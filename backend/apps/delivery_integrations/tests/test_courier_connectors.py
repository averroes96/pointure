"""
Read-connector contract (docs/plans/delivery-v1-plan.md P1.5). All HTTP is mocked.
"""
import json
import logging
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
import requests
from django.utils import timezone

from apps.delivery_integrations.services import catalogue
from apps.delivery_integrations.services.couriers import (
    Capability,
    ConnectorAuthError,
    ConnectorError,
    ConnectorForbidden,
    ConnectorNotFound,
    ConnectorNotSupported,
    ConnectorRateLimited,
    ConnectorUnavailable,
    CourierReadConnector,
    ParcelSnapshot,
    ShipmentStatus,
    CashStatus,
    TERMINAL_STATUSES,
    get_connector,
    register,
)
from apps.delivery_integrations.services.couriers import registry
from apps.delivery_integrations.services.couriers.base import to_date, to_datetime, to_decimal

REQUEST = "apps.delivery_integrations.services.couriers.base.requests.request"
SECRET = "very-secret-token-123"


class FakeConnector(CourierReadConnector):
    platform = "fakeplatform"
    capabilities = frozenset({Capability.TEST, Capability.LIST})

    def auth_headers(self):
        return {"Authorization": f"Token {self.credentials.get('apiKey', '')}"}

    def test_credentials(self):
        self._request("GET", "/ping/")


class OverrideConnector(FakeConnector):
    platform = "overrideplatform"
    BASE_URL_OVERRIDE = "https://read-api.example-courier.dz/api"


@pytest.fixture(autouse=True)
def isolated(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    saved = dict(registry._REGISTRY)
    register(FakeConnector)
    register(OverrideConnector)
    entries = [
        {"key": "fakecourier", "name": "Fake", "platform": "fakeplatform", "requiredCredentials": ["apiKey"],
         "capabilities": {}, "endpoint": "https://catalogue-endpoint.example.dz/api/"},
        {"key": "overridecourier", "name": "Override", "platform": "overrideplatform",
         "requiredCredentials": ["apiKey"], "capabilities": {}, "endpoint": "https://old-host.example.dz/api"},
        {"key": "genericeco", "name": "Generic", "platform": "fakeplatform", "requiredCredentials": ["token"],
         "capabilities": {}, "requiresBaseUrl": True, "baseUrlSuffixes": [".ecotrack.dz"]},
        {"key": "nobodybuiltme", "name": "Unbuilt", "platform": "unbuiltplatform",
         "requiredCredentials": ["token"], "capabilities": {}, "endpoint": "https://x.example.dz"},
    ]
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry(e) for e in entries],
    }), encoding="utf-8")
    yield
    registry._REGISTRY.clear()
    registry._REGISTRY.update(saved)


def _config(courier, credentials=None, base_url=""):
    return SimpleNamespace(courier=courier, credentials=credentials or {"apiKey": SECRET}, base_url=base_url)


def _response(status=200, payload=None, headers=None, bad_json=False):
    resp = mock.Mock(status_code=status, headers=headers or {})
    if bad_json:
        resp.json.side_effect = ValueError("no json")
    else:
        resp.json.return_value = payload if payload is not None else {}
    return resp


# ─── Registry ─────────────────────────────────────────────────────────────────

def test_registry_builds_the_platform_connector_with_the_catalogue_endpoint():
    conn = get_connector(_config("fakecourier"))
    assert isinstance(conn, FakeConnector)
    assert conn.base_url == "https://catalogue-endpoint.example.dz/api"
    assert conn.courier_key == "fakecourier"
    assert conn.credentials == {"apiKey": SECRET}


def test_connector_override_beats_the_catalogue_endpoint():
    conn = get_connector(_config("overridecourier"))
    assert conn.base_url == "https://read-api.example-courier.dz/api"


def test_store_base_url_is_used_for_generic_couriers():
    conn = get_connector(_config("genericeco", {"token": "t"}, base_url="https://shop.ecotrack.dz"))
    assert conn.base_url == "https://shop.ecotrack.dz"


@pytest.mark.parametrize("courier,base_url,reason", [
    ("not-in-catalogue", "", "unknown_courier"),
    ("nobodybuiltme", "", "no_connector"),
    ("genericeco", "", "no_base_url"),
])
def test_registry_reports_why_a_courier_is_not_supported(courier, base_url, reason):
    with pytest.raises(ConnectorNotSupported) as exc:
        get_connector(_config(courier, base_url=base_url))
    assert exc.value.reason == reason


def test_register_refuses_classes_without_a_platform():
    class NoPlatform(CourierReadConnector):
        pass

    with pytest.raises(TypeError):
        register(NoPlatform)


def test_unimplemented_operations_raise_not_supported():
    conn = get_connector(_config("fakecourier"))
    assert conn.supports(Capability.LIST) is True
    assert conn.supports(Capability.PAYOUTS) is False
    for call in (lambda: conn.list_parcels(), lambda: conn.get_parcel("x"), lambda: conn.history("x"),
                 lambda: conn.balance(), lambda: conn.list_payouts(), lambda: conn.payout_lines("p")):
        with pytest.raises(ConnectorNotSupported):
            call()


# ─── HTTP and error mapping ───────────────────────────────────────────────────

