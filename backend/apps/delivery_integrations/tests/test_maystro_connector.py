"""
Maystro read connector and the courier "Test connection" action
(docs/plans/delivery-v1-plan.md P1.7). Synthetic data shaped like Maystro's schema;
all HTTP is mocked.
"""
import json
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import ProviderConfig
from apps.delivery_integrations.services import catalogue
from apps.delivery_integrations.services.couriers import (
    Capability,
    CashStatus,
    ConnectorAuthError,
    ConnectorError,
    ConnectorForbidden,
    ConnectorNotSupported,
    ConnectorUnavailable,
    ShipmentStatus,
    get_connector,
)
from apps.delivery_integrations.services.couriers.maystro import (
    STATUS_MAP,
    MaystroConnector,
    cash_status_for,
    map_status,
)

REQUEST = "apps.delivery_integrations.services.couriers.base.requests.request"
BASE = "https://backend-web-app.maystro-delivery.com/api"
STORE_TOKEN = "0123456789abcdef0123456789abcdef01234567"
ALGIERS = ZoneInfo("Africa/Algiers")


def order_row(**overrides):
    row = {
        "id": "a1b2c3d4-0000-0000-0000-000000000001", "display_id": "172316976800001",
        "updated_at": "2026-11-16T10:00:00+01:00", "created_at": "2026-11-15T09:00:00+01:00",
        "status": 41, "customer_name": "Client Test", "customer_phone": "0551234567",
        "wilaya": "Alger", "wilaya_id": "16", "commune_name": "Bab Ezzouar", "commune_id": "1630",
        "product_price": "4500", "price": 400, "total_price": "4900", "external_id": None,
    }
    row.update(overrides)
    return row


@pytest.fixture(autouse=True)
def snapshot(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    entry = {"key": "maystro", "name": "Maystro", "platform": "maystro", "requiredCredentials": ["apiKey"],
             "capabilities": {}, "endpoint": "https://backend.maystro-delivery.com/api"}
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(), "couriers": [catalogue.clean_entry(entry)],
    }), encoding="utf-8")
    cache.clear()  # throttle counters
    yield
    cache.clear()


def _conn(secret=STORE_TOKEN):
    return get_connector(SimpleNamespace(courier="maystro", credentials={"apiKey": secret}, base_url=""))


def _resp(payload=None, status_code=200):
    r = mock.Mock(status_code=status_code, headers={})
    r.json.return_value = payload if payload is not None else {}
    return r


# ─── Construction and auth ────────────────────────────────────────────────────

def test_store_token_uses_token_auth_on_the_new_backend_with_full_capabilities():
    conn = _conn()
    assert isinstance(conn, MaystroConnector)
    assert conn.base_url == BASE
    assert conn.auth_headers() == {"Authorization": f"Token {STORE_TOKEN}"}
    assert conn.capabilities == {
        Capability.TEST, Capability.LIST, Capability.GET, Capability.HISTORY, Capability.BALANCE, Capability.PAYOUTS,
    }


def test_integration_key_uses_x_api_key_and_only_reads_the_balance():
    conn = _conn("ak_12345_abcdef")
    assert conn.auth_headers() == {"X-API-KEY": "ak_12345_abcdef"}
    assert conn.capabilities == {Capability.TEST, Capability.BALANCE}
    with mock.patch(REQUEST) as req:
        for call in (lambda: conn.list_parcels(), lambda: conn.get_parcel("x1"), lambda: conn.history("x1"),
                     lambda: conn.list_payouts(), lambda: conn.payout_lines("p1"), lambda: conn.pending_payout_lines()):
            with pytest.raises(ConnectorNotSupported) as exc:
                call()
            assert exc.value.reason == "key_scope"
    req.assert_not_called()


# ─── Mapping ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("code,expected", [
    (4, ShipmentStatus.CREATED), (5, ShipmentStatus.PENDING_PICKUP), (6, ShipmentStatus.PICKED_UP),
    (8, ShipmentStatus.AT_HUB), (9, ShipmentStatus.IN_TRANSIT), (10, ShipmentStatus.RETURN_IN_TRANSIT),
    (11, ShipmentStatus.CREATED), (12, ShipmentStatus.ON_HOLD), (15, ShipmentStatus.AT_HUB),
    (22, ShipmentStatus.IN_TRANSIT), (31, ShipmentStatus.OUT_FOR_DELIVERY),
    (32, ShipmentStatus.DELIVERY_ATTEMPTED), (33, ShipmentStatus.OUT_FOR_DELIVERY),
    (41, ShipmentStatus.DELIVERED), (42, ShipmentStatus.ON_HOLD), (50, ShipmentStatus.CANCELLED),
    (51, ShipmentStatus.RETURN_IN_TRANSIT), (52, ShipmentStatus.RETURNED), (53, ShipmentStatus.ON_HOLD),
    (99, ShipmentStatus.UNKNOWN), ("41", ShipmentStatus.DELIVERED), (None, ShipmentStatus.UNKNOWN),
])
def test_status_map(code, expected):
    assert map_status(code)[0] == expected


