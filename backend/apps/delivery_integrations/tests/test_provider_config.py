"""
Courier accounts with named credentials (docs/plans/delivery-v1-plan.md P1.4, K8).
Catalogue snapshots are synthetic; no network.
"""
import importlib
import json

import pytest
from django.apps import apps as django_apps
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, SyncOutbox, Tenant, User
from apps.delivery_integrations.models import ProviderConfig
from apps.delivery_integrations.services import catalogue

URL = "/api/v1/deliveries/provider-configs/"
MIGRATION = importlib.import_module(
    "apps.delivery_integrations.migrations.0007_provider_config_courier_credentials"
)

ENTRIES = [
    {"key": "maystro", "name": "Maystro", "platform": "maystro", "requiredCredentials": ["apiKey"],
     "capabilities": {}, "endpoint": "https://backend.example-courier.dz/api"},
    {"key": "yalidine", "name": "Yalidine", "platform": "yalidine",
     "requiredCredentials": ["apiId", "apiToken"], "capabilities": {},
     "endpoint": "https://api.example-yal.dz"},
    {"key": "ecotrack", "name": "Ecotrack (any tenant)", "platform": "ecotrack",
     "requiredCredentials": ["token"], "capabilities": {},
     "requiresBaseUrl": True, "baseUrlSuffixes": [".ecotrack.dz"]},
]


@pytest.fixture(autouse=True)
def snapshot(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry(e) for e in ENTRIES],
    }), encoding="utf-8")


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Config Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    owner = User.objects.create_user(
        email="owner-cfg@test.com", password="password123", role=RoleChoices.OWNER, tenant=tenant
    )
    client = APIClient()
    client.force_authenticate(user=owner)
    return tenant, client


# ─── Create ───────────────────────────────────────────────────────────────────

def test_create_saves_credentials_and_never_returns_them(store):
    tenant, client = store
    res = client.post(URL, {"courier": "maystro", "credentials": {"apiKey": "tok-SECRET-1"}}, format="json")

    assert res.status_code == status.HTTP_201_CREATED, res.content
    body = res.json()
    assert "credentials" not in body
    assert "tok-SECRET-1" not in res.content.decode()
    assert body["courier"] == "maystro"
    assert body["courier_name"] == "Maystro"
    assert body["platform"] == "maystro"
    assert body["required_credentials"] == ["apiKey"]
    assert body["saved_credentials"] == ["apiKey"]
    assert body["missing_credentials"] == []
    cfg = ProviderConfig.objects.get(tenant=tenant, courier="maystro")
    assert cfg.credentials == {"apiKey": "tok-SECRET-1"}
    assert cfg.base_url == ""

    listed = client.get(URL)
    assert listed.status_code == status.HTTP_200_OK
    assert "tok-SECRET-1" not in listed.content.decode()


@pytest.mark.parametrize("payload", [
    {"courier": "maystro", "credentials": {"apiKey": "k", "extra": "x"}},     # unknown name
    {"courier": "yalidine", "credentials": {"apiId": "a"}},                   # missing apiToken
    {"courier": "maystro", "credentials": {"apiKey": ""}},                    # empty value
    {"courier": "unknown-courier", "credentials": {"apiKey": "k"}},           # not in catalogue
    {"courier": "", "credentials": {"apiKey": "k"}},                          # no courier
    {"courier": "maystro", "credentials": {"apiKey": "k"}, "base_url": "https://x.example.dz"},
    {"courier": "ecotrack", "credentials": {"token": "t"}},                   # base_url required
    {"courier": "ecotrack", "credentials": {"token": "t"}, "base_url": "http://shop.ecotrack.dz"},
    {"courier": "ecotrack", "credentials": {"token": "t"}, "base_url": "https://shop.evil.dz"},
])
def test_invalid_create_is_refused(store, payload):
    tenant, client = store
    res = client.post(URL, payload, format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert ProviderConfig.objects.filter(tenant=tenant).count() == 0


def test_generic_ecotrack_keeps_its_base_url(store):
    tenant, client = store
    res = client.post(URL, {"courier": "ecotrack", "credentials": {"token": "t"},
                            "base_url": "https://shop.ecotrack.dz/"}, format="json")
    assert res.status_code == status.HTTP_201_CREATED, res.content
    assert ProviderConfig.objects.get(tenant=tenant).base_url == "https://shop.ecotrack.dz"


def test_duplicate_courier_is_refused(store):
    tenant, client = store
    assert client.post(URL, {"courier": "maystro", "credentials": {"apiKey": "a"}}, format="json").status_code == 201
    res = client.post(URL, {"courier": "maystro", "credentials": {"apiKey": "b"}}, format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert ProviderConfig.objects.filter(tenant=tenant).count() == 1


# ─── Update ───────────────────────────────────────────────────────────────────

def test_patch_merges_credentials(store):
    tenant, client = store
    cfg = ProviderConfig.objects.create(
        tenant=tenant, courier="yalidine", credentials={"apiId": "id-1", "apiToken": "old"}
    )
    res = client.patch(f"{URL}{cfg.pk}/", {"credentials": {"apiToken": "new"}}, format="json")
    assert res.status_code == status.HTTP_200_OK, res.content
    cfg.refresh_from_db()
    assert cfg.credentials == {"apiId": "id-1", "apiToken": "new"}


def test_patch_can_complete_missing_credentials(store):
    tenant, client = store
    cfg = ProviderConfig.objects.create(tenant=tenant, courier="yalidine", credentials={"apiToken": "t"})
    assert client.get(f"{URL}{cfg.pk}/").json()["missing_credentials"] == ["apiId"]
    res = client.patch(f"{URL}{cfg.pk}/", {"credentials": {"apiId": "i"}}, format="json")
    assert res.status_code == status.HTTP_200_OK
    assert res.json()["missing_credentials"] == []


def test_courier_cannot_change(store):
    tenant, client = store
    cfg = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "k"})
    res = client.patch(f"{URL}{cfg.pk}/", {"courier": "yalidine"}, format="json")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    cfg.refresh_from_db()
    assert cfg.courier == "maystro"


