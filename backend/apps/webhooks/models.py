import uuid

from django.db import models

from apps.core.models import TenantScopedModel

WEBHOOK_EVENT_CHOICES = [
    ("sale.created", "Vente créée"),
    ("sale.cancelled", "Vente annulée"),
    ("sale.refunded", "Vente remboursée"),
    ("payment.created", "Paiement reçu"),
    ("invoice.created", "Facture créée"),
    ("invoice.paid", "Facture payée"),
    ("stock.alert", "Alerte de stock"),
]

DELIVERY_STATUS_CHOICES = [
    ("pending", "En attente"),
    ("delivered", "Livré"),
    ("failed", "Échoué"),
    ("abandoned", "Abandonné"),
]

MAX_ATTEMPTS = 5
RETRY_DELAYS_SECONDS = [0, 60, 300, 1800, 7200]  # 0, 1 min, 5 min, 30 min, 2 h


class WebhookEndpoint(TenantScopedModel):
    """A tenant-configured HTTP endpoint that receives webhook events."""

    name = models.CharField(max_length=200)
    url = models.URLField(max_length=500)
    secret = models.CharField(max_length=200)
    events = models.JSONField(default=list)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} → {self.url}"


class WebhookDelivery(models.Model):
    """Outbox entry for a single webhook delivery attempt."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    idempotency_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    endpoint = models.ForeignKey(
        WebhookEndpoint, on_delete=models.CASCADE, related_name="deliveries"
    )
    tenant = models.ForeignKey(
        "core.Tenant", on_delete=models.CASCADE, related_name="webhook_deliveries"
    )
    event_type = models.CharField(max_length=50)
    payload = models.JSONField()
    status = models.CharField(
        max_length=20, choices=DELIVERY_STATUS_CHOICES, default="pending", db_index=True
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True, db_index=True)
    response_status = models.SmallIntegerField(null=True, blank=True)
    response_body = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
