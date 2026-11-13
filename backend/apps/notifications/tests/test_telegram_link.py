"""Task 8.2: link an owner Telegram chat with a mocked Bot API."""
from datetime import timedelta

import pytest
import requests
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Tenant
from apps.notifications.services.telegram_link import (
    TelegramLinkError,
    poll_link,
    public_telegram_status,
    token_updates,
)

User = get_user_model()


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeTelegram:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, json, timeout):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _update(update_id, chat_id, text, first_name="Ali"):
    return {
        "update_id": update_id,
        "message": {
            "text": text,
            "chat": {"id": chat_id, "first_name": first_name},
        },
    }


@pytest.fixture
def config_store(monkeypatch):
    store = {}

    def load():
        return dict(store)

    def save(updates):
        store.update(updates)
        return dict(store)

    monkeypatch.setattr("apps.core.desktop.backup.load_desktop_config", load)
    monkeypatch.setattr("apps.core.desktop.backup.save_desktop_config", save)
    return store


@pytest.fixture
def owner_client(db):
    tenant = Tenant.objects.create(name="Telegram Store")
    owner = User.objects.create_user(
        email="owner-tg@example.com", password="password123", tenant=tenant, role="owner",
    )
    manager = User.objects.create_user(
        email="manager-tg@example.com", password="password123", tenant=tenant, role="manager",
    )
    cashier = User.objects.create_user(
        email="cashier-tg@example.com", password="password123", tenant=tenant, role="cashier",
    )
    client = APIClient()
    client.force_authenticate(user=owner)
    return client, manager, cashier


def test_poll_links_matching_start_and_ignores_unknown_messages():
    now = timezone.now()
    config = {
        "telegram_bot_token": "token-1",
        "telegram_link_code": "482913",
        "telegram_link_expires": (now + timedelta(minutes=5)).isoformat(),
        "telegram_chats": [],
    }
    session = FakeTelegram([
        FakeResponse({"ok": True, "result": [
            _update(10, 111, "bonjour"),
            _update(11, 222, "/start 000000"),
            _update(12, 333, "/start 482913", first_name="Karim"),
        ]}),
    ])
    updates, result = poll_link(config, session, now=now)
    assert result["linked"] is True
    assert result["chat"] == {"chat_id": "333", "label": "Karim"}
    assert result["ignored"] == 2
    assert updates["telegram_chats"] == [{"chat_id": "333", "label": "Karim"}]
    assert updates["telegram_update_offset"] == 13
    assert updates["telegram_link_code"] == ""
    assert session.calls[0]["timeout"] == 10
    assert session.calls[0]["json"]["timeout"] == 0
    assert "111" not in str(updates["telegram_chats"])
    assert "222" not in str(updates["telegram_chats"])


def test_poll_refuses_a_fourth_chat_and_an_expired_code():
    now = timezone.now()
    config = {
        "telegram_bot_token": "token-1",
        "telegram_link_code": "482913",
        "telegram_link_expires": (now + timedelta(minutes=5)).isoformat(),
        "telegram_chats": [
            {"chat_id": "1", "label": "A"},
            {"chat_id": "2", "label": "B"},
            {"chat_id": "3", "label": "C"},
        ],
    }
    session = FakeTelegram([
        FakeResponse({"ok": True, "result": [_update(4, 9, "/start 482913")]}),
    ])
    updates, result = poll_link(config, session, now=now)
    assert result["linked"] is False
    assert result["limit_reached"] is True
    assert "telegram_chats" not in updates
    assert updates["telegram_update_offset"] == 5

    expired = dict(config)
    expired["telegram_link_expires"] = (now - timedelta(seconds=1)).isoformat()
    with pytest.raises(TelegramLinkError) as exc_info:
        poll_link(expired, FakeTelegram([]), now=now)
    assert exc_info.value.code == "link_expired"


def test_replacing_the_token_clears_saved_chats_and_hides_the_token():
    config = {
        "telegram_bot_token": "old",
        "telegram_chats": [{"chat_id": "5", "label": "Old"}],
        "telegram_update_offset": 8,
    }
    updates = token_updates(config, "new-token", "shoedz_bot")
    assert updates["telegram_chats"] == []
    assert updates["telegram_update_offset"] is None
    status = public_telegram_status({**config, **updates})
    assert status["has_token"] is True
    assert status["bot_username"] == "shoedz_bot"
    assert status["chats"] == []
    assert "new-token" not in str(status)


@pytest.mark.django_db
def test_owner_links_a_chat_and_other_roles_are_refused(owner_client, config_store, monkeypatch):
    client, manager, cashier = owner_client
    token = "555:secret-token"
    telegram = FakeTelegram([
        FakeResponse({"ok": True, "result": {"id": 1, "username": "shoedz_bot"}}),
    ])
    monkeypatch.setattr(requests, "post", telegram.post)

    for user in (manager, cashier):
        other = APIClient()
        other.force_authenticate(user=user)
        denied = other.post("/api/v1/desktop/telegram/token/", {"token": token}, format="json")
        assert denied.status_code == 403
        assert denied.data["code"] == "not_owner"

    saved = client.post("/api/v1/desktop/telegram/token/", {"token": token}, format="json")
    assert saved.status_code == 200
    assert saved.data["has_token"] is True
    assert saved.data["bot_username"] == "shoedz_bot"
    assert token not in str(saved.data)
    assert config_store["telegram_bot_token"] == token

    started = client.post("/api/v1/desktop/telegram/link/", {}, format="json")
    assert started.status_code == 200
    code = started.data["pending_link"]["code"]
    assert len(code) == 6 and code.isdigit()

    telegram.responses.append(FakeResponse({"ok": True, "result": [
        _update(1, 777, "prix ?"),
        _update(2, 888, f"/start {code}", first_name="Lina"),
    ]}))
    polled = client.post("/api/v1/desktop/telegram/poll/", {}, format="json")
    assert polled.status_code == 200
    assert polled.data["linked"] is True
    assert polled.data["chats"] == [{"chat_id": "888", "label": "Lina"}]
    assert "777" not in str(polled.data["chats"])

    telegram.responses.append(FakeResponse({"ok": True, "result": {"ok": True}}))
    tested = client.post("/api/v1/desktop/telegram/chats/888/test/", {}, format="json")
    assert tested.status_code == 200
    assert tested.data == {"status": "ok", "chat_id": "888"}
    test_call = telegram.calls[-1]
    assert test_call["json"]["chat_id"] == "888"
    assert test_call["json"]["parse_mode"] == "HTML"
    assert token not in test_call["json"]["text"]

    unknown = client.post("/api/v1/desktop/telegram/chats/999/test/", {}, format="json")
    assert unknown.status_code == 404
    assert unknown.data["code"] == "unknown_chat"
    assert telegram.calls[-1] == test_call

    removed = client.delete("/api/v1/desktop/telegram/chats/888/")
    assert removed.status_code == 200
    assert removed.data["chats"] == []


@pytest.mark.django_db
def test_rejected_token_is_not_stored(owner_client, config_store, monkeypatch):
    client, _manager, _cashier = owner_client
    telegram = FakeTelegram([requests.ConnectionError("offline")])
    monkeypatch.setattr(requests, "post", telegram.post)
    response = client.post("/api/v1/desktop/telegram/token/", {"token": "555:nope"}, format="json")
    assert response.status_code == 400
    assert response.data["code"] == "telegram_unreachable"
    assert "telegram_bot_token" not in config_store
