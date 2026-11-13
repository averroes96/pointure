"""
Size-curve report and broken size-run detection.

Core sizes are the sizes that cover at least 70% of a product's net sales
over 52 weeks, largest first. With no sales of its own, a product uses the
category curve, then the gender curve, then DEFAULT_CORE_SIZES.
"""
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import F, Sum
from django.db.models.functions import Greatest

TWOPLACES = Decimal("0.01")
CORE_SHARE = Decimal("0.70")
CORE_WEEKS = 52
SOLD_STATUSES = ("completed", "partially_paid")
OPEN_PO_STATUSES = ("sent", "partial")

# Used only when the store has no sales history for that gender.
DEFAULT_CORE_SIZES = {
    "M": (40, 41, 42, 43),
    "F": (37, 38, 39, 40),
    "K": (28, 30, 32, 34),
    "U": (39, 40, 41, 42),
}


def select_core_sizes(sold_by_size: dict[int, int]) -> list[int]:
    """Sizes that cover CORE_SHARE of positive net sales, largest first."""
    positive = {size: qty for size, qty in sold_by_size.items() if qty > 0 and size > 0}
    total = sum(positive.values())
    if total <= 0:
        return []
    ordered = sorted(positive.items(), key=lambda item: (-item[1], item[0]))
    chosen = []
    running = 0
    for size, qty in ordered:
        chosen.append(size)
        running += qty
        if Decimal(running) / Decimal(total) >= CORE_SHARE:
            break
    return sorted(chosen)


def _money(value: Decimal) -> str:
    return str(value.quantize(TWOPLACES, rounding=ROUND_HALF_UP))


def _apply_product_filters(qs, prefix, *, product_id, brand, category, gender):
    if product_id:
        qs = qs.filter(**{f"{prefix}__id": product_id})
    if brand:
        qs = qs.filter(**{f"{prefix}__brand__iexact": brand})
    if category:
        qs = qs.filter(**{f"{prefix}__category": category})
    if gender:
        qs = qs.filter(**{f"{prefix}__gender": gender})
    return qs


def _net_by_key(tenant, start, today, key_fields, *, product_id=None, brand="", category="", gender=""):
    from apps.sales.models import ReturnItem, SaleItem

    sales = SaleItem.objects.filter(
        sale__tenant=tenant,
        sale__status__in=SOLD_STATUSES,
        sale__created_at__date__gte=start,
        sale__created_at__date__lte=today,
    )
    sales = _apply_product_filters(
        sales, "variant__product",
        product_id=product_id, brand=brand, category=category, gender=gender,
    )
    sold = {
        _key(row, key_fields): row["qty"] or 0
        for row in sales.values(*key_fields).annotate(qty=Sum("quantity"))
    }

    returns = ReturnItem.objects.filter(
        return_obj__tenant=tenant,
        return_obj__original_sale__status__in=SOLD_STATUSES,
        return_obj__created_at__date__gte=start,
        return_obj__created_at__date__lte=today,
    )
    returns = _apply_product_filters(
        returns, "variant__product",
        product_id=product_id, brand=brand, category=category, gender=gender,
    )
    returned = {
        _key(row, key_fields): row["qty"] or 0
        for row in returns.values(*key_fields).annotate(qty=Sum("quantity"))
    }

    keys = set(sold) | set(returned)
    return {key: sold.get(key, 0) - returned.get(key, 0) for key in keys}


def _key(row, fields):
    values = tuple(row[field] for field in fields)
    return values[0] if len(values) == 1 else values


