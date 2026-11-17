"""
Ecotrack-platform read connector (docs/plans/delivery-v1-plan.md P3.5). Built from
third-party documentation (unverified); synthetic data shaped like the documented
responses, all HTTP mocked.
"""
import json
import logging
from datetime import datetime, timedelta
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import ProviderConfig, Shipment
from apps.delivery_integrations.services import catalogue, sync
from apps.delivery_integrations.services.couriers import (
    CashStatus,
    ConnectorAuthError,
    ConnectorError,
    ConnectorForbidden,
    ConnectorNotFound,
    ConnectorRateLimited,
    ParcelSnapshot,
    ShipmentStatus,
    get_connector,
)
from apps.delivery_integrations.services.couriers import ecotrack
from apps.delivery_integrations.services.couriers.ecotrack import (
    ACTIVITIES,
    BUCKETS,
    EcotrackConnector,
    cash_status_for,
    map_activity,
    map_bucket,
)

REQUEST = "apps.delivery_integrations.services.couriers.base.requests.request"
ALGIERS = ZoneInfo("Africa/Algiers")
TOKEN = "eyJ0-SECRET-ecotrack-token-0001"
CATALOGUE = [
    {"key": "dhd", "name": "DHD Livraison", "platform": "ecotrack", "requiredCredentials": ["token"],
     "capabilities": {}, "endpoint": "https://platform.dhd-dz.com"},
    {"key": "packers", "name": "Packers", "platform": "ecotrack", "requiredCredentials": ["token"],
     "capabilities": {}, "endpoint": "https://packers.ecotrack.dz"},
    {"key": "ecotrack", "name": "Ecotrack (any tenant)", "platform": "ecotrack", "requiredCredentials": ["token"],
     "capabilities": {}, "requiresBaseUrl": True, "baseUrlSuffixes": [".ecotrack.dz"]},
]

# Every key both sources document.
DOCUMENTED_BUCKETS = [
    "prete_a_expedier", "en_ramassage", "en_preparation_stock", "vers_hub", "en_hub", "vers_wilaya",
    "en_preparation", "en_livraison", "suspendu", "livre_non_encaisse", "encaisse_non_paye", "paiements_prets",
    "paye_et_archive", "retour_chez_livreur", "retour_transit_entrepot", "retour_en_traitement", "retour_recu",
    "retour_archive", "annule",
]
DOCUMENTED_ACTIVITIES = [
    "order_information_received_by_carrier", "picked", "accepted_by_carrier", "dispatched_to_driver",
    "attempt_delivery", "return_asked", "return_in_transit", "Return_received", "livred", "encaissed", "payed",
]


def order(**over):
    row = {
        "tracking": "ECOH123456", "reference": "8f14e45f-ceea-467e-a4f0-6b1c2d3e4f50", "client": "Client Test",
        "phone": "0551234567", "phone_2": None, "adresse": "12 rue X", "commune": "Bab Ezzouar", "wilaya_id": 16,
        "montant": "5300.00", "tarif_prestation": "400.00", "tarif_retour": "200.00", "type_id": 1,
        "created_at": "2026-11-15 09:00:00", "payment_id": None, "return_id": None, "status": "encaisse_non_paye",
        "products": "Basket x1",
    }
    row.update(over)
    return row


def _resp(payload=None, status_code=200, headers=None):
    r = mock.Mock(status_code=status_code, headers=headers or {})
    r.json.return_value = payload if payload is not None else {}
    return r


def _page(rows, page=1, last=1):
    return {"current_page": page, "last_page": last, "per_page": 40, "total": len(rows), "data": rows}


@pytest.fixture(autouse=True)
def setup(settings, tmp_path, monkeypatch):
    settings.DATA_DIR = tmp_path
    monkeypatch.setattr(ecotrack, "MIN_INTERVAL", 0)
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry(e) for e in CATALOGUE],
    }), encoding="utf-8")
    sync._running.clear(); sync._rerun.clear(); sync._blocked_until.clear()


def _conn(courier="packers", token=TOKEN, base_url=""):
    return get_connector(ProviderConfig(courier=courier, credentials={"token": token}, base_url=base_url))


