"""
Courier catalogue snapshot (docs/plans/delivery-v1-plan.md P1.3).
All HTTP is mocked; entries below are synthetic, shaped like GET /v1/couriers.
"""
import json
from datetime import timedelta
from unittest import mock

import pytest
import requests
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.services import catalogue

GET = "apps.delivery_integrations.services.catalogue.requests.get"
START = "apps.delivery_integrations.services.catalogue.start_background_refresh"

MAYSTRO = {
    "key": "maystro", "name": "Maystro", "platform": "maystro",
    "requiredCredentials": ["apiKey"],
    "capabilities": {"createShipment": True, "track": True, "label": True},
    "endpoint": "https://backend.example-courier.dz/api",
}
GENERIC_ECOTRACK = {
    "key": "ecotrack", "name": "Ecotrack (any tenant)", "platform": "ecotrack",
    "requiredCredentials": ["token"], "capabilities": {"track": True},
    "requiresBaseUrl": True, "baseUrlSuffixes": [".ecotrack.dz"],
}


@pytest.fixture(autouse=True)
def data_dir(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    catalogue._refresh_running = False
    yield tmp_path
    catalogue._refresh_running = False


def _response(payload, status_code=200):
    resp = mock.Mock(status_code=status_code)
    resp.json.return_value = payload
    if status_code >= 400:
        resp.raise_for_status.side_effect = requests.HTTPError(response=resp)
    else:
        resp.raise_for_status.return_value = None
    return resp


def _write(couriers, age=timedelta(0)):
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": (timezone.now() - age).isoformat(),
        "couriers": couriers,
    }), encoding="utf-8")


# ─── Service ──────────────────────────────────────────────────────────────────

def test_refresh_stores_valid_entries_and_uses_a_timeout():
    with mock.patch(GET, return_value=_response([MAYSTRO, GENERIC_ECOTRACK])) as get:
        assert catalogue.refresh_catalogue() is True

    assert get.call_args.kwargs["timeout"] == catalogue.TIMEOUT_SECONDS
    assert get.call_args.args[0] == "https://freeship.dzbuild.com/v1/couriers"
    snap = catalogue.load_snapshot()
    assert [c["key"] for c in snap["couriers"]] == ["maystro", "ecotrack"]
    maystro = snap["couriers"][0]
    assert maystro == {
        "key": "maystro", "name": "Maystro", "platform": "maystro",
        "required_credentials": ["apiKey"],
        "capabilities": {"createShipment": True, "track": True, "label": True},
        "endpoint": "https://backend.example-courier.dz/api",
        "requires_base_url": False, "base_url_suffixes": [],
    }
    ecotrack = snap["couriers"][1]
    assert ecotrack["endpoint"] is None
    assert ecotrack["requires_base_url"] is True
    assert ecotrack["base_url_suffixes"] == [".ecotrack.dz"]
    assert not catalogue.snapshot_path().with_suffix(".json.tmp").exists()


@pytest.mark.parametrize("bad", [
    {**MAYSTRO, "key": "Bad Key!"},
    {**MAYSTRO, "endpoint": "http://plain-http.example.dz/api"},
    {**MAYSTRO, "endpoint": None},
    {**MAYSTRO, "requiredCredentials": []},
    {**MAYSTRO, "requiredCredentials": ["api key with spaces"]},
    {**MAYSTRO, "capabilities": "yes"},
    {**GENERIC_ECOTRACK, "baseUrlSuffixes": ["ecotrack.dz"]},
    "not a dict",
])
def test_invalid_entries_are_dropped(bad):
    with mock.patch(GET, return_value=_response([bad, GENERIC_ECOTRACK])):
        assert catalogue.refresh_catalogue() is True
    assert [c["key"] for c in catalogue.load_snapshot()["couriers"]] == ["ecotrack"]


def test_duplicate_keys_keep_the_first_entry():
    with mock.patch(GET, return_value=_response([MAYSTRO, {**MAYSTRO, "name": "Other"}])):
        catalogue.refresh_catalogue()
    couriers = catalogue.load_snapshot()["couriers"]
    assert len(couriers) == 1
    assert couriers[0]["name"] == "Maystro"


@pytest.mark.parametrize("failure", [
    {"side_effect": requests.Timeout()},
    {"side_effect": requests.ConnectionError()},
    {"return_value": _response({"error": "x"}, status_code=503)},
    {"return_value": _response({"not": "a list"})},
    {"return_value": _response([{"key": "Bad!"}])},
])
def test_failed_refresh_keeps_the_previous_snapshot(failure):
    _write([catalogue.clean_entry(MAYSTRO)], age=timedelta(days=3))
    before = catalogue.snapshot_path().read_text(encoding="utf-8")

    with mock.patch(GET, **failure):
        assert catalogue.refresh_catalogue() is False

    assert catalogue.snapshot_path().read_text(encoding="utf-8") == before


