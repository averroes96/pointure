"""
Invoicing models: Invoice, InvoiceLine, InvoicePayment, DeliveryNote, CreditNote.

Invoice numbering uses SELECT FOR UPDATE to prevent race conditions.
All money values use DecimalField — never float.
"""
from decimal import Decimal

from django.db import models, transaction
from django.utils.translation import gettext_lazy as _

from apps.core.models import Branch, TenantScopedModel


class InvoiceStatusChoices(models.TextChoices):
    DRAFT = "draft", _("Draft")
    SENT = "sent", _("Sent")
    PARTIAL = "partial", _("Partially Paid")
    PAID = "paid", _("Paid")
    OVERDUE = "overdue", _("Overdue")
    CANCELLED = "cancelled", _("Cancelled")


class InvoicePaymentMethodChoices(models.TextChoices):
    CASH = "cash", _("Cash")
    CHEQUE = "cheque", _("Cheque")
    CCP = "ccp", _("CCP")
    VIREMENT = "virement", _("Virement")


# ─────────────────────────────────────────────
# Invoice Number Generator
# ─────────────────────────────────────────────

class InvoiceCounter(models.Model):
    """
    Per-tenant, per-year, per-prefix sequence counter.
    Uses SELECT FOR UPDATE to prevent race conditions on concurrent creation.
    """
    tenant = models.ForeignKey("core.Tenant", on_delete=models.CASCADE)
    prefix = models.CharField(max_length=20, default="FA")
    year = models.IntegerField()
    last_sequence = models.IntegerField(default=0)

    class Meta:
        unique_together = [["tenant", "prefix", "year"]]

    @classmethod
    @transaction.atomic
    def next_number(cls, tenant, prefix="FA"):
        """
        Get and increment the next invoice number atomically.
        Returns e.g. "FA-2026-00147"
        """
        from django.utils import timezone
        year = timezone.now().year

        counter, _ = cls.objects.select_for_update().get_or_create(
            tenant=tenant,
            prefix=prefix,
            year=year,
            defaults={"last_sequence": 0},
        )
        counter.last_sequence += 1
        counter.save(update_fields=["last_sequence"])
        return f"{prefix}-{year}-{counter.last_sequence:05d}"


# ─────────────────────────────────────────────
# Invoice
# ─────────────────────────────────────────────