# ─── Construction ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("courier,base_url,expected", [
    ("dhd", "", "https://platform.dhd-dz.com"),
    ("packers", "", "https://packers.ecotrack.dz"),
    ("ecotrack", "https://shop.ecotrack.dz", "https://shop.ecotrack.dz"),
    ("ecotrack", "https://shop.ecotrack.dz/api/v1/", "https://shop.ecotrack.dz"),
])
def test_one_connector_for_every_tenant(courier, base_url, expected):
    conn = _conn(courier, base_url=base_url)
    assert isinstance(conn, EcotrackConnector)
    assert conn.base_url == expected
    assert (conn.verified, conn.max_list_pages) == (False, 10)


def test_bearer_prefix_in_the_saved_token_is_tolerated():
    assert _conn(token=f"Bearer {TOKEN}").auth_headers() == {"Authorization": f"Bearer {TOKEN}"}


def test_test_credentials_uses_a_cheap_bearer_call_and_refuses_a_missing_token():
    with mock.patch(REQUEST, return_value=_resp([{"wilaya_id": 16}])) as req:
        _conn().test_credentials()
    args, kwargs = req.call_args
    assert args == ("GET", "https://packers.ecotrack.dz/api/v1/get/wilayas")
    assert kwargs["headers"]["Authorization"] == f"Bearer {TOKEN}"
    assert kwargs["params"] is None                     # the token never goes in the URL here

    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn(token=" ").test_credentials()
    req.assert_not_called()


@pytest.mark.parametrize("http,error", [(401, ConnectorAuthError), (403, ConnectorForbidden)])
def test_refusals_are_typed(http, error):
    with mock.patch(REQUEST, return_value=_resp(status_code=http)), pytest.raises(error):
        _conn().test_credentials()


def test_429_carries_retry_after():
    with mock.patch(REQUEST, return_value=_resp(status_code=429, headers={"Retry-After": "30"})), \
            pytest.raises(ConnectorRateLimited) as exc:
        _conn().list_parcels()
    assert exc.value.retry_after == 30


def test_http_200_business_refusal_is_an_error():
    with mock.patch(REQUEST, return_value=_resp({"success": False, "error": 10002})), pytest.raises(ConnectorError):
        _conn().list_parcels()


# ─── Mapping ──────────────────────────────────────────────────────────────────

def test_every_documented_key_is_mapped():
    assert [k for k in DOCUMENTED_BUCKETS if map_bucket(k)[0] == ShipmentStatus.UNKNOWN] == []
    assert [k for k in DOCUMENTED_ACTIVITIES if map_activity(k)[0] == ShipmentStatus.UNKNOWN] == []
    assert len(BUCKETS) == len(DOCUMENTED_BUCKETS)
    assert len(ACTIVITIES) == len(DOCUMENTED_ACTIVITIES)


@pytest.mark.parametrize("key,status_,cash", [
    ("prete_a_expedier", ShipmentStatus.PENDING_PICKUP, None),
    ("en_livraison", ShipmentStatus.OUT_FOR_DELIVERY, None),
    ("suspendu", ShipmentStatus.ON_HOLD, None),
    ("livre_non_encaisse", ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER),
    ("paiements_prets", ShipmentStatus.DELIVERED, CashStatus.READY),
    ("paye_et_archive", ShipmentStatus.DELIVERED, CashStatus.PAID),
    ("retour_en_traitement", ShipmentStatus.RETURN_IN_TRANSIT, None),
    ("retour_recu", ShipmentStatus.RETURNED, None),
    ("ANNULE", ShipmentStatus.CANCELLED, None),
    ("Sorti en livraison", ShipmentStatus.UNKNOWN, None),       # a tenant's display label, not a key
    ("", ShipmentStatus.UNKNOWN, None),
])
def test_bucket_mapping(key, status_, cash):
    assert map_bucket(key) == (status_, cash, key)


@pytest.mark.parametrize("key,expected", [
    ("Return_received", ShipmentStatus.RETURNED),
    ("return_received", ShipmentStatus.RETURNED),
    ("picked", ShipmentStatus.PICKED_UP),
    ("attempt_delivery", ShipmentStatus.DELIVERY_ATTEMPTED),
    ("encaissed", ShipmentStatus.DELIVERED),
    ("something_new", ShipmentStatus.UNKNOWN),
])
def test_activity_mapping(key, expected):
    assert map_activity(key) == (expected, key)


