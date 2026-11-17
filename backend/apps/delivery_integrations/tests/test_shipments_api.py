"""
Shipments API (docs/plans/delivery-v1-plan.md P1.10). Background syncs are mocked:
no thread and no courier call runs in these tests.
"""
from datetime import datetime, timedelta
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import ProviderConfig, Shipment, ShipmentEvent
from apps.delivery_integrations.services import sync
from apps.delivery_integrations.services.couriers import CashStatus, ShipmentStatus

URL = "/api/v1/deliveries/shipments/"
UTC = ZoneInfo("UTC")


@pytest.fixture(autouse=True)
def no_threads():
    cache.clear()
    sync._running.clear(); sync._rerun.clear(); sync._blocked_until.clear(); sync._shipments_running.clear()
    with mock.patch.object(sync, "_start_thread") as start, \
         mock.patch.object(sync, "_start_shipment_thread") as start_one:
        yield start, start_one
    cache.clear()


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="API Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(email=f"{role}-shp@test.com", password="password123", role=role, tenant=tenant)
        for role in (RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER)
    }
    fresh = timezone.now()
    config = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "k"})
    ProviderConfig.objects.filter(pk=config.pk).update(last_synced_at=fresh)
    config.refresh_from_db()
    return tenant, users, config


def _ship(tenant, config, n, status=ShipmentStatus.DELIVERED, cash=CashStatus.HELD_BY_COURIER,
          cod="4900.00", store_amount="4500.00", day=16, **kw):
    return Shipment.objects.create(
        tenant=tenant, provider_config=config, courier=config.courier, external_id=f"ext-{n}",
        tracking_number=f"T{n}", recipient_name=f"Client {n}", recipient_phone=f"05512345{n:02d}",
        status=status, cash_status=cash, cod_amount=Decimal(cod), store_amount=Decimal(store_amount),
        courier_updated_at=datetime(2026, 11, day, 10, n, tzinfo=UTC), last_synced_at=timezone.now(), **kw,
    )


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ─── List ─────────────────────────────────────────────────────────────────────

def test_list_returns_the_stores_shipments_newest_first(store):
    tenant, users, config = store
    _ship(tenant, config, 1, day=10)
    _ship(tenant, config, 2, day=15)
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    other_cfg = ProviderConfig.objects.create(tenant=other, courier="maystro", credentials={"apiKey": "x"})
    _ship(other, other_cfg, 3)

    res = _client(users[RoleChoices.MANAGER]).get(URL)

    assert res.status_code == status.HTTP_200_OK
    body = res.json()
    assert body["count"] == 2
    assert [r["tracking_number"] for r in body["results"]] == ["T2", "T1"]
    row = body["results"][0]
    assert set(row) == {
        "id", "courier", "courier_name", "tracking_number", "reference", "customer_order",
        "recipient_name", "recipient_phone", "wilaya_code", "commune", "cod_amount", "delivery_fee",
        "store_amount", "status", "raw_status", "status_at", "is_terminal", "cash_status",
        "courier_payout_ref", "courier_paid_on", "courier_updated_at", "last_synced_at",
    }
    assert row["cod_amount"] == "4900.00"
    assert "events" not in row


@pytest.mark.parametrize("query,expected", [
    ("?status=delivered", ["T1", "T3"]),
    ("?status=delivered,returned", ["T1", "T2", "T3"]),
    ("?cash_status=paid", ["T3"]),
    ("?search=T2", ["T2"]),
    ("?search=0551234503", ["T3"]),
    ("?date_from=2026-11-15&date_to=2026-11-16", ["T2", "T3"]),
    ("?courier=yalidine", []),
])
def test_list_filters(store, query, expected):
    tenant, users, config = store
    _ship(tenant, config, 1, day=10)
    _ship(tenant, config, 2, status=ShipmentStatus.RETURNED, cash=CashStatus.NOT_APPLICABLE, day=15)
    _ship(tenant, config, 3, cash=CashStatus.PAID, day=16)

    res = _client(users[RoleChoices.OWNER]).get(URL + query)

    assert res.status_code == status.HTTP_200_OK
    assert sorted(r["tracking_number"] for r in res.json()["results"]) == expected


