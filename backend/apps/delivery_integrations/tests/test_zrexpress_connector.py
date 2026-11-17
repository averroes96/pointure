"""
ZR Express new-platform read connector (docs/plans/delivery-v1-plan.md P3.9). Built
from the official public docs (unverified); synthetic data shaped like the documented
responses, all HTTP mocked.
"""
import json
import logging
from datetime import datetime, timezone as dt_timezone
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
from apps.delivery_integrations.services.couriers import zrexpress
from apps.delivery_integrations.services.couriers.zrexpress import (
    STATE_MAP,
    ZRExpressConnector,
    cash_status_for,
    map_state,
)

REQUEST = "apps.delivery_integrations.services.couriers.base.requests.request"
ALGIERS = ZoneInfo("Africa/Algiers")
CREDS = {"apiKey": "zr-SECRET-key-0001", "tenantId": "ab1fb4cb-ae50-43e5-bf80-ce4472d8d353"}
SEARCH = "https://api.zrexpress.app/api/v1/parcels/search"

# The documented example workflow, and the other names the docs show.
WORKFLOW = [
    "commande_recue", "appel_confirmation", "commande_confirmee", "en_traitement", "pret_a_expedier",
    "confirme_au_bureau", "colis_recuperer", "dispatch", "vers_wilaya", "en_livraison", "sortie_en_livraison",
    "livre", "encaisse", "en_attente_dechange", "attente_recuperation_fournisseur", "recupere_par_fournisseur",
    "reinjecte_dans_stock",
]
OTHER_NAMES = ["OrderReceived", "ReadyToDispatch", "OutForDelivery", "InTransit", "AtHub", "Delivered", "Returned",
               "Cancelled", "annule", "supprimee"]


def parcel(**over):
    row = {
        "id": "936706d5-0a35-4958-9fc5-91e5724cc9d8", "trackingNumber": "DZ-AL-20251121-00145",
        "externalId": "8f14e45f-ceea-467e-a4f0-6b1c2d3e4f50",
        "customer": {"customerId": "c1", "name": "Client Test", "phone": {"number1": "+213551234567"}},
        "deliveryAddress": {"city": "Alger", "district": "Bab Ezzouar", "cityTerritoryCode": 16},
        "createdAt": "2026-11-15T09:00:00", "amount": 4900.0, "deliveryPrice": 400.0, "returnPrice": 200.0,
        "deliveryType": "home", "state": {"id": "s1", "name": "livre", "description": "Livré"},
        "lastStateUpdateAt": "2026-11-16T18:44:22.9779944", "isReturn": False, "type": "standard",
    }
    row.update(over)
    return row


def _resp(payload=None, status_code=200, headers=None):
    r = mock.Mock(status_code=status_code, headers=headers or {})
    r.json.return_value = payload if payload is not None else {}
    return r


def _page(rows, number=1, has_next=False):
    return {"items": rows, "pageNumber": number, "pageSize": 100, "totalCount": len(rows), "totalPages": 1,
            "hasPrevious": number > 1, "hasNext": has_next}


@pytest.fixture(autouse=True)
def setup(settings, tmp_path, monkeypatch):
    settings.DATA_DIR = tmp_path
    monkeypatch.setattr(zrexpress, "MIN_INTERVAL", 0)
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry({
            "key": "zrexpressnew", "name": "ZR Express (new platform)", "platform": "zrexpressapp",
            "requiredCredentials": ["apiKey", "tenantId"], "capabilities": {}, "endpoint": "https://api.zrexpress.app",
        })],
    }), encoding="utf-8")
    sync._running.clear(); sync._rerun.clear(); sync._blocked_until.clear()


def _conn(creds=CREDS):
    return get_connector(ProviderConfig(courier="zrexpressnew", credentials=creds))


# ─── Construction ─────────────────────────────────────────────────────────────

def test_connector_for_the_new_platform():
    conn = _conn()
    assert isinstance(conn, ZRExpressConnector)
    assert (conn.base_url, conn.verified) == ("https://api.zrexpress.app", False)
    assert conn.auth_headers() == {"X-Api-Key": CREDS["apiKey"], "X-Tenant": CREDS["tenantId"]}


