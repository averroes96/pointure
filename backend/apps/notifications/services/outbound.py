"""
Deliver queued OutboundMessage rows.

Called from the desktop scheduler or a background thread, never inline in a
request. Each send happens outside a database transaction so SQLite is not
locked during HTTPS.
"""
import logging
from datetime import timedelta

from django.core.mail import EmailMessage
from django.db.models import F, Q
from django.utils import timezone

from apps.core.desktop.backup import load_desktop_config
from apps.core.managers import set_current_tenant
from apps.notifications.channels.telegram import OutboundSendError, send_telegram_message
from apps.notifications.models import OutboundMessage, outbound_backoff

logger = logging.getLogger(__name__)
CLAIM_TIMEOUT = timedelta(minutes=5)


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
    _recover_stale_claims(now)

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
    queue = OutboundMessage.objects.unscoped()
    claimed_at = now
    claimed = (
        queue.filter(pk=pk, status=OutboundMessage.Status.PENDING)
        .filter(Q(next_attempt_at__isnull=True) | Q(next_attempt_at__lte=now))
        .update(status=OutboundMessage.Status.SENDING, claimed_at=claimed_at)
    )
    if claimed != 1:
        return False

    message = queue.get(pk=pk)
    if now >= message.deadline:
        _finish_claim(
            pk,
            claimed_at,
            status=OutboundMessage.Status.FAILED,
            next_attempt_at=None,
            last_error=message.last_error or "Gave up after 48 hours.",
        )
        return True

    try:
        send(message)
    except OutboundSendError as exc:
        logger.info("Outbound message %s not delivered: %s", pk, exc)
        _retry_claimed(message, claimed_at, str(exc), now)
        return True
    except Exception as exc:
        logger.exception("Outbound message %s failed unexpectedly", pk)
        _retry_claimed(message, claimed_at, str(exc)[:2000], now)
        return True

    _finish_claim(
        pk,
        claimed_at,
        status=OutboundMessage.Status.SENT,
        sent_at=now,
        last_error="",
        next_attempt_at=None,
    )
    return True


def _recover_stale_claims(now) -> int:
    """Return abandoned claims to the queue after the bounded send timeout."""
    stale_before = now - CLAIM_TIMEOUT
    return (
        OutboundMessage.objects.unscoped()
        .filter(status=OutboundMessage.Status.SENDING)
        .filter(Q(claimed_at__isnull=True) | Q(claimed_at__lte=stale_before))
        .update(status=OutboundMessage.Status.PENDING, claimed_at=None)
    )


def _finish_claim(pk, claimed_at, **fields) -> int:
    """Apply a result only while this dispatcher still owns the claim."""
    return (
        OutboundMessage.objects.unscoped()
        .filter(
            pk=pk,
            status=OutboundMessage.Status.SENDING,
            claimed_at=claimed_at,
        )
        .update(**fields, claimed_at=None)
    )


def _retry_claimed(message, claimed_at, error, now) -> int:
    attempts = message.attempts + 1
    next_attempt_at = now + outbound_backoff(attempts)
    status = (
        OutboundMessage.Status.FAILED
        if now >= message.deadline or next_attempt_at > message.deadline
        else OutboundMessage.Status.PENDING
    )
    return _finish_claim(
        message.pk,
        claimed_at,
        attempts=F("attempts") + 1,
        last_error=(error or "")[:2000],
        status=status,
        next_attempt_at=next_attempt_at if status == OutboundMessage.Status.PENDING else None,
    )
