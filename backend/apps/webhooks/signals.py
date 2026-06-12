"""
Webhook signal handlers.

On each relevant model event, create WebhookDelivery rows for all active
endpoints subscribed to that event type. Done in a try/except so a webhook
misconfiguration never breaks a sale or payment.
"""
import logging
import uuid

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.sales.models import Sale

logger = logging.getLogger(__name__)


def _enqueue(tenant_id, event_type: str, data: dict):
    """Create WebhookDelivery rows for every active endpoint subscribed to event_type."""
    from .models import WebhookDelivery, WebhookEndpoint

    now = timezone.now()
    endpoints = list(
        WebhookEndpoint.objects.filter(tenant_id=tenant_id, is_active=True)
    )
    deliveries = []
    for ep in endpoints:
        if event_type not in (ep.events or []):
            continue
        payload = {
            "id": str(uuid.uuid4()),
            "event": event_type,
            "timestamp": now.isoformat(),
            "data": data,
        }
        deliveries.append(
            WebhookDelivery(
                endpoint=ep,
                tenant_id=tenant_id,
                event_type=event_type,
                payload=payload,
                status="pending",
                next_attempt_at=now,
            )
        )
    if deliveries:
        WebhookDelivery.objects.bulk_create(deliveries)


@receiver(post_save, sender=Sale)
def on_sale_webhook(sender, instance: Sale, created: bool, **kwargs):
    if not instance.tenant_id:
        return
    try:
        data = {
            "id": instance.pk,
            "receipt_number": instance.receipt_number,
            "total_amount": str(instance.total_amount),
            "status": instance.status,
            "branch_id": instance.branch_id,
        }
        if created:
            _enqueue(instance.tenant_id, "sale.created", data)
        elif instance.status == "cancelled":
            _enqueue(instance.tenant_id, "sale.cancelled", data)
        elif instance.status == "refunded":
            _enqueue(instance.tenant_id, "sale.refunded", data)
    except Exception:
        logger.warning("webhook enqueue failed for sale %s", instance.pk, exc_info=True)
