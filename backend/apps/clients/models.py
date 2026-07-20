import uuid
"""
Client models: Client, ClientLedger, Cheque.
Client.cached_balance is maintained via signals on ClientLedger.
"""
from decimal import Decimal

from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import WILAYA_CHOICES, TenantScopedModel


class ClientTypeChoices(models.TextChoices):
    RETAIL = "retail", _("Retail")
    WHOLESALE = "wholesale", _("Wholesale")


class ChequeStatusChoices(models.TextChoices):
    PENDING = "pending", _("Pending")
    DEPOSITED = "deposited", _("Deposited")
    BOUNCED = "bounced", _("Bounced")
    CANCELLED = "cancelled", _("Cancelled")


class ChequeDirectionChoices(models.TextChoices):
    RECEIVABLE = "receivable", _("Receivable (from client)")
    PAYABLE = "payable", _("Payable (to supplier)")


class LedgerEntryTypeChoices(models.TextChoices):
    DEBIT = "debit", _("Debit (amount owed)")
    CREDIT = "credit", _("Credit (payment received)")


class Client(TenantScopedModel):
    """A customer — either retail walk-in or wholesale partner."""
    name = models.CharField(_("Name"), max_length=200)
    phone = models.CharField(_("Phone"), max_length=20, blank=True)
    email = models.EmailField(_("Email"), blank=True)
    address = models.TextField(_("Address"), blank=True)
    wilaya = models.CharField(_("Wilaya"), max_length=2, choices=WILAYA_CHOICES, blank=True)
    client_type = models.CharField(
        _("Client Type"), max_length=10,
        choices=ClientTypeChoices.choices,
        default=ClientTypeChoices.RETAIL,
        db_index=True,
    )

    # Professional info (for wholesale clients)
    nif = models.CharField(_("NIF"), max_length=20, blank=True)
    rc = models.CharField(_("RC"), max_length=30, blank=True)

    credit_limit = models.DecimalField(
        _("Credit Limit (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    # Cached balance: positive = client owes us, negative = we owe client (credit)
    cached_balance = models.DecimalField(
        _("Outstanding Balance (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    is_active = models.BooleanField(_("Active"), default=True)
    notes = models.TextField(_("Notes"), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Client")
        verbose_name_plural = _("Clients")
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def is_over_credit_limit(self):
        if self.credit_limit > 0:
            return self.cached_balance > self.credit_limit
        return False

    def recompute_balance(self):
        """Recompute cached_balance from the ledger. Called by signal."""
        from django.db.models import Sum
        result = self.ledger_entries.aggregate(
            debits=Sum("amount", filter=models.Q(entry_type="debit")),
            credits=Sum("amount", filter=models.Q(entry_type="credit")),
        )
        debits = result["debits"] or Decimal("0.00")
        credits = result["credits"] or Decimal("0.00")
        balance = debits - credits
        Client.objects.filter(pk=self.pk).update(cached_balance=balance)
        self.cached_balance = balance


class ClientLedger(models.Model):
    """
    Running balance ledger for a client.
    Debit entries = client owes us (invoice issued).
    Credit entries = client paid us.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="ledger_entries")
    entry_type = models.CharField(
        _("Entry Type"), max_length=6, choices=LedgerEntryTypeChoices.choices
    )
    amount = models.DecimalField(_("Amount"), max_digits=12, decimal_places=2)
    description = models.CharField(_("Description"), max_length=300)
    reference_type = models.CharField(_("Reference Type"), max_length=50, blank=True)
    reference_id = models.CharField(_("Reference ID"), max_length=50, blank=True)
    date = models.DateField(_("Date"), db_index=True)
    balance_after = models.DecimalField(
        _("Balance After"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Client Ledger Entry")
        verbose_name_plural = _("Client Ledger Entries")
        ordering = ["date", "created_at"]

    def __str__(self):
        return f"{self.entry_type} {self.amount} — {self.client}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Keep client's cached_balance in sync
        self.client.recompute_balance()


class Cheque(TenantScopedModel):
    """
    Cheque tracking (both receivable from clients and payable to suppliers).
    Denormalised for the cheque calendar view.
    """
    client = models.ForeignKey(
        Client, on_delete=models.SET_NULL, null=True, blank=True, related_name="cheques"
    )
    supplier = models.ForeignKey(
        "suppliers.Supplier", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cheques"
    )
    direction = models.CharField(
        _("Direction"), max_length=12, choices=ChequeDirectionChoices.choices
    )
    number = models.CharField(_("Cheque Number"), max_length=30)
    bank = models.CharField(_("Bank"), max_length=100, blank=True)
    amount = models.DecimalField(_("Amount (DZD)"), max_digits=12, decimal_places=2)
    due_date = models.DateField(_("Due Date"), db_index=True)
    status = models.CharField(
        _("Status"), max_length=12, choices=ChequeStatusChoices.choices,
        default=ChequeStatusChoices.PENDING,
    )
    notified_at = models.DateTimeField(_("Notification Sent At"), null=True, blank=True)
    notes = models.TextField(_("Notes"), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Cheque")
        verbose_name_plural = _("Cheques")
        ordering = ["due_date"]

    def __str__(self):
        party = self.client or self.supplier
        return f"Cheque #{self.number} — {party} — {self.amount} DZD due {self.due_date}"

    @property
    def days_until_due(self):
        from django.utils import timezone
        delta = self.due_date - timezone.now().date()
        return delta.days
