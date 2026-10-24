import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.core.models import Tenant, Branch, StoreSettings
from apps.core.desktop.reset import perform_database_wipe

User = get_user_model()


@pytest.mark.django_db
def test_perform_database_wipe_transactions_only():
    tenant = Tenant.objects.create(name="Store Test", is_active=True)
    user = User.objects.create_user(email="owner@test.com", password="password123", tenant=tenant, role="owner")
    branch = Branch.objects.create(tenant=tenant, name="Branch Test")

    result = perform_database_wipe(mode="transactions_only")
    assert result["mode"] == "transactions_only"

    # In transactions_only mode, tenant, user, and branch remain
    assert Tenant.objects.filter(id=tenant.id).exists()
    assert User.objects.filter(id=user.id).exists()
    assert Branch.objects.filter(id=branch.id).exists()


@pytest.mark.django_db
def test_factory_reset_view_permission_and_auth():
    tenant = Tenant.objects.create(name="Store Test", is_active=True)
    manager = User.objects.create_user(email="manager@test.com", password="password123", tenant=tenant, role="manager")
    owner = User.objects.create_user(email="owner@test.com", password="password123", tenant=tenant, role="owner")

    client = APIClient()

    # 1. Non-owner forbidden
    client.force_authenticate(user=manager)
    res = client.post("/api/v1/desktop/reset/", {"password": "password123", "confirmation": "REINITIALISER"})
    assert res.status_code == 403

    # 2. Owner with bad password
    client.force_authenticate(user=owner)
    res = client.post("/api/v1/desktop/reset/", {"password": "wrongpassword", "confirmation": "REINITIALISER"})
    assert res.status_code == 400
    assert "Mot de passe propriétaire incorrect" in res.data["detail"]

    # 3. Owner with bad confirmation
    res = client.post("/api/v1/desktop/reset/", {"password": "password123", "confirmation": "NON"})
    assert res.status_code == 400
    assert "Confirmation invalide" in res.data["detail"]


@pytest.mark.django_db
def test_factory_reset_view_success_all():
    tenant = Tenant.objects.create(name="Store Test", is_active=True)
    owner = User.objects.create_user(email="owner@test.com", password="password123", tenant=tenant, role="owner")

    client = APIClient()
    client.force_authenticate(user=owner)
    res = client.post("/api/v1/desktop/reset/", {
        "password": "password123",
        "confirmation": "REINITIALISER",
        "mode": "all",
    })
    assert res.status_code == 200
    assert res.data["status"] == "ok"
    assert res.data["mode"] == "all"

    # All tenant data should be gone
    assert not Tenant.objects.filter(is_active=True).exists()
    assert not User.objects.filter(email="owner@test.com").exists()