def test_request_sends_auth_and_a_timeout_and_returns_json():
    conn = get_connector(_config("fakecourier"))
    with mock.patch(REQUEST, return_value=_response(payload={"ok": True})) as req:
        assert conn._request("GET", "/orders/", params={"page": 2}) == {"ok": True}
    args, kwargs = req.call_args
    assert args == ("GET", "https://catalogue-endpoint.example.dz/api/orders/")
    assert kwargs["timeout"] == CourierReadConnector.TIMEOUT_SECONDS
    assert kwargs["params"] == {"page": 2}
    assert kwargs["headers"]["Authorization"] == f"Token {SECRET}"
    assert kwargs["headers"]["Accept"] == "application/json"


@pytest.mark.parametrize("response,error,attrs", [
    (_response(401), ConnectorAuthError, {"status_code": 401}),
    (_response(403), ConnectorForbidden, {"status_code": 403}),
    (_response(404), ConnectorNotFound, {"status_code": 404}),
    (_response(429, headers={"Retry-After": "30"}), ConnectorRateLimited, {"retry_after": 30}),
    (_response(429, headers={"Retry-After": "soon"}), ConnectorRateLimited, {"retry_after": 60}),
    (_response(429, headers={"Retry-After": "999999"}), ConnectorRateLimited, {"retry_after": 3600}),
    (_response(502), ConnectorUnavailable, {"status_code": 502}),
    (_response(400), ConnectorError, {"status_code": 400}),
    (_response(200, bad_json=True), ConnectorError, {"status_code": 200}),
])
def test_http_errors_map_to_typed_exceptions(response, error, attrs):
    conn = get_connector(_config("fakecourier"))
    with mock.patch(REQUEST, return_value=response):
        with pytest.raises(error) as exc:
            conn._request("GET", "/orders/")
    assert type(exc.value) is error
    for name, value in attrs.items():
        assert getattr(exc.value, name) == value


@pytest.mark.parametrize("raised", [requests.Timeout(), requests.ConnectionError()])
def test_network_failures_are_unavailable(raised):
    conn = get_connector(_config("fakecourier"))
    with mock.patch(REQUEST, side_effect=raised):
        with pytest.raises(ConnectorUnavailable):
            conn._request("GET", "/orders/")


def test_next_page_links_are_followed_only_on_the_couriers_host():
    conn = get_connector(_config("fakecourier"))
    with mock.patch(REQUEST, return_value=_response(payload={})) as req:
        conn._request("GET", "https://catalogue-endpoint.example.dz/api/orders/?page=3")
    assert req.call_args.args[1] == "https://catalogue-endpoint.example.dz/api/orders/?page=3"

    with mock.patch(REQUEST) as req:
        with pytest.raises(ConnectorError) as exc:
            conn._request("GET", "https://attacker.example.com/steal/")
        with pytest.raises(ConnectorError):
            conn._request("GET", "http://catalogue-endpoint.example.dz/api/orders/")
    req.assert_not_called()
    assert str(exc.value) == "foreign_url"


def test_logs_never_contain_credentials_or_query_values(caplog):
    conn = get_connector(_config("fakecourier"))
    # The "apps" logger does not propagate (desktop LOGGING), so listen on it directly.
    base_logger = logging.getLogger("apps.delivery_integrations.services.couriers.base")
    base_logger.addHandler(caplog.handler)
    try:
        with mock.patch(REQUEST, return_value=_response(401)):
            with pytest.raises(ConnectorAuthError):
                conn._request("GET", "/orders/", params={"search": "0551234567"})
        with mock.patch(REQUEST, side_effect=requests.Timeout()):
            with pytest.raises(ConnectorUnavailable):
                conn._request("GET", "/orders/?search=0551234567")
    finally:
        base_logger.removeHandler(caplog.handler)
    text = caplog.text
    assert SECRET not in text
    assert "0551234567" not in text
    assert "fakecourier" in text


# ─── Helpers and vocabulary ───────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    ("1250.5", Decimal("1250.50")), (1250, Decimal("1250.00")), (99.999, Decimal("100.00")),
    ("", None), (None, None), ("abc", None), (True, None),
])
def test_to_decimal(value, expected):
    assert to_decimal(value) == expected


def test_to_datetime_reads_naive_values_as_store_time():
    algiers = ZoneInfo("Africa/Algiers")
    assert to_datetime("2026-11-16 21:14:07") == datetime(2026, 11, 16, 21, 14, 7, tzinfo=algiers)
    assert to_datetime("2026-11-16T20:14:07Z") == datetime(2026, 11, 16, 20, 14, 7, tzinfo=ZoneInfo("UTC"))
    assert to_datetime("not a date") is None
    assert to_datetime(None) is None


def test_to_date():
    assert to_date("2026-11-16") == date(2026, 11, 16)
    assert to_date("2026-11-16T10:00:00Z") == date(2026, 11, 16)
    assert to_date("garbage") is None


def test_snapshot_defaults_and_immutability():
    snap = ParcelSnapshot(external_id="1", tracking="T1")
    assert snap.status == ShipmentStatus.UNKNOWN
    assert snap.cash_status == CashStatus.AWAITING_DELIVERY
    assert snap.events == ()
    with pytest.raises(Exception):
        snap.status = ShipmentStatus.DELIVERED  # frozen


def test_terminal_statuses():
    assert TERMINAL_STATUSES == {
        ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED, ShipmentStatus.CANCELLED, ShipmentStatus.LOST,
    }
