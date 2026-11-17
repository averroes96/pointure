"""
Delivery order model: lines, server-computed amounts, draft-only edits, new stock
reasons and the courier payment method (docs/plans/delivery-v1-plan.md P2.3).
Synthetic data only.
"""
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import (
    CustomerOrder, CustomerOrderLine, CustomerOrderStatusChoices, check_cod, expected_cod, lines_total,
)
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import POS_PAYMENT_METHOD_CHOICES, CashSession, CashSessionStatus, PaymentMethodChoices
from apps.sales.services.z_report import render_daily_detailed_report

URL = "/api/v1/deliveries/customer-orders/"


# ─── Amount helpers ───────────────────────────────────────────────────────────

def test_lines_total_and_expected_cod():
    lines = [
        {"unit_price": Decimal("4500.00"), "quantity": 2, "discount_amount": Decimal("500.00")},
        {"unit_price": Decimal("1200.50"), "quantity": 1, "discount_amount": Decimal("0")},
    ]
    assert lines_total(lines) == Decimal("9700.50")
    assert lines_total([]) == Decimal("0.00")
    assert expected_cod(Decimal("9700.50"), Decimal("600"), False) == Decimal("10300.50")
    assert expected_cod(Decimal("9700.50"), Decimal("600"), True) == Decimal("9700.50")
    assert expected_cod(Decimal("0"), None, False) == Decimal("0.00")


@pytest.mark.parametrize("cod,ok", [
    (None, True),
    (Decimal("10000"), True),            # exactly goods + fee
    (Decimal("3000"), True),             # deposit already paid
    (Decimal("0"), True),                # fully prepaid
    (Decimal("10001"), False),           # more than goods + fee
    (Decimal("2999.50"), False),         # couriers take whole dinars
    (Decimal("-1"), False),
])
def test_check_cod(cod, ok):
    assert (check_cod(cod, Decimal("10000.00")) is None) is ok


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Order Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(email=f"{role}-ord@test.com", password="password123",
                                       role=role, tenant=tenant)
        for role in (RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER)
    }
    product = Product.objects.create(tenant=tenant, name="Basket Test", reference="BT-1",
                                     sale_price=Decimal("4500.00"), purchase_price=Decimal("2500.00"))
    v42 = Variant.objects.create(tenant=tenant, product=product, size_eu=42, colour="Noir")
    v43 = Variant.objects.create(tenant=tenant, product=product, size_eu=43, colour="Noir")
    return tenant, users, v42, v43


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _payload(v42, v43, **extra):
    body = {
        "customer_name": "Client Test",
        "customer_phone": "+213 551 23 45 67",
        "wilaya": "16",
        "commune": "Bab Ezzouar",
        "shipping_fee": "600.00",
        "lines": [
            {"variant": str(v42.pk), "quantity": 2, "unit_price": "4500.00", "discount_amount": "500.00"},
            {"variant": str(v43.pk), "quantity": 1, "unit_price": "4500.00"},
        ],
    }
    body.update(extra)
    return body


# ─── API: create and amounts ──────────────────────────────────────────────────

@pytest.mark.parametrize("role", [RoleChoices.OWNER, RoleChoices.MANAGER])
def test_create_with_lines_computes_amounts_on_the_server(store, role):
    tenant, users, v42, v43 = store
    res = _client(users[role]).post(URL, _payload(v42, v43, goods_total="1.00", expected_cod="1.00"), format="json")

    assert res.status_code == status.HTTP_201_CREATED, res.content
    body = res.json()
    assert body["customer_phone"] == "0551234567"
    assert body["goods_total"] == "13000.00"
    assert body["expected_cod"] == "13600.00"
    assert body["cod_to_collect"] == "13600.00"
    assert body["cod_amount"] is None
    assert [(l["quantity"], l["unit_price"], l["discount_amount"], l["subtotal"]) for l in body["lines"]] == [
        (2, "4500.00", "500.00", "8500.00"),
        (1, "4500.00", "0.00", "4500.00"),
    ]
    assert body["lines"][0]["variant_label"] == str(v42)
    order = CustomerOrder.objects.get(pk=body["id"])
    assert order.tenant == tenant
    assert list(order.lines.values_list("variant_id", "position")) == [(v42.pk, 0), (v43.pk, 1)]


def test_free_shipping_and_a_deposit(store):
    tenant, users, v42, v43 = store
    res = _client(users[RoleChoices.OWNER]).post(
        URL, _payload(v42, v43, free_shipping=True, cod_amount="10000.00"), format="json")
    assert res.status_code == status.HTTP_201_CREATED, res.content
    body = res.json()
    assert (body["expected_cod"], body["cod_amount"], body["cod_to_collect"]) == ("13000.00", "10000.00", "10000.00")


