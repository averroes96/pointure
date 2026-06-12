"""
Webhook outbox flush task.

Runs on a schedule (every 60 s). Picks up pending / retryable deliveries,
POSTs them to the configured endpoint URL, and updates status + retry timing.

Signing: HMAC-SHA256 over the raw JSON body, header X-ShoeDZ-Signature: sha256=<hex>.
Receiver can verify with their shared secret.
"""
import hashlib
import hmac
import json
import logging
import urllib.error
import urllib.request
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


def _sign(secret: str, body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


@shared_task(name="apps.webhooks.tasks.flush_webhook_outbox", ignore_result=True)
def flush_webhook_outbox():
    from .models import WebhookDelivery

    now = timezone.now()
    qs = (
        WebhookDelivery.objects.select_related("endpoint")
        .filter(status__in=["pending", "failed"], next_attempt_at__lte=now)
        .order_by("next_attempt_at")[:50]
    )
    for delivery in qs:
        _deliver(delivery)


def _deliver(delivery):
    from .models import MAX_ATTEMPTS, RETRY_DELAYS_SECONDS

    endpoint = delivery.endpoint
    if not endpoint.is_active:
        delivery.status = "abandoned"
        delivery.save(update_fields=["status"])
        return

    body = json.dumps(delivery.payload, ensure_ascii=False).encode("utf-8")
    signature = _sign(endpoint.secret, body)

    req = urllib.request.Request(
        endpoint.url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-ShoeDZ-Signature": signature,
            "X-ShoeDZ-Event": delivery.event_type,
            "X-ShoeDZ-Delivery": str(delivery.idempotency_key),
        },
        method="POST",
    )

    delivery.attempts += 1
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            delivery.response_status = resp.status
            delivery.response_body = resp.read(1000).decode("utf-8", errors="replace")
        delivery.status = "delivered"
        delivery.delivered_at = timezone.now()
        delivery.next_attempt_at = None
    except urllib.error.HTTPError as exc:
        delivery.response_status = exc.code
        try:
            delivery.response_body = exc.read(1000).decode("utf-8", errors="replace")
        except Exception:
            delivery.response_body = str(exc)
        _schedule_retry(delivery, MAX_ATTEMPTS, RETRY_DELAYS_SECONDS)
    except Exception as exc:
        delivery.response_body = str(exc)[:500]
        _schedule_retry(delivery, MAX_ATTEMPTS, RETRY_DELAYS_SECONDS)

    delivery.save(
        update_fields=[
            "status", "attempts", "next_attempt_at",
            "response_status", "response_body", "delivered_at",
        ]
    )


def _schedule_retry(delivery, max_attempts: int, delays: list):
    if delivery.attempts >= max_attempts:
        delivery.status = "abandoned"
        delivery.next_attempt_at = None
    else:
        delay = delays[min(delivery.attempts, len(delays) - 1)]
        delivery.next_attempt_at = timezone.now() + timedelta(seconds=delay)
        delivery.status = "failed"
