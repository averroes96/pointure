"""
Yalidine-family read connector (docs/plans/delivery-v1-plan.md P3.1). Built from the
documentation (unverified); synthetic data shaped like the documented responses, all
HTTP mocked.
"""
import json
import logging
from datetime import datetime
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
    ConnectorRateLimited,
    ShipmentStatus,
    get_connector,
)
from apps.delivery_integrations.services.couriers import yalidine
from apps.delivery_integrations.services.couriers.yalidine import (
    STATUS_MAP,
    YalidineConnector,
    cash_status_for,
    has_cod,
    map_status,
)

REQUEST = "apps.delivery_integrations.services.couriers.base.requests.request"
ALGIERS = ZoneInfo("Africa/Algiers")
CREDS = {"apiId": "11111111111111111111", "apiToken": "SECRET-token-value-0001"}
FAMILY = [
    ("yalidine", "https://api.yalidine.app"), ("yalitec", "https://api.yalitec.me"),
    ("guepex", "https://api.guepex.app"), ("easyandspeed", "https://api.easyandspeed.app"),
    ("economiqua", "https://api.economiqua.app"), ("wecan", "https://api.wecanservices.me"),
]

# Every raw status the documentation lists (parcels + histories).
DOCUMENTED = [
    "Pas encore expédié", "A vérifier", "En préparation", "Pas encore ramassé", "Prêt à expédier",
    "En passation", "Ramassé", "Bloqué", "Débloqué", "Transfert", "Expédié", "Centre", "En localisation",
    "Vers Wilaya", "En transit", "Reçu à Wilaya", "En attente du client", "Prêt pour livreur",
    "Sorti en livraison", "En attente", "Annulé", "En alerte", "Alerte résolue", "Tentative échouée", "Livré",
    "Echèc livraison", "Retour vers centre", "Retourné au centre", "Retour transfert", "Retour groupé",
    "Retour à retirer", "Retour non retiré", "Colis abandonné", "Retour vers vendeur", "Retourné au vendeur",
    "Echange échoué",
]


def parcel(**over):
    row = {
        "tracking": "yal-123456", "order_id": "8f14e45f-ceea-467e-a4f0-6b1c2d3e4f50", "firstname": "Md",
        "familyname": "E* A****", "contact_phone": "05******67", "is_stopdesk": 0, "to_wilaya_id": 16,
        "to_commune_name": "Bab Ezzouar", "price": 4900, "delivery_fee": 400, "freeshipping": 0,
        "has_recouvrement": 1, "date_last_status": "2026-11-16 18:44:22", "last_status": "Livré",
        "payment_status": "not-ready", "payment_id": None,
    }
    row.update(over)
    return row


def _resp(payload=None, status_code=200, headers=None):
    r = mock.Mock(status_code=status_code, headers=headers or {})
    r.json.return_value = payload if payload is not None else {}
    return r


def _page(rows, has_more=False):
    return {"has_more": has_more, "total_data": len(rows), "data": rows, "links": {}}


@pytest.fixture(autouse=True)
def setup(settings, tmp_path, monkeypatch):
    settings.DATA_DIR = tmp_path
    monkeypatch.setattr(yalidine, "MIN_INTERVAL", 0)
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry({
            "key": key, "name": key.title(), "platform": "yalidine", "requiredCredentials": ["apiId", "apiToken"],
            "capabilities": {}, "endpoint": endpoint,
        }) for key, endpoint in FAMILY],
    }), encoding="utf-8")
    sync._running.clear(); sync._rerun.clear(); sync._blocked_until.clear()


def _conn(courier="yalidine", creds=CREDS):
    return get_connector(ProviderConfig(courier=courier, credentials=creds))


# ─── Construction ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("courier,endpoint", FAMILY)
def test_one_connector_serves_the_whole_family(courier, endpoint):
    conn = _conn(courier)
    assert isinstance(conn, YalidineConnector)
    assert conn.base_url == endpoint
    assert conn.verified is False
    assert conn.auth_headers() == {"X-API-ID": CREDS["apiId"], "X-API-TOKEN": CREDS["apiToken"]}


def test_test_credentials_reads_one_wilaya_and_refuses_missing_credentials():
    with mock.patch(REQUEST, return_value=_resp(_page([{"id": 1}]))) as req:
        _conn().test_credentials()
    args, kwargs = req.call_args
    assert args == ("GET", "https://api.yalidine.app/v1/wilayas/")
    assert kwargs["params"] == {"page_size": 1}
    assert kwargs["headers"]["X-API-ID"] == CREDS["apiId"]

    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn(creds={"apiId": "x"}).test_credentials()
    req.assert_not_called()


