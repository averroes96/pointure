"""
The sales list does not run a payment SUM per sale (a page of 25 sales cost 50 extra queries), and the
single-sale responses that follow a payment still show the payment just added.
"""
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.core.models import RoleChoices, Tenant, User
from apps.sales.models import CashSession, CashSessionStatus, Payment, Sale

LIST = "/api/v1/sales/"


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="List Store")
    owner = User.objects.create_user(phone="0555000222", password="x", role=RoleChoices.OWNER, tenant=tenant)
    CashSession.objects.create(tenant=tenant, cashier=owner, opening_float=Decimal("0"), status=CashSessionStatus.OPEN)
    client = APIClient()
    client.force_authenticate(owner)
    return tenant, owner, client


def _sale(tenant, owner, n, total, paid, status="partially_paid"):
    sale = Sale.objects.create(tenant=tenant, cashier=owner, status=status, receipt_number=f"L{n}",
                               total_amount=Decimal(total))
    for part in paid:
        Payment.objects.create(sale=sale, amount=Decimal(part), method="cash")
    return sale


def _rows(client, url=LIST):
    res = client.get(url)
    assert res.status_code == 200
    body = res.json()
    return {row["receipt_number"]: row for row in (body["results"] if isinstance(body, dict) else body)}


def test_the_list_values_are_the_sums_of_the_payments(store):
    tenant, owner, client = store
    _sale(tenant, owner, 1, "10000", ["2000", "3000.50"])
    _sale(tenant, owner, 2, "5000", [], status="layaway")
    _sale(tenant, owner, 3, "4000", ["4000"], status="completed")
    rows = _rows(client)
    assert (rows["L1"]["amount_paid"], rows["L1"]["balance_due"]) == ("5000.50", "4999.50")
    assert (rows["L2"]["amount_paid"], rows["L2"]["balance_due"]) == ("0.00", "5000.00")
    assert (rows["L3"]["amount_paid"], rows["L3"]["balance_due"]) == ("4000.00", "0.00")


def test_the_list_query_count_does_not_grow_with_the_number_of_sales(store):
    tenant, owner, client = store
    _sale(tenant, owner, 0, "1000", ["500"])
    client.get(LIST)
    with CaptureQueriesContext(connection) as one:
        client.get(LIST)
    for n in range(1, 12):
        _sale(tenant, owner, n, "1000", ["500", "100"])
    with CaptureQueriesContext(connection) as twelve:
        client.get(LIST)
    assert len(twelve.captured_queries) == len(one.captured_queries)
    assert not any("SUM" in q["sql"] and "sales_payment" in q["sql"] for q in twelve.captured_queries)


def test_adding_a_payment_answers_with_the_new_amount_paid(store):
    tenant, owner, client = store
    sale = _sale(tenant, owner, 1, "10000", ["2000"])
    res = client.post(f"{LIST}{sale.pk}/add-payment/", {"amount": "3000", "method": "cash"}, format="json")
    assert res.status_code == 200, res.content
    assert (res.json()["amount_paid"], res.json()["balance_due"]) == ("5000.00", "5000.00")
    assert _rows(client)["L1"]["amount_paid"] == "5000.00"


def test_collecting_a_layaway_answers_with_the_balance_settled(store):
    tenant, owner, client = store
    sale = _sale(tenant, owner, 1, "6000", ["1000"], status="layaway")
    Sale.objects.filter(pk=sale.pk).update(is_layaway=True)
    res = client.post(f"{LIST}{sale.pk}/collect-layaway/", {"amount": "5000", "method": "cash"}, format="json")
    assert res.status_code == 200, res.content
    assert (res.json()["amount_paid"], res.json()["balance_due"]) == ("6000.00", "0.00")


def test_the_detail_still_reads_the_database(store):
    tenant, owner, client = store
    sale = _sale(tenant, owner, 1, "10000", ["2000"])
    res = client.get(f"{LIST}{sale.pk}/")
    assert res.status_code == 200
    assert (res.json()["amount_paid"], res.json()["balance_due"]) == ("2000.00", "8000.00")
