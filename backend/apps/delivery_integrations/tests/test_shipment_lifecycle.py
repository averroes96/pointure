"""
Delivery order lifecycle from the courier's statuses (docs/plans/delivery-v1-plan.md P2.5):
delivered → sale; returned / cancelled before pickup → stock back; everything that does
not fit is flagged, never guessed. Synthetic data; a scripted fake courier, no network.
"""
import json
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.utils import timezone

from apps.closing.models import FiscalYear, FiscalYearStatusChoices
from apps.core.models import PlanChoices, RoleChoices, Tenant, User
from apps.delivery_integrations.models import (
    CustomerOrder, CustomerOrderLine, CustomerOrderStatusChoices as OrderStatus, OrderAttentionChoices as Attention,
    ProviderConfig, Shipment, ShipmentEvent,
)
from apps.delivery_integrations.services import catalogue, lifecycle, sync
from apps.delivery_integrations.services.couriers import (
    Capability, CourierReadConnector, ParcelPage, ParcelSnapshot, ShipmentStatus, TrackingEvent, registry,
)
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import CashSession, Payment, PaymentMethodChoices, Sale, SaleItem

DELIVERED_AT = timezone.now() - timedelta(hours=3)


class Script:
    pages = []
    history = {}


class FakeLifecycleConnector(CourierReadConnector):
    platform = "fakelifecycle"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.capabilities = frozenset({Capability.TEST, Capability.LIST, Capability.HISTORY})

    def auth_headers(self):
        return {}

    def list_parcels(self, cursor=None):
        return ParcelPage(items=tuple(Script.pages.pop(0) if Script.pages else ()), next_cursor=None)

    def history(self, ref):
        return Script.history.get(ref, ())


