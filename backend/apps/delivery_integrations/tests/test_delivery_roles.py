"""
Delivery endpoints are for managers and owners only, enforced on the server
(docs/plans/delivery-v1-plan.md P1.2, DL.2, K7; AGENTS.md §4.5).
"""
from decimal import Decimal
from unittest import mock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import (
    CustomerOrder,
    CustomerOrderStatusChoices,
    ProviderConfig,
)
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant

CREATE_ORDER = "apps.delivery_integrations.services.dzship_client.DzshipClient.create_order"


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Roles Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(
            email=f"{role}-roles@test.com", password="password123", role=role, tenant=tenant
        )
        for role in (RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER)
    }
    config = ProviderConfig.objects.create(
        tenant=tenant, provider="maystro", api_id="", api_secret="secret-key", is_active=True
    )
    product = Product.objects.create(
        tenant=tenant, name="Basket", reference="B-1", sale_price=Decimal("4500.00")
    )
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=41)
    StockMovement.objects.create(
        tenant=tenant, variant=variant, quantity_delta=5, reason=MovementReasonChoices.INITIAL
    )
    order = CustomerOrder.objects.create(
        tenant=tenant, customer_name="Client Test", customer_phone="0551234567",
        wilaya="16", commune="Bab Ezzouar",
    )
    return tenant, users, config, variant, order


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.parametrize(
    "method,path_tpl,body",
    [
        ("get", "/api/v1/deliveries/provider-configs/", None),
        ("post", "/api/v1/deliveries/provider-configs/",
         {"provider": "yalidine", "api_id": "x", "api_secret": "y", "is_active": True}),
        ("get", "/api/v1/deliveries/provider-configs/{config}/", None),
        ("patch", "/api/v1/deliveries/provider-configs/{config}/", {"is_active": False}),
        ("delete", "/api/v1/deliveries/provider-configs/{config}/", None),
        ("get", "/api/v1/deliveries/customer-orders/", None),
        ("post", "/api/v1/deliveries/customer-orders/",
         {"customer_name": "X", "customer_phone": "0551234567"}),
        ("get", "/api/v1/deliveries/customer-orders/{order}/", None),
        ("patch", "/api/v1/deliveries/customer-orders/{order}/", {"commune": "Kouba"}),
        ("delete", "/api/v1/deliveries/customer-orders/{order}/", None),
    ],
)
def test_cashier_is_refused_on_every_delivery_endpoint(store, method, path_tpl, body):
    tenant, users, config, variant, order = store
    path = path_tpl.format(config=config.pk, order=order.pk)
    client = _client(users[RoleChoices.CASHIER])

    res = getattr(client, method)(path, body, format="json") if body is not None else getattr(client, method)(path)

    assert res.status_code == status.HTTP_403_FORBIDDEN
    # Nothing changed.
    config.refresh_from_db()
    order.refresh_from_db()
    assert config.is_active is True
    assert order.commune == "Bab Ezzouar"
    assert ProviderConfig.objects.filter(tenant=tenant).count() == 1
    assert CustomerOrder.objects.filter(tenant=tenant).count() == 1


def test_cashier_cannot_dispatch_and_courier_is_never_called(store):
    tenant, users, config, variant, order = store
    client = _client(users[RoleChoices.CASHIER])
    with mock.patch(CREATE_ORDER) as create:
        res = client.post(
            f"/api/v1/deliveries/customer-orders/{order.pk}/dispatch_order/",
            {"provider": "maystro", "total_price": "4500.00",
             "variant_ids": [str(variant.pk)], "quantities": [1]},
            format="json",
        )

    assert res.status_code == status.HTTP_403_FORBIDDEN
    create.assert_not_called()
    order.refresh_from_db()
    assert order.status == CustomerOrderStatusChoices.DRAFT
    assert StockMovement.objects.filter(variant=variant, reason=MovementReasonChoices.SALE).count() == 0


@pytest.mark.parametrize("role", [RoleChoices.MANAGER, RoleChoices.OWNER])
def test_manager_and_owner_can_use_delivery_endpoints(store, role):
    tenant, users, config, variant, order = store
    client = _client(users[role])

    assert client.get("/api/v1/deliveries/provider-configs/").status_code == status.HTTP_200_OK
    assert client.get("/api/v1/deliveries/customer-orders/").status_code == status.HTTP_200_OK
    with mock.patch(CREATE_ORDER, return_value={"trackingNumber": "MAY-R1"}):
        res = client.post(
            f"/api/v1/deliveries/customer-orders/{order.pk}/dispatch_order/",
            {"provider": "maystro", "total_price": "4500.00",
             "variant_ids": [str(variant.pk)], "quantities": [1]},
            format="json",
        )
    assert res.status_code == status.HTTP_200_OK
    assert res.json()["trackingNumber"] == "MAY-R1"
