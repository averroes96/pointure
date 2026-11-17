"""
What a courier status means for a Pointure delivery order (docs/plans/delivery-v1-plan.md P2.5).

Called by the sync after it saved a shipment linked to a Pointure order (DL2.7: parcels
created in the courier app or in DZBuild never get here). One short transaction per
order, no network. Every step is guarded by the order's state, so a second sync, or a
status read twice, changes nothing.

  delivered            dispatched order → completed sale dated on the delivery time, one
                       `courier` payment, no cash session, no stock movement (DL2.1, DL2.5)
  returned             dispatched order → one `delivery_return` per line, order `returned`
  cancelled            before pickup: as returned, order `rejected`;
                       after pickup: flagged (the parcel may still be on its way back)
  lost                 flagged, no stock back

Anything else that does not fit (a return after the sale, a parcel on an order Pointure
never recorded as sent, a closed period, a failed sale) is flagged in `attention` for
the owner instead of being guessed.
"""
import logging
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.closing.services.lock import is_period_closed
from apps.inventory.models import MovementReasonChoices, StockMovement
from apps.inventory.services.costing import current_unit_cost
from apps.sales.models import Payment, PaymentMethodChoices, Sale, SaleItem, SaleStatusChoices

from ..models import CustomerOrder, CustomerOrderStatusChoices as OrderStatus, OrderAttentionChoices as Attention
from .couriers.vocabulary import ShipmentStatus

logger = logging.getLogger(__name__)

ACTIONABLE = frozenset({
    ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED, ShipmentStatus.CANCELLED, ShipmentStatus.LOST,
})
# Any of these in the parcel's history means the courier had it in hand.
HANDLED_BY_COURIER = frozenset({
    ShipmentStatus.PICKED_UP, ShipmentStatus.IN_TRANSIT, ShipmentStatus.AT_HUB,
    ShipmentStatus.OUT_FOR_DELIVERY, ShipmentStatus.DELIVERY_ATTEMPTED, ShipmentStatus.ON_HOLD,
    ShipmentStatus.RETURN_IN_TRANSIT, ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED,
})
NOT_SENT = frozenset({OrderStatus.DRAFT, OrderStatus.CONFIRMED})


def needs_lifecycle(shipment):
    return shipment.customer_order_id is not None and shipment.status in ACTIONABLE


def apply(shipment):
    """
    Apply one shipment's status to its order. Returns what happened ("sale", "stock_back",
    a flag code, or "" for nothing). Never raises: a failure is logged and flagged.
    """
    if not needs_lifecycle(shipment):
        return ""
    try:
        with transaction.atomic():
            order = (
                CustomerOrder.objects.unscoped().select_for_update(of=("self",))
                .select_related("tenant", "dispatched_by")
                .get(pk=shipment.customer_order_id, tenant_id=shipment.tenant_id)
            )
            return _HANDLERS[shipment.status](order, shipment)
    except CustomerOrder.DoesNotExist:
        return ""
    except Exception:
        logger.exception("Delivery lifecycle failed (order %s, shipment %s)", shipment.customer_order_id, shipment.pk)
        _flag_outside(shipment, Attention.SALE_FAILED if shipment.status == ShipmentStatus.DELIVERED else "")
        return "error"


# ─── Handlers (inside the order's transaction) ────────────────────────────────

