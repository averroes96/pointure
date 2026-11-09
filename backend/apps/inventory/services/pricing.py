"""Tier-based pricing helper for inventory products and variants."""
from decimal import Decimal
from typing import Optional


def _positive_decimal(value) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        dec = Decimal(str(value)).quantize(Decimal("0.01"))
    except Exception:
        return None
    return dec if dec > Decimal("0.00") else None


def unit_price_for(variant_or_product, tier: Optional[str] = "detail") -> Decimal:
    """
    Return the catalog unit price for a Variant or Product at the given client price tier.

    Tier fallback rules:
    - ``demi_gros``: ``semi_wholesale_price`` -> ``wholesale_price`` -> ``sale_price``
    - ``gros``: ``wholesale_price`` -> ``semi_wholesale_price`` -> ``sale_price``
    - ``detail`` (default): ``sale_price``
    """
    if variant_or_product is None:
        return Decimal("0.00")

    product = getattr(variant_or_product, "product", None) or variant_or_product

    sale_price = _positive_decimal(getattr(product, "sale_price", None)) or Decimal("0.00")
    semi_wholesale = _positive_decimal(getattr(product, "semi_wholesale_price", None))
    wholesale = _positive_decimal(getattr(product, "wholesale_price", None))

    normalized_tier = (tier or "detail").strip().lower()

    if normalized_tier == "demi_gros":
        if semi_wholesale is not None:
            return semi_wholesale
        if wholesale is not None:
            return wholesale
        return sale_price

    if normalized_tier == "gros":
        if wholesale is not None:
            return wholesale
        if semi_wholesale is not None:
            return semi_wholesale
        return sale_price

    return sale_price