@pytest.mark.parametrize("http,error", [(401, ConnectorAuthError), (403, ConnectorForbidden)])
def test_refusals_are_typed(http, error):
    with mock.patch(REQUEST, return_value=_resp(status_code=http)), pytest.raises(error):
        _conn().test_credentials()


def test_429_carries_retry_after():
    with mock.patch(REQUEST, return_value=_resp(status_code=429, headers={"Retry-After": "42"})), \
            pytest.raises(ConnectorRateLimited) as exc:
        _conn().list_parcels()
    assert exc.value.retry_after == 42


# ─── Status and cash mapping ──────────────────────────────────────────────────

def test_every_documented_status_is_mapped():
    unmapped = [raw for raw in DOCUMENTED if map_status(raw)[0] == ShipmentStatus.UNKNOWN]
    assert unmapped == []
    assert len(STATUS_MAP) == len(DOCUMENTED)


@pytest.mark.parametrize("raw,expected", [
    ("Livré", ShipmentStatus.DELIVERED),
    ("livre", ShipmentStatus.DELIVERED),
    ("  LIVRÉ ", ShipmentStatus.DELIVERED),
    ("Echec  livraison", ShipmentStatus.RETURN_IN_TRANSIT),
    ("Retourné au vendeur", ShipmentStatus.RETURNED),
    ("Tentative échouée", ShipmentStatus.DELIVERY_ATTEMPTED),
    ("Sorti en livraison", ShipmentStatus.OUT_FOR_DELIVERY),
    ("Annulé", ShipmentStatus.CANCELLED),
    ("Colis abandonné", ShipmentStatus.LOST),
    ("Nouveau statut", ShipmentStatus.UNKNOWN),
    (None, ShipmentStatus.UNKNOWN),
])
def test_status_mapping_ignores_accents_case_and_spacing(raw, expected):
    status_, label = map_status(raw)
    assert status_ == expected
    assert label == str(raw or "").strip()


@pytest.mark.parametrize("status_,payment,cod,expected", [
    (ShipmentStatus.IN_TRANSIT, "not-ready", True, CashStatus.AWAITING_DELIVERY),
    (ShipmentStatus.DELIVERED, "not-ready", True, CashStatus.HELD_BY_COURIER),
    (ShipmentStatus.DELIVERED, "", True, CashStatus.HELD_BY_COURIER),
    (ShipmentStatus.DELIVERED, "ready", True, CashStatus.READY),
    (ShipmentStatus.DELIVERED, "receivable", True, CashStatus.READY),
    (ShipmentStatus.DELIVERED, "payed", True, CashStatus.PAID),
    (ShipmentStatus.DELIVERED, "payed", False, CashStatus.NOT_APPLICABLE),
    (ShipmentStatus.RETURNED, "not-ready", True, CashStatus.NOT_APPLICABLE),
    (ShipmentStatus.RETURN_IN_TRANSIT, "not-ready", True, CashStatus.NOT_APPLICABLE),
    (ShipmentStatus.CANCELLED, "not-ready", True, CashStatus.NOT_APPLICABLE),
])
def test_cash_stage_per_parcel(status_, payment, cod, expected):
    assert cash_status_for(status_, payment, cod) == expected


@pytest.mark.parametrize("row,expected", [
    ({"has_recouvrement": 1, "price": 4900}, True),
    ({"has_recouvrement": 0, "price": 4900}, False),
    ({"has_recouvrement": False, "price": 4900}, False),
    ({"has_recouvrement": "", "price": 4900}, True),       # empty = not said
    ({"price": 0}, False),
    ({}, True),
])
def test_has_cod(row, expected):
    assert has_cod(row) is expected


# ─── Parcels ──────────────────────────────────────────────────────────────────

