"""
Deliver queued OutboundMessage rows.

Called from the desktop scheduler, never from a request. Each send happens
outside the database transaction so SQLite is not locked during HTTPS.
"""
import logging

from django.core.mail import EmailMessage
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.desktop.backup import load_desktop_config
from apps.core.managers import set_current_tenant
from apps.notifications.channels.telegram import OutboundSendError, send_telegram_message
from apps.notifications.models import OutboundMessage

logger = logging.getLogger(__name__)


def deliver_message(message: OutboundMessage) -> None:
    """Send one message. Raises OutboundSendError when the caller should retry."""
    if message.channel == OutboundMessage.Channel.TELEGRAM:
        token = str(load_desktop_config().get("telegram_bot_token") or "").strip()
        if not token:
            raise OutboundSendError("Telegram bot token is not configured.")
        send_telegram_message(token, message.recipient, message.text or message.body or "")
        return

    if message.channel == OutboundMessage.Channel.EMAIL:
        try:
            email = EmailMessage(
                subject=message.subject or "",
                body=message.body or message.text or "",
                to=[message.recipient],
            )
            email.send(fail_silently=False)
        except Exception as exc:
            raise OutboundSendError(str(exc)[:2000]) from exc
        return

    raise OutboundSendError(f"Unknown channel: {message.channel}")


def dispatch_due_messages(now=None, send=None, limit=20) -> int:
    """
    Send pending messages whose next_attempt_at has arrived.
    Returns how many rows were attempted. `send` is injectable for tests.
    """
    set_current_tenant(None)
    now = now or timezone.now()
    send = send or deliver_message

    due_ids = list(
        OutboundMessage.objects.unscoped()
        .filter(status=OutboundMessage.Status.PENDING)
        .filter(Q(next_attempt_at__isnull=True) | Q(next_attempt_at__lte=now))
        .order_by("created_at")
        .values_list("pk", flat=True)[:limit]
    )

    attempted = 0
    for pk in due_ids:
        if _dispatch_one(pk, now, send):
            attempted += 1
    return attempted


def _dispatch_one(pk, now, send) -> bool:
    with transaction.atomic():
        message = (
            OutboundMessage.objects.unscoped()
            .select_for_update()
            .get(pk=pk)
        )
        if message.status != OutboundMessage.Status.PENDING:
            return False
        if message.next_attempt_at and message.next_attempt_at > now:
            return False
        if now >= message.deadline:
            message.mark_expired(now=now)
            return True

    try:
        send(message)
    except OutboundSendError as exc:
        logger.info("Outbound message %s not delivered: %s", pk, exc)
        message.mark_retry(str(exc), now=now)
        return True
    except Exception as exc:
        logger.exception("Outbound message %s failed unexpectedly", pk)
        message.mark_retry(str(exc)[:2000], now=now)
        return True

    message.mark_sent(now=now)
    return True