@pytest.mark.parametrize("query", ["?status=flying", "?cash_status=maybe", "?date_from=2026-11-20&date_to=2026-11-01",
                                   "?date_from=not-a-date"])
def test_invalid_filters_are_refused(store, query):
    tenant, users, config = store
    assert _client(users[RoleChoices.OWNER]).get(URL + query).status_code == status.HTTP_400_BAD_REQUEST


def test_cashier_is_refused_everywhere(store):
    tenant, users, config = store
    ship = _ship(tenant, config, 1)
    client = _client(users[RoleChoices.CASHIER])
    for res in (client.get(URL), client.get(f"{URL}{ship.pk}/"), client.get(f"{URL}summary/"),
                client.post(f"{URL}refresh/")):
        assert res.status_code == status.HTTP_403_FORBIDDEN


def test_feature_off_returns_404(store):
    tenant, users, config = store
    StoreSettings.objects.filter(tenant=tenant).update(enable_delivery_integrations=False)
    assert _client(users[RoleChoices.OWNER]).get(URL).status_code == status.HTTP_404_NOT_FOUND


def test_shipments_cannot_be_created_changed_or_deleted(store):
    tenant, users, config = store
    ship = _ship(tenant, config, 1)
    client = _client(users[RoleChoices.OWNER])
    assert client.post(URL, {}, format="json").status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert client.patch(f"{URL}{ship.pk}/", {}, format="json").status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert client.delete(f"{URL}{ship.pk}/").status_code == status.HTTP_405_METHOD_NOT_ALLOWED


# ─── Freshness triggers ───────────────────────────────────────────────────────

def test_opening_the_list_syncs_stale_accounts_only(store, no_threads):
    start, _ = no_threads
    tenant, users, config = store
    stale = ProviderConfig.objects.create(tenant=tenant, courier="yalidine", credentials={"apiId": "a", "apiToken": "b"})
    ProviderConfig.objects.create(tenant=tenant, courier="noest", credentials={"apiToken": "t"}, is_active=False)

    _client(users[RoleChoices.OWNER]).get(URL)

    start.assert_called_once_with(str(stale.pk), "page_open")   # fresh and inactive accounts skipped


def test_opening_the_list_does_not_restart_a_running_sync(store, no_threads):
    start, _ = no_threads
    tenant, users, config = store
    ProviderConfig.objects.filter(pk=config.pk).update(last_synced_at=timezone.now() - timedelta(hours=1))
    sync._running.add(str(config.pk))
    _client(users[RoleChoices.OWNER]).get(URL)
    start.assert_not_called()
    assert str(config.pk) not in sync._rerun


# ─── Detail ───────────────────────────────────────────────────────────────────

def test_detail_includes_events_oldest_first_and_refreshes_when_history_is_missing(store, no_threads):
    _, start_one = no_threads
    tenant, users, config = store
    ship = _ship(tenant, config, 1)
    client = _client(users[RoleChoices.OWNER])

    body = client.get(f"{URL}{ship.pk}/").json()
    assert body["events"] == []
    start_one.assert_called_once_with(str(ship.pk))
    assert body["refreshing"] is True

    sync._shipments_running.clear()
    start_one.reset_mock()
    ShipmentEvent.objects.create(shipment=ship, status=ShipmentStatus.DELIVERED, raw_status="41",
                                 occurred_at=datetime(2026, 11, 16, 10, tzinfo=UTC))
    ShipmentEvent.objects.create(shipment=ship, status=ShipmentStatus.CREATED, raw_status="4",
                                 occurred_at=datetime(2026, 11, 15, 9, tzinfo=UTC))
    body = client.get(f"{URL}{ship.pk}/").json()
    assert [e["raw_status"] for e in body["events"]] == ["4", "41"]
    start_one.assert_not_called()          # fresh, with history: no refresh
    assert body["refreshing"] is False


