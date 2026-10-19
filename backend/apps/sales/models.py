import uuid
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
    TPE = "tpe", _("TPE (Carte CIB / Edahabia)")
    BARIDIMOB = "baridimob", _("BaridiMob")


class CashSessionStatus(models.TextChoices):
    OPEN = "open", _("Ouverte")
    CLOSED = "closed", _("Clôturée")


class CashMovementType(models.TextChoices):
    IN = "in", _("Entrée de caisse (Apport)")
    OUT = "out", _("Sortie de caisse (Dépense / Retrait)")


class SaleStatusChoices(models.TextChoices):
    COMPLETED = "completed", _("Completed")
    CANCELLED = "cancelled", _("Cancelled")
    REFUNDED = "refunded", _("Refunded")
    PARTIALLY_PAID = "partially_paid", _("Partially Paid")
    LAYAWAY = "layaway", _("Mise de côté (Réservation)")


class Sale(TenantScopedModel):
    """Retail sale header."""
    branch = models.ForeignKey(
        Branch, on_delete=models.PROTECT, related_name="sales", null=True, blank=True
    )
    session = models.ForeignKey(
        "sales.CashSession", on_delete=models.SET_NULL, null=True, blank=True, related_name="sales"
    )
    cashier = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="sales"
    )
    authorized_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="authorized_sales",
        help_text=_("Manager who authorized this sale (e.g. discount override or price edit)"),
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
    is_layaway = models.BooleanField(
        _("Mise de côté (Layaway)"), default=False, db_index=True
    )
    layaway_expires_at = models.DateField(
        _("Date limite de réservation"), null=True, blank=True, db_index=True
    )
    layaway_collected_at = models.DateTimeField(
        _("Date de remise client"), null=True, blank=True
    )
    layaway_deposit_forfeited = models.BooleanField(
        _("Acompte conservé lors de l'annulation"), default=False
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = _("Sale")
        verbose_name_plural = _("Sales")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Sale #{self.receipt_number or self.pk}"

    def save(self, *args, **kwargs):
        if not self.pk and not self.created_at:
            try:
                from apps.core.services.time_service import get_trusted_now
                self.created_at = get_trusted_now()
            except Exception:
                pass
        super().save(*args, **kwargs)

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
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(_("Amount"), max_digits=12, decimal_places=2)
    method = models.CharField(
        _("Method"), max_length=20, choices=PaymentMethodChoices.choices
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
    session = models.ForeignKey(
        "sales.CashSession", on_delete=models.SET_NULL, null=True, blank=True, related_name="returns"
    )
    processed_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="returns_processed"
    )
    authorized_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="authorized_returns",
        help_text=_("Manager who approved this return with PIN"),
    )
    reason = models.TextField(_("Reason"))
    refund_amount = models.DecimalField(
        _("Refund Amount"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    refund_method = models.CharField(
        _("Refund Method"), max_length=20, choices=PaymentMethodChoices.choices, default=PaymentMethodChoices.CASH
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Return")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Return from {self.original_sale}"


class ReturnItem(models.Model):
    """Item returned within a return."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="return_items"
    )
    quantity = models.PositiveIntegerField(_("Quantity"))
    restock = models.BooleanField(_("Return to Stock"), default=True)
    is_defective = models.BooleanField(_("Is Defective"), default=False)
    defect_reason = models.CharField(_("Defect Reason"), max_length=30, blank=True, default="")
    defect_notes = models.TextField(_("Defect Notes"), blank=True, default="")

    class Meta:
        verbose_name = _("Return Item")


class CashSession(TenantScopedModel):
    """
    Cash Register Session (Shift / Caisse).
    Represents an active or closed shift with opening float, sales, petty cash movements,
    and end-of-shift cash drawer count with Z-Report generation.
    """
    branch = models.ForeignKey(
        Branch, on_delete=models.PROTECT, related_name="cash_sessions", null=True, blank=True
    )
    cashier = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, related_name="cash_sessions"
    )
    session_number = models.PositiveIntegerField(_("Session / Z Number"), default=0, db_index=True)
    status = models.CharField(
        _("Status"), max_length=10, choices=CashSessionStatus.choices, default=CashSessionStatus.OPEN, db_index=True
    )
    opened_at = models.DateTimeField(_("Opened At"), auto_now_add=True)
    closed_at = models.DateTimeField(_("Closed At"), null=True, blank=True)
    closed_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="closed_cash_sessions"
    )

    # Initial cash in drawer
    opening_float = models.DecimalField(
        _("Opening Cash Float (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )

    # System snapshot computed on close
    system_sales_count = models.PositiveIntegerField(default=0)
    system_total_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_cash_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_tpe_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_baridimob_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_cheque_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_ccp_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_virement_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_account_sales = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_refunds_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    system_refunds_count = models.PositiveIntegerField(default=0)

    # Cash drawer movements during shift
    total_cash_in = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_cash_out = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    # Theoretical cash expected in drawer
    expected_cash = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    # Actual physical count by cashier on close
    actual_cash = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    actual_tpe = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    actual_baridimob = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    actual_cheque = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    actual_ccp = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    actual_virement = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    # Discrepancy (actual_cash - expected_cash)
    cash_gap = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    closing_notes = models.TextField(_("Closing Notes"), blank=True)

    # Manager / Owner approval
    approved_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_cash_sessions"
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _("Cash Session")
        verbose_name_plural = _("Cash Sessions")
        ordering = ["-opened_at"]

    def __str__(self):
        return f"Session Z-{self.session_number:04d} ({self.get_status_display()}) — {self.cashier}"

    def save(self, *args, **kwargs):
        if self._state.adding and (not self.session_number or self.session_number == 0):
            max_num = (
                CashSession.objects.filter(tenant=self.tenant)
                .aggregate(models.Max("session_number"))["session_number__max"]
                or 0
            )
            self.session_number = max_num + 1
        super().save(*args, **kwargs)


class CashMovement(models.Model):
    """
    Petty cash movement inside an open cash session (Apport / Dépense / Retrait coffre).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(CashSession, on_delete=models.CASCADE, related_name="movements")
    type = models.CharField(max_length=5, choices=CashMovementType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.CharField(
        _("Category / Reason"), max_length=50,
        help_text="e.g. Dépense magasin, Paiement fournisseur, Retrait patron, Apport monnaie"
    )
    notes = models.TextField(_("Notes"), blank=True)
    created_by = models.ForeignKey("core.User", on_delete=models.PROTECT, related_name="cash_movements")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Cash Movement")
        verbose_name_plural = _("Cash Movements")
        ordering = ["-created_at"]

    def __str__(self):
        sign = "+" if self.type == "in" else "-"
        return f"{sign}{self.amount} DZD ({self.category})"


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

    # Actual counted amounts & movements
    opening_float = models.DecimalField(_("Opening Cash Float"), max_digits=12, decimal_places=2, default=Decimal("0"))
    expenses = models.DecimalField(_("Petty Cash Expenses"), max_digits=12, decimal_places=2, default=Decimal("0"))
    cash_drops = models.DecimalField(_("Cash Drops / Safe Deposit"), max_digits=12, decimal_places=2, default=Decimal("0"))
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
    authorized_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="authorized_exchanges",
        help_text=_("Manager who approved this exchange with PIN"),
    )
    reason = models.TextField(_("Reason"), blank=True)
    # Positive when customer owes extra (new items more expensive than returned)
    extra_payment_amount = models.DecimalField(
        _("Extra Payment"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    extra_payment_method = models.CharField(
        _("Extra Payment Method"), max_length=20, choices=PaymentMethodChoices.choices, blank=True
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exchange = models.ForeignKey(Exchange, on_delete=models.CASCADE, related_name="returned_items")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="exchange_returns"
    )
    quantity = models.PositiveIntegerField(_("Quantity"))
    unit_price = models.DecimalField(_("Original Unit Price"), max_digits=12, decimal_places=2)
    is_defective = models.BooleanField(_("Is Defective"), default=False)
    defect_reason = models.CharField(_("Defect Reason"), max_length=30, blank=True, default="")
    defect_notes = models.TextField(_("Defect Notes"), blank=True, default="")

    class Meta:
        verbose_name = _("Exchange Return Item")


class ExchangeNewItem(models.Model):
    """New item given to the customer as part of an exchange (deducted from stock)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exchange = models.ForeignKey(Exchange, on_delete=models.CASCADE, related_name="new_items")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="exchange_new_items"
    )
    quantity = models.PositiveIntegerField(_("Quantity"))
    unit_price = models.DecimalField(_("Unit Price"), max_digits=12, decimal_places=2)

    class Meta:
        verbose_name = _("Exchange New Item")