def test_every_maystro_code_is_mapped_and_raw_text_is_kept():
    assert len(STATUS_MAP) == 19
    assert map_status(41) == (ShipmentStatus.DELIVERED, "41 DELIVERED")
    assert map_status(99) == (ShipmentStatus.UNKNOWN, "99")


@pytest.mark.parametrize("code,cod,expected", [
    (41, Decimal("4900.00"), CashStatus.HELD_BY_COURIER),
    (31, Decimal("4900.00"), CashStatus.AWAITING_DELIVERY),
    (4, Decimal("4900.00"), CashStatus.AWAITING_DELIVERY),
    (52, Decimal("4900.00"), CashStatus.NOT_APPLICABLE),
    (50, Decimal("4900.00"), CashStatus.NOT_APPLICABLE),
    (10, Decimal("4900.00"), CashStatus.NOT_APPLICABLE),
    (41, Decimal("0.00"), CashStatus.NOT_APPLICABLE),
])
def test_cash_status_from_the_order(code, cod, expected):
    assert cash_status_for(code, cod) == expected


# ─── Orders ───────────────────────────────────────────────────────────────────

def test_list_parcels_maps_fields_and_pages_by_number():
    payload = {"count": 150, "next": "http://somewhere/api/orders/?page=2", "previous": None,
               "results": [order_row(), order_row(id="a1b2c3d4-0000-0000-0000-000000000002",
                                                  display_id="172316976800002", status=31,
                                                  external_id="ord-42")]}
    with mock.patch(REQUEST, return_value=_resp(payload)) as req:
        page = _conn().list_parcels()

    method, url = req.call_args.args
    assert (method, url) == ("GET", f"{BASE}/orders/")
    assert req.call_args.kwargs["params"] == {"ordering": "-updated_at", "page": 1, "page_size": 100}
    assert page.next_cursor == "2"   # page number, never the absolute `next` link
    first, second = page.items
    assert first.external_id == "a1b2c3d4-0000-0000-0000-000000000001"
    assert first.tracking == "172316976800001"
    assert first.status == ShipmentStatus.DELIVERED
    assert first.raw_status == "41 DELIVERED"
    assert first.cod_amount == Decimal("4900.00")
    assert first.delivery_fee == Decimal("400.00")
    assert first.store_amount == Decimal("4500.00")
    assert first.cash_status == CashStatus.HELD_BY_COURIER
    assert first.wilaya_code == "16"
    assert first.commune == "Bab Ezzouar"
    assert first.recipient_name == "Client Test"
    assert first.updated_at == datetime(2026, 11, 16, 9, 0, tzinfo=ZoneInfo("UTC"))
    assert first.reference == ""
    assert second.status == ShipmentStatus.OUT_FOR_DELIVERY
    assert second.cash_status == CashStatus.AWAITING_DELIVERY
    assert second.reference == "ord-42"


def test_list_parcels_last_page_and_cursor():
    with mock.patch(REQUEST, return_value=_resp({"next": None, "results": [order_row()]})) as req:
        page = _conn().list_parcels(cursor="3")
    assert req.call_args.kwargs["params"]["page"] == 3
    assert page.next_cursor is None


def test_list_parcels_skips_malformed_rows():
    with mock.patch(REQUEST, return_value=_resp({"next": None, "results": [order_row(), {"no": "id"}, "x"]})):
        page = _conn().list_parcels()
    assert len(page.items) == 1


