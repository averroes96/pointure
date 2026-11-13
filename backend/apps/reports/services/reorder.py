"""
Reorder suggestions (decision D8.3).

For each variant: pairs sold over the last 8 weeks, divided by 8, times the
store's cover weeks, minus stock, minus quantity still on open purchase
orders. When the product has a carton breakdown, the need is rounded up to
whole cartons for that colour.
"""
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP

from django.db import transaction
from django.utils.translation import gettext as _

from apps.reports.services.size_curve import OPEN_PO_STATUSES, SOLD_STATUSES

VELOCITY_WEEKS = 8
TWOPLACES = Decimal("0.01")


def raw_need(sold: int, cover_weeks: int, stock: int, on_order: int) -> Decimal:
    velocity = Decimal(int(sold)) / Decimal(VELOCITY_WEEKS)
    return velocity * Decimal(int(cover_weeks)) - Decimal(int(stock)) - Decimal(int(on_order))


def _ceil_units(value: Decimal) -> int:
    if value <= 0:
        return 0
    return int(value.to_integral_value(rounding=ROUND_CEILING))


def _parse_breakdown(breakdown) -> dict[int, int]:
    if not isinstance(breakdown, dict):
        return {}
    parsed = {}
    for raw_size, raw_qty in breakdown.items():
        try:
            size = int(str(raw_size).strip())
            qty = int(raw_qty)
        except (TypeError, ValueError):
            continue
        if size > 0 and qty > 0:
            parsed[size] = qty
    return parsed


def suggest_colour_group(raw_by_size: dict[int, Decimal], breakdown) -> tuple[dict[int, int], int]:
    """
    Return (pairs to order by size, carton count).
    Sizes outside the breakdown stay as loose pairs, rounded up.
    """
    parsed = _parse_breakdown(breakdown)
    if not parsed:
        loose = {size: _ceil_units(need) for size, need in raw_by_size.items()}
        return {size: qty for size, qty in loose.items() if qty > 0}, 0

    cartons = 0
    for size, per_carton in parsed.items():
        need = raw_by_size.get(size, Decimal("0"))
        if need > 0:
            cartons = max(cartons, _ceil_units(need / Decimal(per_carton)))
    ordered = {}
    if cartons > 0:
        for size, per_carton in parsed.items():
            if size in raw_by_size:
                ordered[size] = cartons * per_carton
    for size, need in raw_by_size.items():
        if size not in parsed:
            qty = _ceil_units(need)
            if qty > 0:
                ordered[size] = qty
    return ordered, cartons


def build_reorder_suggestions(tenant, *, today, supplier_id=None, brand="", category=""):
    from datetime import timedelta
    from django.db.models import F, Sum
    from django.db.models.functions import Greatest
    from apps.core.models import StoreSettings
    from apps.inventory.models import Variant
    from apps.sales.models import ReturnItem, SaleItem
    from apps.suppliers.models import POLine

    settings_obj, _created = StoreSettings.objects.get_or_create(tenant=tenant)
    cover_weeks = int(settings_obj.reorder_cover_weeks or 6)
    start = today - timedelta(days=VELOCITY_WEEKS * 7)

    variants = Variant.objects.filter(
        tenant=tenant, is_active=True, product__is_active=True,
    ).select_related("product")
    if brand:
        variants = variants.filter(product__brand__iexact=brand)
    if category:
        variants = variants.filter(product__category=category)
    variant_rows = list(variants)
    if not variant_rows:
        return _empty(cover_weeks)

    variant_ids = [row.pk for row in variant_rows]
    product_ids = {row.product_id for row in variant_rows}

    sold = {
        row["variant_id"]: row["qty"] or 0
        for row in SaleItem.objects.filter(
            variant_id__in=variant_ids,
            sale__tenant=tenant,
            sale__status__in=SOLD_STATUSES,
            sale__created_at__date__gte=start,
            sale__created_at__date__lte=today,
        ).values("variant_id").annotate(qty=Sum("quantity"))
    }
    returned = {
        row["variant_id"]: row["qty"] or 0
        for row in ReturnItem.objects.filter(
            variant_id__in=variant_ids,
            return_obj__tenant=tenant,
            return_obj__original_sale__status__in=SOLD_STATUSES,
            return_obj__created_at__date__gte=start,
            return_obj__created_at__date__lte=today,
        ).values("variant_id").annotate(qty=Sum("quantity"))
    }
    on_order = {
        row["variant_id"]: row["qty"] or 0
        for row in POLine.objects.filter(
            variant_id__in=variant_ids,
            order__tenant=tenant,
            order__status__in=OPEN_PO_STATUSES,
        ).values("variant_id").annotate(
            qty=Sum(Greatest(F("quantity_ordered") - F("quantity_received"), 0))
        )
    }
    suppliers = _last_suppliers(tenant, product_ids)

    groups = {}
    for variant in variant_rows:
        groups.setdefault((variant.product_id, variant.colour or ""), {})[variant.size_eu] = variant

    lines = []
    for (_product_id, _colour), by_size in groups.items():
        sample = next(iter(by_size.values()))
        raw_by_size = {}
        detail = {}
        for size, variant in by_size.items():
            net = int(sold.get(variant.pk, 0)) - int(returned.get(variant.pk, 0))
            stock = int(variant.stock_qty or 0)
            ordered = int(on_order.get(variant.pk, 0))
            need = raw_need(net, cover_weeks, stock, ordered)
            raw_by_size[size] = need
            detail[size] = (variant, net, stock, ordered, need)
        ordered_by_size, cartons = suggest_colour_group(raw_by_size, sample.product.carton_breakdown)
        supplier = suppliers.get(sample.product_id)
        if supplier_id and (supplier is None or supplier[0] != supplier_id):
            continue
        for size, quantity in ordered_by_size.items():
            if quantity <= 0 or size not in detail:
                continue
            variant, net, stock, ordered, need = detail[size]
            lines.append({
                "variant_id": str(variant.pk),
                "product_id": str(variant.product_id),
                "product_name": variant.product.name,
                "brand": variant.product.brand,
                "category": variant.product.category,
                "size_eu": size,
                "colour": variant.colour or "",
                "supplier_id": str(supplier[0]) if supplier else None,
                "supplier_name": supplier[1] if supplier else "",
                "units_sold": net,
                "stock": stock,
                "on_order": ordered,
                "raw_need": str(need.quantize(TWOPLACES, rounding=ROUND_HALF_UP)),
                "suggested_quantity": quantity,
                "cartons": cartons if size in _parse_breakdown(sample.product.carton_breakdown) else 0,
                "unit_price": str(variant.product.purchase_price or Decimal("0.00")),
            })

    lines.sort(key=lambda row: (row["supplier_name"], row["product_name"], row["size_eu"]))
    return {
        "cover_weeks": cover_weeks,
        "velocity_weeks": VELOCITY_WEEKS,
        "lines": lines,
    }


