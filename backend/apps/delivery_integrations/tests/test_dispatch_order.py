"""
Dispatch of a draft CustomerOrder through dzship (DraftOrdersPage → dispatch_order).

Covers the defects listed in docs/plans/delivery-v1-plan.md §3:
  K1  dispatching must write one SALE StockMovement per line;
  K3  the courier call must run outside transaction.atomic() and with a timeout;
  K4  exception text must never be returned to the client;
  K5  the unsigned webhook receiver must not change orders.
"""
from decimal import Decimal
from unittest import mock

import pytest
import requests
from django.db import connection
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import (
    CustomerOrder,
    CustomerOrderStatusChoices,
    ProviderConfig,
)
from apps.delivery_integrations.services.dzship_client import DzshipClient, DzshipError
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import Sale

CREATE_ORDER = "apps.delivery_integrations.services.dzship_client.DzshipClient.create_order"


def _setup():
    tenant = Tenant.objects.create(name="Dispatch Store", plan=PlanChoices.PRO_RETAIL)
    owner = User.objects.create_user(
        email="owner-dispatch@test.com",
        password="password123",
        role=RoleChoices.OWNER,
        tenant=tenant,
    )
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    ProviderConfig.objects.create(
        tenant=tenant, courier="maystro", credentials={"apiKey": "secret-key"}, is_active=True
    )
    product = Product.objects.create(
        tenant=tenant, name="Basket Air", reference="BA-1", sale_price=Decimal("4500.00")
    )
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=42)
    StockMovement.objects.create(
        tenant=tenant, variant=variant, quantity_delta=10, reason=MovementReasonChoices.INITIAL
    )
    order = CustomerOrder.objects.create(
        tenant=tenant,
        customer_name="Amine Test",
        customer_phone="0551234567",
        wilaya="16",
        commune="Bab Ezzouar",
    )
    client = APIClient()
    client.force_authenticate(user=owner)
    return tenant, client, variant, order


def _dispatch(client, order, variant, qty=2):
    return client.post(
        f"/api/v1/deliveries/customer-orders/{order.pk}/dispatch_order/",
        {
            "provider": "maystro",
            "total_price": "9500.00",
            "variant_ids": [str(variant.pk)],
            "quantities": [qty],
        },
        format="json",
    )


@pytest.mark.django_db
def test_dispatch_writes_one_sale_stock_movement_per_line():
    tenant, client, variant, order = _setup()
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-1"}):
        res = _dispatch(client, order, variant, qty=2)

    assert res.status_code == status.HTTP_200_OK
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DISPATCHED
    assert order.tracking_number == "MAY-1"

    movements = StockMovement.objects.filter(
        variant=variant, reason=MovementReasonChoices.SALE
    )
    assert movements.count() == 1
    movement = movements.get()
    assert movement.quantity_delta == -2
    assert movement.reference_type == "Sale"
    assert movement.reference_id == str(order.sale_id)
    variant.refresh_from_db()
    assert variant.stock_qty == 8


@pytest.mark.django_db(transaction=True)
def test_courier_is_called_outside_a_transaction():
    tenant, client, variant, order = _setup()
    seen = {}

    def fake_create(*args, **kwargs):
        seen["in_atomic"] = connection.in_atomic_block
        return {"trackingNumber": "MAY-2"}

    with mock.patch(CREATE_ORDER, side_effect=fake_create):
        res = _dispatch(client, order, variant)

    assert res.status_code == status.HTTP_200_OK
    assert seen["in_atomic"] is False


@pytest.mark.django_db
def test_courier_refusal_returns_translated_error_and_keeps_draft():
    tenant, client, variant, order = _setup()
    with mock.patch(CREATE_ORDER, side_effect=DzshipError("COURIER_ERROR", 502)):
        res = _dispatch(client, order, variant)

    assert res.status_code == status.HTTP_502_BAD_GATEWAY
    body = res.json()
    assert body["error"]["code"] == "courier_refused"
    assert "COURIER_ERROR" not in body["error"]["message"]
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DRAFT
    assert order.sale_id is None
    assert Sale.objects.filter(tenant=tenant).count() == 0
    assert StockMovement.objects.filter(variant=variant, reason=MovementReasonChoices.SALE).count() == 0


@pytest.mark.django_db
def test_courier_timeout_returns_check_courier_message_and_keeps_draft():
    tenant, client, variant, order = _setup()
    with mock.patch(CREATE_ORDER, side_effect=DzshipError("TIMEOUT", None)):
        res = _dispatch(client, order, variant)

    assert res.status_code == status.HTTP_502_BAD_GATEWAY
    assert res.json()["error"]["code"] == "courier_unreachable"
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DRAFT


@pytest.mark.django_db
def test_unexpected_error_text_is_never_returned():
    tenant, client, variant, order = _setup()
    with mock.patch(CREATE_ORDER, side_effect=RuntimeError("secret internal detail")):
        res = _dispatch(client, order, variant)

    assert res.status_code == status.HTTP_502_BAD_GATEWAY
    assert "secret internal detail" not in res.content.decode()
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DRAFT


