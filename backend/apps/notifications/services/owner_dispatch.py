"""
Queue owner Telegram summaries and alerts.

Message text is built first. Delivery stays on the outbound queue and runs
after commit, off the request thread. A failure here must not break the sale.
"""
import logging
import threading
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import close_old_connections, transaction
from django.db.models import F, Sum
from django.utils import timezone

from apps.notifications.models import OutboundMessage
from apps.notifications.services.owner_messages import (
    build_backup_alert,
    build_cancel_alert,
    build_digest_message,
    build_discount_alert,
    build_gap_alert,
    build_refund_alert,
    build_shift_close_message,
    build_year_alert,
)
from apps.notifications.services.telegram_link import chat_list

logger = logging.getLogger(__name__)


def after_commit(callback):
    """Run after the current transaction commits. Swallow delivery errors."""
    def runner():
        try:
            callback()
        except Exception:
            logger.exception("Owner Telegram alert failed")
    transaction.on_commit(runner)


def owner_language(tenant) -> str:
    from apps.core.models import User
    owner = (
        User.objects.filter(tenant=tenant, role="owner", is_active=True)
        .order_by("date_joined")
        .only("language_preference")
        .first()
    )
    lang = getattr(owner, "language_preference", None) or "fr"
    return lang if lang in ("fr", "ar", "en") else "fr"


def store_alert_settings(tenant):
    from apps.core.models import StoreSettings
    settings_obj, _created = StoreSettings.objects.get_or_create(tenant=tenant)
    return settings_obj


def enqueue_telegram(tenant, kind: str, text: str) -> int:
    from apps.core.desktop.backup import load_desktop_config
    chats = chat_list(load_desktop_config())
    if not chats or not text:
        return 0
    if OutboundMessage.objects.filter(tenant=tenant, kind=kind).exists():
        return 0
    for chat in chats:
        OutboundMessage.objects.create(
            tenant=tenant,
            channel=OutboundMessage.Channel.TELEGRAM,
            recipient=chat["chat_id"],
            kind=kind,
            text=text,
        )
    transaction.on_commit(_flush_outbound_queue)
    return len(chats)


def _flush_outbound_queue():
    """Send queued rows after commit, without Celery.

    The web process must not publish to the broker: a down or mismatched
    Redis would log an error on every refund. A daemon thread keeps the
    HTTPS call off the request and off SQLite's write lock.
    """
    threading.Thread(target=_dispatch_outbound_now, daemon=True).start()


def _dispatch_outbound_now():
    from apps.notifications.services.outbound import dispatch_due_messages
    close_old_connections()
    try:
        dispatch_due_messages()
    except Exception:
        logger.exception("Outbound Telegram delivery failed")
    finally:
        close_old_connections()


def _person_name(user) -> str:
    if not user:
        return "—"
    return user.get_full_name() or user.email or user.phone or "—"


