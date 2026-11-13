import uuid
from django.conf import settings
from django.db import models
from django.db.models import Q
from apps.core.models import TenantScopedModel

SOURCE_CHOICES = [
    ("sales", "Ventes"),
    ("inventory", "Inventaire"),
    ("clients", "Clients"),
]

class ReportTemplate(TenantScopedModel):
    """Saved custom report config. Enterprise-only, max 15 per tenant."""
    name = models.CharField(max_length=200)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    config = models.JSONField(default=dict)  # {columns, filters, sort, date_from, date_to}
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="report_templates",
    )
    is_public = models.BooleanField(default=True)  # visible to all tenant users
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.tenant.name} — {self.name}"


class SeasonalEvent(TenantScopedModel):
    """Aïd, rentrée, or a date the owner adds. Calculated dates stay editable."""

    class Kind(models.TextChoices):
        AID_EL_FITR = "aid_el_fitr", "Aïd el Fitr"
        AID_EL_ADHA = "aid_el_adha", "Aïd el Adha"
        RENTREE = "rentree", "Rentrée"
        CUSTOM = "custom", "Personnalisé"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    date = models.DateField()
    label = models.CharField(max_length=80)
    is_estimated = models.BooleanField(default=True)
    # Stable id for seeded rows, so editing the date does not create a duplicate.
    seed_key = models.CharField(max_length=40, blank=True, default="")

    class Meta:
        ordering = ["date", "kind"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "seed_key"],
                condition=~Q(seed_key=""),
                name="reports_seasonal_seed_key_uniq",
            ),
        ]

    def __str__(self):
        return f"{self.label} {self.date}"