@pytest.fixture(autouse=True)
def fake_courier(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    saved = dict(registry._REGISTRY)
    registry.register(FakeLifecycleConnector)
    catalogue.snapshot_path().write_text(json.dumps({
        "fetched_at": timezone.now().isoformat(),
        "couriers": [catalogue.clean_entry({
            "key": "fakelc", "name": "Fake", "platform": "fakelifecycle", "requiredCredentials": ["apiKey"],
            "capabilities": {}, "endpoint": "https://fake-courier.example.dz/api"})],
    }), encoding="utf-8")
    Script.pages, Script.history = [], {}
    yield
    registry._REGISTRY.clear()
    registry._REGISTRY.update(saved)


@pytest.fixture
def store(db):
    tenant = Tenant.objects.create(name="Lifecycle Store", plan=PlanChoices.PRO_RETAIL)
    manager = User.objects.create_user(email="mgr-lc@test.com", password="password123",
                                       role=RoleChoices.MANAGER, tenant=tenant)
    config = ProviderConfig.objects.create(tenant=tenant, courier="fakelc", credentials={"apiKey": "k"})
    product = Product.objects.create(tenant=tenant, name="Basket", reference="B-1",
                                     sale_price=Decimal("4500"), purchase_price=Decimal("2500"))
    v42 = Variant.objects.create(tenant=tenant, product=product, size_eu=42)
    v43 = Variant.objects.create(tenant=tenant, product=product, size_eu=43)
    for v in (v42, v43):
        StockMovement.objects.create(tenant=tenant, variant=v, quantity_delta=10, reason=MovementReasonChoices.INITIAL)
    order = CustomerOrder.objects.create(
        tenant=tenant, customer_name="Client", customer_phone="0551234567", wilaya="16", commune="Bab Ezzouar",
        shipping_fee=Decimal("600"), status=OrderStatus.DISPATCHED, provider="fakelc", tracking_number="T1",
        dispatched_by=manager, dispatched_at=timezone.now() - timedelta(days=1),
    )
    CustomerOrderLine.objects.create(order=order, variant=v42, quantity=2, unit_price=Decimal("4500"),
                                     discount_amount=Decimal("500"), position=0)
    CustomerOrderLine.objects.create(order=order, variant=v43, quantity=1, unit_price=Decimal("4500"), position=1)
    for variant, qty in ((v42, 2), (v43, 1)):        # what the dispatch wrote (P2.4)
        StockMovement.objects.create(tenant=tenant, variant=variant, quantity_delta=-qty,
                                     reason=MovementReasonChoices.DELIVERY_OUT,
                                     reference_id=str(order.pk), reference_type="CustomerOrder")
    return {"tenant": tenant, "manager": manager, "config": config, "v42": v42, "v43": v43, "order": order}


def _shipment(s, status, n=1, order=True, **kw):
    return Shipment.objects.create(
        tenant=s["tenant"], provider_config=s["config"], courier="fakelc", external_id=f"ext-{n}",
        tracking_number=f"T{n}", status=status, status_at=DELIVERED_AT,
        customer_order=s["order"] if order else None, **kw,
    )


def _stock(s):
    s["v42"].refresh_from_db()
    s["v43"].refresh_from_db()
    return s["v42"].stock_qty, s["v43"].stock_qty


def _returns(s):
    return list(StockMovement.objects.filter(tenant=s["tenant"], reason=MovementReasonChoices.DELIVERY_RETURN)
                .order_by("variant__size_eu").values_list("variant_id", "quantity_delta", "reference_id"))


def _set_order(s, **fields):
    CustomerOrder.objects.filter(pk=s["order"].pk).update(**fields)
    s["order"].refresh_from_db()


# ─── Delivered → sale ─────────────────────────────────────────────────────────

def test_delivered_creates_one_dated_sale_with_a_courier_payment_and_no_stock_move(store):
    s = store
    shipment = _shipment(s, ShipmentStatus.DELIVERED)
    movements_before = StockMovement.objects.count()

    assert lifecycle.apply(shipment) == "sale"
    assert lifecycle.apply(shipment) == ""                       # second read changes nothing

    order = CustomerOrder.objects.get(pk=s["order"].pk)
    assert (order.status, order.attention) == (OrderStatus.DELIVERED, "")
    sale = Sale.objects.get(tenant=s["tenant"])
    assert order.sale_id == sale.pk
    assert (sale.status, sale.total_amount, sale.cashier, sale.session, sale.branch, sale.client) == (
        "completed", Decimal("13000.00"), s["manager"], None, None, None)
    assert (sale.receipt_number, sale.timbre_fiscal, sale.is_formal) == ("LV-T1", Decimal("0.00"), False)
    assert sale.created_at == DELIVERED_AT
    items = list(SaleItem.objects.filter(sale=sale).order_by("variant__size_eu").values_list(
        "variant_id", "quantity", "unit_price", "discount_amount", "unit_cost"))
    assert items == [(s["v42"].pk, 2, Decimal("4500.00"), Decimal("500.00"), Decimal("2500.00")),
                     (s["v43"].pk, 1, Decimal("4500.00"), Decimal("0.00"), Decimal("2500.00"))]
    payment = Payment.objects.get(sale=sale)
    assert (payment.method, payment.amount, payment.session, payment.recorded_at) == (
        PaymentMethodChoices.COURIER, Decimal("13000.00"), None, DELIVERED_AT)
    assert StockMovement.objects.count() == movements_before    # the stock left at dispatch
    assert _stock(s) == (8, 9)
    assert CashSession.objects.count() == 0


def test_delivered_in_a_closed_period_is_flagged_without_a_sale(store):
    s = store
    year = DELIVERED_AT.year
    FiscalYear.objects.create(tenant=s["tenant"], year=year, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
                              status=FiscalYearStatusChoices.CLOSED, closed_at=timezone.now(), closed_by=s["manager"])
    assert lifecycle.apply(_shipment(s, ShipmentStatus.DELIVERED)) == Attention.PERIOD_CLOSED
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention, s["order"].sale_id) == (
        OrderStatus.DISPATCHED, Attention.PERIOD_CLOSED, None)
    assert Sale.objects.count() == 0


def test_failed_sale_is_rolled_back_and_flagged(store):
    s = store
    with mock.patch("apps.delivery_integrations.services.lifecycle.SaleItem.objects.create",
                    side_effect=RuntimeError("boom")):
        assert lifecycle.apply(_shipment(s, ShipmentStatus.DELIVERED)) == "error"
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention, s["order"].sale_id) == (
        OrderStatus.DISPATCHED, Attention.SALE_FAILED, None)
    assert Sale.objects.count() == 0 and Payment.objects.count() == 0

    # The next read of the parcel retries and succeeds.
    assert lifecycle.apply(Shipment.objects.get(external_id="ext-1")) == "sale"
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention) == (OrderStatus.DELIVERED, "")