def test_history_is_sorted_oldest_first():
    rows = [
        {"status": 41, "created_at": "2026-11-16 10:00:00", "comment": None, "agent": None},
        {"status": 31, "created_at": "2026-11-16 08:00:00", "comment": "client absent", "agent": None},
        {"status": 4, "created_at": "2026-11-15 09:00:00", "comment": None, "agent": None},
        {"status": 41, "created_at": "garbage", "comment": None, "agent": None},
    ]
    with mock.patch(REQUEST, return_value=_resp(rows)) as req:
        events = _conn().history("a1b2c3d4-0000-0000-0000-000000000001")
    assert req.call_args.args[1] == f"{BASE}/orders/history-order/a1b2c3d4-0000-0000-0000-000000000001/"
    assert [e.status for e in events] == [ShipmentStatus.CREATED, ShipmentStatus.OUT_FOR_DELIVERY,
                                          ShipmentStatus.DELIVERED]
    assert events[1].note == "client absent"
    assert events[0].occurred_at == datetime(2026, 11, 15, 9, 0, tzinfo=ALGIERS)


def test_get_parcel():
    with mock.patch(REQUEST, return_value=_resp(order_row(status=52))) as req:
        snap = _conn().get_parcel("a1b2c3d4-0000-0000-0000-000000000001")
    assert req.call_args.args[1] == f"{BASE}/orders/a1b2c3d4-0000-0000-0000-000000000001/"
    assert snap.status == ShipmentStatus.RETURNED
    assert snap.cash_status == CashStatus.NOT_APPLICABLE


@pytest.mark.parametrize("bad_ref", ["../payments", "a/b", "", "x" * 65, "id?x=1"])
def test_references_cannot_alter_the_url(bad_ref):
    with mock.patch(REQUEST) as req:
        with pytest.raises(ConnectorError):
            _conn().get_parcel(bad_ref)
    req.assert_not_called()


# ─── Balance and payouts ──────────────────────────────────────────────────────

def test_balance_with_store_token():
    payload = {"current_balance": 125000.5, "payable_balance": 40000.0,
               "charges": {"extra_services": 0.0, "total": 0.0},
               "orders": {"awaiting_collection": 3, "collected_not_payable": 5, "payable": 8, "total_unpaid": 16},
               "last_payment": {"id": "p1", "payment_date": "2026-11-10", "nb_orders": 12, "amount": 50000.0}}
    with mock.patch(REQUEST, return_value=_resp(payload)) as req:
        balance = _conn().balance()
    assert req.call_args.args[1] == f"{BASE}/payments/balance/"
    assert balance.held == Decimal("125000.50")
    assert balance.payable == Decimal("40000.00")
    assert balance.counts == {"awaiting_collection": 3, "collected_not_payable": 5, "payable": 8, "total_unpaid": 16}


def test_balance_with_integration_key_uses_the_integration_endpoint():
    with mock.patch(REQUEST, return_value=_resp({"current_balance": 9000})) as req:
        balance = _conn("ak_1_x").balance()
    assert req.call_args.args[1] == f"{BASE}/stores/hooks/integrations/balance/"
    assert req.call_args.kwargs["headers"]["X-API-KEY"] == "ak_1_x"
    assert balance.held == Decimal("9000.00")
    assert balance.payable is None


def test_list_payouts():
    payload = {"count": 40, "next": "x", "results": [
        {"id": "p-1", "payment_date": "2026-11-10", "nb_orders": 12, "amount": "50000.00"},
    ]}
    with mock.patch(REQUEST, return_value=_resp(payload)) as req:
        payouts, cursor = _conn().list_payouts()
    assert req.call_args.args[1] == f"{BASE}/payments/"
    assert cursor == "2"
    assert payouts[0].external_id == "p-1"
    assert payouts[0].paid_on == date(2026, 11, 10)
    assert payouts[0].amount == Decimal("50000.00")
    assert payouts[0].order_count == 12


STATEMENT = {
    "payment": {"id": "p-1", "payment_date": "2026-11-10", "nb_orders": 2, "product_price": 9000.0},
    "delivered_orders": [
        {"display_id_order": "T1", "external_order_id": None, "product_name": "A", "delivery_price": 400.0,
         "amount": 4500.0, "description": ""},
        {"display_id_order": None, "amount": 1.0},
    ],
    "delivered_orders_total": 4500.0,
    "exchanges": [{"display_id_order": "T2", "external_order_id": None, "product_name": "B", "amount": 4500.0,
                   "description": ""}],
    "exchanges_total": 4500.0,
    "extra_services": [{"display_id_order": None, "type": 1, "type_label": "x", "amount": 100.0}],
    "extra_services_total": 100.0, "total": 8900.0,
}


