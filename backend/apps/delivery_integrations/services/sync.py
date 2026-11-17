"""
Event-driven shipment sync (docs/plans/delivery-v1-plan.md P1.9, DL.5).

`request_sync()` is called when something happens (Shipments page opened, Refresh,
after a dispatch). It starts ONE background run per courier account and returns at
once; a trigger that arrives during a run is merged into one follow-up run.

Rules (AGENTS.md §3, §4.2, §4.7):
- courier calls happen outside any transaction; each page is saved in one short
  transaction, and only shipments that changed are saved;
- no request tenant exists in the thread: every query filters by tenant explicitly;
- failures are logged and recorded on the ProviderConfig, never raised to a request;
- never writes Sale, StockMovement, ClientLedger, CashSession or loyalty data (DL.3).
"""
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import close_old_connections, connection, transaction
from django.db.models import Q
from django.utils import timezone

from ..models import CustomerOrder, ProviderConfig, Shipment
from . import couriers, lifecycle
from .couriers import CashStatus, Capability

logger = logging.getLogger(__name__)

MAX_PAGES = 40                  # 40 × 100 Maystro orders per run
FIRST_SYNC_DAYS = 90
CURSOR_OVERLAP = timedelta(minutes=5)
MAX_HISTORY_CALLS = 30          # history of status changes; the rest loads when a shipment is opened
MAX_PAYOUT_PAGES = 10
MAX_STATEMENTS = 20
PAYOUT_OVERLAP = timedelta(days=1)


@dataclass
class SyncResult:
    pages: int = 0
    created: int = 0
    updated: int = 0
    events: int = 0
    paid: int = 0
    ready: int = 0
    unready: int = 0
    error: str = ""
    partial: bool = False
    lifecycle: dict = field(default_factory=dict)   # outcome → count (P2.5)


# ─── Run bookkeeping (process-local) ──────────────────────────────────────────

_lock = threading.Lock()
_running: set = set()           # provider_config ids with a run in progress
_rerun: set = set()             # ids that got a trigger during their run
_blocked_until: dict = {}       # id → time.monotonic() deadline after a rate limit


def is_running(config_id) -> bool:
    with _lock:
        return str(config_id) in _running


def request_sync(config_id, trigger="manual") -> str:
    """
    Start a background sync of one courier account. Returns at once with
    "started", "merged" (a run is in progress; one more will follow) or "blocked"
    (the courier asked us to wait after a rate limit).
    """
    key = str(config_id)
    with _lock:
        deadline = _blocked_until.get(key)
        if deadline and time.monotonic() < deadline:
            return "blocked"
        if key in _running:
            _rerun.add(key)
            return "merged"
        _running.add(key)
    try:
        _start_thread(key, trigger)
    except Exception:
        with _lock:
            _running.discard(key)
        logger.exception("Could not start the shipment sync thread")
        return "error"
    return "started"


def _start_thread(key, trigger):
    threading.Thread(target=_run, args=(key, trigger), name=f"shipment-sync-{key[:8]}", daemon=True).start()


def _run(key, trigger):
    try:
        while True:
            close_old_connections()
            try:
                config = ProviderConfig.objects.unscoped().select_related("tenant").get(pk=key)
                if config.is_active:
                    sync_courier(config)
            except ProviderConfig.DoesNotExist:
                pass
            except Exception:
                logger.exception("Shipment sync crashed (config %s, trigger %s)", key, trigger)
            with _lock:
                if key in _rerun:
                    _rerun.discard(key)
                    continue
                _running.discard(key)
                break
    finally:
        connection.close()  # the thread's own SQLite connection


# ─── Sync of one courier account ──────────────────────────────────────────────

def sync_courier(config) -> SyncResult:
    """Read changed orders, then payouts, and update the store's shipments. Never raises."""
    result = SyncResult()
    try:
        connector = couriers.get_connector(config)
        if connector.supports(Capability.LIST):
            _sync_orders(config, connector, result)
        if connector.supports(Capability.PAYOUTS):
            _sync_payouts(config, connector, result)
        else:
            # e.g. a Maystro ak_ key: valid, but cannot read orders or payouts.
            result.error = "key_scope" if not connector.supports(Capability.LIST) else ""
    except couriers.ConnectorNotSupported as exc:
        result.error = exc.reason[:50]
    except couriers.ConnectorRateLimited as exc:
        result.error = "rate_limited"
        with _lock:
            _blocked_until[str(config.pk)] = time.monotonic() + exc.retry_after
    except couriers.ConnectorAuthError:
        result.error = "auth_refused"
    except couriers.ConnectorForbidden:
        result.error = "forbidden"
    except couriers.ConnectorUnavailable:
        result.error = "unreachable"
    except couriers.ConnectorError as exc:
        result.error = "connector_error"
        logger.warning("Shipment sync: connector error %s (config %s)", exc, config.pk)
    except Exception:
        result.error = "error"
        logger.exception("Shipment sync failed (config %s)", config.pk)

    if result.partial and not result.error:
        result.error = "partial"
    ProviderConfig.objects.unscoped().filter(pk=config.pk).update(
        last_synced_at=timezone.now(), last_sync_error=result.error,
    )
    logger.info(
        "Shipment sync %s: pages=%d created=%d updated=%d events=%d paid=%d ready=%d unready=%d "
        "orders=%s error=%s",
        config.courier, result.pages, result.created, result.updated, result.events,
        result.paid, result.ready, result.unready, result.lifecycle or "-", result.error or "-",
    )
    return result


def _sync_orders(config, connector, result):
    floor = (config.sync_cursor - CURSOR_OVERLAP) if config.sync_cursor else (
        timezone.now() - timedelta(days=FIRST_SYNC_DAYS)
    )
    newest = config.sync_cursor
    changed_status = []
    linked = []          # shipments of Pointure orders that reached a status the lifecycle acts on
    cursor = None
    reached_floor = False

    while result.pages < MAX_PAGES:
        page = connector.list_parcels(cursor)          # network, outside any transaction
        result.pages += 1
        batch = []
        for snap in page.items:
            if snap.updated_at is not None and snap.updated_at <= floor:
                reached_floor = True
                break
            batch.append(snap)
            if snap.updated_at and (newest is None or snap.updated_at > newest):
                newest = snap.updated_at
        if batch:
            page_changed, page_linked = _save_page(config, batch, result)
            changed_status += page_changed
            linked += page_linked
        if reached_floor or not page.next_cursor:
            break
        cursor = page.next_cursor
    else:
        result.partial = True
        logger.warning("Shipment sync %s stopped at %d pages before reaching its cursor", config.courier, MAX_PAGES)

    # History of status changes (outside transactions, capped). New parcels of Pointure
    # orders that are already final get theirs too: "cancelled before pickup" needs it.
    if connector.supports(Capability.HISTORY):
        wanted = changed_status + [s for s in linked if s not in changed_status]
        for shipment in wanted[:MAX_HISTORY_CALLS]:
            events = connector.history(shipment.external_id)
            with transaction.atomic():
                result.events += shipment.merge_events(events)

    # Pointure orders: sale at delivery, stock back on return (P2.5). One transaction each.
    for shipment in linked:
        outcome = lifecycle.apply(shipment)
        if outcome:
            result.lifecycle[outcome] = result.lifecycle.get(outcome, 0) + 1

    if newest is not None and newest != config.sync_cursor:
        ProviderConfig.objects.unscoped().filter(pk=config.pk).update(sync_cursor=newest)
        config.sync_cursor = newest


def _save_page(config, snapshots, result):
    """Upsert one page in one short transaction. Returns existing shipments whose status changed."""
    tenant = config.tenant
    ids = [s.external_id for s in snapshots]
    now = timezone.now()
    status_changed = []
    linked = []
    with transaction.atomic():
        existing = {
            s.external_id: s
            for s in Shipment.objects.unscoped().filter(tenant=tenant, courier=config.courier, external_id__in=ids)
        }
        orders = _orders_by_key(tenant, snapshots, existing)
        for snap in snapshots:
            shipment = existing.get(snap.external_id)
            if shipment is None:
                shipment = Shipment(
                    tenant=tenant, provider_config=config, courier=config.courier,
                    external_id=snap.external_id[:64],
                )
                shipment.apply_snapshot(snap)
                shipment.customer_order = orders.get(snap.reference) or orders.get(snap.tracking)
                shipment.last_synced_at = now
                shipment.save()
                result.created += 1
                if lifecycle.needs_lifecycle(shipment):
                    linked.append(shipment)
                continue
            changed = shipment.apply_snapshot(snap)
            if changed:
                shipment.last_synced_at = now
                shipment.save(update_fields=changed + ["last_synced_at", "updated_at"])
                result.updated += 1
                if "status" in changed:
                    status_changed.append(shipment)
                    if lifecycle.needs_lifecycle(shipment):
                        linked.append(shipment)
    return status_changed, linked


def _orders_by_key(tenant, snapshots, existing):
    """Pointure CustomerOrders matching new shipments, by our reference (order id) or tracking number."""
    new = [s for s in snapshots if s.external_id not in existing]
    refs = {s.reference for s in new if s.reference}
    trackings = {s.tracking for s in new if s.tracking}
    if not refs and not trackings:
        return {}
    query = Q(tracking_number__in=trackings)
    uuid_refs = [r for r in refs if _looks_like_uuid(r)]
    if uuid_refs:
        query |= Q(pk__in=uuid_refs)
    found = {}
    for order in CustomerOrder.objects.unscoped().filter(query, tenant=tenant):
        found[str(order.pk)] = order
        if order.tracking_number:
            found[order.tracking_number] = order
    return found


def _looks_like_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


# ─── Payouts → paid / ready ───────────────────────────────────────────────────

def _sync_payouts(config, connector, result):
    tenant = config.tenant
    cutoff = (config.payout_cursor - PAYOUT_OVERLAP) if config.payout_cursor else (
        timezone.localdate() - timedelta(days=FIRST_SYNC_DAYS)
    )

    # 1. Paid: statements of payouts newer than the cursor.
    to_read, cursor, pages = [], None, 0
    while pages < MAX_PAYOUT_PAGES:
        payouts, cursor = connector.list_payouts(cursor)
        pages += 1
        to_read += [p for p in payouts if p.paid_on is None or p.paid_on >= cutoff]
        if not cursor:
            break
    to_read.sort(key=lambda p: (p.paid_on is None, p.paid_on))
    newest_paid_on = config.payout_cursor
    for payout in to_read[:MAX_STATEMENTS]:
        lines = connector.payout_lines(payout.external_id)    # network, outside transactions
        trackings = {line.tracking for line in lines if line.tracking}
        with transaction.atomic():
            for shipment in Shipment.objects.unscoped().filter(
                tenant=tenant, courier=config.courier, tracking_number__in=trackings,
            ):
                if (shipment.cash_status, shipment.courier_payout_ref, shipment.courier_paid_on) != (
                    CashStatus.PAID, payout.external_id[:64], payout.paid_on,
                ):
                    shipment.cash_status = CashStatus.PAID
                    shipment.courier_payout_ref = payout.external_id[:64]
                    shipment.courier_paid_on = payout.paid_on
                    shipment.save(update_fields=["cash_status", "courier_payout_ref", "courier_paid_on", "updated_at"])
                    result.paid += 1
        if payout.paid_on and (newest_paid_on is None or payout.paid_on > newest_paid_on):
            newest_paid_on = payout.paid_on
    if len(to_read) > MAX_STATEMENTS:
        result.partial = True
    if newest_paid_on != config.payout_cursor:
        ProviderConfig.objects.unscoped().filter(pk=config.pk).update(payout_cursor=newest_paid_on)
        config.payout_cursor = newest_paid_on

    # 2. Ready: the payout the courier is preparing.
    pending = {line.tracking for line in connector.pending_payout_lines() if line.tracking}
    with transaction.atomic():
        mine = Shipment.objects.unscoped().filter(tenant=tenant, courier=config.courier)
        for shipment in mine.filter(cash_status=CashStatus.HELD_BY_COURIER, tracking_number__in=pending):
            shipment.cash_status = CashStatus.READY
            shipment.save(update_fields=["cash_status", "updated_at"])
            result.ready += 1
        # Left the prepared payout without being paid: back to "held by the courier".
        for shipment in mine.filter(cash_status=CashStatus.READY, courier_payout_ref="").exclude(
            tracking_number__in=pending,
        ):
            shipment.cash_status = CashStatus.HELD_BY_COURIER
            shipment.save(update_fields=["cash_status", "updated_at"])
            result.unready += 1


# ─── One shipment (opened in the UI) ──────────────────────────────────────────

_shipments_running: set = set()


def shipment_refreshing(shipment_id) -> bool:
    with _lock:
        return str(shipment_id) in _shipments_running


def request_shipment_refresh(shipment_id) -> str:
    """Re-read one shipment in the background (once at a time). Returns "started" or "running"."""
    key = str(shipment_id)
    with _lock:
        if key in _shipments_running:
            return "running"
        _shipments_running.add(key)
    try:
        _start_shipment_thread(key)
    except Exception:
        with _lock:
            _shipments_running.discard(key)
        logger.exception("Could not start the shipment refresh thread")
        return "error"
    return "started"


def _start_shipment_thread(key):
    threading.Thread(target=_run_shipment, args=(key,), name=f"shipment-refresh-{key[:8]}", daemon=True).start()


def _run_shipment(key):
    try:
        close_old_connections()
        shipment = Shipment.objects.unscoped().select_related("provider_config").filter(pk=key).first()
        if shipment is not None and shipment.provider_config.is_active:
            sync_shipment(shipment)
    except Exception:
        logger.exception("Shipment refresh crashed (shipment %s)", key)
    finally:
        with _lock:
            _shipments_running.discard(key)
        connection.close()


def sync_shipment(shipment) -> str:
    """
    Re-read one shipment and its full history. Called in the background when a
    shipment is opened. Returns "" on success or an error code. Never raises.
    """
    config = shipment.provider_config
    try:
        connector = couriers.get_connector(config)
        snap = connector.get_parcel(shipment.external_id) if connector.supports(Capability.GET) else None
        events = connector.history(shipment.external_id) if connector.supports(Capability.HISTORY) else ()
    except couriers.ConnectorNotSupported as exc:
        return exc.reason[:50]
    except couriers.ConnectorError as exc:
        return getattr(exc, "code", "connector_error")
    except Exception:
        logger.exception("Shipment refresh failed (shipment %s)", shipment.pk)
        return "error"
    with transaction.atomic():
        if snap is not None:
            changed = shipment.apply_snapshot(snap)
            if changed:
                shipment.last_synced_at = timezone.now()
                shipment.save(update_fields=changed + ["last_synced_at", "updated_at"])
        shipment.merge_events(events)
    return ""