def notify_shift_closed(session_id):
    from apps.sales.models import CashSession, Return
    from apps.sales.services.z_report import compute_session_stats

    session = (
        CashSession.objects.select_related("cashier", "branch", "tenant")
        .filter(pk=session_id)
        .first()
    )
    if session is None:
        return
    stats = compute_session_stats(session)
    overrides = []
    for sale in session.sales.filter(authorized_by__isnull=False).select_related("authorized_by"):
        overrides.append({
            "receipt": sale.receipt_number or str(sale.pk)[:8],
            "discount": sale.discount_amount,
            "approver": _person_name(sale.authorized_by),
        })
    returns = Return.objects.filter(tenant=session.tenant, authorized_by__isnull=False)
    if session.opened_at:
        returns = returns.filter(created_at__gte=session.opened_at)
        if session.closed_at:
            returns = returns.filter(created_at__lte=session.closed_at)
    for item in returns.select_related("authorized_by", "original_sale"):
        overrides.append({
            "receipt": item.original_sale.receipt_number or str(item.pk)[:8],
            "discount": item.refund_amount,
            "approver": _person_name(item.authorized_by),
        })
    lang = owner_language(session.tenant)
    payload = {
        "cashier": _person_name(session.cashier),
        "branch": session.branch.name if session.branch_id else "—",
        "sales_count": stats["sales_count"],
        "total_sales": stats["total_sales"],
        "payments": {
            "cash": stats["cash_sales"],
            "tpe": stats["tpe_sales"],
            "baridimob": stats["baridimob_sales"],
            "cheque": stats["cheque_sales"],
            "ccp": stats["ccp_sales"],
            "virement": stats["virement_sales"],
            "account": stats["account_sales"],
        },
        "expected_cash": stats["expected_cash"],
        "counted_cash": session.actual_cash,
        "gap": session.cash_gap,
        "refunds_count": stats["refunds_count"],
        "refunds_amount": stats["refunds_amount"],
        "overrides": overrides,
    }
    enqueue_telegram(
        session.tenant,
        f"shift_close:{session.pk}",
        build_shift_close_message(payload, lang),
    )
    settings_obj = store_alert_settings(session.tenant)
    gap = abs(session.cash_gap or Decimal("0"))
    if settings_obj.alert_cash_gap_enabled and gap > settings_obj.alert_cash_gap_amount:
        enqueue_telegram(
            session.tenant,
            f"cash_gap:{session.pk}",
            build_gap_alert({
                "gap": session.cash_gap,
                "threshold": settings_obj.alert_cash_gap_amount,
                "cashier": payload["cashier"],
            }, lang),
        )


def notify_sale_cancelled(sale_id):
    from apps.sales.models import Sale
    sale = Sale.objects.select_related("tenant").filter(pk=sale_id).first()
    if sale is None:
        return
    settings_obj = store_alert_settings(sale.tenant)
    if not settings_obj.alert_cancel_enabled:
        return
    enqueue_telegram(
        sale.tenant,
        f"cancel:{sale.pk}",
        build_cancel_alert({
            "receipt": sale.receipt_number,
            "amount": sale.total_amount,
        }, owner_language(sale.tenant)),
    )


def notify_refund(return_id):
    from apps.sales.models import Return
    item = Return.objects.select_related("tenant", "original_sale").filter(pk=return_id).first()
    if item is None:
        return
    settings_obj = store_alert_settings(item.tenant)
    if not settings_obj.alert_refund_enabled:
        return
    if (item.refund_amount or Decimal("0")) <= settings_obj.alert_refund_amount:
        return
    enqueue_telegram(
        item.tenant,
        f"refund:{item.pk}",
        build_refund_alert({
            "receipt": item.original_sale.receipt_number,
            "amount": item.refund_amount,
        }, owner_language(item.tenant)),
    )


def sale_discount_pct(sale) -> Decimal:
    gross = Decimal("0")
    off = Decimal(sale.discount_amount or 0)
    for item in sale.items.all():
        gross += Decimal(item.unit_price) * item.quantity
        off += Decimal(item.discount_amount or 0)
    if gross <= 0:
        return Decimal("0.00")
    return (off / gross * Decimal("100")).quantize(Decimal("0.01"))


def notify_discount_approved(sale_id):
    from apps.sales.models import Sale
    sale = Sale.objects.select_related("tenant", "authorized_by").filter(pk=sale_id).first()
    if sale is None or sale.authorized_by_id is None:
        return
    settings_obj = store_alert_settings(sale.tenant)
    if not settings_obj.alert_discount_enabled:
        return
    pct = sale_discount_pct(sale)
    if pct <= Decimal(settings_obj.alert_discount_pct):
        return
    enqueue_telegram(
        sale.tenant,
        f"discount:{sale.pk}",
        build_discount_alert({
            "pct": pct,
            "approver": _person_name(sale.authorized_by),
            "receipt": sale.receipt_number,
        }, owner_language(sale.tenant)),
    )


