"""
Landed cost for an import shipment.

Unit cost in DZD = supplier price × exchange rate + this line's share of the
extra costs. The share is split by value, pairs, or cartons. Rounding remainder
goes to the heaviest line so the shares add up to the total exactly.
Extra costs are not added to the supplier invoice.
"""
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils.translation import gettext as _
from rest_framework.exceptions import ValidationError

TWOPLACES = Decimal("0.01")
DEFAULT_LABELS = (
    "Fret",
    "Droits de douane",
    "Transitaire",
    "Transport",
    "Autres",
)


def allocate_amounts(weighted, total: Decimal) -> dict:
    """
    weighted: sequence of (key, weight, quantity) with weight > 0.
    Returns key -> allocated DZD, quantized, summing to total.
    """
    rows = [(key, Decimal(weight), int(quantity)) for key, weight, quantity in weighted if Decimal(weight) > 0 and int(quantity) > 0]
    total = Decimal(total).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
    if not rows or total < 0:
        return {}
    weight_sum = sum((weight for _key, weight, _qty in rows), Decimal("0"))
    if weight_sum <= 0:
        return {}
    shares = []
    running = Decimal("0.00")
    for key, weight, quantity in rows:
        share = (total * weight / weight_sum).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
        shares.append([key, weight, quantity, share])
        running += share
    remainder = total - running
    largest = max(range(len(shares)), key=lambda index: (shares[index][1], -index))
    shares[largest][3] += remainder
    return {key: share for key, _weight, _qty, share in shares}


def line_weight(line, method: str, rate: Decimal) -> Decimal:
    quantity = Decimal(line.quantity_ordered or 0)
    if method == "pairs":
        return quantity
    if method == "cartons":
        if line.cartons and line.cartons > 0:
            return Decimal(line.cartons)
        per_carton = Decimal(line.pairs_per_carton or 0)
        if per_carton <= 0:
            return quantity
        return quantity / per_carton
    return quantity * Decimal(line.agreed_unit_price) * rate


def reception_unit_cost(line, po) -> Decimal:
    """DZD cost used for PAMP. Landed cost wins; otherwise price × rate."""
    if line.landed_unit_cost is not None:
        return Decimal(line.landed_unit_cost)
    rate = Decimal(po.exchange_rate if po.exchange_rate is not None else 1)
    return Decimal(line.agreed_unit_price) * rate


def _cost_for(po):
    from apps.suppliers.models import LandedCost
    return (
        LandedCost.objects.filter(tenant=po.tenant, purchase_orders=po)
        .order_by("-created_at")
        .first()
    )


def _received(po) -> bool:
    return po.lines.filter(quantity_received__gt=0).exists() or po.status in ("partial", "received")


def preview_rows(po, allocation: str, total_costs: Decimal) -> list[dict]:
    rate = Decimal(po.exchange_rate if po.exchange_rate is not None else 1)
    lines = list(po.lines.select_related("variant__product").order_by("id"))
    shares = allocate_amounts(
        [(line.pk, line_weight(line, allocation, rate), line.quantity_ordered) for line in lines],
        total_costs,
    )
    built = []
    by_product = {}
    for line in lines:
        quantity = Decimal(line.quantity_ordered or 0)
        supplier_price = Decimal(line.agreed_unit_price)
        dzd_price = (supplier_price * rate).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
        allocated = shares.get(line.pk, Decimal("0.00"))
        landed = dzd_price if quantity <= 0 else (dzd_price + allocated / quantity).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
        product_id = line.variant.product_id if line.variant_id else None
        built.append((line, product_id, quantity, supplier_price, dzd_price, allocated, landed))
        if product_id and quantity > 0:
            bucket = by_product.setdefault(product_id, {"product": line.variant.product, "qty": 0, "value": Decimal("0")})
            bucket["qty"] += int(quantity)
            bucket["value"] += landed * quantity

    estimates = {}
    for product_id, bucket in by_product.items():
        product = bucket["product"]
        stock = product.total_stock
        basis = product.pamp if product.pamp and product.pamp > 0 else (product.purchase_price or Decimal("0"))
        incoming_qty = Decimal(bucket["qty"])
        if stock <= 0 or basis <= 0:
            estimate = bucket["value"] / incoming_qty
        else:
            estimate = (Decimal(stock) * basis + bucket["value"]) / (Decimal(stock) + incoming_qty)
        estimates[product_id] = _money(estimate)

    return [
        {
            "line_id": str(line.pk),
            "description": line.description,
            "quantity": int(quantity),
            "supplier_unit_price": _money(supplier_price),
            "dzd_unit_price": _money(dzd_price),
            "allocated_cost": _money(allocated),
            "landed_unit_cost": _money(landed),
            "estimated_pamp": estimates.get(product_id),
        }
        for line, product_id, quantity, supplier_price, dzd_price, allocated, landed in built
    ]


