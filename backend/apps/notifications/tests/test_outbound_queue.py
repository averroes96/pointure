"""Task 8.1: outbound queue backoff, retry, and Telegram escaping."""
import inspect
from datetime import timedelta

import pytest
import requests
from django.utils import timezone

from apps.core.desktop import scheduler
from apps.core.models import Tenant
from apps.notifications.channels.telegram import OutboundSendError, send_telegram_message
from apps.notifications.models import (
    OUTBOUND_BACKOFFS,
    OUTBOUND_GIVE_UP_AFTER,
    OutboundMessage,
    outbound_backoff,
)
from apps.notifications.services.outbound import deliver_message, dispatch_due_messages


def _message(tenant, **overrides):
    data = {
        "tenant": tenant,
        "channel": OutboundMessage.Channel.TELEGRAM,
        "recipient": "424242",
        "kind": "shift_close",
        "text": "Caisse fermée",
    }
    data.update(overrides)
    return OutboundMessage.objects.create(**data)


def test_backoff_is_2_5_15_60_then_hourly():
    assert outbound_backoff(1) == timedelta(minutes=2)
    assert outbound_backoff(2) == timedelta(minutes=5)
    assert outbound_backoff(3) == timedelta(minutes=15)
    assert outbound_backoff(4) == timedelta(minutes=60)
    assert outbound_backoff(5) == timedelta(hours=1)
    assert outbound_backoff(12) == timedelta(hours=1)
    assert OUTBOUND_BACKOFFS == (
        timedelta(minutes=2),
        timedelta(minutes=5),
        timedelta(minutes=15),
        timedelta(minutes=60),
    )
    assert OUTBOUND_GIVE_UP_AFTER == timedelta(hours=48)


def test_scheduler_sends_the_queue_every_two_minutes_outside_a_request():
    source = inspect.getsource(scheduler._run_scheduler_loop)
    assert "outbound_interval_sec = 2 * 60" in source
    assert "dispatch_due_messages()" in source
    assert "dispatch_due_messages" not in inspect.getsource(
        __import__("apps.notifications.views", fromlist=["views"])
    )


@pytest.mark.django_db
def test_retry_schedule_then_give_up_after_48_hours():
    tenant = Tenant.objects.create(name="Queue Store")
    message = _message(tenant)
    now = timezone.now()

    message.mark_retry("offline", now=now)
    message.refresh_from_db()
    assert message.status == OutboundMessage.Status.PENDING
    assert message.attempts == 1
    assert message.next_attempt_at == now + timedelta(minutes=2)
    assert message.last_error == "offline"

    message.mark_retry("offline", now=now)
    message.refresh_from_db()
    assert message.attempts == 2
    assert message.next_attempt_at == now + timedelta(minutes=5)

    message.attempts = 4
    message.save(update_fields=["attempts"])
    message.mark_retry("still offline", now=now)
    message.refresh_from_db()
    assert message.attempts == 5
    assert message.status == OutboundMessage.Status.PENDING
    assert message.next_attempt_at == now + timedelta(hours=1)

    created = now - timedelta(hours=47, minutes=59)
    OutboundMessage.objects.filter(pk=message.pk).update(created_at=created)
    message.refresh_from_db()
    message.mark_retry("too late", now=now)
    message.refresh_from_db()
    assert message.status == OutboundMessage.Status.FAILED
    assert message.next_attempt_at is None
    assert message.last_error == "too late"


@pytest.mark.django_db
def test_dispatch_waits_for_next_attempt_then_marks_sent():
    tenant = Tenant.objects.create(name="Wait Store")
    now = timezone.now()
    waiting = _message(tenant, text="not yet")
    OutboundMessage.objects.filter(pk=waiting.pk).update(
        next_attempt_at=now + timedelta(minutes=2),
    )
    sent_ids = []

    def send(message):
        sent_ids.append(message.pk)

    assert dispatch_due_messages(now=now, send=send) == 0
    assert sent_ids == []

    assert dispatch_due_messages(now=now + timedelta(minutes=2), send=send) == 1
    waiting.refresh_from_db()
    assert waiting.status == OutboundMessage.Status.SENT
    assert waiting.sent_at == now + timedelta(minutes=2)
    assert waiting.next_attempt_at is None
    assert sent_ids == [waiting.pk]


@pytest.mark.django_db
def test_offline_network_error_marks_the_message_for_retry(monkeypatch):
    tenant = Tenant.objects.create(name="Offline Store")
    token = "123456:secret-token"
    monkeypatch.setattr(
        "apps.notifications.services.outbound.load_desktop_config",
        lambda: {"telegram_bot_token": token},
    )

    def offline(url, json, timeout):
        raise requests.ConnectionError(f"network down calling {url}")

    monkeypatch.setattr(requests, "post", offline)

    message = _message(tenant, text="écart 500")
    now = timezone.now()
    assert dispatch_due_messages(now=now) == 1

    message.refresh_from_db()
    assert message.status == OutboundMessage.Status.PENDING
    assert message.attempts == 1
    assert message.sent_at is None
    assert message.next_attempt_at == now + timedelta(minutes=2)
    assert "network down" in message.last_error
    assert token not in message.last_error
    assert "telegram_bot_token" not in {field.name for field in OutboundMessage._meta.fields}


def test_telegram_sender_escapes_html_and_uses_a_ten_second_timeout():
    captured = {}

    class Response:
        status_code = 200
        text = ""

    class Session:
        def post(self, url, json, timeout):
            captured["url"] = url
            captured["json"] = json
            captured["timeout"] = timeout
            return Response()

    raw = 'Caisse < 1 & "ok">'
    send_telegram_message("token-value", "99", raw, session=Session())

    assert captured["timeout"] == 10
    assert captured["url"] == "https://api.telegram.org/bottoken-value/sendMessage"
    assert captured["json"]["chat_id"] == "99"
    assert captured["json"]["parse_mode"] == "HTML"
    assert captured["json"]["text"] == 'Caisse &lt; 1 &amp; "ok"&gt;'


def test_telegram_network_error_redacts_the_bot_token():
    token = "999:ABC-secret"

    class Session:
        def post(self, url, json, timeout):
            raise requests.ConnectionError(f"failed {url}")

    with pytest.raises(OutboundSendError) as exc_info:
        send_telegram_message(token, "1", "hello", session=Session())

    message = str(exc_info.value)
    assert token not in message
    assert "***" in message


@pytest.mark.django_db
def test_deliver_reads_the_token_from_desktop_config_not_the_row(monkeypatch):
    tenant = Tenant.objects.create(name="Config Store")
    seen = {}

    monkeypatch.setattr(
        "apps.notifications.services.outbound.load_desktop_config",
        lambda: {"telegram_bot_token": "from-config"},
    )

    def fake_send(token, chat_id, text, session=None):
        seen["token"] = token
        seen["chat_id"] = chat_id
        seen["text"] = text

    monkeypatch.setattr(
        "apps.notifications.services.outbound.send_telegram_message",
        fake_send,
    )
    message = _message(tenant, recipient="555", text="bonjour")
    deliver_message(message)
    assert seen == {"token": "from-config", "chat_id": "555", "text": "bonjour"}
