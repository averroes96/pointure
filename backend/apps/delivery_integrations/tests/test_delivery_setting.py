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

    # 1. Unauthenticated external order intake (the remaining public route)
    res_intake = client.post(
        "/api/v1/deliveries/external-orders/",
        {"customer_name": "A", "phone": "0551234567"},
        format="json",
    )
    assert res_intake.status_code == status.HTTP_404_NOT_FOUND

    # 2. Authenticated provider-configs endpoint
    client.force_authenticate(user=owner)
    res_configs = client.get("/api/v1/deliveries/provider-configs/")
    assert res_configs.status_code == status.HTTP_404_NOT_FOUND

    # 3. Authenticated customer-orders endpoint
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

    # The external intake is reachable once enabled: without an API key it answers 401.
    client.force_authenticate(user=None)
    res_intake = client.post("/api/v1/deliveries/external-orders/", {}, format="json")
    assert res_intake.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/v1/deliveries/webhook/"),
        ("get", "/api/v1/deliveries/meta-webhook/"),
        ("post", "/api/v1/deliveries/meta-webhook/"),
        ("get", "/api/v1/deliveries/meta-oauth/url/"),
        ("get", "/api/v1/deliveries/meta-oauth/callback/"),
        ("get", "/api/v1/deliveries/social-integrations/"),
    ],
)
def test_removed_routes_are_gone_even_when_enabled(store_setup, method, path):
    """Meta/Gemini parsing and the unsigned status webhook were removed
    (docs/plans/delivery-v1-plan.md P1.1, DL.10)."""
    tenant, owner, settings = store_setup
    settings.enable_delivery_integrations = True
    settings.save(update_fields=["enable_delivery_integrations"])
    client = APIClient()
    client.force_authenticate(user=owner)

    res = getattr(client, method)(path, {}, format="json") if method == "post" else client.get(path)
    assert res.status_code == status.HTTP_404_NOT_FOUND

