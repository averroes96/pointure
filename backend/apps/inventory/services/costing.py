"""Costing services for inventory variants and products."""
from decimal import Decimal


def current_unit_cost(variant) -> Decimal:
    """
    Return the current unit cost for a variant.
    Returns product.pamp if > 0, otherwise product.purchase_price,
    falling back to Decimal('0.00').
    """
    if variant is None:
        return Decimal("0.00")
    product = getattr(variant, "product", None)
    if product is None:
        return Decimal("0.00")
    pamp = getattr(product, "pamp", None)
    if pamp is not None and pamp > Decimal("0.00"):
        return Decimal(str(pamp))
    purchase_price = getattr(product, "purchase_price", None)
    if purchase_price is not None and purchase_price > Decimal("0.00"):
        return Decimal(str(purchase_price))
    return Decimal("0.00")

