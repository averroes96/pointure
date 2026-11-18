"""
The seasonal report gives the same figures as before the speed-up and costs a handful of queries.

Context: `/reports/seasonal/` took about 15 s and 104 queries on a store with three years of sales: it
ran about 6 queries per event (16 years x 3 kinds), each filtering on `created_at__date` (no index).
`reference_window_stats` below is the previous implementation, kept here only as the oracle.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.db.models import DecimalField, ExpressionWrapper, F, Sum
from django.db.models.functions import Coalesce
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Product, Variant
from apps.reports.services import seasonal
from apps.reports.services.seasonal import sales_span, seasonal_comparison, window_for, window_stats
from apps.reports.services.size_curve import SOLD_STATUSES
from apps.sales.models import Return, ReturnItem, Sale, SaleItem


def _local(day, hh=12, mm=0, ss=0, us=0):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hh, mm, ss, us))


def reference_window_stats(tenant, start, end):
    """The implementation before the speed-up (date lookups, `sale IN (subquery)`, separate size query)."""
    if end < start:
        return {"revenue": "0.00", "pairs": 0, "top_models": [], "top_sizes": []}
    net_expr = ExpressionWrapper(
        F("total_amount") - Coalesce(F("timbre_fiscal"), Decimal("0.00")),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )
    sales = Sale.objects.filter(
        tenant=tenant, status__in=SOLD_STATUSES, created_at__date__gte=start, created_at__date__lte=end,
    )
    revenue = sales.aggregate(total=Sum(net_expr))["total"] or Decimal("0.00")
    refunds = Return.objects.filter(
        tenant=tenant, original_sale__status__in=SOLD_STATUSES,
        created_at__date__gte=start, created_at__date__lte=end,
    ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")

    def returned_items():
        return ReturnItem.objects.filter(
            return_obj__tenant=tenant, return_obj__original_sale__status__in=SOLD_STATUSES,
            return_obj__created_at__date__gte=start, return_obj__created_at__date__lte=end,
        )

    models = seasonal._net_ranked(
        {pid: {"label": f"{b} {n}".strip() if b else n, "qty": q} for pid, n, b, q in
         SaleItem.objects.filter(sale__in=sales).values_list("variant__product_id", "variant__product__name",
                                                              "variant__product__brand").annotate(q=Sum("quantity"))},
        {pid: {"label": f"{b} {n}".strip() if b else n, "qty": q} for pid, n, b, q in
         returned_items().values_list("variant__product_id", "variant__product__name",
                                      "variant__product__brand").annotate(q=Sum("quantity"))},
        "name",
    )
    sizes = seasonal._net_ranked(
        {s: {"label": s, "qty": q} for s, q in
         SaleItem.objects.filter(sale__in=sales).values_list("variant__size_eu").annotate(q=Sum("quantity"))},
        {s: {"label": s, "qty": q} for s, q in
         returned_items().values_list("variant__size_eu").annotate(q=Sum("quantity"))},
        "size_eu",
    )
    return {"revenue": seasonal._money(revenue - refunds), "pairs": sum(r["pairs"] for r in models),
            "top_models": models[:5], "top_sizes": sizes[:5]}


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Seasonal Speed", plan=PlanChoices.PRO_RETAIL)
    owner = User.objects.create_user(phone="0555000111", password="x", role=RoleChoices.OWNER, tenant=tenant)
    products = [
        Product.objects.create(tenant=tenant, name=name, brand=brand, sale_price=Decimal("4000"),
                               purchase_price=Decimal("2000"))
        for name, brand in (("City", "Atlas"), ("Run", "Nike"), ("Slide", ""), ("Boot", "Geox"),
                            ("Court", "Puma"), ("Trek", "Bata"), ("Flex", "Fila"))
    ]
    variants = [Variant.objects.create(tenant=tenant, product=p, size_eu=s, colour="Noir")
                for p in products for s in (38, 40, 42, 44)]
    return tenant, owner, variants


def _sell(tenant, owner, variants, when, picks, *, status="completed", stamp="0", n=[0]):
    n[0] += 1
    sale = Sale.objects.create(tenant=tenant, cashier=owner, status=status, receipt_number=f"S{n[0]}",
                               total_amount=Decimal("4000") * sum(q for _, q in picks) + Decimal(stamp),
                               timbre_fiscal=Decimal(stamp))
    Sale.objects.filter(pk=sale.pk).update(created_at=when)
    for index, qty in picks:
        SaleItem.objects.create(sale=sale, variant=variants[index], quantity=qty, unit_price=Decimal("4000"))
    return sale


def _return(tenant, owner, sale, when, index, qty, variants):
    ret = Return.objects.create(tenant=tenant, original_sale=sale, processed_by=owner, reason="size",
                                refund_amount=Decimal("4000") * qty)
    Return.objects.filter(pk=ret.pk).update(created_at=when)
    ReturnItem.objects.create(return_obj=ret, variant=variants[index], quantity=qty)


@pytest.fixture
def busy_store(store):
    tenant, owner, variants = store
    event = date(2026, 3, 20)                                    # a window of 30 days: 2026-02-18 .. 2026-03-19
    start, end = window_for(event, 30)
    sales = [
        _sell(tenant, owner, variants, _local(start, 0, 0, 0), [(0, 2), (5, 1)]),          # first instant of the window
        _sell(tenant, owner, variants, _local(end, 23, 59, 59, 999999), [(1, 3)], stamp="100"),   # last instant
        _sell(tenant, owner, variants, _local(date(2026, 3, 1)), [(2, 1), (6, 1), (9, 2)]),
        _sell(tenant, owner, variants, _local(date(2026, 3, 1), 9), [(0, 1), (1, 1)], status="partially_paid"),
        _sell(tenant, owner, variants, _local(date(2026, 3, 5)), [(0, 4)], status="cancelled"),        # excluded
        _sell(tenant, owner, variants, _local(start - timedelta(days=1), 23, 59, 59), [(3, 5)]),      # day before
        _sell(tenant, owner, variants, _local(event, 0, 0, 0), [(3, 6)]),                              # the event day
        _sell(tenant, owner, variants, _local(date(2026, 3, 8)), [(16, 2), (20, 2), (24, 1), (9, 1), (10, 1), (11, 1)]),
    ]
    _return(tenant, owner, sales[0], _local(date(2026, 2, 25)), 0, 1, variants)
    _return(tenant, owner, sales[2], _local(date(2026, 3, 2)), 9, 2, variants)
    _return(tenant, owner, sales[5], _local(date(2026, 3, 3)), 3, 1, variants)       # sale outside, return inside
    _return(tenant, owner, sales[4], _local(date(2026, 3, 4)), 0, 1, variants)       # cancelled sale: ignored
    return tenant, owner, variants, event


@pytest.mark.parametrize("window", [
    (date(2026, 2, 18), date(2026, 3, 19)),      # the 30-day window
    (date(2026, 2, 19), date(2026, 3, 19)),      # drops the first-instant sale
    (date(2026, 2, 18), date(2026, 3, 18)),      # drops the last-instant sale
    (date(2026, 3, 1), date(2026, 3, 1)),        # one day
    (date(2026, 1, 1), date(2026, 12, 31)),      # everything
    (date(2025, 1, 1), date(2025, 12, 31)),      # before any sale
    (date(2027, 1, 1), date(2027, 6, 30)),       # after every sale
    (date(2026, 3, 19), date(2026, 3, 18)),      # reversed
])
def test_window_stats_matches_the_previous_implementation(busy_store, window):
    tenant = busy_store[0]
    expected = reference_window_stats(tenant, *window)
    assert window_stats(tenant, *window) == expected
    assert window_stats(tenant, *window, span=sales_span(tenant)) == expected


def test_the_reference_figures_are_not_trivial(busy_store):
    """Guards the oracle: the busy window really has revenue, ties, returns and more than 5 models."""
    tenant = busy_store[0]
    stats = reference_window_stats(tenant, date(2026, 2, 18), date(2026, 3, 19))
    assert Decimal(stats["revenue"]) > 0 and stats["pairs"] > 5
    assert len(stats["top_models"]) == 5 and len(stats["top_sizes"]) == 3      # 7 models sold: only 5 shown
    assert stats["pairs"] == window_stats(tenant, date(2026, 2, 18), date(2026, 3, 19))["pairs"]


def test_a_window_costs_four_queries(busy_store):
    tenant = busy_store[0]
    with CaptureQueriesContext(connection) as ctx:
        window_stats(tenant, date(2026, 2, 18), date(2026, 3, 19))
    assert len(ctx.captured_queries) == 4                       # revenue, refunds, items sold, items returned
    assert not any("django_datetime_cast_date" in q["sql"] for q in ctx.captured_queries)
    assert not any(" IN (SELECT" in q["sql"] for q in ctx.captured_queries)


def test_the_comparison_skips_windows_outside_the_sales_history(busy_store):
    tenant, _owner, _variants, _event = busy_store
    seasonal.ensure_seasonal_events(tenant)
    with CaptureQueriesContext(connection) as ctx:
        report = seasonal_comparison(tenant, kind="aid_el_fitr", days_before=30, today=date(2026, 3, 1))
    occurrences = report["occurrences"]
    assert len(occurrences) >= 14                               # 2020 .. 2035
    # seed check, events, span (sales and returns), then 4 per window that overlaps the sales (at most 2 here)
    assert len(ctx.captured_queries) <= 4 + 4 * 2
    for row in occurrences:
        expected = reference_window_stats(tenant, date.fromisoformat(row["window_start"]),
                                          date.fromisoformat(row["window_end"]))
        assert {k: row[k] for k in expected} == expected


def test_the_comparison_of_an_empty_store_costs_no_window_query(store):
    tenant = store[0]
    seasonal.ensure_seasonal_events(tenant)
    assert sales_span(tenant) is None
    with CaptureQueriesContext(connection) as ctx:
        report = seasonal_comparison(tenant, kind="rentree", days_before=30, today=date(2026, 3, 1))
    assert all(row["pairs"] == 0 and row["revenue"] == "0.00" and row["top_models"] == [] for row in report["occurrences"])
    assert len(ctx.captured_queries) == 4                       # seed check, events, span (sales and returns)


def test_the_span_covers_returns_made_after_the_last_sale(store):
    tenant, owner, variants = store
    sale = _sell(tenant, owner, variants, _local(date(2026, 3, 1)), [(0, 1)])
    _return(tenant, owner, sale, _local(date(2026, 3, 20)), 0, 1, variants)
    first, last = sales_span(tenant)
    assert first == _local(date(2026, 3, 1)) and last == _local(date(2026, 3, 20))
    # a window that only contains the return still counts its refund
    assert window_stats(tenant, date(2026, 3, 15), date(2026, 3, 25), span=(first, last))["revenue"] == "-4000.00"


def test_the_seasonal_endpoint_answers_with_the_same_figures(busy_store):
    tenant, owner, _variants, _event = busy_store
    client = APIClient()
    client.force_authenticate(owner)
    res = client.get("/api/v1/reports/seasonal/?event=aid_el_fitr&days_before=30")
    assert res.status_code == 200
    for row in res.json()["occurrences"]:
        expected = reference_window_stats(tenant, date.fromisoformat(row["window_start"]),
                                          date.fromisoformat(row["window_end"]))
        assert {k: row[k] for k in expected} == expected
    assert client.get("/api/v1/reports/seasonal-preview/").status_code == 200