def test_list_parcels_reads_newest_changes_first_and_maps_a_parcel():
    page = _page([parcel(), {"tracking": ""}, "junk", parcel(tracking="yal-2", last_status="Sorti en livraison")],
                 has_more=True)
    with mock.patch(REQUEST, return_value=_resp(page)) as req:
        result = _conn().list_parcels()

    args, kwargs = req.call_args
    assert args == ("GET", "https://api.yalidine.app/v1/parcels/")
    assert kwargs["params"] == {"order_by": "date_last_status", "page": 1, "page_size": 100}
    assert kwargs["timeout"] == YalidineConnector.TIMEOUT_SECONDS
    assert result.next_cursor == "2"
    assert [s.tracking for s in result.items] == ["yal-123456", "yal-2"]
    snap = result.items[0]
    when = datetime(2026, 11, 16, 18, 44, 22, tzinfo=ALGIERS)
    assert (snap.external_id, snap.tracking, snap.status, snap.raw_status) == (
        "yal-123456", "yal-123456", ShipmentStatus.DELIVERED, "Livré")
    assert (snap.status_at, snap.updated_at) == (when, when)
    assert (snap.reference, snap.recipient_name, snap.recipient_phone) == (
        "8f14e45f-ceea-467e-a4f0-6b1c2d3e4f50", "Md E* A****", "05******67")
    assert (snap.wilaya_code, snap.commune) == ("16", "Bab Ezzouar")
    assert (snap.cod_amount, snap.delivery_fee, snap.store_amount) == (Decimal("4900.00"), Decimal("400.00"), None)
    assert (snap.cash_status, snap.cash_raw) == (CashStatus.HELD_BY_COURIER, "not-ready")
    assert result.items[1].status == ShipmentStatus.OUT_FOR_DELIVERY


def test_last_page_and_next_cursor():
    with mock.patch(REQUEST, return_value=_resp(_page([parcel()]))) as req:
        result = _conn().list_parcels("3")
    assert req.call_args.kwargs["params"]["page"] == 3
    assert result.next_cursor is None


def test_parcel_without_cod_collects_nothing():
    with mock.patch(REQUEST, return_value=_resp(_page([parcel(has_recouvrement=0, payment_status="payed")]))):
        snap = _conn().list_parcels().items[0]
    assert (snap.cod_amount, snap.cash_status) == (Decimal("0.00"), CashStatus.NOT_APPLICABLE)


@pytest.mark.parametrize("payload", [_page([parcel()]), parcel()])
def test_get_parcel_accepts_list_or_bare_answers(payload):
    with mock.patch(REQUEST, return_value=_resp(payload)) as req:
        snap = _conn().get_parcel("yal-123456")
    assert req.call_args.args == ("GET", "https://api.yalidine.app/v1/parcels/yal-123456")
    assert snap.tracking == "yal-123456"


@pytest.mark.parametrize("payload", [_page([]), {}, ["x"]])
def test_get_parcel_without_a_parcel_is_invalid(payload):
    with mock.patch(REQUEST, return_value=_resp(payload)), pytest.raises(ConnectorError):
        _conn().get_parcel("yal-123456")


@pytest.mark.parametrize("ref", ["", "yal/../x", "a" * 65, "yal 1"])
def test_unsafe_references_are_refused_before_any_call(ref):
    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn().get_parcel(ref)
    req.assert_not_called()


def test_history_is_oldest_first_with_reason_and_place():
    rows = _page([
        {"date_status": "2026-11-16 10:00:00", "status": "Livré", "reason": "", "center_name": "Centre X",
         "commune_name": "Bab Ezzouar"},
        {"date_status": "2026-11-15 09:00:00", "status": "Tentative échouée", "reason": "Client injoignable"},
        {"date_status": "not a date", "status": "Centre"},
    ])
    with mock.patch(REQUEST, return_value=_resp(rows)) as req:
        events = _conn().history("yal-123456")
    assert req.call_args.args == ("GET", "https://api.yalidine.app/v1/histories/yal-123456")
    assert [(e.status, e.raw_status, e.note) for e in events] == [
        (ShipmentStatus.DELIVERY_ATTEMPTED, "Tentative échouée", "Client injoignable"),
        (ShipmentStatus.DELIVERED, "Livré", "Centre X · Bab Ezzouar"),
    ]
    assert events[0].occurred_at == datetime(2026, 11, 15, 9, 0, tzinfo=ALGIERS)


# ─── Quota guard ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("header,left,wait", [
    ("x-minute-quota-left", "5", 60),
    ("x-hour-quota-left", "12", 3600),
    ("x-day-quota-left", "300", 6 * 3600),
    ("x-second-quota-left", "1", 2),
])
def test_low_quota_stops_before_the_next_call(header, left, wait):
    conn = _conn()
    with mock.patch(REQUEST, return_value=_resp(_page([parcel()], has_more=True), headers={header: left})) as req:
        conn.list_parcels()                       # this page is kept
        with pytest.raises(ConnectorRateLimited) as exc:
            conn.list_parcels("2")
    assert req.call_count == 1
    assert exc.value.retry_after == wait