@pytest.mark.django_db
def test_order_already_claimed_for_dispatch_is_refused_without_calling_courier():
    tenant, client, variant, order = _setup()
    CustomerOrder.objects.filter(pk=order.pk).update(status=CustomerOrderStatusChoices.CONFIRMED)
    with mock.patch(CREATE_ORDER) as create:
        res = _dispatch(client, order, variant)

    assert res.status_code == status.HTTP_400_BAD_REQUEST
    create.assert_not_called()


@pytest.mark.django_db
def test_unknown_variant_is_refused_before_calling_courier():
    tenant, client, variant, order = _setup()
    other_tenant = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    other_product = Product.objects.create(
        tenant=other_tenant, name="X", reference="X-1", sale_price=Decimal("100.00")
    )
    foreign_variant = Variant.objects.create(tenant=other_tenant, product=other_product, size_eu=40)
    with mock.patch(CREATE_ORDER) as create:
        res = _dispatch(client, order, foreign_variant)

    assert res.status_code == status.HTTP_400_BAD_REQUEST
    create.assert_not_called()
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DRAFT


def test_dzship_client_sends_timeout_and_reference():
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"trackingNumber": "MAY-3"}
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=response) as post:
        data = DzshipClient.create_order(
            "maystro", {"apiToken": "k"}, {"reference": "ref-1", "codAmount": 100}
        )

    assert data == {"trackingNumber": "MAY-3"}
    kwargs = post.call_args.kwargs
    assert kwargs["timeout"] == DzshipClient.TIMEOUT_SECONDS
    assert kwargs["json"]["order"]["reference"] == "ref-1"
    assert "options" not in kwargs["json"]


@pytest.mark.parametrize("courier,credentials", [
    # K8: credentials go to dzship unchanged, under the catalogue's names.
    ("zrexpress", {"token": "t", "key": "k"}),
    ("noest", {"apiToken": "t", "guid": "g"}),
    ("maystro", {"apiKey": "k"}),
])
def test_dzship_client_sends_credentials_unchanged(courier, credentials):
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"trackingNumber": "X"}
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=response) as post:
        DzshipClient.create_order(courier, credentials, {})
    body = post.call_args.kwargs["json"]
    assert body["courier"] == courier
    assert body["credentials"] == credentials


def test_dzship_client_sends_base_url_for_generic_ecotrack():
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"trackingNumber": "X"}
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=response) as post:
        DzshipClient.create_order("ecotrack", {"token": "t"}, {}, base_url="https://shop.ecotrack.dz")
    assert post.call_args.kwargs["json"]["options"] == {"baseUrl": "https://shop.ecotrack.dz"}


@pytest.mark.django_db
def test_dispatch_sends_the_saved_credentials_and_refuses_incomplete_ones():
    tenant, client, variant, order = _setup()
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-5"}) as create:
        res = _dispatch(client, order, variant)
    assert res.status_code == status.HTTP_200_OK
    assert create.call_args.args[:2] == ("maystro", {"apiKey": "secret-key"})

    other = CustomerOrder.objects.create(
        tenant=tenant, customer_name="B", customer_phone="0661234567", wilaya="16", commune="Kouba",
    )
    ProviderConfig.objects.filter(tenant=tenant, courier="maystro").update(credentials={})
    with mock.patch(CREATE_ORDER) as create:
        res = _dispatch(client, other, variant)
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    create.assert_not_called()


def test_dzship_client_maps_timeout_and_error_envelope():
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    side_effect=requests.Timeout()):
        with pytest.raises(DzshipError) as exc:
            DzshipClient.create_order("maystro", {"apiToken": "k"}, {})
    assert exc.value.code == "TIMEOUT"

    error_response = mock.Mock(status_code=400)
    error_response.json.return_value = {"error": {"code": "VALIDATION_ERROR", "message": "x"}}
    http_error = requests.HTTPError(response=error_response)
    failing = mock.Mock()
    failing.raise_for_status.side_effect = http_error
    with mock.patch("apps.delivery_integrations.services.dzship_client.requests.post",
                    return_value=failing):
        with pytest.raises(DzshipError) as exc:
            DzshipClient.create_order("maystro", {"apiToken": "k"}, {})
    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.status_code == 400


@pytest.mark.django_db
def test_unsigned_webhook_receiver_is_disabled_and_changes_nothing():
    tenant, client, variant, order = _setup()
    CustomerOrder.objects.filter(pk=order.pk).update(
        status=CustomerOrderStatusChoices.DISPATCHED, tracking_number="MAY-9"
    )
    anonymous = APIClient()
    res = anonymous.post(
        "/api/v1/deliveries/webhook/",
        {"trackingNumber": "MAY-9", "status": "returned"},
        format="json",
    )

    assert res.status_code == status.HTTP_404_NOT_FOUND
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DISPATCHED


@pytest.mark.django_db
def test_external_ingestion_error_does_not_leak_exception_text():
    tenant, client, variant, order = _setup()
    tenant.api_key = "ingest-key"
    tenant.save(update_fields=["api_key"])
    anonymous = APIClient()
    with mock.patch(
        "apps.delivery_integrations.views.CustomerOrder.objects.create",
        side_effect=RuntimeError("secret internal detail"),
    ):
        res = anonymous.post(
            "/api/v1/deliveries/external-orders/",
            {"customer_name": "A", "phone": "0551234567"},
            format="json",
            HTTP_X_API_KEY="ingest-key",
        )

    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert "secret internal detail" not in res.content.decode()
