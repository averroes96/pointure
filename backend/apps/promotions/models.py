import uuid
"""Promotions: scheduled discounts by category, product, or minimum quantity."""
from decimal import Decimal

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel


class Promotion(TenantScopedModel):
    name = models.CharField(_("Name"), max_length=200)
    description = models.TextField(_("Description"), blank=True)
    is_active = models.BooleanField(_("Active"), default=True)
    start_date = models.DateField(_("Start date"))
    end_date = models.DateField(_("End date"), null=True, blank=True)

    # ── Conditions (all non-null conditions must match simultaneously) ─────────
    # Leave blank to match any value for that dimension.
    category = models.CharField(
        _("Category"), max_length=100, blank=True,
        help_text="Match variants whose product.category equals this value. Leave blank to match any category.",
    )
    product = models.ForeignKey(
        "inventory.Product", verbose_name=_("Product"),
        null=True, blank=True, on_delete=models.SET_NULL, related_name="promotions",
        help_text="Restrict to a specific product. Overrides category filter.",
    )
    min_quantity = models.PositiveIntegerField(
        _("Minimum quantity"), null=True, blank=True,
        help_text="Promotion applies only when the cart line has at least this many units.",
    )
    min_amount = models.DecimalField(
        _("Minimum line amount (DZD)"), max_digits=10, decimal_places=2,
        null=True, blank=True,
        help_text="Promotion applies only when unit_price × qty ≥ this amount.",
    )

    # ── Effect — exactly one of discount_pct / discount_amount should be set ──
    discount_pct = models.DecimalField(
        _("Discount %"), max_digits=5, decimal_places=2,
        null=True, blank=True,
        help_text="Percentage discount, e.g. 15 → 15% off the line total.",
    )
    discount_amount = models.DecimalField(
        _("Discount per unit (DZD)"), max_digits=10, decimal_places=2,
        null=True, blank=True,
        help_text="Fixed discount per unit in DZD, e.g. 500 → 500 DZD off per unit.",
    )

    priority = models.PositiveIntegerField(
        _("Priority"), default=0,
        help_text="Higher = wins when multiple promotions match the same line.",
    )
    max_uses = models.PositiveIntegerField(
        _("Max uses"), null=True, blank=True,
        help_text="Total number of sale lines this promotion can be applied to. Null = unlimited.",
    )
    uses_count = models.PositiveIntegerField(_("Uses count"), default=0, editable=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Promotion")
        verbose_name_plural = _("Promotions")
        ordering = ["-priority", "start_date"]

    def __str__(self):
        return self.name

    def compute_discount(self, unit_price: Decimal, qty: int) -> Decimal:
        """Return total line discount in DZD for the given unit price and quantity."""
        if self.discount_pct:
            return (unit_price * qty * self.discount_pct / 100).quantize(Decimal("0.01"))
        if self.discount_amount:
            return (self.discount_amount * qty).quantize(Decimal("0.01"))
        return Decimal("0.00")

    def matches(self, variant, qty: int, line_amount: Decimal = Decimal("0")) -> bool:
        """Return True if all conditions of this promotion match the given variant and qty."""
        if self.product_id and self.product_id != variant.product_id:
            return False
        if self.category and self.category != getattr(variant.product, "category", ""):
            return False
        if self.min_quantity and qty < self.min_quantity:
            return False
        if self.min_amount and line_amount < self.min_amount:
            return False
        return True
