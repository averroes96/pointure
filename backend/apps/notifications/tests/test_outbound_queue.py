"""Task 8.1: outbound queue backoff, retry, and Telegram escaping."""
import threading
from datetime import timedelta

import pytest
import requests
from django.utils import timezone

from apps.core.signals import AUDITED_MODELS
from apps.core.models import Tenant
from apps.notifications.channels.telegram import OutboundSendError, send_telegram_message
from apps.notifications.models import (
    OUTBOUND_BACKOFFS,
    OUTBOUND_GIVE_UP_AFTER,
    OutboundMessage,
    outbound_backoff,
)
from apps.notifications.services.outbound import (
    CLAIM_TIMEOUT,
    deliver_message,
    dispatch_due_messages,
)


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


def test_queue_flush_runs_delivery_on_a_background_thread(monkeypatch):
    from apps.notifications.services import owner_dispatch

    completed = threading.Event()
    caller_thread = threading.get_ident()
    worker_threads = []

    def dispatch():
        worker_threads.append(threading.get_ident())
        completed.set()

    monkeypatch.setattr(owner_dispatch, "_dispatch_outbound_now", dispatch)
    owner_dispatch._flush_outbound_queue()

    assert completed.wait(timeout=5)
    assert len(worker_threads) == 1
    assert worker_threads[0] != caller_thread


@pytest.mark.django_db
def test_outbound_messages_are_not_audited():
    assert "OutboundMessage" not in AUDITED_MODELS


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
def test_dispatch_recovers_a_stale_sending_claim():
    tenant = Tenant.objects.create(name="Stale Claim Store")
    now = timezone.now()
    message = _message(tenant)
    stale_claim = now - CLAIM_TIMEOUT - timedelta(seconds=1)
    OutboundMessage.objects.filter(pk=message.pk).update(
        status=OutboundMessage.Status.SENDING,
        claimed_at=stale_claim,
    )
    sent_ids = []

    assert dispatch_due_messages(now=now, send=lambda row: sent_ids.append(row.pk)) == 1

    message.refresh_from_db()
    assert sent_ids == [message.pk]
    assert message.status == OutboundMessage.Status.SENT
    assert message.claimed_at is None
    assert message.sent_at == now


@pytest.mark.django_db(transaction=True)
def test_concurrent_dispatch_threads_only_send_a_message_once():
    from django.db import close_old_connections

    tenant = Tenant.objects.create(name="Concurrent Queue Store")
    message = _message(tenant)
    now = timezone.now()
    sending = threading.Event()
    release_sender = threading.Event()
    sent_ids = []
    first_result = []
    second_result = []
    errors = []

    def send(row):
        sent_ids.append(row.pk)
        sending.set()
        if not release_sender.wait(timeout=5):
            raise RuntimeError("test sender timed out")

    def run_dispatch(result):
        close_old_connections()
        try:
            result.append(dispatch_due_messages(now=now, send=send))
        except Exception as exc:  # propagate worker-thread failures to pytest
            errors.append(exc)
        finally:
            close_old_connections()

    first = threading.Thread(target=run_dispatch, args=(first_result,))
    second = threading.Thread(target=run_dispatch, args=(second_result,))
    first.start()
    assert sending.wait(timeout=5)
    second.start()
    second.join(timeout=5)
    release_sender.set()
    first.join(timeout=5)

    assert not first.is_alive()
    assert not second.is_alive()
    assert errors == []
    assert first_result == [1]
    assert second_result == [0]
    assert sent_ids == [message.pk]
    message.refresh_from_db()
    assert message.status == OutboundMessage.Status.SENT
    assert message.claimed_at is None


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