@pytest.mark.parametrize("cod", ["13601.00", "13000.50", "-5.00"])
def test_cod_out_of_bounds_is_refused(store, cod):
    tenant, users, v42, v43 = store
    res = _client(users[RoleChoices.OWNER]).post(URL, _payload(v42, v43, cod_amount=cod), format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"].keys()) == ["cod_amount"]
    assert CustomerOrder.objects.filter(tenant=tenant).count() == 0


@pytest.mark.parametrize("line,field", [
    ({"quantity": 0, "unit_price": "100.00"}, "quantity"),
    ({"quantity": 1, "unit_price": "-1.00"}, "unit_price"),
    ({"quantity": 1, "unit_price": "100.00", "discount_amount": "100.01"}, "discount_amount"),
    ({"quantity": 1, "unit_price": "100.00", "discount_amount": "-1.00"}, "discount_amount"),
])
def test_invalid_line_is_refused(store, line, field):
    tenant, users, v42, v43 = store
    res = _client(users[RoleChoices.OWNER]).post(
        URL, _payload(v42, v43, lines=[{"variant": str(v42.pk), **line}]), format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"]["lines"][0].keys()) == [field]


def test_variant_of_another_store_is_refused(store):
    tenant, users, v42, v43 = store
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    foreign = Variant.objects.create(
        tenant=other, size_eu=40,
        product=Product.objects.create(tenant=other, name="X", reference="X-1",
                                       sale_price=Decimal("1"), purchase_price=Decimal("1")),
    )
    res = _client(users[RoleChoices.OWNER]).post(
        URL, _payload(v42, v43, lines=[{"variant": str(foreign.pk), "quantity": 1, "unit_price": "1.00"}]),
        format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"]["lines"][0].keys()) == ["variant"]


@pytest.mark.parametrize("field,value", [("customer_phone", "12345"), ("customer_phone2", "0991234567")])
def test_invalid_phone_is_refused(store, field, value):
    tenant, users, v42, v43 = store
    res = _client(users[RoleChoices.OWNER]).post(URL, _payload(v42, v43, **{field: value}), format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"].keys()) == [field]


def test_system_fields_are_read_only(store):
    tenant, users, v42, v43 = store
    owner = users[RoleChoices.OWNER]
    res = _client(owner).post(URL, _payload(
        v42, v43, status="delivered", tracking_number="FAKE-1", provider="maystro",
        dispatched_by=str(owner.pk), dispatched_at=timezone.now().isoformat(),
        stock_returned_at=timezone.now().isoformat(),
    ), format="json")
    assert res.status_code == status.HTTP_201_CREATED, res.content
    order = CustomerOrder.objects.get(pk=res.json()["id"])
    assert order.status == CustomerOrderStatusChoices.DRAFT
    assert (order.tracking_number, order.provider, order.dispatched_by, order.dispatched_at,
            order.stock_returned_at) == (None, None, None, None, None)


def test_home_delivery_clears_the_stop_desk(store):
    tenant, users, v42, v43 = store
    client = _client(users[RoleChoices.OWNER])
    desk = client.post(URL, _payload(v42, v43, delivery_type="stopdesk", stop_desk_id="101",
                                     stop_desk_name="Bureau Centre"), format="json").json()
    assert (desk["stop_desk_id"], desk["stop_desk_name"]) == ("101", "Bureau Centre")

    home = client.patch(f"{URL}{desk['id']}/", {"delivery_type": "home"}, format="json").json()
    assert (home["delivery_type"], home["stop_desk_id"], home["stop_desk_name"]) == ("home", "", "")


# ─── API: update ──────────────────────────────────────────────────────────────

def test_patch_lines_replaces_them_and_rechecks_cod(store):
    tenant, users, v42, v43 = store
    client = _client(users[RoleChoices.OWNER])
    order_id = client.post(URL, _payload(v42, v43, cod_amount="13600.00"), format="json").json()["id"]

    # Fewer goods: the stored COD would now exceed goods + fee.
    smaller = [{"variant": str(v43.pk), "quantity": 1, "unit_price": "4500.00"}]
    refused = client.patch(f"{URL}{order_id}/", {"lines": smaller}, format="json")
    assert refused.status_code == status.HTTP_400_BAD_REQUEST
    assert list(refused.json()["error"]["details"].keys()) == ["cod_amount"]
    assert CustomerOrderLine.objects.filter(order_id=order_id).count() == 2

    ok = client.patch(f"{URL}{order_id}/", {"lines": smaller, "cod_amount": None}, format="json")
    assert ok.status_code == status.HTTP_200_OK, ok.content
    assert (ok.json()["goods_total"], ok.json()["cod_to_collect"]) == ("4500.00", "5100.00")
    assert [l["variant"] for l in ok.json()["lines"]] == [str(v43.pk)]
    assert CustomerOrderLine.objects.filter(order_id=order_id).count() == 1

    kept = client.patch(f"{URL}{order_id}/", {"customer_name": "Autre"}, format="json")
    assert len(kept.json()["lines"]) == 1


def test_patch_cod_is_checked_against_saved_lines(store):
    tenant, users, v42, v43 = store
    client = _client(users[RoleChoices.OWNER])
    order_id = client.post(URL, _payload(v42, v43), format="json").json()["id"]
    res = client.patch(f"{URL}{order_id}/", {"cod_amount": "13601.00"}, format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert list(res.json()["error"]["details"].keys()) == ["cod_amount"]


@pytest.mark.parametrize("method", ["patch", "put"])
def test_only_drafts_can_be_changed(store, method):
    tenant, users, v42, v43 = store
    client = _client(users[RoleChoices.OWNER])
    order_id = client.post(URL, _payload(v42, v43), format="json").json()["id"]
    CustomerOrder.objects.filter(pk=order_id).update(status=CustomerOrderStatusChoices.DISPATCHED)

    body = _payload(v42, v43, customer_name="Changed", lines=[])
    res = getattr(client, method)(f"{URL}{order_id}/", body, format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    order = CustomerOrder.objects.get(pk=order_id)
    assert order.customer_name == "Client Test"
    assert order.lines.count() == 2


def test_cashier_cannot_create_orders(store):
    tenant, users, v42, v43 = store
    res = _client(users[RoleChoices.CASHIER]).post(URL, _payload(v42, v43), format="json")
    assert res.status_code == status.HTTP_403_FORBIDDEN
    assert CustomerOrder.objects.count() == 0


# ─── Model rules ──────────────────────────────────────────────────────────────

def test_database_refuses_impossible_lines(store):
    tenant, users, v42, v43 = store
    order = CustomerOrder.objects.create(tenant=tenant, customer_name="C", customer_phone="0551234567")
    for bad in ({"quantity": 0}, {"unit_price": Decimal("-1")}, {"discount_amount": Decimal("-1")}):
        fields = {"quantity": 1, "unit_price": Decimal("10"), "discount_amount": Decimal("0"), **bad}
        with pytest.raises(IntegrityError), transaction.atomic():
            CustomerOrderLine.objects.create(order=order, variant=v42, **fields)


def test_order_methods_use_the_lines(store):
    tenant, users, v42, v43 = store
    order = CustomerOrder.objects.create(tenant=tenant, customer_name="C", customer_phone="0551234567",
                                         shipping_fee=Decimal("400"))
    CustomerOrderLine.objects.create(order=order, variant=v42, quantity=3, unit_price=Decimal("1000"),
                                     discount_amount=Decimal("250"))
    assert order.goods_total() == Decimal("2750.00")
    assert order.expected_cod() == Decimal("3150.00")
    assert order.cod_to_collect() == Decimal("3150.00")
    order.cod_amount = Decimal("2000")
    assert order.cod_to_collect() == Decimal("2000")


# ─── Stock reasons and the courier payment method ─────────────────────────────

def test_delivery_stock_reasons_move_stock_and_show_on_the_z_report(store):
    tenant, users, v42, v43 = store
    owner = users[RoleChoices.OWNER]
    StockMovement.objects.create(tenant=tenant, variant=v42, quantity_delta=5, reason=MovementReasonChoices.INITIAL)
    out = StockMovement(tenant=tenant, variant=v42, quantity_delta=-2, reason=MovementReasonChoices.DELIVERY_OUT,
                        user=owner)
    out.full_clean()                         # fits the 15-character reason field
    out.save()
    back = StockMovement(tenant=tenant, variant=v42, quantity_delta=1, reason=MovementReasonChoices.DELIVERY_RETURN,
                         user=owner)
    back.full_clean()
    back.save()
    v42.refresh_from_db()
    assert v42.stock_qty == 4

    today = timezone.localdate()
    assert "Envoi livraison" in render_daily_detailed_report(tenant, today, user=owner, lang="fr")
    ar = render_daily_detailed_report(tenant, today, user=owner, lang="ar")
    assert "إرسال توصيل" in ar and "إرجاع توصيل" in ar
    en = render_daily_detailed_report(tenant, today, user=owner, lang="en")
    assert "Delivery dispatch" in en and "Delivery return" in en


def test_courier_method_exists_but_is_not_offered_at_the_pos():
    assert PaymentMethodChoices.COURIER == "courier"
    pos = dict(POS_PAYMENT_METHOD_CHOICES)
    assert "courier" not in pos
    assert set(pos) == set(PaymentMethodChoices.values) - {"courier"}


def test_pos_sale_with_courier_payment_is_refused(store):
    tenant, users, v42, v43 = store
    cashier = users[RoleChoices.CASHIER]
    StockMovement.objects.create(tenant=tenant, variant=v42, quantity_delta=3, reason=MovementReasonChoices.INITIAL)
    CashSession.objects.create(tenant=tenant, cashier=cashier, opening_float=Decimal("0"), status=CashSessionStatus.OPEN)
    client = _client(cashier)
    payload = {
        "items": [{"variant_id": str(v42.pk), "quantity": 1, "unit_price": "4500.00", "discount_amount": "0.00"}],
        "payments": [{"amount": "4500.00", "method": "courier"}],
    }
    res = client.post("/api/v1/sales/", payload, format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert res.json()["error"]["code"] == {"method": ["invalid_choice"]}

    payload["payments"][0]["method"] = "cash"
    assert client.post("/api/v1/sales/", payload, format="json").status_code == status.HTTP_201_CREATED
    v42.refresh_from_db()
    assert v42.stock_qty == 2                # only the cash sale moved stock
