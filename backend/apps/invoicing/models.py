import uuid
"""
Invoicing models: Invoice, InvoiceLine, InvoicePayment, DeliveryNote, CreditNote.

Invoice numbering uses SELECT FOR UPDATE to prevent race conditions.
All money values use DecimalField — never float.
"""
from decimal import Decimal

from django.db import models, transaction
from django.utils.translation import gettext_lazy as _

from apps.core.models import Branch, TenantScopedModel


def _assert_client_not_blocked(client_id, tenant, message):
    if not client_id:
        return

    from django.core.exceptions import ValidationError
    from apps.clients.models import Client

    client = Client.objects.select_for_update().only("is_blocked").get(
        pk=client_id,
        tenant=tenant,
    )
    if client.is_blocked:
        raise ValidationError({"client": message})


class InvoiceStatusChoices(models.TextChoices):
    DRAFT = "draft", _("Draft")
    SENT = "sent", _("Sent")
    PARTIAL = "partial", _("Partially Paid")
    PAID = "paid", _("Paid")
    OVERDUE = "overdue", _("Overdue")
    CANCELLED = "cancelled", _("Cancelled")


class QuoteStatusChoices(models.TextChoices):
    DRAFT = "draft", _("Draft")
    SENT = "sent", _("Sent")
    ACCEPTED = "accepted", _("Accepted")
    EXPIRED = "expired", _("Expired")
    CONVERTED = "converted", _("Converted")
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("core.Tenant", on_delete=models.CASCADE)
    prefix = models.CharField(max_length=20, default="FA")
    year = models.IntegerField()
    last_sequence = models.IntegerField(default=0)

    class Meta:
        unique_together = [["tenant", "prefix", "year"]]

    @classmethod
    @transaction.atomic
    def next_number(cls, tenant, prefix="FA", date=None, year=None):
        """
        Get and increment the next invoice number atomically.
        Returns e.g. "FA-2026-00147"
        Uses document date's year (or explicitly passed year), defaulting to timezone.now().year.
        """
        from django.utils import timezone
        if year is None:
            if date is not None:
                year = date.year if hasattr(date, "year") else int(str(date)[:4])
            else:
                year = timezone.localdate().year

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
    is_formal = models.BooleanField(_("Formal Invoice"), default=True)
    is_paid_in_cash = models.BooleanField(_("Paid in Cash"), default=False)
    timbre_fiscal = models.DecimalField(
        _("Fiscal Stamp"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )

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
        if self.date:
            from apps.closing.services.lock import assert_period_open
            assert_period_open(self.tenant, self.date)
        # Auto-assign invoice number on first save (when moving out of draft)
        if not self.number and self.status != InvoiceStatusChoices.DRAFT:
            self.number = InvoiceCounter.next_number(self.tenant, self.series_prefix, date=self.date)
        # Only recompute line totals on UPDATE — on initial INSERT there are no
        # lines yet (FK needs a PK to exist first). Callers must call
        # compute_totals() + save(update_fields=...) after adding lines.
        if self.pk:
            self.compute_totals()
        super().save(*args, **kwargs)
        # Update client ledger
        self._sync_client_ledger()

    def compute_totals(self):
        """Recompute total_ht, tva_amount, total_ttc, and timbre_fiscal from line items."""
        total_ht = sum(line.line_total for line in self.lines.all())
        self.total_ht = total_ht
        if self.apply_tva:
            self.tva_amount = (total_ht * self.tva_rate / 100).quantize(Decimal("0.01"))
        else:
            self.tva_amount = Decimal("0.00")
        
        base_ttc = self.total_ht + self.tva_amount
        
        if self.is_formal and self.is_paid_in_cash:
            timbre = base_ttc * Decimal("0.01")
            self.timbre_fiscal = min(timbre, Decimal("2500.00")).quantize(Decimal("0.01"))
        else:
            self.timbre_fiscal = Decimal("0.00")
            
        self.total_ttc = base_ttc + self.timbre_fiscal

    def confirm(self, user=None):
        """Assign invoice number and set status based on payments."""
        if self.status == InvoiceStatusChoices.DRAFT:
            with transaction.atomic():
                _assert_client_not_blocked(
                    self.client_id,
                    self.tenant,
                    _("Ce client est bloqué. Impossible de confirmer la facture."),
                )
                if self.date:
                    from apps.closing.services.lock import assert_period_open
                    assert_period_open(self.tenant, self.date)
                self.number = InvoiceCounter.next_number(self.tenant, self.series_prefix, date=self.date)
                self.status = InvoiceStatusChoices.SENT
                self.save(update_fields=["number", "status"])
                self.update_status()
                # Deduct inventory immediately for non-draft invoices
                self._deduct_inventory(user=user)

    def _deduct_inventory(self, lines=None, user=None):
        """Deduct stock for all invoice lines. Called on create/confirm for non-draft invoices."""
        if not self.branch:
            return
        from apps.inventory.models import StockMovement
        for line in (lines or self.lines.all()):
            if line.variant:
                StockMovement.objects.create(
                    tenant=self.tenant,
                    branch=self.branch,
                    variant=line.variant,
                    reason="sale",
                    quantity_delta=-int(line.quantity),
                    reference_id=self.number or str(self.pk),
                    reference_type="invoice",
                    user=user or self.created_by,
                    notes=f"Facture {self.number or self.pk}"
                )
                line.variant.refresh_stock()
                if self.branch:
                    line.variant.refresh_stock(branch=self.branch)

    def _restore_inventory(self, lines=None, ref_prefix="CANCEL", user=None):
        """Restore stock for all invoice lines. Called on cancel/edit."""
        if not self.branch:
            return
        from apps.inventory.models import StockMovement
        # Guard against phantom stock: only restore if stock was actually deducted for this invoice
        has_deductions = StockMovement.objects.filter(
            reference_id=self.number or str(self.pk),
            reference_type="invoice",
            reason="sale",
        ).exists()
        if not has_deductions:
            return

        for line in (lines or self.lines.all()):
            if line.variant:
                StockMovement.objects.create(
                    tenant=self.tenant,
                    branch=self.branch,
                    variant=line.variant,
                    reason="return",
                    quantity_delta=int(line.quantity),
                    reference_id=self.number or str(self.pk),
                    reference_type="invoice",
                    user=user or self.created_by,
                    notes=f"{ref_prefix} Facture {self.number or self.pk}"
                )
                line.variant.refresh_stock()
                if self.branch:
                    line.variant.refresh_stock(branch=self.branch)

    def _update_inventory_delta(self, old_lines, new_lines, user=None):
        """Update stock based on differences between old and new quantities for the same branch."""
        if not self.branch:
            return
        from collections import defaultdict
        from apps.inventory.models import StockMovement
        
        old_qtys = defaultdict(int)
        for line in old_lines:
            if line.variant_id:
                old_qtys[line.variant_id] += line.quantity
                
        new_qtys = defaultdict(int)
        for line in new_lines:
            if line.variant_id:
                new_qtys[line.variant_id] += line.quantity
                
        variants_to_update = set(old_qtys.keys()) | set(new_qtys.keys())
        for variant_id in variants_to_update:
            movement_qty = old_qtys.get(variant_id, 0) - new_qtys.get(variant_id, 0)
            if movement_qty != 0:
                reason = "return" if movement_qty > 0 else "sale"
                StockMovement.objects.create(
                    tenant=self.tenant,
                    branch=self.branch,
                    variant_id=variant_id,
                    reason=reason,
                    quantity_delta=movement_qty,
                    reference_id=self.number or str(self.pk),
                    reference_type="invoice",
                    user=user or self.created_by,
                    notes=f"Modification Facture {self.number or self.pk}"
                )
                from apps.inventory.models import Variant
                variant = Variant.objects.get(pk=variant_id)
                variant.refresh_stock()
                variant.refresh_stock(branch=self.branch)

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
                "description": f"Facture {self.number}",
                "date": self.date,
            },
        )

    @property
    def total_paid(self):
        return self.payments.aggregate(
            total=models.Sum("amount")
        )["total"] or Decimal("0.00")

    @property
    def credit_notes_total(self):
        return self.credit_notes.aggregate(
            total=models.Sum("total_ttc")
        )["total"] or Decimal("0.00")

    @property
    def balance_due(self):
        return self.total_ttc - self.total_paid - self.credit_notes_total

    def update_status(self):
        """Update invoice status based on payments and credit notes."""
        if self.status == InvoiceStatusChoices.CANCELLED:
            return
            
        paid_and_credited = self.total_paid + self.credit_notes_total
        
        if self.total_ttc > 0 and paid_and_credited >= self.total_ttc:
            new_status = InvoiceStatusChoices.PAID
        elif self.total_paid > 0 or self.credit_notes_total > 0:
            new_status = InvoiceStatusChoices.PARTIAL
        elif self.status != InvoiceStatusChoices.DRAFT:
            new_status = InvoiceStatusChoices.SENT
        else:
            new_status = InvoiceStatusChoices.DRAFT
            
        if self.status != new_status:
            Invoice.objects.filter(pk=self.pk).update(status=new_status)
            self.status = new_status


