"""
Shipment and ShipmentEvent (docs/plans/delivery-v1-plan.md P1.8).
"""
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.contrib import admin
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.managers import clear_current_tenant, set_current_tenant
from apps.core.models import PlanChoices, RoleChoices, StoreSettings, SyncOutbox, Tenant, User
from apps.delivery_integrations.models import ProviderConfig, Shipment, ShipmentEvent
from apps.delivery_integrations.services.couriers import (
    CashStatus,
    ParcelSnapshot,
    ShipmentStatus,
    TrackingEvent,
)

UTC = ZoneInfo("UTC")
T0 = datetime(2026, 11, 16, 8, 0, tzinfo=UTC)
T1 = datetime(2026, 11, 16, 10, 0, tzinfo=UTC)


@pytest.fixture
def setup(db):
    tenant = Tenant.objects.create(name="Ship Store", plan=PlanChoices.PRO_RETAIL)
    config = ProviderConfig.objects.create(tenant=tenant, courier="maystro", credentials={"apiKey": "k"})
    return tenant, config


def _shipment(tenant, config, external_id="ext-1", **kw):
    return Shipment.objects.create(tenant=tenant, provider_config=config, courier="maystro",
                                   external_id=external_id, **kw)


def _snap(**kw):
    base = dict(
        external_id="ext-1", tracking="T-1", status=ShipmentStatus.DELIVERED, raw_status="41 DELIVERED",
        status_at=T1, updated_at=T1, recipient_name="Client", recipient_phone="0551234567",
        wilaya_code="16", commune="Bab Ezzouar", cod_amount=Decimal("4900.00"),
        delivery_fee=Decimal("400.00"), store_amount=Decimal("4500.00"),
        cash_status=CashStatus.HELD_BY_COURIER,
    )
    base.update(kw)
    return ParcelSnapshot(**base)


# ─── Constraints and scoping ──────────────────────────────────────────────────

def test_external_id_is_unique_per_store_and_courier(setup):
    tenant, config = setup
    _shipment(tenant, config)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _shipment(tenant, config)

    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    other_config = ProviderConfig.objects.create(tenant=other, courier="maystro", credentials={"apiKey": "k"})
    _shipment(other, other_config)  # same courier id in another store is fine
    assert Shipment.objects.unscoped().filter(external_id="ext-1").count() == 2


def test_tenant_scoping(setup):
    tenant, config = setup
    mine = _shipment(tenant, config)
    other = Tenant.objects.create(name="Other", plan=PlanChoices.PRO_RETAIL)
    other_config = ProviderConfig.objects.create(tenant=other, courier="maystro", credentials={"apiKey": "k"})
    _shipment(other, other_config, external_id="ext-2")
    try:
        set_current_tenant(tenant)
        assert list(Shipment.objects.values_list("pk", flat=True)) == [mine.pk]
    finally:
        clear_current_tenant()


def test_courier_account_with_shipments_cannot_be_deleted(setup):
    tenant, config = setup
    _shipment(tenant, config)
    with pytest.raises(ProtectedError):
        config.delete()


# ─── apply_snapshot ───────────────────────────────────────────────────────────

def test_apply_snapshot_copies_fields_and_reports_changes(setup):
    tenant, config = setup
    ship = _shipment(tenant, config)
    changed = ship.apply_snapshot(_snap())

    assert set(changed) == {
        "tracking_number", "recipient_name", "recipient_phone", "wilaya_code", "commune", "cod_amount",
        "delivery_fee", "store_amount", "status", "raw_status", "status_at", "is_terminal",
        "courier_updated_at", "cash_status",
    }
    assert ship.tracking_number == "T-1"
    assert ship.status == ShipmentStatus.DELIVERED
    assert ship.is_terminal is True
    assert ship.cash_status == CashStatus.HELD_BY_COURIER
    assert ship.cod_amount == Decimal("4900.00")


def test_same_snapshot_twice_changes_nothing_and_writes_no_outbox_row(setup):
    tenant, config = setup
    ship = _shipment(tenant, config)
    ship.apply_snapshot(_snap())
    ship.save()
    ship.refresh_from_db()
    outbox_before = SyncOutbox.objects.filter(tenant=tenant, model_name="Shipment").count()

    assert ship.apply_snapshot(_snap()) == []
    # Caller saves only on change: nothing saved, so no new outbox row.
    assert SyncOutbox.objects.filter(tenant=tenant, model_name="Shipment").count() == outbox_before


