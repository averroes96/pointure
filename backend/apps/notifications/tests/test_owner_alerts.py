"""Task 8.3: owner Telegram summaries and alerts."""
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.core.models import StoreSettings, Tenant, User
from apps.notifications.models import OutboundMessage
from apps.notifications.services.owner_dispatch import (
    dispatch_scheduled_alerts,
    notify_discount_approved,
    notify_refund,
    notify_sale_cancelled,
    notify_shift_closed,
)
from apps.notifications.services.owner_messages import (
    build_digest_message,
    build_shift_close_message,
)
from apps.sales.models import CashSession, Return, Sale


@pytest.fixture
def linked(monkeypatch):
    monkeypatch.setattr(
        "apps.core.desktop.backup.load_desktop_config",
        lambda: {"telegram_chats": [{"chat_id": "42", "label": "Patron"}]},
    )


def test_shift_and_digest_builders_use_the_owner_language():
    shift = build_shift_close_message({
        "cashier": "Amine",
        "branch": "Centre",
        "sales_count": 2,
        "total_sales": Decimal("3000"),
        "payments": {"cash": Decimal("3000")},
        "expected_cash": Decimal("3000"),
        "counted_cash": Decimal("2500"),
        "gap": Decimal("-500"),
        "refunds_count": 1,
        "refunds_amount": Decimal("200"),
        "overrides": [{"receipt": "RC-1", "discount": Decimal("100"), "approver": "Sara"}],
    }, "fr")
    assert shift.splitlines()[0] == "Clôture de caisse"
    assert "Caissier : Amine" in shift
    assert "espèces 3000.00 DZD" in shift
    assert "Écart : -500.00 DZD" in shift
    assert "RC-1 100.00 DZD (Sara)" in shift

    arabic = build_digest_message({
        "day": "2026-11-13",
        "sales_count": 4,
        "total": Decimal("8000"),
        "last_week_count": 1,
        "last_week_total": Decimal("500"),
        "top_models": [{"name": "City", "qty": 3}],
        "low_stock": 2,
        "cheques_due": 1,
        "overdue": Decimal("1500"),
        "layaways": 0,
    }, "ar")
    assert arabic.startswith("ملخص 2026-11-13")
    assert "City (3)" in arabic
    assert "1500.00 DZD" in arabic


@pytest.mark.django_db
def test_shift_close_enqueues_summary_and_gap_alert(linked):
    tenant = Tenant.objects.create(name="Alert Store")
    User.objects.create_user(
        email="owner-alert@example.com", password="password123",
        tenant=tenant, role="owner", language_preference="en", first_name="Nadia",
    )
    cashier = User.objects.create_user(
        email="cashier-alert@example.com", password="password123",
        tenant=tenant, role="cashier", first_name="Amine",
    )
    session = CashSession.objects.create(
        tenant=tenant, cashier=cashier, status="closed",
        actual_cash=Decimal("2500.00"), cash_gap=Decimal("-1500.00"),
    )
    notify_shift_closed(session.pk)
    kinds = set(OutboundMessage.objects.filter(tenant=tenant).values_list("kind", flat=True))
    assert kinds == {f"shift_close:{session.pk}", f"cash_gap:{session.pk}"}
    summary = OutboundMessage.objects.get(tenant=tenant, kind=f"shift_close:{session.pk}")
    assert summary.text.startswith("Shift closed")
    assert summary.recipient == "42"


@pytest.mark.django_db
def test_disabled_alerts_enqueue_nothing(linked):
    tenant = Tenant.objects.create(name="Quiet Store")
    User.objects.create_user(
        email="owner-quiet@example.com", password="password123",
        tenant=tenant, role="owner", language_preference="fr",
    )
    StoreSettings.objects.create(
        tenant=tenant,
        alert_cancel_enabled=False,
        alert_refund_enabled=True,
        alert_refund_amount=Decimal("1000.00"),
        alert_discount_enabled=True,
        alert_discount_pct=10,
    )
    sale = Sale.objects.create(tenant=tenant, total_amount=Decimal("4000.00"), receipt_number="RC-9")
    notify_sale_cancelled(sale.pk)
    assert OutboundMessage.objects.filter(tenant=tenant).count() == 0

    refund = Return.objects.create(
        tenant=tenant, original_sale=sale, reason="taille",
        refund_amount=Decimal("500.00"),
    )
    notify_refund(refund.pk)
    assert OutboundMessage.objects.filter(tenant=tenant).count() == 0

    notify_discount_approved(sale.pk)
    assert OutboundMessage.objects.filter(tenant=tenant).count() == 0


@pytest.mark.django_db
def test_digest_sends_once_after_the_configured_time(linked):
    tenant = Tenant.objects.create(name="Digest Store")
    User.objects.create_user(
        email="owner-digest@example.com", password="password123",
        tenant=tenant, role="owner", language_preference="fr",
    )
    StoreSettings.objects.create(
        tenant=tenant,
        telegram_digest_time="21:00",
        alert_year_open_enabled=False,
        alert_backup_stale_enabled=False,
    )
    morning = timezone.make_aware(datetime(2026, 6, 2, 10, 0))
    dispatch_scheduled_alerts(now=morning)
    assert OutboundMessage.objects.filter(tenant=tenant, kind="digest:2026-06-02").count() == 0

    evening = timezone.make_aware(datetime(2026, 6, 2, 21, 5))
    dispatch_scheduled_alerts(now=evening)
    dispatch_scheduled_alerts(now=evening + timedelta(minutes=10))
    assert OutboundMessage.objects.filter(tenant=tenant, kind="digest:2026-06-02").count() == 1