def test_long_tracking_number_gets_a_short_receipt_number(store):
    s = store
    _set_order(s, tracking_number="X" * 40)
    lifecycle.apply(_shipment(s, ShipmentStatus.DELIVERED))
    assert Sale.objects.get().receipt_number == f"LV-{s['order'].pk.hex[:12].upper()}"


# ─── Returned / cancelled → stock back ────────────────────────────────────────

def test_returned_puts_stock_back_once(store):
    s = store
    shipment = _shipment(s, ShipmentStatus.RETURNED)
    assert lifecycle.apply(shipment) == "stock_back"
    assert lifecycle.apply(shipment) == ""

    order = CustomerOrder.objects.get(pk=s["order"].pk)
    assert order.status == OrderStatus.RETURNED and order.stock_returned_at is not None
    assert _returns(s) == [(s["v42"].pk, 2, str(order.pk)), (s["v43"].pk, 1, str(order.pk))]
    assert _stock(s) == (10, 10)
    assert Sale.objects.count() == 0


def test_cancelled_before_pickup_puts_stock_back(store):
    s = store
    shipment = _shipment(s, ShipmentStatus.CANCELLED)
    ShipmentEvent.objects.create(shipment=shipment, status=ShipmentStatus.PENDING_PICKUP, occurred_at=DELIVERED_AT)
    assert lifecycle.apply(shipment) == "stock_back"
    s["order"].refresh_from_db()
    assert s["order"].status == OrderStatus.REJECTED
    assert _stock(s) == (10, 10)


def test_cancelled_after_pickup_is_flagged_without_stock_back(store):
    s = store
    shipment = _shipment(s, ShipmentStatus.CANCELLED)
    ShipmentEvent.objects.create(shipment=shipment, status=ShipmentStatus.PICKED_UP, occurred_at=DELIVERED_AT)
    assert lifecycle.apply(shipment) == Attention.CANCELLED_AFTER_PICKUP
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention) == (OrderStatus.DISPATCHED, Attention.CANCELLED_AFTER_PICKUP)
    assert _returns(s) == []

    # When the parcel then comes back, the stock returns and the flag clears.
    shipment.status = ShipmentStatus.RETURNED
    shipment.save()
    assert lifecycle.apply(shipment) == "stock_back"
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention) == (OrderStatus.RETURNED, "")


def test_stock_back_in_a_closed_period_is_flagged(store):
    s = store
    year = timezone.localdate().year
    FiscalYear.objects.create(tenant=s["tenant"], year=year, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
                              status=FiscalYearStatusChoices.CLOSED, closed_at=timezone.now(), closed_by=s["manager"])
    assert lifecycle.apply(_shipment(s, ShipmentStatus.RETURNED)) == Attention.PERIOD_CLOSED
    assert _returns(s) == []


# ─── Flags ────────────────────────────────────────────────────────────────────

def test_return_after_delivery_is_flagged_and_the_sale_is_kept(store):
    s = store
    shipment = _shipment(s, ShipmentStatus.DELIVERED)
    lifecycle.apply(shipment)
    shipment.status = ShipmentStatus.RETURNED
    shipment.save()

    assert lifecycle.apply(shipment) == Attention.RETURNED_AFTER_DELIVERY
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention) == (OrderStatus.DELIVERED, Attention.RETURNED_AFTER_DELIVERY)
    assert Sale.objects.get().status == "completed"
    assert _returns(s) == []


def test_lost_is_flagged_without_stock_back(store):
    s = store
    assert lifecycle.apply(_shipment(s, ShipmentStatus.LOST)) == Attention.LOST
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention) == (OrderStatus.DISPATCHED, Attention.LOST)
    assert _returns(s) == []


@pytest.mark.parametrize("order_status", [OrderStatus.DRAFT, OrderStatus.CONFIRMED])
@pytest.mark.parametrize("parcel_status", [ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED,
                                           ShipmentStatus.CANCELLED, ShipmentStatus.LOST])