def _empty(cover_weeks):
    return {"cover_weeks": cover_weeks, "velocity_weeks": VELOCITY_WEEKS, "lines": []}


def _last_suppliers(tenant, product_ids):
    from apps.suppliers.models import POLine
    rows = POLine.objects.filter(
        order__tenant=tenant,
        variant__product_id__in=product_ids,
        variant__isnull=False,
    ).exclude(order__status="cancelled").values(
        "variant__product_id", "order__supplier_id", "order__supplier__name",
        "order__created_at", "order_id",
    )
    best = {}
    for row in rows:
        product_id = row["variant__product_id"]
        key = (row["order__created_at"], str(row["order_id"]))
        current = best.get(product_id)
        if current is None or key > current[0]:
            best[product_id] = (key, row["order__supplier_id"], row["order__supplier__name"])
    return {product_id: (info[1], info[2]) for product_id, info in best.items()}


def create_reorder_orders(tenant, user, lines):
    """Create one draft purchase order per supplier. Quantities come from the caller."""
    from rest_framework.exceptions import ValidationError
    from apps.inventory.models import Variant
    from apps.suppliers.models import POLine, PurchaseOrder, Supplier

    chosen = {}
    for line in lines:
        chosen[line["variant_id"]] = int(line["quantity"])
    variants = list(
        Variant.objects.filter(tenant=tenant, pk__in=chosen).select_related("product")
    )
    if len(variants) != len(chosen):
        raise ValidationError(_("Une variante sélectionnée est introuvable."))

    suppliers = _last_suppliers(tenant, {variant.product_id for variant in variants})
    grouped = {}
    for variant in variants:
        supplier = suppliers.get(variant.product_id)
        if supplier is None:
            raise ValidationError(_("Aucun fournisseur connu pour une ou plusieurs lignes."))
        grouped.setdefault(supplier[0], []).append(variant)

    orders = []
    with transaction.atomic():
        supplier_rows = {
            row.pk: row
            for row in Supplier.objects.filter(tenant=tenant, pk__in=grouped)
        }
        for supplier_id, group in grouped.items():
            supplier = supplier_rows.get(supplier_id)
            if supplier is None:
                raise ValidationError(_("Aucun fournisseur connu pour une ou plusieurs lignes."))
            po = PurchaseOrder.objects.create(
                tenant=tenant,
                supplier=supplier,
                status="draft",
                notes=_("Réassort suggéré"),
                created_by=user,
            )
            total = Decimal("0.00")
            for variant in group:
                quantity = chosen[variant.pk]
                price = variant.product.purchase_price or Decimal("0.00")
                POLine.objects.create(
                    order=po,
                    variant=variant,
                    description=_line_description(variant),
                    quantity_ordered=quantity,
                    agreed_unit_price=price,
                    pairs_per_carton=variant.product.pairs_per_carton or 10,
                )
                total += price * Decimal(quantity)
            po.total_amount = total
            po.save(update_fields=["total_amount"])
            orders.append({
                "id": str(po.pk),
                "supplier_id": str(supplier.pk),
                "supplier_name": supplier.name,
                "line_count": len(group),
            })
    orders.sort(key=lambda row: row["supplier_name"])
    return {"orders": orders}


def _line_description(variant) -> str:
    parts = [variant.product.name]
    if variant.size_eu:
        parts.append(f"EU{variant.size_eu}")
    colour = variant.colour or ""
    if colour and colour not in ("Standard", "N/A"):
        parts.append(colour)
    return " ".join(parts)[:300]