def test_unreadable_snapshot_counts_as_missing():
    catalogue.snapshot_path().write_text("{not json", encoding="utf-8")
    assert catalogue.load_snapshot() is None


def test_get_catalogue_serves_fresh_snapshot_without_refreshing():
    _write([catalogue.clean_entry(MAYSTRO)], age=timedelta(hours=1))
    with mock.patch(START) as start:
        result = catalogue.get_catalogue()
    start.assert_not_called()
    assert result["stale"] is False
    assert [c["key"] for c in result["couriers"]] == ["maystro"]


def test_get_catalogue_serves_stale_snapshot_and_refreshes_in_background():
    _write([catalogue.clean_entry(MAYSTRO)], age=timedelta(hours=25))
    with mock.patch(START) as start:
        result = catalogue.get_catalogue()
    start.assert_called_once()
    assert result["stale"] is True
    assert [c["key"] for c in result["couriers"]] == ["maystro"]


def test_get_catalogue_without_snapshot_returns_empty_and_refreshes():
    with mock.patch(START) as start:
        result = catalogue.get_catalogue()
    start.assert_called_once()
    assert result == {"couriers": [], "fetched_at": None, "stale": True, "refreshing": False}


def test_only_one_background_refresh_runs_at_a_time():
    started = []
    with mock.patch("apps.delivery_integrations.services.catalogue.threading.Thread") as thread:
        thread.return_value.start.side_effect = lambda: started.append(1)
        assert catalogue.start_background_refresh() is True
        assert catalogue.start_background_refresh() is False
    assert started == [1]
    assert catalogue.is_refreshing() is True


def test_background_refresh_clears_the_running_flag_even_on_error():
    catalogue._refresh_running = True
    with mock.patch(
        "apps.delivery_integrations.services.catalogue.refresh_catalogue",
        side_effect=RuntimeError("boom"),
    ):
        catalogue._run_refresh()
    assert catalogue.is_refreshing() is False


def test_get_courier_looks_up_the_snapshot_only():
    _write([catalogue.clean_entry(MAYSTRO)])
    with mock.patch(GET) as get:
        assert catalogue.get_courier("maystro")["platform"] == "maystro"
        assert catalogue.get_courier("unknown") is None
    get.assert_not_called()


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Catalogue Store", plan=PlanChoices.PRO_RETAIL)
    store_settings = StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(
            email=f"{role}-cat@test.com", password="password123", role=role, tenant=tenant
        )
        for role in (RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER)
    }
    return store_settings, users


def _get(user, query=""):
    client = APIClient()
    client.force_authenticate(user=user)
    return client.get(f"/api/v1/deliveries/couriers/{query}")


def test_manager_reads_the_catalogue(store):
    _, users = store
    _write([catalogue.clean_entry(MAYSTRO)])
    with mock.patch(START) as start:
        res = _get(users[RoleChoices.MANAGER])
    assert res.status_code == status.HTTP_200_OK
    body = res.json()
    assert [c["key"] for c in body["couriers"]] == ["maystro"]
    assert body["stale"] is False
    start.assert_not_called()


def test_refresh_true_starts_a_background_refresh(store):
    _, users = store
    _write([catalogue.clean_entry(MAYSTRO)])
    with mock.patch(START) as start:
        res = _get(users[RoleChoices.OWNER], "?refresh=true")
    assert res.status_code == status.HTTP_200_OK
    start.assert_called_once()


def test_refresh_false_string_is_not_truthy(store):
    _, users = store
    _write([catalogue.clean_entry(MAYSTRO)])
    with mock.patch(START) as start:
        res = _get(users[RoleChoices.OWNER], "?refresh=false")
    assert res.status_code == status.HTTP_200_OK
    start.assert_not_called()


def test_cashier_is_refused(store):
    _, users = store
    with mock.patch(START) as start:
        res = _get(users[RoleChoices.CASHIER])
    assert res.status_code == status.HTTP_403_FORBIDDEN
    start.assert_not_called()


def test_feature_off_returns_404(store):
    store_settings, users = store
    store_settings.enable_delivery_integrations = False
    store_settings.save(update_fields=["enable_delivery_integrations"])
    with mock.patch(START) as start:
        res = _get(users[RoleChoices.OWNER])
    assert res.status_code == status.HTTP_404_NOT_FOUND
    start.assert_not_called()