def test_payout_lines_cover_delivered_orders_and_exchanges():
    with mock.patch(REQUEST, return_value=_resp(STATEMENT)) as req:
        lines = _conn().payout_lines("p-1")
    assert req.call_args.args[1] == f"{BASE}/payments/p-1/statement/"
    assert [(l.tracking, l.amount, l.delivery_fee) for l in lines] == [
        ("T1", Decimal("4500.00"), Decimal("400.00")),
        ("T2", Decimal("4500.00"), None),
    ]


def test_pending_payout_lines_read_the_current_statement():
    empty = {"payment": None, "delivered_orders": [], "delivered_orders_total": 0.0, "exchanges": [],
             "exchanges_total": 0.0, "extra_services": [], "extra_services_total": 0.0, "total": 0.0}
    with mock.patch(REQUEST, return_value=_resp(empty)) as req:
        assert _conn().pending_payout_lines() == ()
    assert req.call_args.args[1] == f"{BASE}/payments/statement/"


def test_test_credentials():
    with mock.patch(REQUEST, return_value=_resp({"current_balance": 1})):
        assert _conn().test_credentials() is None
    with mock.patch(REQUEST, return_value=_resp(status_code=401)):
        with pytest.raises(ConnectorAuthError):
            _conn().test_credentials()
    with mock.patch(REQUEST) as req:
        with pytest.raises(ConnectorError):
            _conn("").test_credentials()
    req.assert_not_called()


# ─── "Test connection" action ─────────────────────────────────────────────────

@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Maystro Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(email=f"{role}-may@test.com", password="password123", role=role, tenant=tenant)
        for role in (RoleChoices.OWNER, RoleChoices.CASHIER)
    }
    config = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": STORE_TOKEN})
    return tenant, users, config


def _test(user, config):
    client = APIClient()
    client.force_authenticate(user=user)
    return client.post(f"/api/v1/deliveries/provider-configs/{config.pk}/test/")


@pytest.mark.parametrize("http,expected", [
    (_resp({"current_balance": 1}), {"result": "ok", "limited": False, "verified": True}),
    (_resp(status_code=401), {"result": "refused"}),
    (_resp(status_code=403), {"result": "forbidden"}),
    (_resp(status_code=503), {"result": "unreachable"}),
])
def test_test_action_reports_the_result(store, http, expected):
    tenant, users, config = store
    with mock.patch(REQUEST, return_value=http):
        res = _test(users[RoleChoices.OWNER], config)
    assert res.status_code == status.HTTP_200_OK
    body = res.json()
    for key, value in expected.items():
        assert body[key] == value
    if expected["result"] == "ok":
        assert body["capabilities"] == sorted(MaystroConnector.FULL)
    assert STORE_TOKEN not in res.content.decode()


def test_test_action_with_integration_key_is_ok_but_limited(store):
    tenant, users, config = store
    ProviderConfig.objects.filter(pk=config.pk).update(credentials={"apiKey": "ak_1_x"})
    with mock.patch(REQUEST, return_value=_resp({"current_balance": 1})):
        body = _test(users[RoleChoices.OWNER], config).json()
    assert body == {"result": "ok", "capabilities": ["balance", "test"], "limited": True, "verified": True}


def test_test_action_for_a_courier_without_connector(store):
    tenant, users, config = store
    other = ProviderConfig.objects.create(tenant=tenant, courier="unlisted", credentials={"token": "t"})
    with mock.patch(REQUEST) as req:
        body = _test(users[RoleChoices.OWNER], other).json()
    assert body == {"result": "not_supported", "reason": "unknown_courier"}
    req.assert_not_called()


def test_test_action_unexpected_error_is_not_leaked(store):
    tenant, users, config = store
    with mock.patch(REQUEST, side_effect=RuntimeError("secret internal detail")):
        res = _test(users[RoleChoices.OWNER], config)
    assert res.json() == {"result": "error"}
    assert "secret internal detail" not in res.content.decode()


def test_test_action_refuses_cashiers(store):
    tenant, users, config = store
    with mock.patch(REQUEST) as req:
        res = _test(users[RoleChoices.CASHIER], config)
    assert res.status_code == status.HTTP_403_FORBIDDEN
    req.assert_not_called()


def test_test_action_is_throttled(store):
    tenant, users, config = store
    with mock.patch(REQUEST, return_value=_resp({"current_balance": 1})):
        codes = [_test(users[RoleChoices.OWNER], config).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10
    assert codes[10] == status.HTTP_429_TOO_MANY_REQUESTS