def _money(value: Decimal) -> str:
    return str(Decimal(value).quantize(TWOPLACES, rounding=ROUND_HALF_UP))


def landed_cost_state(po) -> dict:
    cost = _cost_for(po)
    if cost is None:
        lines = [{"label": label, "amount_dzd": "0.00"} for label in DEFAULT_LABELS]
        total = Decimal("0.00")
        allocation = "value"
        status = "draft"
        cost_id = None
    else:
        lines = [
            {"label": line.label, "amount_dzd": _money(line.amount_dzd)}
            for line in cost.lines.all()
        ]
        total = sum((Decimal(line["amount_dzd"]) for line in lines), Decimal("0.00"))
        allocation = cost.allocation
        status = cost.status
        cost_id = str(cost.pk)
    return {
        "id": cost_id,
        "status": status,
        "currency": po.currency or "DZD",
        "exchange_rate": str(po.exchange_rate or Decimal("1.0000")),
        "allocation": allocation,
        "cost_lines": lines,
        "total_costs": _money(total),
        "can_apply": status != "applied" and not _received(po),
        "preview": preview_rows(po, allocation, total) if cost_id or po.lines.exists() else [],
    }


def save_landed_cost(po, data) -> dict:
    from apps.suppliers.models import LandedCost, LandedCostLine
    if _received(po):
        raise ValidationError(_("Cette commande a déjà été réceptionnée en partie."))
    cost = _cost_for(po)
    if cost is not None and cost.status == LandedCost.Status.APPLIED:
        raise ValidationError(_("Les coûts d'approche sont déjà appliqués."))
    with transaction.atomic():
        po.currency = data["currency"].strip().upper()
        po.exchange_rate = data["exchange_rate"]
        po.save(update_fields=["currency", "exchange_rate"])
        if cost is None:
            cost = LandedCost.objects.create(
                tenant=po.tenant,
                allocation=data["allocation"],
                status=LandedCost.Status.DRAFT,
            )
            cost.purchase_orders.add(po)
        else:
            cost.allocation = data["allocation"]
            cost.save(update_fields=["allocation"])
            cost.lines.all().delete()
        LandedCostLine.objects.bulk_create([
            LandedCostLine(landed_cost=cost, label=line["label"].strip(), amount_dzd=line["amount_dzd"])
            for line in data["lines"]
            if line["label"].strip()
        ])
    po.refresh_from_db()
    return landed_cost_state(po)


def apply_landed_cost(po) -> dict:
    from apps.suppliers.models import LandedCost, POLine
    cost = _cost_for(po)
    if cost is None:
        raise ValidationError(_("Enregistrez d'abord les coûts d'approche."))
    if cost.status == LandedCost.Status.APPLIED:
        raise ValidationError(_("Les coûts d'approche sont déjà appliqués."))
    with transaction.atomic():
        locked = type(po).objects.select_for_update().get(pk=po.pk)
        if locked.lines.filter(quantity_received__gt=0).exists() or locked.status in ("partial", "received"):
            raise ValidationError(_("Cette commande a déjà été réceptionnée en partie."))
        state = landed_cost_state(locked)
        for row in state["preview"]:
            POLine.objects.filter(pk=row["line_id"], order=locked).update(
                landed_unit_cost=row["landed_unit_cost"],
            )
        cost.status = LandedCost.Status.APPLIED
        cost.save(update_fields=["status"])
    return landed_cost_state(po)
