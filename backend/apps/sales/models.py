"""
Sales models: Sale, SaleItem, Payment, Return, ReturnItem.
All writes create StockMovement records automatically.
"""
from decimal import Decimal

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import Branch, TenantScopedModel


class PaymentMethodChoices(models.TextChoices):
    CASH = "cash", _("Cash")
    CHEQUE = "cheque", _("Cheque")
    CCP = "ccp", _("CCP (Algérie Poste)")
    VIREMENT = "virement", _("Virement Bancaire")
    ACCOUNT = "account", _("Client Account Balance")


class SaleStatusChoices(models.TextChoices):
    COMPLETED = "completed", _("Completed")
    CANCELLED = "cancelled", _("Cancelled")
    REFUNDED = "refunded", _("Refunded")


class Sale(TenantScopedModel):
    """Retail sale header."""
    branch = models.ForeignKey(
        Branch, on_delete=models.PROTECT, related_name="sales", null=True, blank=True
    )
    cashier = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="sales"
    )
    client = models.ForeignKey(
        "clients.Client", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="sales"
    )
    status = models.CharField(
        _("Status"), max_length=12, choices=SaleStatusChoices.choices,
        default=SaleStatusChoices.COMPLETED,
    )
    total_amount = models.DecimalField(
        _("Total (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    discount_amount = models.DecimalField(
        _("Cart Discount"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    notes = models.TextField(_("Notes"), blank=True)
    receipt_number = models.CharField(_("Receipt Number"), max_length=30, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = _("Sale")
        verbose_name_plural = _("Sales")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Sale #{self.receipt_number or self.pk}"

    @property
    def amount_paid(self):
        return self.payments.aggregate(
            total=models.Sum("amount")
        )["total"] or Decimal("0.00")

    @property
    def balance_due(self):
        return self.total_amount - self.amount_paid


class SaleItem(models.Model):
    """Line item within a sale."""
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="sale_items"
    )
    quantity = models.PositiveIntegerField(_("Quantity"), default=1)
    unit_price = models.DecimalField(_("Unit Price (DZD)"), max_digits=12, decimal_places=2)
    discount_amount = models.DecimalField(
        _("Line Discount"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )

    class Meta:
        verbose_name = _("Sale Item")

    def __str__(self):
        return f"{self.variant} × {self.quantity}"

    @property
    def subtotal(self):
        return (self.unit_price * self.quantity) - self.discount_amount


class Payment(models.Model):
    """Payment linked to a sale (can be multiple for split payments)."""
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(_("Amount"), max_digits=12, decimal_places=2)
    method = models.CharField(
        _("Method"), max_length=10, choices=PaymentMethodChoices.choices
    )
    # Cheque-specific fields
    cheque_ref = models.ForeignKey(
        "clients.Cheque", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="sale_payments"
    )
    notes = models.TextField(_("Notes"), blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Payment")

    def __str__(self):
        return f"{self.method} {self.amount} DZD"


class Return(TenantScopedModel):
    """Customer return linked to original sale."""
    original_sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="returns")
    processed_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="returns_processed"
    )
    reason = models.TextField(_("Reason"))
    refund_amount = models.DecimalField(
        _("Refund Amount"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    refund_method = models.CharField(
        _("Refund Method"), max_length=10, choices=PaymentMethodChoices.choices, default=PaymentMethodChoices.CASH
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Return")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Return from {self.original_sale}"


class ReturnItem(models.Model):
    """Item returned within a return."""
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="return_items"
    )
    quantity = models.PositiveIntegerField(_("Quantity"))
    restock = models.BooleanField(_("Return to Stock"), default=True)

    class Meta:
        verbose_name = _("Return Item")