def test_test_credentials_posts_a_one_parcel_search_and_refuses_missing_credentials():
    with mock.patch(REQUEST, return_value=_resp(_page([]))) as req:
        _conn().test_credentials()
    args, kwargs = req.call_args
    assert args == ("POST", SEARCH)
    assert kwargs["json"] == {"pageNumber": 1, "pageSize": 1}
    assert kwargs["headers"]["X-Tenant"] == CREDS["tenantId"]

    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn({"apiKey": "x"}).test_credentials()
    req.assert_not_called()


@pytest.mark.parametrize("http,error", [(401, ConnectorAuthError), (403, ConnectorForbidden)])
def test_refusals_are_typed(http, error):
    with mock.patch(REQUEST, return_value=_resp(status_code=http)), pytest.raises(error):
        _conn().test_credentials()


def test_429_carries_retry_after():
    with mock.patch(REQUEST, return_value=_resp(status_code=429, headers={"Retry-After": "20"})), \
            pytest.raises(ConnectorRateLimited) as exc:
        _conn().list_parcels()
    assert exc.value.retry_after == 20


# ─── Mapping ──────────────────────────────────────────────────────────────────

def test_every_documented_state_is_mapped():
    unmapped = [n for n in WORKFLOW + OTHER_NAMES if map_state(n)[0] == ShipmentStatus.UNKNOWN]
    assert unmapped == []
    assert len(STATE_MAP) == len(WORKFLOW) + len(OTHER_NAMES)


@pytest.mark.parametrize("name,expected", [
    ("commande_recue", ShipmentStatus.CREATED),
    ("PretAExpedier", ShipmentStatus.PENDING_PICKUP),           # separators and case ignored
    ("Prêt-à-expédier", ShipmentStatus.PENDING_PICKUP),
    ("colis_recuperer", ShipmentStatus.PICKED_UP),
    ("confirme_au_bureau", ShipmentStatus.AT_HUB),
    ("vers_wilaya", ShipmentStatus.IN_TRANSIT),
    ("sortie_en_livraison", ShipmentStatus.OUT_FOR_DELIVERY),
    ("OUTFORDELIVERY", ShipmentStatus.OUT_FOR_DELIVERY),
    ("en_attente_dechange", ShipmentStatus.ON_HOLD),
    ("encaisse", ShipmentStatus.DELIVERED),
    ("attente_recuperation_fournisseur", ShipmentStatus.RETURN_IN_TRANSIT),
    ("recupere_par_fournisseur", ShipmentStatus.RETURNED),
    ("supprimee", ShipmentStatus.CANCELLED),
    ("etat_maison", ShipmentStatus.UNKNOWN),
    (None, ShipmentStatus.UNKNOWN),
])
def test_state_mapping(name, expected):
    assert map_state(name) == (expected, str(name or "").strip())


@pytest.mark.parametrize("name,expected", [
    ("dispatch", ShipmentStatus.RETURN_IN_TRANSIT),             # a return travelling through transit states
    ("livre", ShipmentStatus.RETURN_IN_TRANSIT),
    ("etat_maison", ShipmentStatus.RETURN_IN_TRANSIT),
    ("recupere_par_fournisseur", ShipmentStatus.RETURNED),      # back: stays returned
    ("annule", ShipmentStatus.CANCELLED),
])
def test_is_return_rule(name, expected):
    assert map_state(name, is_return=True)[0] == expected


@pytest.mark.parametrize("status_,cod,expected", [
    (ShipmentStatus.IN_TRANSIT, True, CashStatus.AWAITING_DELIVERY),
    (ShipmentStatus.DELIVERED, True, CashStatus.HELD_BY_COURIER),
    (ShipmentStatus.DELIVERED, False, CashStatus.NOT_APPLICABLE),
    (ShipmentStatus.RETURN_IN_TRANSIT, True, CashStatus.NOT_APPLICABLE),
    (ShipmentStatus.CANCELLED, True, CashStatus.NOT_APPLICABLE),
])
def test_cash_stage(status_, cod, expected):
    assert cash_status_for(status_, cod) == expected