def test_toggle_active_works_without_the_catalogue(store, settings, tmp_path):
    tenant, client = store
    cfg = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "k"})
    catalogue.snapshot_path().unlink()
    res = client.patch(f"{URL}{cfg.pk}/", {"is_active": False}, format="json")
    assert res.status_code == status.HTTP_200_OK
    cfg.refresh_from_db()
    assert cfg.is_active is False
    assert cfg.credentials == {"apiKey": "k"}


def test_put_is_not_allowed(store):
    tenant, client = store
    cfg = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "k"})
    res = client.put(f"{URL}{cfg.pk}/", {"courier": "maystro"}, format="json")
    assert res.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


# ─── Secrets never reach the sync outbox ──────────────────────────────────────

def test_sync_outbox_payload_has_no_credentials(store):
    tenant, client = store
    client.post(URL, {"courier": "maystro", "credentials": {"apiKey": "tok-SECRET-2"}}, format="json")
    rows = SyncOutbox.objects.filter(tenant=tenant, model_name="ProviderConfig")
    assert rows.exists()
    for row in rows:
        assert "credentials" not in row.payload
        assert "api_secret" not in row.payload
        assert "api_id" not in row.payload
        assert "tok-SECRET-2" not in json.dumps(row.payload)


# ─── Migration 0007 data steps ────────────────────────────────────────────────

@pytest.mark.django_db
def test_migration_maps_legacy_rows_and_is_idempotent():
    tenant = Tenant.objects.create(name="Legacy", plan=PlanChoices.PRO_RETAIL)
    rows = {
        "maystro_secret": ProviderConfig.objects.create(tenant=tenant, provider="maystro", api_id="", api_secret="tok-a"),
        "yalidine": ProviderConfig.objects.create(tenant=tenant, provider="yalidine", api_id="yid", api_secret="ytok"),
        "noest": ProviderConfig.objects.create(tenant=tenant, provider="noest", api_id="maybe-guid", api_secret="ntok"),
        "zr": ProviderConfig.objects.create(tenant=tenant, provider="zr_express", api_id="zid", api_secret="ztok"),
    }
    other = Tenant.objects.create(name="Legacy 2", plan=PlanChoices.PRO_RETAIL)
    maystro_id_only = ProviderConfig.objects.create(tenant=other, provider="maystro", api_id="tok-b", api_secret="")
    already = ProviderConfig.objects.create(
        tenant=other, provider="yalidine", api_id="x", api_secret="y", courier="yalidine",
        credentials={"apiId": "kept", "apiToken": "kept"},
    )

    MIGRATION.fill_courier_and_credentials(django_apps, None)
    MIGRATION.fill_courier_and_credentials(django_apps, None)  # second run changes nothing

    def reload(cfg):
        cfg.refresh_from_db()
        return cfg.courier, cfg.credentials

    assert reload(rows["maystro_secret"]) == ("maystro", {"apiKey": "tok-a"})
    assert reload(maystro_id_only) == ("maystro", {"apiKey": "tok-b"})
    assert reload(rows["yalidine"]) == ("yalidine", {"apiId": "yid", "apiToken": "ytok"})
    assert reload(rows["noest"]) == ("noest", {"apiToken": "ntok"})
    assert reload(rows["zr"]) == ("zrexpress", {})
    assert reload(already) == ("yalidine", {"apiId": "kept", "apiToken": "kept"})


@pytest.mark.django_db
def test_migration_scrubs_secrets_from_existing_outbox_rows():
    tenant = Tenant.objects.create(name="Outbox", plan=PlanChoices.PRO_RETAIL)
    leaked = SyncOutbox.objects.create(
        tenant=tenant, model_name="ProviderConfig", object_id="1", action="create",
        payload={"provider": "maystro", "api_id": "a", "api_secret": "s", "is_active": True},
    )
    social = SyncOutbox.objects.create(
        tenant=tenant, model_name="SocialIntegration", object_id="2", action="create",
        payload={"page_id": "p", "access_token": "t"},
    )
    unrelated = SyncOutbox.objects.create(
        tenant=tenant, model_name="Client", object_id="3", action="create",
        payload={"name": "X", "api_secret": "not-ours-to-touch"},
    )

    MIGRATION.scrub_secrets_from_sync_outbox(django_apps, None)

    leaked.refresh_from_db()
    social.refresh_from_db()
    unrelated.refresh_from_db()
    assert leaked.payload == {"provider": "maystro", "is_active": True}
    assert social.payload == {"page_id": "p"}
    assert unrelated.payload == {"name": "X", "api_secret": "not-ours-to-touch"}
