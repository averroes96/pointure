"""Models for fiscal year-end management closing."""
import uuid
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel


class FiscalYearStatusChoices(models.TextChoices):
    OPEN = "open", _("Ouvert")
    CLOSED = "closed", _("Clôturé")


class BalanceKindChoices(models.TextChoices):
    CLIENT = "client", _("Client")
    SUPPLIER = "supplier", _("Fournisseur")


class FiscalYear(TenantScopedModel):
    """
    Fiscal year management closing model.
    Tracks start/end dates, locking status, snapshots of stock & balances,
    and year-end totals for external accountant reporting.
    """
    year = models.PositiveSmallIntegerField(_("Year"))
    start_date = models.DateField(_("Start Date"))
    end_date = models.DateField(_("End Date"))
    status = models.CharField(
        _("Status"),
        max_length=10,
        choices=FiscalYearStatusChoices.choices,
        default=FiscalYearStatusChoices.OPEN,
        db_index=True,
    )
    closed_at = models.DateTimeField(_("Closed At"), null=True, blank=True)
    closed_by = models.ForeignKey(
        "core.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="closed_fiscal_years",
        verbose_name=_("Closed By"),
    )
    reopened_reason = models.TextField(_("Reopened Reason"), blank=True, default="")
    stocktake_session = models.ForeignKey(
        "inventory.StocktakeSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fiscal_years",
        verbose_name=_("Year-end Stocktake Session"),
    )
    totals = models.JSONField(_("Totals & Summary"), default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Fiscal Year")
        verbose_name_plural = _("Fiscal Years")
        ordering = ["-year"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "year"], name="closing_fiscal_year_tenant_year_uniq")
        ]

    def __str__(self):
        return f"Exercice {self.year} ({self.get_status_display()})"

    @property
    def is_closed(self) -> bool:
        return self.status == FiscalYearStatusChoices.CLOSED

    @property
    def is_open(self) -> bool:
        return self.status == FiscalYearStatusChoices.OPEN

    def clean(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValidationError(_("La date de début ne peut pas être postérieure à la date de fin."))

    def close(self, user):
        """Close the fiscal year and lock the period."""
        if self.is_closed:
            raise ValidationError(_("Cet exercice est déjà clôturé."))
        self.status = FiscalYearStatusChoices.CLOSED
        self.closed_at = timezone.now()
        self.closed_by = user
        self.save(update_fields=["status", "closed_at", "closed_by", "updated_at"])

    def reopen(self, user, reason: str):
        """Reopen the fiscal year (owner only). Requires an audit reason."""
        if not reason or not str(reason).strip():
            raise ValidationError(_("Un motif de réouverture est obligatoire."))
        if self.is_open:
            raise ValidationError(_("Cet exercice est déjà ouvert."))
        self.status = FiscalYearStatusChoices.OPEN
        self.reopened_reason = str(reason).strip()
        self.closed_at = None
        self.closed_by = None
        self.save(update_fields=["status", "reopened_reason", "closed_at", "closed_by", "updated_at"])


class StockSnapshotLine(models.Model):
    """Point-in-time stock valuation line for a fiscal year."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fiscal_year = models.ForeignKey(
        FiscalYear, on_delete=models.CASCADE, related_name="stock_lines"
    )
    variant = models.ForeignKey(
        "inventory.Variant", on_delete=models.PROTECT, related_name="stock_snapshots"
    )
    branch = models.ForeignKey(
        "core.Branch", on_delete=models.SET_NULL, null=True, blank=True, related_name="stock_snapshots"
    )
    quantity = models.IntegerField(_("Quantity"), default=0)
    unit_cost = models.DecimalField(_("Unit Cost (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00"))
    cost_value = models.DecimalField(_("Cost Value (DZD)"), max_digits=14, decimal_places=2, default=Decimal("0.00"))
    unit_price = models.DecimalField(_("Unit Price (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00"))
    retail_value = models.DecimalField(_("Retail Value (DZD)"), max_digits=14, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        verbose_name = _("Stock Snapshot Line")
        verbose_name_plural = _("Stock Snapshot Lines")
        ordering = ["variant__product__name", "variant__size_eu"]

    def __str__(self):
        return f"{self.variant} × {self.quantity} ({self.fiscal_year.year})"


class BalanceSnapshotLine(models.Model):
    """Point-in-time balance snapshot line (client or supplier) for a fiscal year."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fiscal_year = models.ForeignKey(
        FiscalYear, on_delete=models.CASCADE, related_name="balance_lines"
    )
    kind = models.CharField(_("Kind"), max_length=10, choices=BalanceKindChoices.choices, db_index=True)
    party_id = models.UUIDField(_("Party ID"))
    party_name = models.CharField(_("Party Name"), max_length=255)
    balance = models.DecimalField(_("Balance (DZD)"), max_digits=14, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        verbose_name = _("Balance Snapshot Line")
        verbose_name_plural = _("Balance Snapshot Lines")
        ordering = ["kind", "party_name"]

    def __str__(self):
        return f"[{self.get_kind_display()}] {self.party_name}: {self.balance} DZD"