def test_parcel_on_an_order_never_recorded_as_sent_is_flagged(store, order_status, parcel_status):
    s = store
    _set_order(s, status=order_status)      # e.g. the dispatch timed out but the courier created the parcel
    assert lifecycle.apply(_shipment(s, parcel_status)) == Attention.NOT_RECORDED
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention) == (order_status, Attention.NOT_RECORDED)
    assert Sale.objects.count() == 0 and _returns(s) == []


@pytest.mark.parametrize("order_status", [OrderStatus.RETURNED, OrderStatus.REJECTED])
def test_delivered_after_the_stock_came_back_is_a_conflict(store, order_status):
    s = store
    _set_order(s, status=order_status)
    assert lifecycle.apply(_shipment(s, ShipmentStatus.DELIVERED)) == Attention.STATUS_CONFLICT
    assert Sale.objects.count() == 0


@pytest.mark.parametrize("status", [ShipmentStatus.IN_TRANSIT, ShipmentStatus.OUT_FOR_DELIVERY,
                                    ShipmentStatus.RETURN_IN_TRANSIT, ShipmentStatus.UNKNOWN])
def test_non_final_statuses_change_nothing(store, status):
    s = store
    assert lifecycle.apply(_shipment(s, status)) == ""
    s["order"].refresh_from_db()
    assert (s["order"].status, s["order"].attention) == (OrderStatus.DISPATCHED, "")


def test_parcels_not_created_in_pointure_never_touch_sales_or_stock(store):
    s = store
    movements = StockMovement.objects.count()
    for n, status in enumerate((ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED, ShipmentStatus.CANCELLED), start=2):
        assert lifecycle.apply(_shipment(s, status, n=n, order=False)) == ""
    assert Sale.objects.count() == 0 and StockMovement.objects.count() == movements


# ─── Through the sync ─────────────────────────────────────────────────────────

def _snap(n, status, reference="", tracking=None, minutes_ago=5):
    when = timezone.now() - timedelta(minutes=minutes_ago)
    return ParcelSnapshot(external_id=f"ext-{n}", tracking=tracking or f"T{n}", status=status,
                          raw_status=str(status), status_at=when, updated_at=when, reference=reference)


def test_sync_links_the_parcel_and_creates_the_sale_once(store):
    s = store
    Script.pages = [[_snap(1, ShipmentStatus.IN_TRANSIT, reference=str(s["order"].pk), minutes_ago=30)]]
    first = sync.sync_courier(s["config"])
    assert first.lifecycle == {}
    assert Shipment.objects.get(external_id="ext-1").customer_order_id == s["order"].pk

    Script.pages = [[_snap(1, ShipmentStatus.DELIVERED, reference=str(s["order"].pk))]]
    second = sync.sync_courier(s["config"])
    assert second.lifecycle == {"sale": 1}
    Script.pages = [[_snap(1, ShipmentStatus.DELIVERED, reference=str(s["order"].pk), minutes_ago=1)]]
    third = sync.sync_courier(s["config"])           # read again, status unchanged
    assert third.lifecycle == {}
    assert Sale.objects.count() == 1
    s["order"].refresh_from_db()
    assert s["order"].status == OrderStatus.DELIVERED


def test_sync_reads_the_history_of_a_new_cancelled_parcel_before_deciding(store):
    s = store
    Script.pages = [[_snap(1, ShipmentStatus.CANCELLED, tracking="T1")]]
    Script.history = {"ext-1": (
        TrackingEvent(status=ShipmentStatus.PICKED_UP, raw_status="picked", occurred_at=DELIVERED_AT),
        TrackingEvent(status=ShipmentStatus.CANCELLED, raw_status="cancelled", occurred_at=DELIVERED_AT),
    )}
    result = sync.sync_courier(s["config"])
    assert result.lifecycle == {Attention.CANCELLED_AFTER_PICKUP.value: 1}
    assert _returns(s) == []


def test_lifecycle_failure_never_breaks_the_sync(store):
    s = store
    Script.pages = [[_snap(1, ShipmentStatus.DELIVERED, tracking="T1")]]
    failing = mock.Mock(side_effect=RuntimeError("x"))
    with mock.patch.dict(lifecycle._HANDLERS, {ShipmentStatus.DELIVERED: failing}):
        result = sync.sync_courier(s["config"])
    assert (result.error, result.created, result.lifecycle) == ("", 1, {"error": 1})
    s["order"].refresh_from_db()
    assert s["order"].attention == Attention.SALE_FAILED
