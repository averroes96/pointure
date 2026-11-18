"""
/reports/best-sellers/ ranks the last 90 days by default and is cached for a few minutes per tenant.

Context: the dashboard card ranked every sale ever made, one aggregate over the whole sale-item table
(about 0.4 s on a fast PC with three years of sales, several seconds on a store's i3), on every visit.
"""
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Product, Variant
from apps.reports.views import BEST_SELLERS_CACHE_SECONDS, BEST_SELLERS_DEFAULT_DAYS
from apps.sales.models import Sale, SaleItem

URL = "/api/v1/reports/best-sellers/"


@pytest.fixture(autouse=True)
def empty_cache():
    cache.clear()
    yield
    cache.clear()


class Store:
    def __init__(self, name, phone):
        self.tenant = Tenant.objects.create(name=name, plan=PlanChoices.PRO_RETAIL)
        self.owner = User.objects.create_user(phone=phone, password="x", role=RoleChoices.OWNER, tenant=self.tenant)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.n = 0

    def model(self, name):
        product = Product.objects.create(tenant=self.tenant, name=name, brand="B", sale_price=Decimal("4000"),
                                         purchase_price=Decimal("2000"))
        return Variant.objects.create(tenant=self.tenant, product=product, size_eu=42, colour="Noir")

    def sell(self, variant, qty, days_ago, hour=12, minute=0):
        self.n += 1
        day = timezone.localdate() - timedelta(days=days_ago)
        sale = Sale.objects.create(tenant=self.tenant, cashier=self.owner, status="completed",
                                   total_amount=Decimal("4000") * qty, receipt_number=f"BS{self.n}")
        when = timezone.make_aware(datetime(day.year, day.month, day.day, hour, minute))
        Sale.objects.filter(pk=sale.pk).update(created_at=when)
        SaleItem.objects.create(sale=sale, variant=variant, quantity=qty, unit_price=Decimal("4000"))

    def ranking(self, query=""):
        res = self.client.get(URL + query)
        assert res.status_code == 200, res.content
        return {row["product_name"]: row["units_sold"] for row in res.json()}


@pytest.fixture
def store(db):
    return Store("Best Sellers Store", "0555000333")


def test_the_default_window_is_the_last_90_days(store):
    assert BEST_SELLERS_DEFAULT_DAYS == 90
    recent, edge, old = store.model("Recent"), store.model("Edge"), store.model("Old")
    store.sell(recent, 3, days_ago=0)
    store.sell(edge, 2, days_ago=89, hour=0, minute=0)          # first instant of the window: counted
    store.sell(old, 9, days_ago=90, hour=23, minute=59)         # last minute before it: not counted
    store.sell(old, 9, days_ago=400)
    assert store.ranking() == {"Recent": 3, "Edge": 2}


def test_days_chooses_another_window(store):
    model = store.model("Model")
    store.sell(model, 1, days_ago=5)
    store.sell(model, 4, days_ago=200)
    assert store.ranking("?days=7") == {"Model": 1}
    assert store.ranking("?days=365") == {"Model": 5}


def test_explicit_dates_still_work_and_win_over_days(store):
    model = store.model("Model")
    store.sell(model, 4, days_ago=400)
    store.sell(model, 1, days_ago=1)
    start = (timezone.localdate() - timedelta(days=500)).isoformat()
    end = (timezone.localdate() - timedelta(days=300)).isoformat()
    assert store.ranking(f"?from={start}&to={end}&days=7") == {"Model": 4}
    assert store.ranking(f"?from={start}") == {"Model": 5}                 # open-ended, as before


@pytest.mark.parametrize("bad", ["0", "3651", "abc", "-5"])
def test_an_invalid_number_of_days_is_a_400(store, bad):
    res = store.client.get(URL + f"?days={bad}")
    assert res.status_code == 400
    assert "days" in str(res.json())


def test_the_ranking_is_ordered_and_keeps_the_response_shape(store):
    a, b = store.model("A"), store.model("B")
    store.sell(a, 1, days_ago=1)
    store.sell(b, 5, days_ago=2)
    rows = store.client.get(URL).json()
    assert [row["product_name"] for row in rows] == ["B", "A"]
    assert set(rows[0]) == {"product_id", "product_name", "brand", "units_sold", "revenue"}


# ─── Cache ────────────────────────────────────────────────────────────────────

def _touches_sale_items(captured):
    return any("sales_saleitem" in q["sql"] for q in captured)


def test_a_second_visit_within_the_delay_does_not_query_the_sales(store):
    store.sell(store.model("Model"), 2, days_ago=1)
    with CaptureQueriesContext(connection) as first:
        store.ranking()
    with CaptureQueriesContext(connection) as second:
        assert store.ranking() == {"Model": 2}
    assert _touches_sale_items(first.captured_queries)
    assert not _touches_sale_items(second.captured_queries)


def test_a_new_sale_appears_once_the_cache_expires(store, monkeypatch):
    model = store.model("Model")
    store.sell(model, 2, days_ago=1)
    assert store.ranking() == {"Model": 2}
    store.sell(model, 3, days_ago=0)
    assert store.ranking() == {"Model": 2}                         # within the delay: the cached ranking

    import django.core.cache.backends.locmem as locmem
    later = locmem.time.time() + BEST_SELLERS_CACHE_SECONDS + 1
    monkeypatch.setattr(locmem.time, "time", lambda: later)
    assert store.ranking() == {"Model": 5}


def test_each_window_is_cached_separately(store):
    model = store.model("Model")
    store.sell(model, 1, days_ago=1)
    store.sell(model, 4, days_ago=200)
    assert store.ranking() == {"Model": 1}
    assert store.ranking("?days=365") == {"Model": 5}
    assert store.ranking("?days=90") == {"Model": 1}               # same window as the default


def test_the_cache_never_mixes_two_stores(db):
    first, second = Store("First", "0555000444"), Store("Second", "0555000555")
    first.sell(first.model("Only In First"), 2, days_ago=1)
    second.sell(second.model("Only In Second"), 7, days_ago=1)
    assert first.ranking() == {"Only In First": 2}
    assert second.ranking() == {"Only In Second": 7}
    assert first.ranking() == {"Only In First": 2}


def test_a_cashier_still_sees_the_card(store):
    cashier = User.objects.create_user(phone="0555000666", password="x", role=RoleChoices.CASHIER, tenant=store.tenant)
    store.sell(store.model("Model"), 1, days_ago=1)
    client = APIClient()
    client.force_authenticate(cashier)
    assert client.get(URL).status_code == 200