def _delivered(order, shipment):
    if order.status == OrderStatus.DELIVERED or order.sale_id:
        return ""
    if order.status in NOT_SENT:
        return _flag(order, Attention.NOT_RECORDED)
    if order.status != OrderStatus.DISPATCHED:
        return _flag(order, Attention.STATUS_CONFLICT)

    delivered_at = shipment.status_at or timezone.now()
    if is_period_closed(order.tenant, delivered_at):
        return _flag(order, Attention.PERIOD_CLOSED)

    lines = list(order.lines.select_related("variant"))
    if not lines:
        return _flag(order, Attention.SALE_FAILED)
    total = order.goods_total()
    sale = Sale.objects.create(
        tenant=order.tenant,
        cashier=order.dispatched_by,
        status=SaleStatusChoices.COMPLETED,
        total_amount=total,
        notes=f"Livraison {order.provider or shipment.courier} {order.tracking_number or shipment.tracking_number}".strip(),
        receipt_number=_receipt_number(order, shipment),
    )
    for line in lines:
        SaleItem.objects.create(
            sale=sale, variant=line.variant, quantity=line.quantity, unit_price=line.unit_price,
            discount_amount=line.discount_amount, unit_cost=current_unit_cost(line.variant), unit_cost_estimated=False,
        )
    if total > Decimal("0"):
        # Collected by the courier: no cash session, never in the X/Z cash totals (DL2.5).
        Payment.objects.create(sale=sale, session=None, amount=total, method=PaymentMethodChoices.COURIER)
    # Dated on the delivery (auto_now_add fields are set on insert, so date them after).
    Sale.objects.filter(pk=sale.pk).update(created_at=delivered_at)
    Payment.objects.filter(sale=sale).update(recorded_at=delivered_at)

    order.sale = sale
    order.status = OrderStatus.DELIVERED
    order.attention = ""
    order.save()
    return "sale"


def _returned(order, shipment):
    if order.status == OrderStatus.DELIVERED or order.sale_id:
        return _flag(order, Attention.RETURNED_AFTER_DELIVERY)
    if order.status in NOT_SENT:
        return _flag(order, Attention.NOT_RECORDED)
    if order.status != OrderStatus.DISPATCHED:
        return ""
    return _stock_back(order, OrderStatus.RETURNED)


def _cancelled(order, shipment):
    if order.status == OrderStatus.DELIVERED or order.sale_id:
        return _flag(order, Attention.STATUS_CONFLICT)
    if order.status in NOT_SENT:
        return _flag(order, Attention.NOT_RECORDED)
    if order.status != OrderStatus.DISPATCHED:
        return ""
    if shipment.events.filter(status__in=HANDLED_BY_COURIER).exists():
        return _flag(order, Attention.CANCELLED_AFTER_PICKUP)
    return _stock_back(order, OrderStatus.REJECTED)


def _lost(order, shipment):
    if order.status in NOT_SENT:
        return _flag(order, Attention.NOT_RECORDED)
    if order.status != OrderStatus.DISPATCHED:
        return ""
    return _flag(order, Attention.LOST)


_HANDLERS = {
    ShipmentStatus.DELIVERED: _delivered,
    ShipmentStatus.RETURNED: _returned,
    ShipmentStatus.CANCELLED: _cancelled,
    ShipmentStatus.LOST: _lost,
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _stock_back(order, new_status):
    if order.stock_returned_at is not None:
        return ""
    if is_period_closed(order.tenant, timezone.localdate()):
        return _flag(order, Attention.PERIOD_CLOSED)
    for line in order.lines.select_related("variant"):
        StockMovement.objects.create(
            tenant=order.tenant,
            variant=line.variant,
            quantity_delta=line.quantity,
            reason=MovementReasonChoices.DELIVERY_RETURN,
            reference_id=str(order.pk),
            reference_type="CustomerOrder",
            notes=f"{order.provider or ''} {order.tracking_number or ''}".strip(),
        )
    order.status = new_status
    order.stock_returned_at = timezone.now()
    order.attention = ""
    order.save()
    return "stock_back"


def _flag(order, code):
    if order.attention != code:
        order.attention = code
        order.save(update_fields=["attention", "updated_at"])
    return code


def _flag_outside(shipment, code):
    if not code:
        return
    try:
        CustomerOrder.objects.unscoped().filter(
            pk=shipment.customer_order_id, tenant_id=shipment.tenant_id, sale__isnull=True,
        ).update(attention=code, updated_at=timezone.now())
    except Exception:
        logger.exception("Could not flag order %s", shipment.customer_order_id)


def _receipt_number(order, shipment):
    """`LV-<tracking>`: unique per parcel without a shared counter (fits the 30-character field)."""
    tracking = (order.tracking_number or shipment.tracking_number or "").strip()
    if tracking and len(tracking) <= 27:
        return f"LV-{tracking}"
    return f"LV-{order.pk.hex[:12].upper()}"
