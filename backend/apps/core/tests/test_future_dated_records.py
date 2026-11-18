"""
`check_future_dated_records` reports rows dated after "now" and whether the time guard is affected.

Context: one store's log began with the clock at 2072, then 2027, then 2026. The anti-rollback guard never
dates a sale before the latest sale or stock movement, so a single row in the future dates every later
sale in the future too. The command shows whether a database is in that state. It only reads.
"""
from datetime import timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.core.management.commands.check_future_dated_records import event_time_fields
from apps.core.models import Tenant
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import Payment, Sale


def _run(*args):
    out = StringIO()
    call_command("check_future_dated_records", *args, stdout=out)
    return out.getvalue()


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(name="Clock Store")


def _sale(tenant, when, n=1):
    sale = Sale.objects.create(tenant=tenant, status="completed", total_amount=Decimal("100"), receipt_number=f"C{n}")
    Sale.objects.filter(pk=sale.pk).update(created_at=when)
    return sale


def test_an_empty_database_has_nothing_to_report(db):
    text = _run()
    assert "No record is dated in the future." in text
    assert "Time guard: no sale or stock movement yet" in text


def test_recent_and_past_records_are_not_reported(tenant):
    now = timezone.now()
    _sale(tenant, now - timedelta(days=3), 1)
    _sale(tenant, now + timedelta(minutes=2), 2)               # within the default 10-minute tolerance
    text = _run()
    assert "No record is dated in the future." in text
    assert "Time guard: not affected" in text


def test_future_rows_are_listed_per_table_with_their_range(tenant):
    now = timezone.now()
    first = _sale(tenant, now + timedelta(days=400), 1)
    _sale(tenant, now + timedelta(days=500), 2)
    _sale(tenant, now - timedelta(days=1), 3)

    product = Product.objects.create(tenant=tenant, name="P", sale_price=Decimal("100"), purchase_price=Decimal("50"))
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=42, colour="Noir")
    movement = StockMovement.objects.create(tenant=tenant, variant=variant, quantity_delta=2,
                                            reason=MovementReasonChoices.INITIAL)
    StockMovement.objects.filter(pk=movement.pk).update(timestamp=now + timedelta(days=400))
    payment = Payment.objects.create(sale=first, amount=Decimal("100"), method="cash")
    Payment.objects.filter(pk=payment.pk).update(recorded_at=now + timedelta(days=400))

    text = _run()

    assert "Records dated in the future:" in text
    assert "sales.Sale.created_at: 2 row(s)" in text
    assert "inventory.StockMovement.timestamp: 1 row(s)" in text
    assert "sales.Payment.recorded_at: 1 row(s)" in text
    expected_first = timezone.localtime(now + timedelta(days=400)).strftime("%d/%m/%Y")
    expected_last = timezone.localtime(now + timedelta(days=500)).strftime("%d/%m/%Y")
    line = next(line for line in text.splitlines() if "sales.Sale.created_at" in line)
    assert expected_first in line and expected_last in line


def test_the_time_guard_is_reported_as_affected_when_the_latest_sale_is_ahead(tenant):
    _sale(tenant, timezone.now() + timedelta(days=400))
    text = _run()
    assert "Time guard AFFECTED" in text
    assert "day(s) ahead of the PC clock" in text


def test_the_tolerance_can_be_changed(tenant):
    _sale(tenant, timezone.now() + timedelta(minutes=30))
    assert "sales.Sale.created_at: 1 row(s)" in _run()                          # default 10 minutes: 30 is beyond it
    assert "No record is dated in the future." in _run("--tolerance-minutes", "60")


def test_moments_meant_to_be_in_the_future_are_not_scanned():
    names = {f"{model._meta.label}.{field.name}" for model, field in event_time_fields()}
    assert "sales.Sale.created_at" in names and "inventory.StockMovement.timestamp" in names
    assert not [n for n in names if any(word in n.rsplit(".", 1)[1] for word in ("expire", "valid", "scheduled", "retry", "next"))]
    assert not [n for n in names if n.startswith(("auth.", "sessions.", "token_blacklist.", "admin."))]


def test_the_command_writes_nothing(tenant):
    sale = _sale(tenant, timezone.now() + timedelta(days=400))
    before = Sale.objects.filter(pk=sale.pk).values_list("created_at", flat=True).get()
    _run()
    assert Sale.objects.filter(pk=sale.pk).values_list("created_at", flat=True).get() == before