def build_size_curve(tenant, *, today, product_id=None, brand="", category="", gender="", weeks=8):
    from apps.inventory.models import Product, Variant
    from apps.suppliers.models import POLine

    weeks = int(weeks)
    window_start = today - timedelta(days=weeks * 7)
    core_start = today - timedelta(days=CORE_WEEKS * 7)
    filters = {
        "product_id": product_id,
        "brand": brand or "",
        "category": category or "",
        "gender": gender or "",
    }

    sold_by_size = _net_by_key(
        tenant, window_start, today, ("variant__size_eu",), **filters,
    )
    stock_qs = Variant.objects.filter(tenant=tenant)
    if not product_id:
        stock_qs = stock_qs.filter(product__is_active=True)
    stock_qs = _apply_product_filters(stock_qs, "product", **filters)
    stock_by_size = {
        row["size_eu"]: row["qty"] or 0
        for row in stock_qs.values("size_eu").annotate(qty=Sum("stock_qty"))
    }

    order_qs = POLine.objects.filter(
        order__tenant=tenant,
        order__status__in=OPEN_PO_STATUSES,
        variant__isnull=False,
    )
    if not product_id:
        order_qs = order_qs.filter(variant__product__is_active=True)
    order_qs = _apply_product_filters(order_qs, "variant__product", **filters)
    on_order_by_size = {
        row["variant__size_eu"]: row["qty"] or 0
        for row in order_qs.values("variant__size_eu").annotate(
            qty=Sum(Greatest(F("quantity_ordered") - F("quantity_received"), 0))
        )
    }

    sizes = sorted(
        set(sold_by_size) | set(stock_by_size) | set(on_order_by_size),
        key=lambda size: (size is None, size),
    )
    positive_total = sum(qty for qty in sold_by_size.values() if qty > 0)
    size_rows = []
    for size in sizes:
        sold = int(sold_by_size.get(size, 0))
        stock = int(stock_by_size.get(size, 0))
        on_order = int(on_order_by_size.get(size, 0))
        if positive_total > 0 and sold > 0:
            share = (Decimal(sold) / Decimal(positive_total) * Decimal("100"))
        else:
            share = Decimal("0")
        if sold > 0:
            cover = (Decimal(stock) * Decimal(weeks) / Decimal(sold))
            cover_text = _money(cover)
        else:
            cover_text = None
        denominator = sold + max(stock, 0)
        if sold > 0 and denominator > 0:
            sell_through = Decimal(sold) / Decimal(denominator) * Decimal("100")
        else:
            sell_through = Decimal("0")
        size_rows.append({
            "size_eu": size,
            "units_sold": sold,
            "sales_share": _money(share),
            "stock": stock,
            "on_order": on_order,
            "weeks_of_cover": cover_text,
            "sell_through_pct": _money(sell_through),
        })

    broken = _broken_products(tenant, today, core_start, filters)
    return {"weeks": weeks, "sizes": size_rows, "broken": broken}


def _broken_products(tenant, today, core_start, filters):
    from apps.inventory.models import Product, Variant

    product_id = filters["product_id"]
    products = Product.objects.filter(tenant=tenant)
    if product_id:
        products = products.filter(pk=product_id)
    else:
        products = products.filter(is_active=True)
    if filters["brand"]:
        products = products.filter(brand__iexact=filters["brand"])
    if filters["category"]:
        products = products.filter(category=filters["category"])
    if filters["gender"]:
        products = products.filter(gender=filters["gender"])

    product_rows = list(products.only(
        "id", "name", "brand", "category", "gender", "pamp", "purchase_price",
    ))
    if not product_rows:
        return []

    stock_rows = (
        Variant.objects.filter(tenant=tenant, product__in=product_rows)
        .values("product_id", "size_eu")
        .annotate(qty=Sum("stock_qty"))
    )
    stock = {}
    real_sizes = set()
    for row in stock_rows:
        stock.setdefault(row["product_id"], {})[row["size_eu"]] = row["qty"] or 0
        if row["size_eu"] and row["size_eu"] > 0:
            real_sizes.add(row["product_id"])

    own_sales = _net_by_key(
        tenant, core_start, today,
        ("variant__product_id", "variant__size_eu"),
        product_id=product_id,
        brand=filters["brand"],
        category=filters["category"],
        gender=filters["gender"],
    )
    by_product = {}
    for (pid, size), qty in own_sales.items():
        by_product.setdefault(pid, {})[size] = qty

    category_sales = _net_by_key(
        tenant, core_start, today,
        ("variant__product__category", "variant__size_eu"),
    )
    by_category = {}
    for (cat, size), qty in category_sales.items():
        by_category.setdefault(cat, {})[size] = qty

    gender_sales = _net_by_key(
        tenant, core_start, today,
        ("variant__product__gender", "variant__size_eu"),
    )
    by_gender = {}
    for (gen, size), qty in gender_sales.items():
        by_gender.setdefault(gen, {})[size] = qty

    broken = []
    for product in product_rows:
        if product.id not in real_sizes:
            continue
        sizes_stock = stock.get(product.id, {})
        pairs = sum(qty for qty in sizes_stock.values() if qty > 0)
        if pairs <= 0:
            continue
        own = select_core_sizes(by_product.get(product.id, {}))
        category_core = select_core_sizes(by_category.get(product.category, {}))
        gender_core = select_core_sizes(by_gender.get(product.gender, {}))
        if own:
            core, basis = own, "product"
        elif category_core:
            core, basis = category_core, "category"
        elif gender_core:
            core, basis = gender_core, "gender"
        else:
            core = list(DEFAULT_CORE_SIZES.get(product.gender, DEFAULT_CORE_SIZES["U"]))
            basis = "default"
        missing = [size for size in core if sizes_stock.get(size, 0) <= 0]
        if not missing:
            continue
        cost = product.pamp if product.pamp and product.pamp > 0 else product.purchase_price
        cost = cost or Decimal("0")
        broken.append({
            "product_id": str(product.id),
            "name": product.name,
            "brand": product.brand,
            "core_sizes": core,
            "missing_sizes": missing,
            "basis": basis,
            "stock_pairs": pairs,
            "stock_value": _money(Decimal(pairs) * Decimal(cost)),
        })
    broken.sort(key=lambda row: (-Decimal(row["stock_value"]), row["name"]))
    return broken