def collect_digest(tenant, day) -> dict:
    from apps.clients.models import Cheque, Client
    from apps.inventory.models import Variant
    from apps.sales.models import Sale, SaleItem

    def totals(on_day):
        qs = Sale.objects.filter(
            tenant=tenant,
            created_at__date=on_day,
            status__in=["completed", "partially_paid", "layaway"],
        )
        return qs.count(), qs.aggregate(total=Sum("total_amount"))["total"] or Decimal("0")

    sales_count, total = totals(day)
    last_count, last_total = totals(day - timedelta(days=7))
    top = list(
        SaleItem.objects.filter(
            sale__tenant=tenant,
            sale__created_at__date=day,
            sale__status__in=["completed", "partially_paid", "layaway"],
        )
        .values("variant__product__name")
        .annotate(qty=Sum("quantity"))
        .order_by("-qty")[:5]
    )
    low_stock = Variant.objects.filter(
        tenant=tenant,
        alert_threshold__gt=0,
        stock_qty__lte=F("alert_threshold"),
    ).count()
    cheques_due = Cheque.objects.filter(
        tenant=tenant,
        status="pending",
        direction="receivable",
        due_date=day + timedelta(days=1),
    ).count()
    overdue = Client.objects.filter(
        tenant=tenant,
        cached_balance__gt=0,
        invoices__due_date__lt=day,
        invoices__status__in=["sent", "partial"],
    ).distinct().aggregate(total=Sum("cached_balance"))["total"] or Decimal("0")
    layaways = Sale.objects.filter(
        tenant=tenant,
        status="layaway",
        layaway_expires_at__isnull=False,
        layaway_expires_at__lte=day,
    ).count()
    return {
        "day": day.isoformat(),
        "sales_count": sales_count,
        "total": total,
        "last_week_count": last_count,
        "last_week_total": last_total,
        "top_models": [{"name": row["variant__product__name"], "qty": row["qty"]} for row in top],
        "low_stock": low_stock,
        "cheques_due": cheques_due,
        "overdue": overdue,
        "layaways": layaways,
    }


def _backup_is_stale(now: datetime) -> bool:
    from apps.core.desktop.backup import load_desktop_config
    config = load_desktop_config()
    if not str(config.get("backup_destination_dir") or "").strip():
        return False
    raw = config.get("last_external_backup_at")
    if not raw:
        return True
    try:
        stamp = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return True
    if stamp.tzinfo is None:
        stamp = timezone.make_aware(stamp, timezone.get_current_timezone())
    return now - stamp > timedelta(days=3)


def dispatch_scheduled_alerts(now=None):
    """Digest at the store's chosen time, plus the year-end and backup alerts."""
    from apps.closing.models import FiscalYear, FiscalYearStatusChoices
    from apps.core.models import Tenant

    now = timezone.localtime(now or timezone.now())
    today = now.date()
    for tenant in Tenant.objects.filter(is_active=True):
        settings_obj = store_alert_settings(tenant)
        lang = owner_language(tenant)
        digest_at = settings_obj.telegram_digest_time
        if now.time() >= digest_at:
            kind = f"digest:{today.isoformat()}"
            if not OutboundMessage.objects.filter(tenant=tenant, kind=kind).exists():
                enqueue_telegram(tenant, kind, build_digest_message(collect_digest(tenant, today), lang))
        if (
            settings_obj.alert_year_open_enabled
            and today.month == 1
            and today.day >= 15
        ):
            year = today.year - 1
            closed = FiscalYear.objects.filter(
                tenant=tenant, year=year, status=FiscalYearStatusChoices.CLOSED,
            ).exists()
            if not closed:
                enqueue_telegram(tenant, f"year_open:{year}", build_year_alert(year, lang))
        if settings_obj.alert_backup_stale_enabled and _backup_is_stale(now):
            enqueue_telegram(
                tenant,
                f"backup_stale:{today.isoformat()}",
                build_backup_alert(lang),
            )
