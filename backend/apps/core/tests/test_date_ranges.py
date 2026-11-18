"""
`day_range` / `on_day` return the same rows as `created_at__date...` (in the store's time zone) but as a
datetime range an index can serve.

Context: a store's perf.log showed report pages taking 1-15 s on a PC with a few years of sales, because
`created_at__date__gte` wraps the column in `django_datetime_cast_date(...)` and so reads every row.
"""
from datetime import date, datetime
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.core.models import Tenant
from apps.core.utils.dates import day_range, on_day, start_of_day
from apps.sales.models import Sale


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(name="Dates Store")


def _local(y, m, d, hh=0, mm=0, ss=0, us=0):
    return timezone.make_aware(datetime(y, m, d, hh, mm, ss, us))


def _sale(tenant, when, n):
    sale = Sale.objects.create(tenant=tenant, status="completed", total_amount=Decimal("100"), receipt_number=f"R{n}")
    Sale.objects.filter(pk=sale.pk).update(created_at=when)
    return sale.pk


@pytest.fixture
def around_midnight(tenant):
    """Sales just before and after local midnight on 2026-03-10 (also across UTC midnight: Algiers is UTC+1)."""
    moments = [
        _local(2026, 3, 9, 23, 59, 59, 999999),    # last instant of the 9th
        _local(2026, 3, 10, 0, 0, 0),              # first instant of the 10th (23:00 UTC on the 9th)
        _local(2026, 3, 10, 0, 59, 59),            # still the 10th local, but already the 10th UTC
        _local(2026, 3, 10, 12, 0),
        _local(2026, 3, 10, 23, 59, 59, 999999),   # last instant of the 10th
        _local(2026, 3, 11, 0, 0, 0),              # first instant of the 11th
        _local(2026, 3, 12, 8, 30),
    ]
    return {when: _sale(tenant, when, i) for i, when in enumerate(moments)}


def _ids(qs):
    return set(qs.values_list("pk", flat=True))


@pytest.mark.parametrize("start,end", [
    (date(2026, 3, 10), date(2026, 3, 10)),
    (date(2026, 3, 10), date(2026, 3, 11)),
    (date(2026, 3, 9), date(2026, 3, 10)),
    (date(2026, 3, 11), date(2026, 3, 12)),
    (date(2026, 3, 1), date(2026, 3, 9)),
    (date(2026, 3, 12), date(2026, 3, 31)),
    (date(2026, 3, 13), date(2026, 3, 20)),      # nothing there
    (date(2026, 3, 10), date(2026, 3, 9)),       # reversed: empty, like __date
    (date(2026, 3, 10), None),
    (None, date(2026, 3, 10)),
    (None, None),
])
def test_day_range_returns_the_same_sales_as_the_date_lookup(tenant, around_midnight, start, end):
    reference = Sale.objects.filter(tenant=tenant)
    if start:
        reference = reference.filter(created_at__date__gte=start)
    if end:
        reference = reference.filter(created_at__date__lte=end)
    ranged = Sale.objects.filter(tenant=tenant, **day_range("created_at", start, end))
    assert _ids(ranged) == _ids(reference)


def test_on_day_is_exactly_the_local_calendar_day(tenant, around_midnight):
    tenth = Sale.objects.filter(tenant=tenant, **on_day("created_at", date(2026, 3, 10)))
    assert _ids(tenth) == _ids(Sale.objects.filter(tenant=tenant, created_at__date=date(2026, 3, 10)))
    assert tenth.count() == 4                      # 00:00:00, 00:59:59, 12:00 and 23:59:59.999999


def test_day_range_follows_a_relation_with_a_prefix(tenant, around_midnight):
    from apps.inventory.models import Product, Variant
    from apps.sales.models import SaleItem
    product = Product.objects.create(tenant=tenant, name="P", sale_price=Decimal("100"), purchase_price=Decimal("50"))
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=42, colour="Noir")
    for pk in around_midnight.values():
        SaleItem.objects.create(sale_id=pk, variant=variant, quantity=1, unit_price=Decimal("100"))

    ranged = SaleItem.objects.filter(**on_day("created_at", date(2026, 3, 10), prefix="sale__"))
    assert ranged.count() == 4
    assert ranged.count() == SaleItem.objects.filter(sale__created_at__date=date(2026, 3, 10)).count()


def test_bounds_are_local_midnights(db):
    assert start_of_day(date(2026, 3, 10)) == _local(2026, 3, 10)
    lookup = day_range("created_at", date(2026, 3, 10), date(2026, 3, 12))
    assert lookup == {"created_at__gte": _local(2026, 3, 10), "created_at__lt": _local(2026, 3, 13)}
    assert day_range("created_at") == {}


def test_the_range_filter_has_no_date_function_and_uses_the_tenant_date_index(tenant, around_midnight):
    qs = Sale.objects.filter(tenant=tenant, **day_range("created_at", date(2026, 3, 10), date(2026, 3, 11)))
    sql, params = qs.query.sql_with_params()
    assert "django_datetime_cast_date" not in sql

    # the old lookup is the one that cannot use it
    old_sql, _ = Sale.objects.filter(tenant=tenant, created_at__date__gte=date(2026, 3, 10)).query.sql_with_params()
    assert "django_datetime_cast_date" in old_sql

    if connection.vendor == "sqlite":
        with connection.cursor() as cursor:
            cursor.execute("EXPLAIN QUERY PLAN " + sql, params)
            plan = " ".join(row[-1] for row in cursor.fetchall())
        assert "sale_tenant_created_idx" in plan


def test_a_range_over_a_year_costs_one_query_and_ignores_other_tenants(tenant, around_midnight):
    other = Tenant.objects.create(name="Other Store")
    _sale(other, _local(2026, 3, 10, 12), 99)
    with CaptureQueriesContext(connection) as ctx:
        count = Sale.objects.filter(tenant=tenant, **day_range("created_at", date(2026, 1, 1), date(2026, 12, 31))).count()
    assert count == 7 and len(ctx.captured_queries) == 1