@pytest.mark.parametrize("status_,stage,cod,expected", [
    (ShipmentStatus.IN_TRANSIT, None, True, CashStatus.AWAITING_DELIVERY),
    (ShipmentStatus.DELIVERED, None, True, CashStatus.HELD_BY_COURIER),
    (ShipmentStatus.DELIVERED, CashStatus.READY, True, CashStatus.READY),
    (ShipmentStatus.DELIVERED, CashStatus.PAID, True, CashStatus.PAID),
    (ShipmentStatus.DELIVERED, CashStatus.PAID, False, CashStatus.NOT_APPLICABLE),
    (ShipmentStatus.RETURNED, None, True, CashStatus.NOT_APPLICABLE),
    (ShipmentStatus.CANCELLED, None, True, CashStatus.NOT_APPLICABLE),
])
def test_cash_stage(status_, stage, cod, expected):
    assert cash_status_for(status_, stage, cod) == expected


# ─── Orders ───────────────────────────────────────────────────────────────────

def test_list_parcels_reads_a_page_and_maps_a_row():
    page = _page([order(), {"tracking": ""}, "junk", order(tracking="ECOH2", status="en_hub")], page=1, last=3)
    with mock.patch(REQUEST, return_value=_resp(page)) as req:
        result = _conn().list_parcels()

    args, kwargs = req.call_args
    assert args == ("GET", "https://packers.ecotrack.dz/api/v1/get/orders")
    assert kwargs["params"] == {"page": 1}
    assert result.next_cursor == "2"
    assert [s.tracking for s in result.items] == ["ECOH123456", "ECOH2"]
    snap = result.items[0]
    assert (snap.external_id, snap.status, snap.raw_status) == ("ECOH123456", ShipmentStatus.DELIVERED,
                                                                 "encaisse_non_paye")
    assert (snap.status_at, snap.updated_at) == (None, None)      # list rows carry no status time
    assert (snap.reference, snap.recipient_name, snap.recipient_phone) == (
        "8f14e45f-ceea-467e-a4f0-6b1c2d3e4f50", "Client Test", "0551234567")
    assert (snap.wilaya_code, snap.commune) == ("16", "Bab Ezzouar")
    assert (snap.cod_amount, snap.delivery_fee, snap.store_amount) == (Decimal("5300.00"), Decimal("400.00"), None)
    assert snap.cash_status == CashStatus.HELD_BY_COURIER
    assert result.items[1].status == ShipmentStatus.AT_HUB


def test_last_page_and_index_keyed_data():
    data = {"current_page": 3, "last_page": 3, "data": {"0": order(), "1": order(tracking="ECOH9")}}
    with mock.patch(REQUEST, return_value=_resp(data)) as req:
        result = _conn().list_parcels("3")
    assert req.call_args.kwargs["params"] == {"page": 3}
    assert result.next_cursor is None
    assert [s.tracking for s in result.items] == ["ECOH123456", "ECOH9"]


def test_zero_amount_parcel_collects_nothing():
    with mock.patch(REQUEST, return_value=_resp(_page([order(montant="0", type_id=2)]))):
        snap = _conn().list_parcels().items[0]
    assert snap.cash_status == CashStatus.NOT_APPLICABLE


def test_get_parcel_uses_only_the_exact_tracking():
    rows = _page([order(tracking="ECOH1234567"), order(tracking="ECOH123456", status="en_livraison")])
    with mock.patch(REQUEST, return_value=_resp(rows)) as req:
        snap = _conn().get_parcel("ECOH123456")
    assert req.call_args.kwargs["params"] == {"tracking": "ECOH123456"}
    assert (snap.tracking, snap.status) == ("ECOH123456", ShipmentStatus.OUT_FOR_DELIVERY)

    with mock.patch(REQUEST, return_value=_resp(_page([order(tracking="OTHER")]))), pytest.raises(ConnectorNotFound):
        _conn().get_parcel("ECOH123456")