class Invoice(TenantScopedModel):
    """Wholesale invoice — the primary financial document."""
    client = models.ForeignKey(
        "clients.Client", on_delete=models.PROTECT, related_name="invoices", null=True, blank=True
    )
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )
    number = models.CharField(_("Invoice Number"), max_length=30, blank=True, db_index=True)
    series_prefix = models.CharField(_("Series Prefix"), max_length=20, default="FA")
    date = models.DateField(_("Invoice Date"), db_index=True)
    due_date = models.DateField(_("Due Date"))
    status = models.CharField(
        _("Status"), max_length=12, choices=InvoiceStatusChoices.choices,
        default=InvoiceStatusChoices.DRAFT,
    )

    # Financial totals
    total_ht = models.DecimalField(
        _("Total HT (ex-TVA)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    tva_rate = models.DecimalField(
        _("TVA Rate %"), max_digits=5, decimal_places=2, default=Decimal("19.00")
    )
    tva_amount = models.DecimalField(
        _("TVA Amount"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    total_ttc = models.DecimalField(
        _("Total TTC (incl. TVA)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    apply_tva = models.BooleanField(_("Apply TVA"), default=True)

    notes = models.TextField(_("Notes"), blank=True)
    pdf_file = models.FileField(_("PDF File"), upload_to="invoices/pdf/", blank=True, null=True)
    created_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="invoices_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Invoice")
        verbose_name_plural = _("Invoices")
        ordering = ["-date", "-number"]

    def __str__(self):
        return f"Invoice {self.number or self.pk}"

    def save(self, *args, **kwargs):
        # Auto-assign invoice number on first save (when moving out of draft)
        if not self.number and self.status != InvoiceStatusChoices.DRAFT:
            self.number = InvoiceCounter.next_number(self.tenant, self.series_prefix)
        # Only recompute line totals on UPDATE — on initial INSERT there are no
        # lines yet (FK needs a PK to exist first). Callers must call
        # compute_totals() + save(update_fields=...) after adding lines.
        if self.pk:
            self.compute_totals()
        super().save(*args, **kwargs)
        # Update client ledger
        self._sync_client_ledger()

    def compute_totals(self):
        """Recompute total_ht, tva_amount, total_ttc from line items."""
        total_ht = sum(line.line_total for line in self.lines.all())
        self.total_ht = total_ht
        if self.apply_tva:
            self.tva_amount = (total_ht * self.tva_rate / 100).quantize(Decimal("0.01"))
        else:
            self.tva_amount = Decimal("0.00")
        self.total_ttc = self.total_ht + self.tva_amount

    def confirm(self):
        """Assign invoice number and set status to sent."""
        if self.status == InvoiceStatusChoices.DRAFT:
            with transaction.atomic():
                self.number = InvoiceCounter.next_number(self.tenant, self.series_prefix)
                self.status = InvoiceStatusChoices.SENT
                self.save(update_fields=["number", "status"])

    def _sync_client_ledger(self):
        """Create or update a client ledger debit entry for this invoice."""
        if not self.client:
            return
        if self.status in (InvoiceStatusChoices.DRAFT, InvoiceStatusChoices.CANCELLED):
            return
        from apps.clients.models import ClientLedger
        ClientLedger.objects.update_or_create(
            client=self.client,
            reference_type="Invoice",
            reference_id=str(self.pk),
            defaults={
                "entry_type": "debit",
                "amount": self.total_ttc,
                "description": f"Invoice {self.number}",
                "date": self.date,
            },
        )

    @property
    def total_paid(self):
        return self.payments.aggregate(
            total=models.Sum("amount")
        )["total"] or Decimal("0.00")

    @property
    def balance_due(self):
        return self.total_ttc - self.total_paid


class InvoiceLine(models.Model):
    """One line item on an invoice."""
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoice_lines"
    )
    description = models.CharField(_("Description"), max_length=300)
    quantity = models.DecimalField(_("Quantity"), max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(_("Unit Price HT"), max_digits=12, decimal_places=2)
    discount_pct = models.DecimalField(
        _("Discount %"), max_digits=5, decimal_places=2, default=Decimal("0.00")
    )
    order = models.PositiveSmallIntegerField(_("Order"), default=0)

    class Meta:
        ordering = ["order", "pk"]

    @property
    def line_total(self):
        subtotal = self.unit_price * self.quantity
        discount = subtotal * self.discount_pct / 100
        return subtotal - discount

    def __str__(self):
        return f"{self.description} × {self.quantity}"


class InvoicePayment(models.Model):
    """Payment recorded against an invoice."""
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(_("Amount"), max_digits=12, decimal_places=2)
    method = models.CharField(
        _("Method"), max_length=10, choices=InvoicePaymentMethodChoices.choices
    )
    cheque_ref = models.ForeignKey(
        "clients.Cheque", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoice_payments"
    )
    recorded_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="invoice_payments"
    )
    date = models.DateField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"{self.method} {self.amount} on {self.invoice}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Update invoice status based on payments
        self._update_invoice_status()
        # Record credit in client ledger
        self._record_client_credit()

    def _update_invoice_status(self):
        inv = self.invoice
        paid = inv.total_paid
        if paid >= inv.total_ttc:
            new_status = InvoiceStatusChoices.PAID
        elif paid > 0:
            new_status = InvoiceStatusChoices.PARTIAL
        else:
            return
        Invoice.objects.filter(pk=inv.pk).update(status=new_status)

    def _record_client_credit(self):
        if not self.invoice.client:
            return
        from apps.clients.models import ClientLedger
        ClientLedger.objects.create(
            client=self.invoice.client,
            entry_type="credit",
            amount=self.amount,
            description=f"Payment on Invoice {self.invoice.number}",
            reference_type="InvoicePayment",
            reference_id=str(self.pk),
            date=self.date,
        )


class DeliveryNote(TenantScopedModel):
    """Bon de livraison — lists delivered quantities."""
    client = models.ForeignKey("clients.Client", on_delete=models.PROTECT, related_name="delivery_notes", null=True, blank=True)
    invoice = models.ForeignKey(Invoice, on_delete=models.SET_NULL, null=True, blank=True, related_name="delivery_notes")
    number = models.CharField(_("BL Number"), max_length=30)
    date = models.DateField()
    delivered_by = models.CharField(_("Delivered By"), max_length=150, blank=True)
    received_by_signature = models.TextField(_("Signature (base64)"), blank=True)
    notes = models.TextField(blank=True)
    pdf_file = models.FileField(upload_to="delivery_notes/pdf/", blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"BL {self.number}"

class DeliveryNoteLine(models.Model):
    """One line item on a delivery note."""
    delivery_note = models.ForeignKey(DeliveryNote, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="delivery_note_lines"
    )
    description = models.CharField(_("Description"), max_length=300)
    quantity = models.DecimalField(_("Quantity"), max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(_("Unit Price HT"), max_digits=12, decimal_places=2, default=Decimal("0.00"))
    discount_pct = models.DecimalField(_("Discount %"), max_digits=5, decimal_places=2, default=Decimal("0.00"))
    order = models.PositiveSmallIntegerField(_("Order"), default=0)

    class Meta:
        ordering = ["order", "pk"]

    def __str__(self):
        return f"{self.description} × {self.quantity}"


class CreditNote(TenantScopedModel):
    """Avoir — issued on returns, adjusts client balance."""
    original_invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="credit_notes"
    )
    number = models.CharField(_("Credit Note Number"), max_length=30, blank=True)
    reason = models.TextField(_("Reason"))
    total_ht = models.DecimalField(max_digits=12, decimal_places=2)
    tva_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    total_ttc = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    pdf_file = models.FileField(upload_to="credit_notes/pdf/", blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Avoir {self.number} on {self.original_invoice}"