# ─── Parcels ──────────────────────────────────────────────────────────────────

def test_list_parcels_is_a_newest_changes_first_feed():
    rows = [parcel(), {"id": ""}, "junk", parcel(id="p2", trackingNumber="DZ-2", isReturn=True,
                                                 state={"name": "dispatch"})]
    with mock.patch(REQUEST, return_value=_resp(_page(rows, has_next=True))) as req:
        result = _conn().list_parcels()

    args, kwargs = req.call_args
    assert args == ("POST", SEARCH)
    assert kwargs["json"] == {"pageNumber": 1, "pageSize": 100, "orderBy": ["lastStateUpdateAt desc"]}
    assert kwargs["params"] is None
    assert result.next_cursor == "2"
    snap = result.items[0]
    when = datetime(2026, 11, 16, 18, 44, 22, 977994, tzinfo=ALGIERS)
    assert (snap.external_id, snap.tracking, snap.status, snap.raw_status) == (
        "936706d5-0a35-4958-9fc5-91e5724cc9d8", "DZ-AL-20251121-00145", ShipmentStatus.DELIVERED, "livre")
    assert (snap.status_at, snap.updated_at) == (when, when)
    assert (snap.reference, snap.recipient_name, snap.recipient_phone) == (
        "8f14e45f-ceea-467e-a4f0-6b1c2d3e4f50", "Client Test", "+213551234567")
    assert (snap.wilaya_code, snap.commune) == ("16", "Bab Ezzouar")
    assert (snap.cod_amount, snap.delivery_fee, snap.store_amount) == (Decimal("4900.00"), Decimal("400.00"), None)
    assert snap.cash_status == CashStatus.HELD_BY_COURIER
    assert (result.items[1].status, result.items[1].cash_status) == (
        ShipmentStatus.RETURN_IN_TRANSIT, CashStatus.NOT_APPLICABLE)


def test_last_page_and_dates_with_an_offset():
    with mock.patch(REQUEST, return_value=_resp(_page([parcel(lastStateUpdateAt="2026-11-16T17:00:00+00:00")],
                                                      number=4))) as req:
        result = _conn().list_parcels("4")
    assert req.call_args.kwargs["json"]["pageNumber"] == 4
    assert result.next_cursor is None
    assert result.items[0].status_at == datetime(2026, 11, 16, 17, 0, tzinfo=dt_timezone.utc)


def test_get_parcel_by_tracking_or_id():
    with mock.patch(REQUEST, return_value=_resp(parcel())) as req:
        snap = _conn().get_parcel("DZ-AL-20251121-00145")
    assert req.call_args.args == ("GET", "https://api.zrexpress.app/api/v1/parcels/DZ-AL-20251121-00145")
    assert snap.tracking == "DZ-AL-20251121-00145"
    with mock.patch(REQUEST, return_value=_resp({})), pytest.raises(ConnectorError):
        _conn().get_parcel("DZ-1")


@pytest.mark.parametrize("ref", ["", "DZ/../x", "a" * 65, "DZ 1"])
def test_unsafe_references_are_refused_before_any_call(ref):
    with mock.patch(REQUEST) as req, pytest.raises(ConnectorError):
        _conn().get_parcel(ref)
    req.assert_not_called()


HISTORY = [
    {"id": "h2", "createdAt": "2026-11-16T15:20:00", "newState": {"name": "livre", "description": "Livré"},
     "location": {"hubName": "Bureau Alger Bab ezzouar"}},
    {"id": "h1", "createdAt": "2026-11-15T10:05:00", "newState": {"name": "sortie_en_livraison",
                                                                  "description": "Sortie en livraison"}},
    {"id": "h0", "createdAt": "bad", "newState": {"name": "commande_recue"}},
    {"id": "h3", "createdAt": "2026-11-16T16:00:00", "newState": {}},
]


