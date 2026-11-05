import pytest
from rest_framework import status
from rest_framework.test import APIClient
from apps.core.models import Tenant, User, RoleChoices, StoreSettings, PlanChoices


@pytest.fixture
def store_setup(db):
    tenant = Tenant.objects.create(name="Delivery Test Store", plan=PlanChoices.PRO_RETAIL)
    owner = User.objects.create_user(
        email="owner-delivery@test.com",
        password="password123",
        role=RoleChoices.OWNER,
        tenant=tenant,
    )
    settings = StoreSettings.objects.create(
        tenant=tenant,
        enable_delivery_integrations=False,
    )
    return tenant, owner, settings


def test_delivery_endpoints_return_404_when_disabled(store_setup):
    tenant, owner, settings = store_setup
    client = APIClient()

    # 1. Unauthenticated webhook endpoint
    res_webhook = client.post(
        "/api/v1/deliveries/webhook/",
        {"trackingNumber": "DZ12345", "status": "delivered"},
        format="json",
    )
    assert res_webhook.status_code == status.HTTP_404_NOT_FOUND

    # 2. Meta webhook GET / POST
    res_meta_get = client.get("/api/v1/deliveries/meta-webhook/")
    assert res_meta_get.status_code == status.HTTP_404_NOT_FOUND

    res_meta_post = client.post(
        "/api/v1/deliveries/meta-webhook/",
        {"object": "page", "entry": []},
        format="json",
    )
    assert res_meta_post.status_code == status.HTTP_404_NOT_FOUND

    # 3. Authenticated provider-configs endpoint
    client.force_authenticate(user=owner)
    res_configs = client.get("/api/v1/deliveries/provider-configs/")
    assert res_configs.status_code == status.HTTP_404_NOT_FOUND

    # 4. Authenticated customer-orders endpoint
    res_orders = client.get("/api/v1/deliveries/customer-orders/")
    assert res_orders.status_code == status.HTTP_404_NOT_FOUND


def test_delivery_endpoints_accessible_when_enabled(store_setup):
    tenant, owner, settings = store_setup
    settings.enable_delivery_integrations = True
    settings.save(update_fields=["enable_delivery_integrations"])

    client = APIClient()

    # Authenticated provider-configs should now succeed (200)
    client.force_authenticate(user=owner)
    res_configs = client.get("/api/v1/deliveries/provider-configs/")
    assert res_configs.status_code == status.HTTP_200_OK

    # Unauthenticated webhook is no longer blocked with 404 (returns 400 on empty payload)
    client.force_authenticate(user=None)
    res_webhook = client.post(
        "/api/v1/deliveries/webhook/",
        {},
        format="json",
    )
    assert res_webhook.status_code == status.HTTP_400_BAD_REQUEST