@pytest.mark.parametrize("ref", ["", "ECO 1", "a&b=c", "x" * 65])
def test_unsafe_references_are_refused_before_any_call(ref):
    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn().get_parcel(ref)
    req.assert_not_called()


ACTIVITY = [
    {"status": "livred", "date": "2026-11-16", "time": "15:20:00", "station": "Alger", "reason": ""},
    {"status": "notification_on_order", "date": "2026-11-16", "time": "12:00:00"},
    {"status": "attempt_delivery", "date": "2026-11-15", "time": "10:05:00", "reason": "Client injoignable"},
    {"status": "picked", "date": "bad"},
]


@pytest.mark.parametrize("payload", [
    {"recipientName": "x", "activity": ACTIVITY},                                          # bare object
    [{"tracking": "OTHER", "activity": []}, {"tracking": "ECOH123456", "activity": ACTIVITY}],  # list
    {"data": {"ECOH123456": {"activity": ACTIVITY}}},                                       # keyed by tracking
])
def test_history_uses_the_exact_tracking_skips_notes_and_sorts(payload):
    with mock.patch(REQUEST, return_value=_resp(payload)) as req:
        events = _conn().history("ECOH123456")
    assert req.call_args.args == ("GET", "https://packers.ecotrack.dz/api/v1/get/tracking/info")
    assert req.call_args.kwargs["params"] == {"tracking": "ECOH123456"}
    assert [(e.status, e.raw_status, e.note) for e in events] == [
        (ShipmentStatus.DELIVERY_ATTEMPTED, "attempt_delivery", "Client injoignable"),
        (ShipmentStatus.DELIVERED, "livred", "Alger"),
    ]
    assert events[1].occurred_at == datetime(2026, 11, 16, 15, 20, tzinfo=ALGIERS)


def test_history_for_another_parcel_only_is_empty():
    with mock.patch(REQUEST, return_value=_resp([{"tracking": "OTHER", "activity": ACTIVITY}])):
        assert _conn().history("ECOH123456") == ()


# ─── Rate guard ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("header", ["X-RateLimit-Remaining", "x-ratelimit-remaining"])
def test_low_remaining_stops_before_the_next_call(header):
    conn = _conn()
    with mock.patch(REQUEST, return_value=_resp(_page([order()], last=2), headers={header: "3"})) as req:
        conn.list_parcels()
        with pytest.raises(ConnectorRateLimited) as exc:
            conn.list_parcels("2")
    assert req.call_count == 1
    assert exc.value.retry_after == 60


def test_comfortable_remaining_does_not_stop():
    conn = _conn()
    with mock.patch(REQUEST, return_value=_resp(_page([]), headers={"X-RateLimit-Remaining": "40"})) as req:
        conn.list_parcels()
        conn.list_parcels()
    assert req.call_count == 2


def test_calls_are_spaced(monkeypatch):
    monkeypatch.setattr(ecotrack, "MIN_INTERVAL", 1.3)
    clock = iter([10.0, 10.5, 11.8])
    monkeypatch.setattr(ecotrack.time, "monotonic", lambda: next(clock))
    with mock.patch.object(ecotrack.time, "sleep") as sleep, mock.patch(REQUEST, return_value=_resp(_page([]))):
        conn = _conn()
        conn.list_parcels()
        conn.list_parcels()
    assert sleep.call_args.args[0] == pytest.approx(0.8)


# ─── Times when the courier gives none ────────────────────────────────────────

