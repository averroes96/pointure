"""
Link an owner's Telegram chat without storing the bot token in the database.

The token and the saved chat ids live in desktop config.json. getUpdates is
called once per poll; the settings screen repeats that poll for five minutes.
"""
import secrets
from datetime import timedelta

import requests
from django.utils import timezone
from django.utils.dateparse import parse_datetime

MAX_TELEGRAM_CHATS = 3
LINK_WINDOW = timedelta(minutes=5)


class TelegramLinkError(Exception):
    def __init__(self, message: str, code: str):
        self.code = code
        super().__init__(message)


def new_link_code() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def public_telegram_status(config: dict, now=None) -> dict:
    """Status safe to return to the browser. The bot token is never included."""
    now = now or timezone.now()
    expires = _parse_expiry(config.get("telegram_link_expires"))
    code = str(config.get("telegram_link_code") or "")
    pending = bool(code) and expires is not None and now < expires
    return {
        "has_token": bool(str(config.get("telegram_bot_token") or "").strip()),
        "bot_username": str(config.get("telegram_bot_username") or ""),
        "chats": chat_list(config),
        "max_chats": MAX_TELEGRAM_CHATS,
        "pending_link": {"code": code, "expires_at": expires.isoformat()} if pending else None,
    }


def chat_list(config: dict) -> list[dict]:
    raw = config.get("telegram_chats") or []
    chats = []
    if not isinstance(raw, list):
        return chats
    for item in raw:
        if not isinstance(item, dict):
            continue
        chat_id = str(item.get("chat_id") or "").strip()
        if not _valid_chat_id(chat_id):
            continue
        chats.append({
            "chat_id": chat_id,
            "label": str(item.get("label") or "")[:80],
        })
        if len(chats) >= MAX_TELEGRAM_CHATS:
            break
    return chats


def validate_bot_token(token: str, session) -> dict:
    """Call getMe. Returns the bot username. Does not write config."""
    token = (token or "").strip()
    if not token or any(ch.isspace() for ch in token):
        raise TelegramLinkError("Jeton Telegram invalide.", "invalid_token")
    payload = _call(token, "getMe", session, {})
    username = str((payload.get("result") or {}).get("username") or "")
    return {"username": username}


def token_updates(config: dict, token: str, username: str) -> dict:
    token = token.strip()
    updates = {
        "telegram_bot_token": token,
        "telegram_bot_username": username,
        "telegram_link_code": "",
        "telegram_link_expires": "",
    }
    if str(config.get("telegram_bot_token") or "") != token:
        updates["telegram_chats"] = []
        updates["telegram_update_offset"] = None
    return updates


def begin_link(now=None) -> dict:
    now = now or timezone.now()
    return {
        "telegram_link_code": new_link_code(),
        "telegram_link_expires": (now + LINK_WINDOW).isoformat(),
    }


def poll_link(config: dict, session, now=None) -> tuple[dict, dict]:
    """
    Read one getUpdates page. A matching `/start <code>` from a new chat is stored.
    Every other message is ignored. Returns (config updates, result).
    """
    now = now or timezone.now()
    token = str(config.get("telegram_bot_token") or "").strip()
    if not token:
        raise TelegramLinkError("Aucun jeton Telegram enregistré.", "no_token")

    code = str(config.get("telegram_link_code") or "")
    expires = _parse_expiry(config.get("telegram_link_expires"))
    if not code or expires is None or now >= expires:
        raise TelegramLinkError("Le code de liaison a expiré.", "link_expired")

    params = {"timeout": 0, "allowed_updates": ["message"]}
    offset = config.get("telegram_update_offset")
    if isinstance(offset, int):
        params["offset"] = offset

    payload = _call(token, "getUpdates", session, params)
    updates = payload.get("result") or []
    chats = chat_list(config)
    linked = None
    ignored = 0
    limit_hit = False
    next_offset = offset if isinstance(offset, int) else None

    for update in updates:
        if not isinstance(update, dict):
            continue
        update_id = update.get("update_id")
        if isinstance(update_id, int):
            next_offset = update_id + 1
        message = update.get("message") or {}
        started = _start_code(str(message.get("text") or ""))
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id")) if chat.get("id") is not None else ""
        if started != code or not _valid_chat_id(chat_id):
            ignored += 1
            continue
        if any(item["chat_id"] == chat_id for item in chats):
            linked = next(item for item in chats if item["chat_id"] == chat_id)
            continue
        if len(chats) >= MAX_TELEGRAM_CHATS:
            limit_hit = True
            ignored += 1
            continue
        label = str(chat.get("first_name") or chat.get("username") or "Telegram")[:80]
        linked = {"chat_id": chat_id, "label": label}
        chats.append(linked)

    config_updates = {}
    if next_offset is not None:
        config_updates["telegram_update_offset"] = next_offset
    if linked and linked in chats:
        config_updates["telegram_chats"] = chats
    if linked:
        config_updates["telegram_link_code"] = ""
        config_updates["telegram_link_expires"] = ""

    result = {
        "linked": linked is not None,
        "chat": linked,
        "ignored": ignored,
        "limit_reached": limit_hit and linked is None,
    }
    return config_updates, result


def remove_chat(config: dict, chat_id: str) -> dict:
    chat_id = str(chat_id)
    if not _valid_chat_id(chat_id):
        raise TelegramLinkError("Identifiant de discussion invalide.", "invalid_chat")
    chats = [item for item in chat_list(config) if item["chat_id"] != chat_id]
    if len(chats) == len(chat_list(config)):
        raise TelegramLinkError("Cette discussion n'est pas liée.", "unknown_chat")
    return {"telegram_chats": chats}


def known_chat(config: dict, chat_id: str) -> dict:
    chat_id = str(chat_id)
    for item in chat_list(config):
        if item["chat_id"] == chat_id:
            return item
    raise TelegramLinkError("Cette discussion n'est pas liée.", "unknown_chat")


def _call(token: str, method: str, session, params: dict) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    try:
        response = session.post(url, json=params, timeout=10)
    except requests.RequestException as exc:
        raise TelegramLinkError("Telegram est injoignable.", "telegram_unreachable") from exc
    try:
        payload = response.json()
    except ValueError as exc:
        raise TelegramLinkError("Réponse Telegram illisible.", "telegram_error") from exc
    if response.status_code != 200 or not payload.get("ok"):
        raise TelegramLinkError("Telegram a refusé la requête.", "telegram_rejected")
    return payload


def _start_code(text: str) -> str | None:
    parts = (text or "").strip().split()
    if len(parts) < 2:
        return None
    command = parts[0].split("@", 1)[0]
    if command != "/start":
        return None
    code = parts[1].strip()
    if len(code) == 6 and code.isdigit():
        return code
    return None


def _valid_chat_id(chat_id: str) -> bool:
    if not chat_id or len(chat_id) > 20:
        return False
    digits = chat_id[1:] if chat_id.startswith("-") else chat_id
    return digits.isdigit() and digits != ""


def _parse_expiry(value):
    if not value or not isinstance(value, str):
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed
