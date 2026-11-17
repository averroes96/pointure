"""
Event-driven shipment sync (docs/plans/delivery-v1-plan.md P1.9).
A scripted fake connector stands in for the courier: no network.
"""
import json
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.utils import timezone

from apps.clients.models import ClientLedger
from apps.core.models import PlanChoices, SyncOutbox, Tenant
from apps.delivery_integrations.models import CustomerOrder, ProviderConfig, Shipment
from apps.delivery_integrations.services import catalogue, sync
from apps.delivery_integrations.services.couriers import (
    Capability,
    CashStatus,
    ConnectorAuthError,
    ConnectorRateLimited,
    ConnectorUnavailable,
    CourierReadConnector,
    ParcelPage,
    ParcelSnapshot,
    Payout,
    PayoutLine,
    ShipmentStatus,
    TrackingEvent,
    register,
)
from apps.delivery_integrations.services.couriers import registry
from apps.inventory.models import StockMovement
from apps.sales.models import CashSession, Sale

NOW = timezone.now()


class Script:
    """What the fake courier answers. Tests mutate it between runs."""
    pages = []            # list[list[ParcelSnapshot]]
    history = {}          # external_id → tuple[TrackingEvent]
    payouts = []          # list[Payout]
    statements = {}       # payout id → tuple[PayoutLine]
    pending = ()          # tuple[PayoutLine]
    raise_on_list = None
    capabilities = frozenset({Capability.TEST, Capability.LIST, Capability.GET, Capability.HISTORY,
                              Capability.BALANCE, Capability.PAYOUTS})
    calls = []


class FakeSyncConnector(CourierReadConnector):
    platform = "fakesync"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.capabilities = Script.capabilities

    def auth_headers(self):
        return {}

    def list_parcels(self, cursor=None):
        Script.calls.append(("list", cursor))
        if Script.raise_on_list:
            raise Script.raise_on_list
        index = int(cursor or 0)
        items = Script.pages[index] if index < len(Script.pages) else []
        nxt = str(index + 1) if index + 1 < len(Script.pages) else None
        return ParcelPage(items=tuple(items), next_cursor=nxt)

    def get_parcel(self, ref):
        Script.calls.append(("get", ref))
        return next(s for page in Script.pages for s in page if s.external_id == ref)

    def history(self, ref):
        Script.calls.append(("history", ref))
        return Script.history.get(ref, ())

    def list_payouts(self, cursor=None):
        Script.calls.append(("payouts", cursor))
        return tuple(Script.payouts), None

    def payout_lines(self, payout_id):
        Script.calls.append(("statement", payout_id))
        return Script.statements.get(payout_id, ())

    def pending_payout_lines(self):
        Script.calls.append(("pending", None))
        return Script.pending


def snap(n, minutes_ago, status=ShipmentStatus.DELIVERED, cash=CashStatus.HELD_BY_COURIER, **kw):
    when = NOW - timedelta(minutes=minutes_ago)
    base = dict(external_id=f"ext-{n}", tracking=f"T{n}", status=status, raw_status=f"raw-{status}",
                status_at=when, updated_at=when, cod_amount=Decimal("4900.00"),
                delivery_fee=Decimal("400.00"), store_amount=Decimal("4500.00"), cash_status=cash)
    base.update(kw)
    return ParcelSnapshot(**base)


@pytest.fixture(autouse=True)
def fake_courier(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    saved = dict(registry._REGISTRY)
    register(FakeSyncConnector)
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry({
            "key": "fakecourier", "name": "Fake", "platform": "fakesync", "requiredCredentials": ["apiKey"],
            "capabilities": {}, "endpoint": "https://fake-courier.example.dz/api"})],
    }), encoding="utf-8")
    Script.pages, Script.history, Script.payouts, Script.statements = [], {}, [], {}
    Script.pending, Script.raise_on_list, Script.calls = (), None, []
    Script.capabilities = frozenset({Capability.TEST, Capability.LIST, Capability.GET, Capability.HISTORY,
                                     Capability.BALANCE, Capability.PAYOUTS})
    sync._running.clear(); sync._rerun.clear(); sync._blocked_until.clear()
    yield
    registry._REGISTRY.clear(); registry._REGISTRY.update(saved)


@pytest.fixture
def config(db):
    tenant = Tenant.objects.create(name="Sync Store", plan=PlanChoices.PRO_RETAIL)
    return ProviderConfig.objects.create(tenant=tenant, courier="fakecourier", credentials={"apiKey": "k"})


def _ships(config):
    return Shipment.objects.unscoped().filter(tenant=config.tenant)


# ─── Orders ───────────────────────────────────────────────────────────────────

def test_first_sync_reads_back_90_days_and_sets_the_cursor(config):
    Script.pages = [[snap(1, 10), snap(2, 60 * 24 * 10)], [snap(3, 60 * 24 * 100), snap(4, 60 * 24 * 120)]]
    result = sync.sync_courier(config)

    assert (result.created, result.updated, result.error) == (2, 0, "")
    assert sorted(_ships(config).values_list("external_id", flat=True)) == ["ext-1", "ext-2"]
    assert ("list", "1") in Script.calls   # second page read, stopped at the 100-day-old order
    config.refresh_from_db()
    assert config.sync_cursor == NOW - timedelta(minutes=10)
    assert config.last_sync_error == ""
    assert config.last_synced_at is not None
    ship = _ships(config).get(external_id="ext-1")
    assert (ship.status, ship.cash_status, ship.cod_amount) == (
        ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER, Decimal("4900.00"))


def test_second_sync_stops_at_the_cursor_and_saves_nothing(config):
    Script.pages = [[snap(1, 10), snap(2, 20)], [snap(3, 30)]]
    sync.sync_courier(config)
    config.refresh_from_db()
    outbox = SyncOutbox.objects.filter(tenant=config.tenant, model_name="Shipment").count()
    Script.calls = []

    result = sync.sync_courier(config)

    assert (result.created, result.updated) == (0, 0)
    assert SyncOutbox.objects.filter(tenant=config.tenant, model_name="Shipment").count() == outbox
    assert [c for c in Script.calls if c[0] == "list"] == [("list", None)]  # only the first page


def test_status_change_updates_and_fetches_history_for_that_shipment_only(config):
    Script.pages = [[snap(1, 30, status=ShipmentStatus.OUT_FOR_DELIVERY, cash=CashStatus.AWAITING_DELIVERY),
                     snap(2, 40, status=ShipmentStatus.OUT_FOR_DELIVERY, cash=CashStatus.AWAITING_DELIVERY)]]
    sync.sync_courier(config)
    config.refresh_from_db()
    Script.calls = []
    Script.pages = [[snap(1, 1, status=ShipmentStatus.DELIVERED)]]
    Script.history = {"ext-1": (
        TrackingEvent(status=ShipmentStatus.OUT_FOR_DELIVERY, raw_status="31", occurred_at=NOW - timedelta(hours=2)),
        TrackingEvent(status=ShipmentStatus.DELIVERED, raw_status="41", occurred_at=NOW - timedelta(minutes=1)),
    )}

    result = sync.sync_courier(config)

    assert (result.updated, result.events) == (1, 2)
    assert [c for c in Script.calls if c[0] == "history"] == [("history", "ext-1")]
    ship = _ships(config).get(external_id="ext-1")
    assert (ship.status, ship.is_terminal, ship.cash_status) == (
        ShipmentStatus.DELIVERED, True, CashStatus.HELD_BY_COURIER)
    assert ship.events.count() == 2
    assert _ships(config).get(external_id="ext-2").status == ShipmentStatus.OUT_FOR_DELIVERY


def test_new_shipments_link_to_pointure_orders_of_the_same_store_only(config):
    order_by_tracking = CustomerOrder.objects.create(tenant=config.tenant, customer_name="A",
                                                     customer_phone="0551234567", tracking_number="T1")
    order_by_ref = CustomerOrder.objects.create(tenant=config.tenant, customer_name="B", customer_phone="0661234567")
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    CustomerOrder.objects.create(tenant=other, customer_name="C", customer_phone="0771234567", tracking_number="T3")
    Script.pages = [[snap(1, 5), snap(2, 6, reference=str(order_by_ref.pk)), snap(3, 7), snap(4, 8, reference="not-a-uuid")]]

    sync.sync_courier(config)

    links = dict(_ships(config).values_list("external_id", "customer_order_id"))
    assert links == {"ext-1": order_by_tracking.pk, "ext-2": order_by_ref.pk, "ext-3": None, "ext-4": None}


def test_each_store_only_touches_its_own_shipments(config):
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    other_config = ProviderConfig.objects.create(tenant=other, courier="fakecourier", credentials={"apiKey": "x"})
    Script.pages = [[snap(1, 5)]]
    sync.sync_courier(config)
    Script.pages = [[snap(1, 4, status=ShipmentStatus.RETURNED, cash=CashStatus.NOT_APPLICABLE)]]
    sync.sync_courier(other_config)

    assert _ships(config).get(external_id="ext-1").status == ShipmentStatus.DELIVERED
    assert Shipment.objects.unscoped().get(tenant=other, external_id="ext-1").status == ShipmentStatus.RETURNED


def test_page_cap_marks_the_run_partial(config, monkeypatch):
    monkeypatch.setattr(sync, "MAX_PAGES", 2)
    Script.pages = [[snap(1, 1)], [snap(2, 2)], [snap(3, 3)]]
    result = sync.sync_courier(config)
    assert result.pages == 2
    assert result.error == "partial"
    config.refresh_from_db()
    assert config.last_sync_error == "partial"


def test_sync_never_touches_sales_stock_ledger_or_cash_sessions(config):
    before = (Sale.objects.count(), StockMovement.objects.count(), ClientLedger.objects.count(),
              CashSession.objects.count())
    Script.pages = [[snap(1, 1), snap(2, 2, status=ShipmentStatus.RETURNED, cash=CashStatus.NOT_APPLICABLE)]]
    Script.payouts = [Payout(external_id="p1", paid_on=timezone.localdate())]
    Script.statements = {"p1": (PayoutLine(tracking="T1", amount=Decimal("4500")),)}
    sync.sync_courier(config)
    after = (Sale.objects.count(), StockMovement.objects.count(), ClientLedger.objects.count(),
             CashSession.objects.count())
    assert after == before


# ─── Payouts ──────────────────────────────────────────────────────────────────

def test_payout_statements_mark_shipments_paid_and_move_the_cursor(config):
    today = timezone.localdate()
    Script.pages = [[snap(1, 1), snap(2, 2), snap(3, 3)]]
    Script.payouts = [Payout(external_id="p-new", paid_on=today), Payout(external_id="p-old", paid_on=today - timedelta(days=200))]
    Script.statements = {"p-new": (PayoutLine(tracking="T1", amount=Decimal("4500")),
                                   PayoutLine(tracking="T2", amount=Decimal("4500")))}

    result = sync.sync_courier(config)

    assert result.paid == 2
    assert [c for c in Script.calls if c[0] == "statement"] == [("statement", "p-new")]  # 200-day-old one skipped
    paid = _ships(config).get(external_id="ext-1")
    assert (paid.cash_status, paid.courier_payout_ref, paid.courier_paid_on) == (CashStatus.PAID, "p-new", today)
    assert _ships(config).get(external_id="ext-3").cash_status == CashStatus.HELD_BY_COURIER
    config.refresh_from_db()
    assert config.payout_cursor == today


def test_known_payouts_are_not_read_again_except_the_one_day_overlap(config):
    today = timezone.localdate()
    Script.pages = [[snap(1, 1)]]
    Script.payouts = [Payout(external_id="p-today", paid_on=today),
                      Payout(external_id="p-week", paid_on=today - timedelta(days=7))]
    Script.statements = {"p-today": (PayoutLine(tracking="T1"),)}
    sync.sync_courier(config)
    config.refresh_from_db()
    Script.calls = []

    result = sync.sync_courier(config)

    assert [c for c in Script.calls if c[0] == "statement"] == [("statement", "p-today")]
    assert result.paid == 0   # idempotent: already paid with the same payout


def test_paid_shipment_stays_paid_when_its_order_changes_again(config):
    today = timezone.localdate()
    Script.pages = [[snap(1, 5)]]
    Script.payouts = [Payout(external_id="p1", paid_on=today)]
    Script.statements = {"p1": (PayoutLine(tracking="T1"),)}
    sync.sync_courier(config)
    config.refresh_from_db()
    Script.pages = [[snap(1, 1, recipient_name="Renamed")]]

    sync.sync_courier(config)

    ship = _ships(config).get(external_id="ext-1")
    assert (ship.cash_status, ship.recipient_name) == (CashStatus.PAID, "Renamed")


def test_prepared_payout_marks_ready_and_leaving_it_goes_back_to_held(config):
    Script.pages = [[snap(1, 1), snap(2, 2)]]
    Script.pending = (PayoutLine(tracking="T1"),)
    result = sync.sync_courier(config)
    assert result.ready == 1
    assert _ships(config).get(external_id="ext-1").cash_status == CashStatus.READY
    assert _ships(config).get(external_id="ext-2").cash_status == CashStatus.HELD_BY_COURIER

    config.refresh_from_db()
    Script.pending = ()
    result = sync.sync_courier(config)
    assert result.unready == 1
    assert _ships(config).get(external_id="ext-1").cash_status == CashStatus.HELD_BY_COURIER


# ─── Errors ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raised,code", [
    (ConnectorAuthError(status_code=401), "auth_refused"),
    (ConnectorUnavailable("timeout"), "unreachable"),
    (RuntimeError("boom"), "error"),
])
def test_errors_are_recorded_not_raised(config, raised, code):
    Script.raise_on_list = raised
    result = sync.sync_courier(config)
    assert result.error == code
    config.refresh_from_db()
    assert config.last_sync_error == code


def test_rate_limit_blocks_new_runs_until_retry_after(config):
    Script.raise_on_list = ConnectorRateLimited(retry_after=120)
    assert sync.sync_courier(config).error == "rate_limited"
    with mock.patch.object(sync, "_start_thread") as start:
        assert sync.request_sync(config.pk) == "blocked"
    start.assert_not_called()


def test_balance_only_credentials_are_reported_as_key_scope(config):
    Script.capabilities = frozenset({Capability.TEST, Capability.BALANCE})
    result = sync.sync_courier(config)
    assert result.error == "key_scope"
    assert [c for c in Script.calls if c[0] in ("list", "payouts")] == []


def test_courier_without_connector_is_reported(config):
    ProviderConfig.objects.filter(pk=config.pk).update(courier="unknown-courier")
    config.refresh_from_db()
    assert sync.sync_courier(config).error == "unknown_courier"


# ─── Triggering ───────────────────────────────────────────────────────────────

def test_request_sync_returns_at_once_and_merges_triggers(config):
    with mock.patch.object(sync, "_start_thread") as start:
        assert sync.request_sync(config.pk, "page_open") == "started"
        assert sync.request_sync(config.pk, "refresh") == "merged"
    start.assert_called_once_with(str(config.pk), "page_open")
    assert Script.calls == []   # nothing ran inline
    assert sync.is_running(config.pk) is True


def test_a_merged_trigger_causes_exactly_one_follow_up_run(config):
    runs = []

    def fake_sync(cfg):
        runs.append(cfg.pk)
        if len(runs) == 1:
            sync.request_sync(cfg.pk, "during-run")   # arrives while running
        return sync.SyncResult()

    sync._running.add(str(config.pk))
    with mock.patch.object(sync, "sync_courier", side_effect=fake_sync), \
         mock.patch.object(sync, "connection"), mock.patch.object(sync, "close_old_connections"):
        sync._run(str(config.pk), "page_open")

    assert runs == [config.pk, config.pk]
    assert sync.is_running(config.pk) is False


def test_inactive_courier_accounts_are_not_synced(config):
    ProviderConfig.objects.filter(pk=config.pk).update(is_active=False)
    sync._running.add(str(config.pk))
    with mock.patch.object(sync, "sync_courier") as run, \
         mock.patch.object(sync, "connection"), mock.patch.object(sync, "close_old_connections"):
        sync._run(str(config.pk), "refresh")
    run.assert_not_called()


# ─── One shipment ─────────────────────────────────────────────────────────────

def test_sync_shipment_rereads_the_parcel_and_its_history(config):
    Script.pages = [[snap(1, 30, status=ShipmentStatus.OUT_FOR_DELIVERY, cash=CashStatus.AWAITING_DELIVERY)]]
    sync.sync_courier(config)
    ship = _ships(config).get(external_id="ext-1")
    Script.pages = [[snap(1, 1, status=ShipmentStatus.DELIVERED)]]
    Script.history = {"ext-1": (TrackingEvent(status=ShipmentStatus.DELIVERED, raw_status="41",
                                              occurred_at=NOW - timedelta(minutes=1)),)}

    assert sync.sync_shipment(ship) == ""
    ship.refresh_from_db()
    assert ship.status == ShipmentStatus.DELIVERED
    assert ship.events.count() == 1


def test_sync_shipment_reports_errors(config):
    Script.pages = [[snap(1, 1)]]
    sync.sync_courier(config)
    ship = _ships(config).get(external_id="ext-1")
    with mock.patch.object(FakeSyncConnector, "get_parcel", side_effect=ConnectorUnavailable("timeout")):
        assert sync.sync_shipment(ship) == "unavailable"
