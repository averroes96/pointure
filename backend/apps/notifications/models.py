"""Notification models."""
from django.db import models
from apps.core.models import TenantScopedModel


class Notification(TenantScopedModel):
    class TypeChoices(models.TextChoices):
        CHEQUE_DUE = "cheque_due", "Cheque Due"
        LOW_STOCK = "low_stock", "Low Stock"
        INVOICE_OVERDUE = "invoice_overdue", "Invoice Overdue"
        GENERAL = "general", "General"

    user = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=20, choices=TypeChoices.choices, default=TypeChoices.GENERAL)
    title = models.CharField(max_length=200)
    body = models.TextField()
    read = models.BooleanField(default=False)
    related_object_type = models.CharField(max_length=50, blank=True)
    related_object_id = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.type}: {self.title}"
