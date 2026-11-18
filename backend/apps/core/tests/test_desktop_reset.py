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


@pytest.fixture
def safety_backup(tmp_path, monkeypatch):
    """The pre-reset backup: the test database is in memory, so the real one is skipped; give it a file."""
    created = tmp_path / "db_backup_pre_reset_20260101_000000.sqlite3"
    created.write_bytes(b"sqlite")
    calls = []

    def fake_backup(prefix="db_backup", db_path=None):
        calls.append(prefix)
        return created

    monkeypatch.setattr("apps.core.desktop.backup.perform_database_backup", fake_backup)
    return created, calls


def _reset_request(owner):
    client = APIClient()
    client.force_authenticate(user=owner)
    return client.post("/api/v1/desktop/reset/", {
        "password": "password123",
        "confirmation": "REINITIALISER",
        "mode": "all",
    })


@pytest.mark.django_db
def test_factory_reset_view_success_all(safety_backup):
    tenant = Tenant.objects.create(name="Store Test", is_active=True)
    owner = User.objects.create_user(email="owner@test.com", password="password123", tenant=tenant, role="owner")

    res = _reset_request(owner)
    assert res.status_code == 200
    assert res.data["status"] == "ok"
    assert res.data["mode"] == "all"
    created, calls = safety_backup
    assert res.data["backup_created"] == created.name
    assert calls == ["db_backup_pre_reset"]

    # All tenant data should be gone
    assert not Tenant.objects.filter(is_active=True).exists()
    assert not User.objects.filter(email="owner@test.com").exists()


@pytest.mark.django_db
@pytest.mark.parametrize("failure", ["none", "missing_file", "empty_file"])
def test_factory_reset_is_refused_and_deletes_nothing_without_a_safety_backup(tmp_path, monkeypatch, failure):
    tenant = Tenant.objects.create(name="Store Test", is_active=True)
    owner = User.objects.create_user(email="owner@test.com", password="password123", tenant=tenant, role="owner")

    produced = {
        "none": None,
        "missing_file": tmp_path / "never_written.sqlite3",
        "empty_file": tmp_path / "empty.sqlite3",
    }[failure]
    if failure == "empty_file":
        produced.write_bytes(b"")
    monkeypatch.setattr("apps.core.desktop.backup.perform_database_backup", lambda prefix="db_backup", db_path=None: produced)

    res = _reset_request(owner)

    assert res.status_code == 500
    assert "aucune donnée n'a été supprimée" in res.data["detail"]
    assert Tenant.objects.filter(id=tenant.id).exists()
    assert User.objects.filter(id=owner.id).exists()
