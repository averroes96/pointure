import uuid
"""Notification models."""
from datetime import timedelta

from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel

# Retry delays after the 1st, 2nd, 3rd and 4th failure, then hourly.
OUTBOUND_BACKOFFS = (
    timedelta(minutes=2),
    timedelta(minutes=5),
    timedelta(minutes=15),
    timedelta(minutes=60),
)
OUTBOUND_GIVE_UP_AFTER = timedelta(hours=48)


def outbound_backoff(attempts: int) -> timedelta:
    """Delay before the next try. `attempts` is the number of failures so far."""
    if attempts <= 1:
        return OUTBOUND_BACKOFFS[0]
    if attempts <= len(OUTBOUND_BACKOFFS):
        return OUTBOUND_BACKOFFS[attempts - 1]
    return timedelta(hours=1)


class Notification(TenantScopedModel):
    class TypeChoices(models.TextChoices):
        CHEQUE_DUE = "cheque_due", "Cheque Due"
        LOW_STOCK = "low_stock", "Low Stock"
        INVOICE_OVERDUE = "invoice_overdue", "Invoice Overdue"
        CLOSING_REMINDER = "closing_reminder", "Closing Reminder"
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


class OutboundMessage(TenantScopedModel):
    """
    Queued owner alert. A desktop scheduler job delivers these outside the request.
    The bot token stays in desktop config.json; this row only stores the chat id or email.
    """

    class Channel(models.TextChoices):
        TELEGRAM = "telegram", _("Telegram")
        EMAIL = "email", _("Email")

    class Status(models.TextChoices):
        PENDING = "pending", _("Pending")
        SENT = "sent", _("Sent")
        FAILED = "failed", _("Failed")

    channel = models.CharField(max_length=20, choices=Channel.choices)
    recipient = models.CharField(max_length=255)
    kind = models.CharField(max_length=50)
    text = models.TextField(blank=True, default="")
    subject = models.CharField(max_length=200, blank=True, default="")
    body = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"], name="notif_outbox_due_idx"),
        ]

    def __str__(self):
        return f"{self.channel}:{self.kind} ({self.status})"

    @property
    def deadline(self):
        return self.created_at + OUTBOUND_GIVE_UP_AFTER

    def mark_sent(self, now=None):
        now = now or timezone.now()
        self.status = self.Status.SENT
        self.sent_at = now
        self.last_error = ""
        self.next_attempt_at = None
        self.save(update_fields=["status", "sent_at", "last_error", "next_attempt_at"])

    def mark_retry(self, error: str, now=None):
        """
        Record a failed attempt. Pending messages are retried on the backoff
        schedule. After 48 hours from creation the row is failed for good.
        """
        now = now or timezone.now()
        self.attempts += 1
        self.last_error = (error or "")[:2000]
        delay = outbound_backoff(self.attempts)
        nxt = now + delay
        if now >= self.deadline or nxt > self.deadline:
            self.status = self.Status.FAILED
            self.next_attempt_at = None
        else:
            self.status = self.Status.PENDING
            self.next_attempt_at = nxt
        self.save(update_fields=["attempts", "last_error", "status", "next_attempt_at"])

    def mark_expired(self, now=None):
        now = now or timezone.now()
        self.status = self.Status.FAILED
        self.next_attempt_at = None
        if not self.last_error:
            self.last_error = "Gave up after 48 hours."
        self.save(update_fields=["status", "next_attempt_at", "last_error"])
