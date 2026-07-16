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
    PARTIALLY_PAID = "partially_paid", _("Partially Paid")


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
        _("Status"), max_length=15, choices=SaleStatusChoices.choices,
        default=SaleStatusChoices.COMPLETED,
    )
    total_amount = models.DecimalField(
        _("Total (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    discount_amount = models.DecimalField(
        _("Cart Discount"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    is_formal = models.BooleanField(_("Formal Invoice"), default=False)
    timbre_fiscal = models.DecimalField(
        _("Fiscal Stamp"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    notes = models.TextField(_("Notes"), blank=True)
    receipt_number = models.CharField(_("Receipt Number"), max_length=30, blank=True, db_index=True)
    due_date = models.DateField(_("Payment Due Date"), null=True, blank=True)
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


class CashReconciliation(TenantScopedModel):
    """End-of-day cash drawer reconciliation — one per date/branch."""
    date = models.DateField(_("Date"))
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reconciliations",
    )
    submitted_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True,
        related_name="submitted_reconciliations",
    )
    approved_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="approved_reconciliations",
    )
    status = models.CharField(
        _("Status"), max_length=20,
        choices=[("pending", "En attente"), ("approved", "Approuvé")],
        default="pending",
    )

    # System snapshot (filled automatically at submission time)
    system_cash = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    system_cheque = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    system_ccp = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    system_virement = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    system_account = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    system_sales_count = models.PositiveIntegerField(default=0)
    system_total_refunds = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))

    # Actual counted amounts
    actual_cash = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    actual_cheque = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    actual_ccp = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    actual_virement = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))

    notes = models.TextField(_("Notes"), blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Cash Reconciliation")
        unique_together = [("tenant", "date", "branch")]
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Reconciliation {self.date} — {self.branch or 'All branches'}"


class Exchange(TenantScopedModel):
    """Returns-as-exchange: customer returns old items and receives new ones in one transaction."""
    original_sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="exchanges")
    processed_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="exchanges_processed"
    )
    reason = models.TextField(_("Reason"), blank=True)
    # Positive when customer owes extra (new items more expensive than returned)
    extra_payment_amount = models.DecimalField(
        _("Extra Payment"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    extra_payment_method = models.CharField(
        _("Extra Payment Method"), max_length=10, choices=PaymentMethodChoices.choices, blank=True
    )
    # Positive when store refunds cash (returned items more expensive than new)
    refund_amount = models.DecimalField(
        _("Cash Refund"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Exchange")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Exchange #{self.pk} from {self.original_sale}"


class ExchangeReturnItem(models.Model):
    """Item returned by the customer as part of an exchange (restocked)."""
    exchange = models.ForeignKey(Exchange, on_delete=models.CASCADE, related_name="returned_items")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="exchange_returns"
    )
    quantity = models.PositiveIntegerField(_("Quantity"))
    unit_price = models.DecimalField(_("Original Unit Price"), max_digits=12, decimal_places=2)

    class Meta:
        verbose_name = _("Exchange Return Item")


class ExchangeNewItem(models.Model):
    """New item given to the customer as part of an exchange (deducted from stock)."""
    exchange = models.ForeignKey(Exchange, on_delete=models.CASCADE, related_name="new_items")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="exchange_new_items"
    )
    quantity = models.PositiveIntegerField(_("Quantity"))
    unit_price = models.DecimalField(_("Unit Price"), max_digits=12, decimal_places=2)

    class Meta:
        verbose_name = _("Exchange New Item")
