"""
Courier payouts picked up at the agency (docs/plans/delivery-v1-plan.md P1.12).
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.clients.models import ClientLedger
from apps.core.models import AuditLog, PlanChoices, RoleChoices, StoreSettings, Tenant, User
from apps.delivery_integrations.models import CourierPayout, ProviderConfig, Shipment
from apps.delivery_integrations.services.couriers import CashStatus, ParcelSnapshot, ShipmentStatus
from apps.inventory.models import StockMovement
from apps.sales.models import CashMovement, CashSession, Sale

URL = "/api/v1/deliveries/payouts/"


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Payout Store", plan=PlanChoices.PRO_RETAIL)
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    users = {
        role: User.objects.create_user(email=f"{role}-pay@test.com", password="password123", role=role, tenant=tenant)
        for role in (RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER)
    }
    config = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "k"})
    return tenant, users, config


def _ship(tenant, config, n, cash=CashStatus.HELD_BY_COURIER, store_amount="4500.00", cod="4900.00",
          fee="400.00", **kw):
    return Shipment.objects.create(
        tenant=tenant, provider_config=config, courier=config.courier, external_id=f"ext-{n}",
        tracking_number=f"T{n}", status=ShipmentStatus.DELIVERED, cash_status=cash,
        store_amount=Decimal(store_amount) if store_amount is not None else None,
        cod_amount=Decimal(cod) if cod is not None else None,
        delivery_fee=Decimal(fee) if fee is not None else None, **kw,
    )


def _client(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _record(client, **body):
    return client.post(URL, {"courier": "maystro", "amount_received": "9000.00", **body}, format="json")


# ─── Record ───────────────────────────────────────────────────────────────────

def test_record_payout_computes_totals_and_marks_parcels_paid(store):
    tenant, users, config = store
    a = _ship(tenant, config, 1)                                    # store_amount 4500
    b = _ship(tenant, config, 2, cash=CashStatus.READY, store_amount=None, cod="3000.00", fee="350.00")  # 2650
    res = _record(_client(users[RoleChoices.MANAGER]), amount_received="7000.00",
                  shipment_ids=[str(a.pk), str(b.pk)], courier_reference="BV-12", picked_up_on="2026-11-16")

    assert res.status_code == status.HTTP_201_CREATED, res.content
    body = res.json()
    assert (body["expected_amount"], body["amount_received"], body["difference"]) == ("7150.00", "7000.00", "-150.00")
    assert (body["status"], body["courier_reference"], body["picked_up_on"]) == ("recorded", "BV-12", "2026-11-16")
    assert body["shipment_count"] == 2
    assert body["unconfirmed_count"] == 2
    assert sorted(s["tracking_number"] for s in body["shipments"]) == ["T1", "T2"]
    a.refresh_from_db(); b.refresh_from_db()
    assert (a.cash_status, a.payout_previous_cash, str(a.payout_id)) == (CashStatus.PAID, CashStatus.HELD_BY_COURIER, body["id"])
    assert (b.cash_status, b.payout_previous_cash) == (CashStatus.PAID, CashStatus.READY)
    assert AuditLog.objects.filter(tenant=tenant, model_name="CourierPayout", object_id=body["id"]).exists()


def test_record_by_tracking_numbers_and_by_courier_payout(store):
    tenant, users, config = store
    _ship(tenant, config, 1)
    _ship(tenant, config, 2, cash=CashStatus.PAID, courier_payout_ref="mp-9", courier_paid_on=date(2026, 11, 16))
    _ship(tenant, config, 3, cash=CashStatus.PAID, courier_payout_ref="mp-9", courier_paid_on=date(2026, 11, 16))
    res = _record(_client(users[RoleChoices.OWNER]), trackings=[" T1 ", "T1", ""], courier_payout_ref="mp-9",
                  amount_received="13500.00")
    assert res.status_code == status.HTTP_201_CREATED, res.content
    body = res.json()
    assert body["shipment_count"] == 3
    assert body["unconfirmed_count"] == 1           # T1 was not reported paid by the courier
    assert body["difference"] == "0.00"


def test_unknown_tracking_numbers_are_reported_and_nothing_is_recorded(store):
    tenant, users, config = store
    _ship(tenant, config, 1)
    res = _record(_client(users[RoleChoices.OWNER]), trackings=["T1", "NOPE-1", "NOPE-2"])
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert res.json()["error"]["details"]["unknown_trackings"] == ["NOPE-1", "NOPE-2"]
    assert CourierPayout.objects.count() == 0
    assert Shipment.objects.unscoped().get(tracking_number="T1").payout_id is None


@pytest.mark.parametrize("cash", [CashStatus.AWAITING_DELIVERY, CashStatus.NOT_APPLICABLE])
def test_parcels_without_cash_with_the_courier_are_refused(store, cash):
    tenant, users, config = store
    ok = _ship(tenant, config, 1)
    bad = _ship(tenant, config, 2, cash=cash)
    res = _record(_client(users[RoleChoices.OWNER]), shipment_ids=[str(ok.pk), str(bad.pk)])
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert res.json()["error"]["details"]["refused_trackings"] == ["T2"]
    ok.refresh_from_db()
    assert (ok.cash_status, ok.payout_id) == (CashStatus.HELD_BY_COURIER, None)
    assert CourierPayout.objects.count() == 0


def test_a_parcel_cannot_be_in_two_payouts_double_submit(store):
    tenant, users, config = store
    a = _ship(tenant, config, 1)
    client = _client(users[RoleChoices.OWNER])
    assert _record(client, shipment_ids=[str(a.pk)]).status_code == 201
    second = _record(client, shipment_ids=[str(a.pk)])
    assert second.status_code == status.HTTP_400_BAD_REQUEST
    assert CourierPayout.objects.count() == 1


def test_parcels_of_another_store_or_courier_are_refused(store):
    tenant, users, config = store
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    other_cfg = ProviderConfig.objects.create(tenant=other, courier="maystro", credentials={"apiKey": "x"})
    foreign = _ship(other, other_cfg, 9)
    yal = ProviderConfig.objects.create(tenant=tenant, courier="yalidine", credentials={"apiId": "a", "apiToken": "b"})
    other_courier = _ship(tenant, yal, 8)
    client = _client(users[RoleChoices.OWNER])
    for ship in (foreign, other_courier):
        res = _record(client, shipment_ids=[str(ship.pk)])
        assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert CourierPayout.objects.count() == 0


@pytest.mark.parametrize("body,field", [
    ({"amount_received": "-1.00"}, "amount_received"),
    ({"amount_received": "abc"}, "amount_received"),
    ({"courier": "unknown"}, "courier"),
    ({"shipment_ids": []}, "shipments"),
    ({"picked_up_on": (timezone.localdate() + timedelta(days=1)).isoformat()}, "picked_up_on"),
])
def test_invalid_input_is_refused(store, body, field):
    tenant, users, config = store
    a = _ship(tenant, config, 1)
    payload = {"shipment_ids": [str(a.pk)], **body}
    res = _record(_client(users[RoleChoices.OWNER]), **payload)
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert field in res.json()["error"]["details"]
    assert CourierPayout.objects.count() == 0


def test_totals_sent_by_the_client_are_ignored(store):
    tenant, users, config = store
    a = _ship(tenant, config, 1)
    res = _record(_client(users[RoleChoices.OWNER]), shipment_ids=[str(a.pk)], amount_received="4500.00",
                  expected_amount="1.00", difference="999.00")
    assert res.status_code == status.HTTP_201_CREATED
    assert (res.json()["expected_amount"], res.json()["difference"]) == ("4500.00", "0.00")


# ─── Void ─────────────────────────────────────────────────────────────────────

def test_void_restores_every_parcel_and_cannot_run_twice(store):
    tenant, users, config = store
    held = _ship(tenant, config, 1)
    ready = _ship(tenant, config, 2, cash=CashStatus.READY)
    courier_paid = _ship(tenant, config, 3, cash=CashStatus.PAID, courier_payout_ref="mp-1")
    client = _client(users[RoleChoices.OWNER])
    payout_id = _record(client, shipment_ids=[str(held.pk), str(ready.pk), str(courier_paid.pk)]).json()["id"]

    res = client.post(f"{URL}{payout_id}/void/")

    assert res.status_code == status.HTTP_200_OK
    assert res.json()["status"] == "voided"
    assert res.json()["voided_by_name"]
    for ship, expected in ((held, CashStatus.HELD_BY_COURIER), (ready, CashStatus.READY), (courier_paid, CashStatus.PAID)):
        ship.refresh_from_db()
        assert (ship.cash_status, ship.payout_id, ship.payout_previous_cash) == (expected, None, "")
    assert client.post(f"{URL}{payout_id}/void/").status_code == status.HTTP_400_BAD_REQUEST
    # The parcels can be recorded again.
    assert _record(client, shipment_ids=[str(held.pk)]).status_code == 201


def test_a_courier_update_does_not_unpay_a_recorded_parcel(store):
    tenant, users, config = store
    ship = _ship(tenant, config, 1)
    _record(_client(users[RoleChoices.OWNER]), shipment_ids=[str(ship.pk)])
    ship.refresh_from_db()
    changed = ship.apply_snapshot(ParcelSnapshot(
        external_id="ext-1", tracking="T1", status=ShipmentStatus.RETURNED, cash_status=CashStatus.NOT_APPLICABLE,
    ))
    assert ship.cash_status == CashStatus.PAID
    assert "cash_status" not in changed


# ─── Lists ────────────────────────────────────────────────────────────────────

def test_list_and_detail(store):
    tenant, users, config = store
    a = _ship(tenant, config, 1, courier_payout_ref="mp-1")
    a.cash_status = CashStatus.PAID; a.save()
    b = _ship(tenant, config, 2)
    client = _client(users[RoleChoices.OWNER])
    payout_id = _record(client, shipment_ids=[str(a.pk), str(b.pk)]).json()["id"]

    listed = client.get(URL).json()
    assert listed["count"] == 1
    row = listed["results"][0]
    assert (row["id"], row["shipment_count"], row["unconfirmed_count"]) == (payout_id, 2, 1)
    assert "shipments" not in row
    detail = client.get(f"{URL}{payout_id}/").json()
    assert sorted(s["tracking_number"] for s in detail["shipments"]) == ["T1", "T2"]
    assert client.get(URL + "?status=voided").json()["count"] == 0


def test_to_record_groups_courier_payouts_and_held_cash(store):
    tenant, users, config = store
    _ship(tenant, config, 1, cash=CashStatus.PAID, courier_payout_ref="mp-1", courier_paid_on=date(2026, 11, 16))
    _ship(tenant, config, 2, cash=CashStatus.PAID, courier_payout_ref="mp-1", courier_paid_on=date(2026, 11, 16),
          store_amount=None, cod="1000.00", fee="200.00")
    _ship(tenant, config, 3, cash=CashStatus.HELD_BY_COURIER, store_amount="1500.00")
    _ship(tenant, config, 4, cash=CashStatus.READY, store_amount="100.00")
    recorded = _ship(tenant, config, 5, cash=CashStatus.HELD_BY_COURIER)
    client = _client(users[RoleChoices.OWNER])
    _record(client, shipment_ids=[str(recorded.pk)])

    body = client.get(f"{URL}to-record/").json()

    assert body == {"couriers": [{
        "courier": "maystro",
        "courier_payouts": [{"courier_payout_ref": "mp-1", "paid_on": "2026-11-16", "count": 2, "expected_amount": "5300.00"}],
        "held": {"count": 1, "expected_amount": "1500.00"},
        "ready": {"count": 1, "expected_amount": "100.00"},
    }]}


# ─── Access and isolation from the till ───────────────────────────────────────

def test_cashier_is_refused_everywhere(store):
    tenant, users, config = store
    a = _ship(tenant, config, 1)
    payout = _record(_client(users[RoleChoices.OWNER]), shipment_ids=[str(a.pk)]).json()
    client = _client(users[RoleChoices.CASHIER])
    for res in (client.get(URL), client.get(f"{URL}{payout['id']}/"), client.get(f"{URL}to-record/"),
                _record(client, shipment_ids=[str(a.pk)]), client.post(f"{URL}{payout['id']}/void/")):
        assert res.status_code == status.HTTP_403_FORBIDDEN
    assert CourierPayout.objects.get(pk=payout["id"]).status == "recorded"


def test_payouts_cannot_be_edited_or_deleted(store):
    tenant, users, config = store
    a = _ship(tenant, config, 1)
    client = _client(users[RoleChoices.OWNER])
    payout_id = _record(client, shipment_ids=[str(a.pk)]).json()["id"]
    assert client.patch(f"{URL}{payout_id}/", {"amount_received": "1"}, format="json").status_code == 405
    assert client.delete(f"{URL}{payout_id}/").status_code == 405


def test_payouts_never_touch_the_till_sales_stock_or_ledger(store):
    tenant, users, config = store
    a = _ship(tenant, config, 1)
    before = (CashSession.objects.count(), CashMovement.objects.count(), Sale.objects.count(),
              StockMovement.objects.count(), ClientLedger.objects.count())
    client = _client(users[RoleChoices.OWNER])
    payout_id = _record(client, shipment_ids=[str(a.pk)]).json()["id"]
    client.post(f"{URL}{payout_id}/void/")
    after = (CashSession.objects.count(), CashMovement.objects.count(), Sale.objects.count(),
             StockMovement.objects.count(), ClientLedger.objects.count())
    assert after == before


# ─── Preview (P1.13) ──────────────────────────────────────────────────────────

def test_preview_matches_what_recording_would_compute_and_writes_nothing(store):
    tenant, users, config = store
    _ship(tenant, config, 1)
    _ship(tenant, config, 2, cash=CashStatus.PAID, courier_payout_ref="mp-3", store_amount="1000.00")
    client = _client(users[RoleChoices.OWNER])
    body = {"courier": "maystro", "trackings": ["T1"], "courier_payout_ref": "mp-3"}

    preview = client.post(f"{URL}preview/", body, format="json")

    assert preview.status_code == status.HTTP_200_OK
    data = preview.json()
    assert (data["count"], data["expected_amount"], data["trackings"]) == (2, "5500.00", ["T1", "T2"])
    assert CourierPayout.objects.count() == 0
    assert Shipment.objects.unscoped().filter(payout__isnull=False).count() == 0

    recorded = client.post(URL, {**body, "amount_received": "5500.00"}, format="json").json()
    assert (recorded["expected_amount"], recorded["shipment_count"]) == (data["expected_amount"], data["count"])


def test_preview_reports_problems_like_recording(store):
    tenant, users, config = store
    _ship(tenant, config, 1, cash=CashStatus.AWAITING_DELIVERY)
    client = _client(users[RoleChoices.OWNER])
    unknown = client.post(f"{URL}preview/", {"courier": "maystro", "trackings": ["NOPE"]}, format="json")
    assert unknown.status_code == 400
    assert unknown.json()["error"]["details"]["unknown_trackings"] == ["NOPE"]
    refused = client.post(f"{URL}preview/", {"courier": "maystro", "trackings": ["T1"]}, format="json")
    assert refused.json()["error"]["details"]["refused_trackings"] == ["T1"]


def test_preview_refuses_cashiers(store):
    tenant, users, config = store
    _ship(tenant, config, 1)
    res = _client(users[RoleChoices.CASHIER]).post(f"{URL}preview/", {"courier": "maystro", "trackings": ["T1"]},
                                                   format="json")
    assert res.status_code == status.HTTP_403_FORBIDDEN


# ─── Confirm courier payouts as received (backlog) ────────────────────────────

def test_confirm_courier_payouts_records_each_for_its_expected_amount(store):
    tenant, users, config = store
    _ship(tenant, config, 1, cash=CashStatus.PAID, courier_payout_ref="mp-1", courier_paid_on=date(2026, 10, 1))
    _ship(tenant, config, 2, cash=CashStatus.PAID, courier_payout_ref="mp-1", courier_paid_on=date(2026, 10, 1),
          store_amount="1000.00")
    _ship(tenant, config, 3, cash=CashStatus.PAID, courier_payout_ref="mp-2", courier_paid_on=date(2026, 10, 8))
    client = _client(users[RoleChoices.OWNER])

    res = client.post(f"{URL}confirm-courier-payouts/", {"courier": "maystro", "refs": ["mp-1", "mp-2", "mp-1"]},
                      format="json")

    assert res.status_code == status.HTTP_201_CREATED, res.content
    assert len(res.json()["created"]) == 2 and res.json()["failed"] == []
    rows = {p.picked_up_on: p for p in CourierPayout.objects.filter(tenant=tenant)}
    assert set(rows) == {date(2026, 10, 1), date(2026, 10, 8)}
    first = rows[date(2026, 10, 1)]
    assert (first.expected_amount, first.amount_received, first.difference) == (
        Decimal("5500.00"), Decimal("5500.00"), Decimal("0.00"))
    assert first.shipments.count() == 2
    assert client.get(f"{URL}to-record/").json() == {"couriers": []}


def test_confirm_courier_payouts_reports_failures_without_undoing_successes(store):
    tenant, users, config = store
    _ship(tenant, config, 1, cash=CashStatus.PAID, courier_payout_ref="mp-1", courier_paid_on=date(2026, 10, 1))
    client = _client(users[RoleChoices.OWNER])

    res = client.post(f"{URL}confirm-courier-payouts/", {"courier": "maystro", "refs": ["mp-1", "mp-unknown"]},
                      format="json")

    assert res.status_code == status.HTTP_201_CREATED
    body = res.json()
    assert len(body["created"]) == 1
    assert [f["courier_payout_ref"] for f in body["failed"]] == ["mp-unknown"]
    again = client.post(f"{URL}confirm-courier-payouts/", {"courier": "maystro", "refs": ["mp-1"]}, format="json")
    assert again.status_code == status.HTTP_400_BAD_REQUEST     # already recorded: nothing created
    assert CourierPayout.objects.count() == 1


def test_confirm_courier_payouts_refuses_cashiers(store):
    tenant, users, config = store
    _ship(tenant, config, 1, cash=CashStatus.PAID, courier_payout_ref="mp-1", courier_paid_on=date(2026, 10, 1))
    res = _client(users[RoleChoices.CASHIER]).post(f"{URL}confirm-courier-payouts/",
                                                   {"courier": "maystro", "refs": ["mp-1"]}, format="json")
    assert res.status_code == status.HTTP_403_FORBIDDEN
    assert CourierPayout.objects.count() == 0
