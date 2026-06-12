from django.conf import settings
from django.db import models
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