@pytest.mark.parametrize("payload", [HISTORY, {"items": HISTORY}])
def test_history_is_oldest_first_with_description_and_hub(payload):
    with mock.patch(REQUEST, return_value=_resp(payload)) as req:
        events = _conn().history("936706d5-0a35-4958-9fc5-91e5724cc9d8")
    assert req.call_args.args == (
        "GET", "https://api.zrexpress.app/api/v1/parcels/936706d5-0a35-4958-9fc5-91e5724cc9d8/state-history")
    assert [(e.status, e.raw_status, e.note) for e in events] == [
        (ShipmentStatus.OUT_FOR_DELIVERY, "sortie_en_livraison", "Sortie en livraison"),
        (ShipmentStatus.DELIVERED, "livre", "Livré — Bureau Alger Bab ezzouar"),
    ]


# ─── Rate guard ───────────────────────────────────────────────────────────────

def test_low_remaining_stops_before_the_next_call():
    conn = _conn()
    with mock.patch(REQUEST, return_value=_resp(_page([parcel()], has_next=True),
                                                headers={"X-RateLimit-Remaining": "2"})) as req:
        conn.list_parcels()
        with pytest.raises(ConnectorRateLimited) as exc:
            conn.list_parcels("2")
    assert (req.call_count, exc.value.retry_after) == (1, 60)


def test_calls_are_spaced(monkeypatch):
    monkeypatch.setattr(zrexpress, "MIN_INTERVAL", 0.5)
    clock = iter([5.0, 5.1, 5.6])
    monkeypatch.setattr(zrexpress.time, "monotonic", lambda: next(clock))
    with mock.patch.object(zrexpress.time, "sleep") as sleep, mock.patch(REQUEST, return_value=_resp(_page([]))):
        conn = _conn()
        conn.list_parcels()
        conn.list_parcels()
    assert sleep.call_args.args[0] == pytest.approx(0.4)


# ─── Through the app ──────────────────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="ZR Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    owner = User.objects.create_user(email="owner-zr@test.com", password="password123",
                                     role=RoleChoices.OWNER, tenant=tenant)
    config = ProviderConfig.objects.create(tenant=tenant, courier="zrexpressnew", credentials=CREDS)
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
    assert CREDS["apiKey"] not in res.content.decode()


def test_sync_follows_the_feed_and_sets_the_cursor(store):
    tenant, owner, config = store
    pages = {
        1: _resp(_page([parcel(), parcel(id="p2", trackingNumber="DZ-2", state={"name": "recupere_par_fournisseur"},
                                         lastStateUpdateAt="2026-11-16T12:00:00")], has_next=True)),
        2: _resp(_page([parcel(id="p3", trackingNumber="DZ-3", state={"name": "vers_wilaya"},
                               lastStateUpdateAt="2026-11-14T08:00:00")], number=2)),
    }

    def answer(method, url, params=None, json=None, **kwargs):
        if url == SEARCH:
            return pages[json["pageNumber"]]
        return _resp([])                                    # histories

    with mock.patch(REQUEST, side_effect=answer):
        result = sync.sync_courier(config)

    assert (result.pages, result.created, result.error) == (2, 3, "")
    ships = {s.tracking_number: s for s in Shipment.objects.unscoped().filter(tenant=tenant)}
    assert (ships["DZ-AL-20251121-00145"].status, ships["DZ-AL-20251121-00145"].cash_status) == (
        ShipmentStatus.DELIVERED, CashStatus.HELD_BY_COURIER)
    assert (ships["DZ-2"].status, ships["DZ-2"].is_terminal) == (ShipmentStatus.RETURNED, True)
    config.refresh_from_db()
    assert config.sync_cursor == datetime(2026, 11, 16, 18, 44, 22, 977994, tzinfo=ALGIERS)


def test_logs_never_contain_the_key_or_tenant(caplog):
    base_logger = logging.getLogger("apps.delivery_integrations.services.couriers.base")
    base_logger.addHandler(caplog.handler)
    try:
        with mock.patch(REQUEST, return_value=_resp(status_code=401)), pytest.raises(ConnectorAuthError):
            _conn().test_credentials()
    finally:
        base_logger.removeHandler(caplog.handler)
    assert "HTTP 401" in caplog.text
    assert CREDS["apiKey"] not in caplog.text and CREDS["tenantId"] not in caplog.text