def test_non_terminal_status(setup):
    tenant, config = setup
    ship = _shipment(tenant, config)
    ship.apply_snapshot(_snap(status=ShipmentStatus.OUT_FOR_DELIVERY, raw_status="31 SHIPPED",
                              cash_status=CashStatus.AWAITING_DELIVERY))
    assert ship.is_terminal is False


@pytest.mark.parametrize("current", [CashStatus.PAID, CashStatus.READY])
def test_order_snapshot_never_moves_cash_back_from_payout_stages(setup, current):
    tenant, config = setup
    ship = _shipment(tenant, config, cash_status=current)
    changed = ship.apply_snapshot(_snap(cash_status=CashStatus.HELD_BY_COURIER))
    assert ship.cash_status == current
    assert "cash_status" not in changed


def test_order_snapshot_can_still_mark_not_applicable(setup):
    tenant, config = setup
    ship = _shipment(tenant, config, cash_status=CashStatus.READY)
    ship.apply_snapshot(_snap(status=ShipmentStatus.RETURNED, cash_status=CashStatus.NOT_APPLICABLE))
    assert ship.cash_status == CashStatus.NOT_APPLICABLE


def test_long_courier_values_are_truncated_to_the_columns(setup):
    tenant, config = setup
    ship = _shipment(tenant, config)
    ship.apply_snapshot(_snap(recipient_name="x" * 500, raw_status="y" * 500, tracking="z" * 100))
    ship.save()
    ship.refresh_from_db()
    assert len(ship.recipient_name) == 200
    assert len(ship.raw_status) == 100
    assert len(ship.tracking_number) == 64


# ─── merge_events ─────────────────────────────────────────────────────────────

def test_merge_events_adds_only_new_events(setup):
    tenant, config = setup
    ship = _shipment(tenant, config)
    events = (
        TrackingEvent(status=ShipmentStatus.CREATED, raw_status="4 CREATED", occurred_at=T0),
        TrackingEvent(status=ShipmentStatus.DELIVERED, raw_status="41 DELIVERED", occurred_at=T1, note="ok"),
    )
    assert ship.merge_events(events) == 2
    assert ship.merge_events(events) == 0
    more = events + (TrackingEvent(status=ShipmentStatus.RETURNED, raw_status="52 TAKEN_BY_STORE",
                                   occurred_at=datetime(2026, 11, 17, 9, 0, tzinfo=UTC)),)
    assert ship.merge_events(more) == 1
    assert list(ship.events.values_list("raw_status", flat=True)) == [
        "4 CREATED", "41 DELIVERED", "52 TAKEN_BY_STORE",
    ]


def test_event_uniqueness_is_enforced_by_the_database(setup):
    tenant, config = setup
    ship = _shipment(tenant, config)
    ShipmentEvent.objects.create(shipment=ship, status=ShipmentStatus.CREATED, raw_status="4 CREATED", occurred_at=T0)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ShipmentEvent.objects.create(shipment=ship, status=ShipmentStatus.CREATED, raw_status="4 CREATED",
                                         occurred_at=T0)


def test_deleting_a_shipment_deletes_its_events(setup):
    tenant, config = setup
    ship = _shipment(tenant, config)
    ship.merge_events((TrackingEvent(status=ShipmentStatus.CREATED, raw_status="4 CREATED", occurred_at=T0),))
    ship.delete()
    assert ShipmentEvent.objects.count() == 0


# ─── Admin and API ────────────────────────────────────────────────────────────

def test_admin_is_read_only():
    model_admin = admin.site._registry[Shipment]
    request = object()
    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False


def test_deleting_a_courier_account_with_shipments_is_refused_cleanly(setup):
    tenant, config = setup
    StoreSettings.objects.create(tenant=tenant, enable_delivery_integrations=True)
    owner = User.objects.create_user(email="o-ship@test.com", password="password123",
                                     role=RoleChoices.OWNER, tenant=tenant)
    _shipment(tenant, config)
    client = APIClient()
    client.force_authenticate(user=owner)

    res = client.delete(f"/api/v1/deliveries/provider-configs/{config.pk}/")

    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert ProviderConfig.objects.filter(pk=config.pk).exists()