class InvoiceLine(models.Model):
    """One line item on an invoice."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
    cartons = models.PositiveIntegerField(_("Cartons"), default=0)
    order = models.PositiveSmallIntegerField(_("Order"), default=0)
    unit_cost = models.DecimalField(
        _("Unit Cost HT"), max_digits=12, decimal_places=2, null=True, blank=True
    )
    unit_cost_estimated = models.BooleanField(
        _("Unit Cost Estimated"), default=False
    )

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
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
        if self.date and self.invoice_id:
            from apps.closing.services.lock import assert_period_open
            tenant = getattr(self.invoice, "tenant", None)
            assert_period_open(tenant, self.date)
        super().save(*args, **kwargs)
        # Update invoice status based on payments
        self.invoice.update_status()
        # Record credit in client ledger
        self._record_client_credit()

    def _record_client_credit(self):
        if not self.invoice.client:
            return
        from apps.clients.models import ClientLedger
        ClientLedger.objects.create(
            client=self.invoice.client,
            entry_type="credit",
            amount=self.amount,
            description=f"Paiement sur facture {self.invoice.number}",
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

    def save(self, *args, **kwargs):
        if self.date:
            from apps.closing.services.lock import assert_period_open
            assert_period_open(self.tenant, self.date)
        super().save(*args, **kwargs)

class DeliveryNoteLine(models.Model):
    """One line item on a delivery note."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    delivery_note = models.ForeignKey(DeliveryNote, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="delivery_note_lines"
    )
    description = models.CharField(_("Description"), max_length=300)
    quantity = models.DecimalField(_("Quantity"), max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(_("Unit Price HT"), max_digits=12, decimal_places=2, default=Decimal("0.00"))
    discount_pct = models.DecimalField(_("Discount %"), max_digits=5, decimal_places=2, default=Decimal("0.00"))
    cartons = models.PositiveIntegerField(_("Cartons"), default=0)
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

    def save(self, *args, **kwargs):
        if self.date:
            from apps.closing.services.lock import assert_period_open
            assert_period_open(self.tenant, self.date)
        super().save(*args, **kwargs)
        # Generate number if not set
        if not self.number:
            CreditNote.objects.filter(pk=self.pk).update(number=f"AV-{self.original_invoice.number}-{self.pk}")
            self.number = f"AV-{self.original_invoice.number}-{self.pk}"
        # Update original invoice status
        self.original_invoice.update_status()
        # Record credit in client ledger
        self._record_client_credit()

    def _record_client_credit(self):
        if not self.original_invoice.client:
            return
        from apps.clients.models import ClientLedger
        ClientLedger.objects.update_or_create(
            client=self.original_invoice.client,
            reference_type="CreditNote",
            reference_id=str(self.pk),
            defaults={
                "entry_type": "credit",
                "amount": self.total_ttc,
                "description": f"Avoir sur facture {self.original_invoice.number}",
                "date": self.date,
            }
        )


# ─────────────────────────────────────────────
# Quote (Devis / Facture Proforma)
# ─────────────────────────────────────────────

class Quote(TenantScopedModel):
    """
    Wholesale quotation / proforma invoice.
    Purely commercial proposal: never affects stock or client ledger balances.
    """
    client = models.ForeignKey(
        "clients.Client", on_delete=models.SET_NULL, null=True, blank=True, related_name="quotes"
    )
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="quotes"
    )
    number = models.CharField(_("Quote Number"), max_length=30, blank=True, db_index=True)
    date = models.DateField(_("Quote Date"), db_index=True)
    valid_until = models.DateField(_("Valid Until"))
    status = models.CharField(
        _("Status"),
        max_length=15,
        choices=QuoteStatusChoices.choices,
        default=QuoteStatusChoices.DRAFT,
        db_index=True,
    )

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
    converted_invoice = models.ForeignKey(
        Invoice, on_delete=models.SET_NULL, null=True, blank=True, related_name="converted_quotes"
    )
    converted_delivery_note = models.ForeignKey(
        DeliveryNote, on_delete=models.SET_NULL, null=True, blank=True, related_name="converted_quotes"
    )
    pdf_file = models.FileField(_("PDF File"), upload_to="quotes/pdf/", blank=True, null=True)
    created_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="quotes_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Quote")
        verbose_name_plural = _("Quotes")
        ordering = ["-date", "-number"]

    def __str__(self):
        return f"Quote {self.number or self.pk}"

    def save(self, *args, **kwargs):
        from datetime import timedelta
        if not self.number:
            self.number = InvoiceCounter.next_number(self.tenant, "PF", date=self.date)
        if not self.valid_until and self.date:
            self.valid_until = self.date + timedelta(days=15)
        if self.pk:
            self.compute_totals()
        super().save(*args, **kwargs)

    def compute_totals(self):
        total_ht = sum(line.line_total for line in self.lines.all())
        self.total_ht = total_ht
        if self.apply_tva:
            self.tva_amount = (total_ht * self.tva_rate / 100).quantize(Decimal("0.01"))
        else:
            self.tva_amount = Decimal("0.00")
        self.total_ttc = self.total_ht + self.tva_amount

    def send(self, user=None):
        if not self.pk:
            return
        with transaction.atomic():
            quote = Quote.objects.select_for_update().get(pk=self.pk)
            if quote.status not in (QuoteStatusChoices.CANCELLED, QuoteStatusChoices.CONVERTED):
                quote.status = QuoteStatusChoices.SENT
                quote.save(update_fields=["status"])
                self.status = quote.status

    def accept(self, user=None):
        if not self.pk:
            return
        with transaction.atomic():
            quote = Quote.objects.select_for_update().get(pk=self.pk)
            if quote.status not in (QuoteStatusChoices.CANCELLED, QuoteStatusChoices.CONVERTED):
                quote.status = QuoteStatusChoices.ACCEPTED
                quote.save(update_fields=["status"])
                self.status = quote.status

    def cancel(self, user=None):
        if not self.pk:
            return
        with transaction.atomic():
            quote = Quote.objects.select_for_update().get(pk=self.pk)
            if quote.status == QuoteStatusChoices.CONVERTED:
                raise ValueError(_("Impossible d'annuler un devis déjà converti."))
            quote.status = QuoteStatusChoices.CANCELLED
            quote.save(update_fields=["status"])
            self.status = quote.status

    def convert_to_invoice(self, user=None, target_date=None):
        if not self.pk:
            raise ValueError(_("Le devis doit être enregistré avant d'être converti."))

        from datetime import timedelta
        from django.utils import timezone
        from apps.closing.services.lock import assert_period_open

        inv_date = target_date or timezone.localdate()
        assert_period_open(self.tenant, inv_date)

        with transaction.atomic():
            quote = Quote.objects.select_for_update().get(pk=self.pk)
            if quote.status == QuoteStatusChoices.CANCELLED:
                raise ValueError(_("Un devis annulé ne peut pas être converti."))
            if quote.converted_invoice:
                raise ValueError(_("Ce devis a déjà été converti en facture."))

            _assert_client_not_blocked(
                quote.client_id,
                quote.tenant,
                _("Ce client est bloqué. Impossible d'émettre une facture."),
            )

            invoice = Invoice.objects.create(
                tenant=quote.tenant,
                client=quote.client,
                branch=quote.branch,
                date=inv_date,
                due_date=inv_date + timedelta(days=30),
                series_prefix="FA",
                apply_tva=quote.apply_tva,
                tva_rate=quote.tva_rate,
                is_formal=True,
                notes=quote.notes or f"Créée depuis le devis {quote.number}",
                created_by=user or quote.created_by,
                status=InvoiceStatusChoices.DRAFT,
            )

            for i, line in enumerate(quote.lines.all()):
                InvoiceLine.objects.create(
                    invoice=invoice,
                    variant=line.variant,
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount_pct=line.discount_pct,
                    cartons=line.cartons,
                    order=line.order if line.order else i,
                    unit_cost=line.unit_cost,
                    unit_cost_estimated=line.unit_cost_estimated,
                )

            invoice.compute_totals()
            invoice.save(update_fields=["total_ht", "tva_amount", "total_ttc", "timbre_fiscal"])

            if quote.converted_delivery_note:
                quote.converted_delivery_note.invoice = invoice
                quote.converted_delivery_note.save(update_fields=["invoice"])

            quote.converted_invoice = invoice
            quote.status = QuoteStatusChoices.CONVERTED
            quote.save(update_fields=["converted_invoice", "status"])

            self.converted_invoice = invoice
            self.status = QuoteStatusChoices.CONVERTED

        return invoice

    def convert_to_delivery_note(self, user=None, target_date=None):
        if not self.pk:
            raise ValueError(_("Le devis doit être enregistré avant d'être converti."))

        from django.utils import timezone
        from apps.closing.services.lock import assert_period_open

        dn_date = target_date or timezone.localdate()
        assert_period_open(self.tenant, dn_date)

        with transaction.atomic():
            quote = Quote.objects.select_for_update().get(pk=self.pk)
            if quote.status == QuoteStatusChoices.CANCELLED:
                raise ValueError(_("Un devis annulé ne peut pas être converti."))
            if quote.converted_delivery_note:
                raise ValueError(_("Ce devis a déjà été converti en bon de livraison."))
            _assert_client_not_blocked(
                quote.client_id,
                quote.tenant,
                _("Ce client est bloqué. Impossible d'émettre un bon de livraison."),
            )

            bl_number = InvoiceCounter.next_number(quote.tenant, "BL", date=dn_date)
            dn = DeliveryNote.objects.create(
                tenant=quote.tenant,
                client=quote.client,
                number=bl_number,
                date=dn_date,
                notes=quote.notes or f"Créé depuis le devis {quote.number}",
                invoice=quote.converted_invoice,
            )

            for i, line in enumerate(quote.lines.all()):
                DeliveryNoteLine.objects.create(
                    delivery_note=dn,
                    variant=line.variant,
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount_pct=line.discount_pct,
                    cartons=line.cartons,
                    order=line.order if line.order else i,
                )

            quote.converted_delivery_note = dn
            quote.status = QuoteStatusChoices.CONVERTED
            quote.save(update_fields=["converted_delivery_note", "status"])

            self.converted_delivery_note = dn
            self.status = QuoteStatusChoices.CONVERTED

        return dn


class QuoteLine(models.Model):
    """One line item on a quotation / proforma invoice."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quote = models.ForeignKey(Quote, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="quote_lines"
    )
    description = models.CharField(_("Description"), max_length=300)
    quantity = models.DecimalField(_("Quantity"), max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(_("Unit Price HT"), max_digits=12, decimal_places=2)
    discount_pct = models.DecimalField(
        _("Discount %"), max_digits=5, decimal_places=2, default=Decimal("0.00")
    )
    cartons = models.PositiveIntegerField(_("Cartons"), default=0)
    order = models.PositiveSmallIntegerField(_("Order"), default=0)
    unit_cost = models.DecimalField(
        _("Unit Cost HT"), max_digits=12, decimal_places=2, null=True, blank=True
    )
    unit_cost_estimated = models.BooleanField(
        _("Unit Cost Estimated"), default=False
    )

    class Meta:
        ordering = ["order", "pk"]

    @property
    def line_total(self):
        subtotal = self.unit_price * self.quantity
        discount = subtotal * self.discount_pct / 100
        return subtotal - discount

    def __str__(self):
        return f"{self.description} × {self.quantity}"

