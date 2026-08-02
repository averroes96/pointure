import uuid
"""Supplier models: Supplier, PurchaseOrder, POLine, SupplierInvoice, SupplierPayment."""
from decimal import Decimal

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel


class POStatusChoices(models.TextChoices):
    DRAFT = "draft", _("Draft")
    SENT = "sent", _("Sent to Supplier")
    PARTIAL = "partial", _("Partially Received")
    RECEIVED = "received", _("Fully Received")
    CANCELLED = "cancelled", _("Cancelled")


class Supplier(TenantScopedModel):
    name = models.CharField(_("Name"), max_length=200)
    contact_name = models.CharField(_("Contact"), max_length=150, blank=True)
    phone = models.CharField(_("Phone"), max_length=20, blank=True)
    email = models.EmailField(_("Email"), blank=True)
    address = models.TextField(_("Address"), blank=True)
    origin_country = models.CharField(_("Origin Country"), max_length=100, blank=True)
    payment_terms = models.CharField(_("Payment Terms"), max_length=200, blank=True)
    outstanding_balance = models.DecimalField(
        _("Outstanding Balance Owed"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Supplier")
        ordering = ["name"]

    def __str__(self):
        return self.name

    def recompute_balance(self):
        from django.db.models import Sum
        from django.db.models.functions import Coalesce
        from decimal import Decimal
        invoiced = self.invoices.aggregate(t=Coalesce(Sum("total_amount"), Decimal("0")))["t"]
        paid = self.payments.aggregate(t=Coalesce(Sum("amount"), Decimal("0")))["t"]
        claimed = self.return_claims.filter(credit_note_applied=True).aggregate(t=Coalesce(Sum("total_amount"), Decimal("0")))["t"]
        self.outstanding_balance = invoiced - paid - claimed
        self.save(update_fields=["outstanding_balance"])


class ClaimStatusChoices(models.TextChoices):
    DRAFT = "draft", _("Draft")
    SENT = "sent", _("Sent to Supplier")
    ACCEPTED = "accepted", _("Accepted / Credit Applied")
    REJECTED = "rejected", _("Rejected")


class SupplierReturnClaim(TenantScopedModel):
    """
    Bon de Retour Défectueux / Demande d'Avoir Fournisseur.
    Groups quarantined defect items for a supplier and allows generating a return slip and debiting balance.
    """
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="return_claims")
    claim_number = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=20, choices=ClaimStatusChoices.choices, default=ClaimStatusChoices.DRAFT)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    credit_note_applied = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Supplier Return Claim")
        verbose_name_plural = _("Supplier Return Claims")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.claim_number or 'Claim'} — {self.supplier.name}"

    def save(self, *args, **kwargs):
        is_new = not self.pk
        super().save(*args, **kwargs)
        if (is_new or not self.claim_number) and self.pk:
            seq = str(self.pk).replace("-", "")[:8].upper()
            self.claim_number = f"RET-{seq}"
            SupplierReturnClaim.objects.filter(pk=self.pk).update(claim_number=self.claim_number)


class PurchaseOrder(TenantScopedModel):
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    status = models.CharField(max_length=12, choices=POStatusChoices.choices, default=POStatusChoices.DRAFT)
    expected_date = models.DateField(null=True, blank=True)
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    created_by = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Purchase Order")
        ordering = ["-created_at"]

    def __str__(self):
        return f"PO #{self.pk} — {self.supplier}"


class POLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey("inventory.Variant", on_delete=models.PROTECT, null=True, blank=True)
    description = models.CharField(max_length=300)
    quantity_ordered = models.PositiveIntegerField()
    quantity_received = models.IntegerField(default=0)
    cartons = models.PositiveIntegerField(default=0)
    pairs_per_carton = models.PositiveIntegerField(default=10)
    agreed_unit_price = models.DecimalField(max_digits=12, decimal_places=2)

    @property
    def line_total(self):
        return self.agreed_unit_price * self.quantity_ordered


class SupplierInvoice(TenantScopedModel):
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="invoices")
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.SET_NULL, null=True, blank=True)
    invoice_number = models.CharField(max_length=100)
    date = models.DateField()
    due_date = models.DateField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Supplier Invoice {self.invoice_number} — {self.supplier}"


class SupplierPayment(TenantScopedModel):
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="payments")
    supplier_invoice = models.ForeignKey(SupplierInvoice, on_delete=models.SET_NULL, null=True, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=10, choices=[
        ("cash", "Cash"), ("cheque", "Cheque"), ("virement", "Virement"),
    ])
    cheque_number = models.CharField(max_length=30, blank=True)
    bank = models.CharField(max_length=100, blank=True)
    due_date = models.DateField(null=True, blank=True)
    date = models.DateField()
    notes = models.TextField(blank=True)
    recorded_by = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