def test_a_new_status_is_dated_when_first_seen_and_kept_after(db):
    tenant = Tenant.objects.create(name="T", plan=PlanChoices.PRO_RETAIL)
    config = ProviderConfig.objects.create(tenant=tenant, courier="packers", credentials={"token": TOKEN})
    ship = Shipment(tenant=tenant, provider_config=config, courier="packers", external_id="E1")
    snap = ParcelSnapshot(external_id="E1", tracking="E1", status=ShipmentStatus.IN_TRANSIT, raw_status="vers_hub")

    ship.apply_snapshot(snap)
    ship.save()
    first = ship.status_at
    assert first is not None and ship.courier_updated_at == first

    later = first + timedelta(hours=2)
    with mock.patch("apps.delivery_integrations.models.timezone.now", return_value=later):
        assert ship.apply_snapshot(snap) == []                 # same status: nothing changes
        changed = ship.apply_snapshot(ParcelSnapshot(external_id="E1", tracking="E1",
                                                     status=ShipmentStatus.AT_HUB, raw_status="en_hub"))
    assert "status_at" in changed and ship.status_at == later

    dated = datetime(2026, 11, 1, 9, 0, tzinfo=ALGIERS)        # a courier that gives times keeps them
    ship.apply_snapshot(ParcelSnapshot(external_id="E1", tracking="E1", status=ShipmentStatus.AT_HUB,
                                       raw_status="en_hub", status_at=dated, updated_at=dated))
    assert (ship.status_at, ship.courier_updated_at) == (dated, dated)


# ─── Through the app ──────────────────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Eco Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    owner = User.objects.create_user(email="owner-eco@test.com", password="password123",
                                     role=RoleChoices.OWNER, tenant=tenant)
    config = ProviderConfig.objects.create(tenant=tenant, courier="dhd", credentials={"token": TOKEN})
    return tenant, owner, config


def test_test_action_says_the_connector_is_unverified(store):
    tenant, owner, config = store
    client = APIClient()
    client.force_authenticate(user=owner)
    with mock.patch(REQUEST, return_value=_resp([])):
        res = client.post(f"/api/v1/deliveries/provider-configs/{config.pk}/test/")
    assert res.json() == {"result": "ok", "capabilities": ["get", "history", "list", "test"],
                          "limited": False, "verified": False}
    assert res.status_code == status.HTTP_200_OK
    assert TOKEN not in res.content.decode()


def _answer(pages):
    def answer(method, url, params=None, **kwargs):
        if url.endswith("/get/orders"):
            return pages[params["page"]]
        return _resp({"activity": []})                     # histories
    return answer


def test_sync_reads_every_page_and_saves_shipments(store):
    tenant, owner, config = store
    pages = {1: _resp(_page([order(), order(tracking="E2", status="retour_recu")], 1, 2)),
             2: _resp(_page([order(tracking="E3", status="vers_wilaya")], 2, 2))}
    with mock.patch(REQUEST, side_effect=_answer(pages)):
        result = sync.sync_courier(config)

    assert (result.pages, result.created, result.error) == (2, 3, "")
    ships = {s.tracking_number: s for s in Shipment.objects.unscoped().filter(tenant=tenant)}
    assert (ships["ECOH123456"].status, ships["ECOH123456"].cash_status) == (
        ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER)
    assert (ships["E2"].status, ships["E2"].is_terminal) == (ShipmentStatus.RETURNED, True)
    assert all(s.status_at is not None for s in ships.values())
    config.refresh_from_db()
    assert config.sync_cursor is None                          # no "changed since" feed to follow

    # A second run that sees the same statuses saves nothing.
    with mock.patch(REQUEST, side_effect=_answer(pages)):
        again = sync.sync_courier(config)
    assert (again.created, again.updated) == (0, 0)


def test_sync_stops_at_the_page_cap_and_says_partial(store, monkeypatch):
    tenant, owner, config = store
    monkeypatch.setattr(EcotrackConnector, "max_list_pages", 2)
    pages = {n: _resp(_page([order(tracking=f"E{n}")], n, 5)) for n in range(1, 6)}
    with mock.patch(REQUEST, side_effect=_answer(pages)) as req:
        result = sync.sync_courier(config)
    assert (result.pages, result.error) == (2, "partial")
    assert [c.kwargs["params"]["page"] for c in req.call_args_list if c.args[1].endswith("/get/orders")] == [1, 2]


def test_logs_never_contain_the_token(caplog):
    base_logger = logging.getLogger("apps.delivery_integrations.services.couriers.base")
    base_logger.addHandler(caplog.handler)
    try:
        with mock.patch(REQUEST, return_value=_resp(status_code=401)), pytest.raises(ConnectorAuthError):
            _conn().test_credentials()
    finally:
        base_logger.removeHandler(caplog.handler)
    assert "HTTP 401" in caplog.text and TOKEN not in caplog.text