def test_comfortable_quota_and_odd_headers_do_not_stop():
    conn = _conn()
    headers = {"x-minute-quota-left": "40", "x-hour-quota-left": "abc", "x-day-quota-left": None}
    with mock.patch(REQUEST, return_value=_resp(_page([parcel()]), headers=headers)) as req:
        conn.list_parcels()
        conn.list_parcels("2")
    assert req.call_count == 2


def test_calls_are_spaced(monkeypatch):
    monkeypatch.setattr(yalidine, "MIN_INTERVAL", 0.3)
    clock = iter([100.0, 100.1, 100.4])
    monkeypatch.setattr(yalidine.time, "monotonic", lambda: next(clock))
    with mock.patch.object(yalidine.time, "sleep") as sleep, \
            mock.patch(REQUEST, return_value=_resp(_page([]))):
        conn = _conn()
        conn.list_parcels()
        conn.list_parcels()
    sleep.assert_called_once()
    assert sleep.call_args.args[0] == pytest.approx(0.2)


# ─── Through the app ──────────────────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Yal Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    owner = User.objects.create_user(email="owner-yal@test.com", password="password123",
                                     role=RoleChoices.OWNER, tenant=tenant)
    config = ProviderConfig.objects.create(tenant=tenant, courier="guepex", credentials=CREDS)
    return tenant, owner, config


def test_test_action_says_the_connector_is_unverified(store):
    tenant, owner, config = store
    client = APIClient()
    client.force_authenticate(user=owner)
    with mock.patch(REQUEST, return_value=_resp(_page([]))):
        res = client.post(f"/api/v1/deliveries/provider-configs/{config.pk}/test/")
    assert res.status_code == status.HTTP_200_OK
    assert res.json() == {"result": "ok", "capabilities": ["get", "history", "list", "test"],
                          "limited": False, "verified": False}
    assert CREDS["apiToken"] not in res.content.decode()


def test_sync_reads_pages_and_saves_shipments(store):
    tenant, owner, config = store
    pages = {
        1: _resp(_page([parcel(), parcel(tracking="yal-2", last_status="Retourné au vendeur")], has_more=True)),
        2: _resp(_page([parcel(tracking="yal-3", last_status="Vers Wilaya", date_last_status="2026-11-14 08:00:00")])),
    }

    def answer(method, url, params=None, **kwargs):
        if "/v1/parcels/" in url:
            return pages[params["page"]]
        return _resp(_page([]))                     # histories

    with mock.patch(REQUEST, side_effect=answer):
        result = sync.sync_courier(config)

    assert (result.created, result.error) == (3, "")
    ships = {s.tracking_number: s for s in Shipment.objects.unscoped().filter(tenant=tenant)}
    assert (ships["yal-123456"].status, ships["yal-123456"].cash_status) == (
        ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER)
    assert (ships["yal-2"].status, ships["yal-2"].is_terminal) == (ShipmentStatus.RETURNED, True)
    assert ships["yal-3"].status == ShipmentStatus.IN_TRANSIT
    config.refresh_from_db()
    assert config.sync_cursor == datetime(2026, 11, 16, 18, 44, 22, tzinfo=ALGIERS)


def test_sync_stops_on_low_quota_and_waits(store):
    tenant, owner, config = store
    low = _resp(_page([parcel()], has_more=True), headers={"x-minute-quota-left": "2"})
    with mock.patch(REQUEST, return_value=low) as req:
        result = sync.sync_courier(config)
    assert result.error == "rate_limited"
    assert req.call_count == 1
    assert sync.request_sync(config.pk) == "blocked"
    assert Shipment.objects.unscoped().filter(tenant=tenant).count() == 1   # the page read is kept


def test_logs_never_contain_the_credentials(caplog):
    base_logger = logging.getLogger("apps.delivery_integrations.services.couriers.base")
    base_logger.addHandler(caplog.handler)
    try:
        with mock.patch(REQUEST, return_value=_resp(status_code=401)), pytest.raises(ConnectorAuthError):
            _conn().test_credentials()
    finally:
        base_logger.removeHandler(caplog.handler)
    assert "HTTP 401" in caplog.text
    assert CREDS["apiToken"] not in caplog.text and CREDS["apiId"] not in caplog.text