def test_detail_of_another_stores_shipment_is_404(store):
    tenant, users, config = store
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    other_cfg = ProviderConfig.objects.create(tenant=other, courier="maystro", credentials={"apiKey": "x"})
    foreign = _ship(other, other_cfg, 9)
    assert _client(users[RoleChoices.OWNER]).get(f"{URL}{foreign.pk}/").status_code == status.HTTP_404_NOT_FOUND


# ─── Summary ──────────────────────────────────────────────────────────────────

def test_summary_counts_and_money_per_courier(store):
    tenant, users, config = store
    _ship(tenant, config, 1, cash=CashStatus.HELD_BY_COURIER, cod="4900.00", store_amount="4500.00")
    _ship(tenant, config, 2, cash=CashStatus.HELD_BY_COURIER, cod="3100.50", store_amount="2700.50")
    _ship(tenant, config, 3, cash=CashStatus.PAID, cod="1000.00", store_amount="600.00")
    _ship(tenant, config, 4, status=ShipmentStatus.RETURNED, cash=CashStatus.NOT_APPLICABLE, cod="2000.00")
    _ship(tenant, config, 5, status=ShipmentStatus.OUT_FOR_DELIVERY, cash=CashStatus.AWAITING_DELIVERY, day=1)

    body = _client(users[RoleChoices.OWNER]).get(f"{URL}summary/").json()

    assert len(body["couriers"]) == 1
    maystro = body["couriers"][0]
    assert maystro["courier"] == "maystro"
    assert maystro["total"] == 5
    assert maystro["by_status"] == {"delivered": 3, "returned": 1, "out_for_delivery": 1}
    assert maystro["by_cash"]["held_by_courier"] == {"count": 2, "cod_amount": "8000.50", "store_amount": "7200.50"}
    assert maystro["by_cash"]["paid"] == {"count": 1, "cod_amount": "1000.00", "store_amount": "600.00"}
    assert body["accounts"] == [{
        "courier": "maystro", "courier_name": "maystro", "last_synced_at": body["accounts"][0]["last_synced_at"],
        "last_sync_error": "", "syncing": False,
    }]

    dated = _client(users[RoleChoices.OWNER]).get(f"{URL}summary/?date_from=2026-11-10").json()
    assert dated["couriers"][0]["total"] == 4   # the day-1 shipment is outside the range


def test_summary_lists_accounts_without_shipments(store):
    tenant, users, config = store
    body = _client(users[RoleChoices.OWNER]).get(f"{URL}summary/").json()
    assert body["couriers"] == [{"courier": "maystro", "courier_name": "maystro", "total": 0,
                                 "by_status": {}, "by_cash": {}}]


# ─── Refresh ──────────────────────────────────────────────────────────────────

def test_refresh_starts_a_sync_per_active_account(store, no_threads):
    start, _ = no_threads
    tenant, users, config = store
    ProviderConfig.objects.create(tenant=tenant, courier="noest", credentials={"apiToken": "t"}, is_active=False)

    res = _client(users[RoleChoices.OWNER]).post(f"{URL}refresh/")

    assert res.status_code == status.HTTP_202_ACCEPTED
    assert res.json() == {"sync": {"maystro": "started"}}
    start.assert_called_once_with(str(config.pk), "refresh")


def test_refresh_is_throttled(store):
    tenant, users, config = store
    client = _client(users[RoleChoices.OWNER])
    codes = [client.post(f"{URL}refresh/").status_code for _ in range(7)]
    assert codes[:6] == [202] * 6
    assert codes[6] == status.HTTP_429_TOO_MANY_REQUESTS
