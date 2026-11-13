"""Owner-only Telegram linking. The token stays in desktop config.json."""
import threading

import requests
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.notifications.channels.telegram import OutboundSendError, send_telegram_message
from apps.notifications.services.telegram_link import (
    MAX_TELEGRAM_CHATS,
    TelegramLinkError,
    begin_link,
    chat_list,
    known_chat,
    poll_link,
    public_telegram_status,
    remove_chat,
    token_updates,
    validate_bot_token,
)

_config_lock = threading.Lock()


def _owner_guard(request):
    if getattr(request.user, "role", "") != "owner":
        return _error(_("Seul le propriétaire peut gérer le lien Telegram."), "not_owner", status.HTTP_403_FORBIDDEN)
    return None


def _error(message, code, http_status):
    return Response({"detail": message, "code": code}, status=http_status)


def _load_save():
    from apps.core.desktop.backup import load_desktop_config, save_desktop_config
    return load_desktop_config, save_desktop_config


def _with_config(mutator):
    load_desktop_config, save_desktop_config = _load_save()
    with _config_lock:
        config = load_desktop_config()
        updates = mutator(config)
        if updates:
            save_desktop_config(updates)
            config = {**config, **updates}
        return config


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def telegram_status_view(request):
    denied = _owner_guard(request)
    if denied:
        return denied
    load_desktop_config, _save = _load_save()
    return Response(public_telegram_status(load_desktop_config(), now=timezone.now()))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def telegram_token_view(request):
    denied = _owner_guard(request)
    if denied:
        return denied
    token = str(request.data.get("token") or "")
    try:
        identity = validate_bot_token(token, requests)
    except TelegramLinkError as exc:
        return _error(str(exc), exc.code, status.HTTP_400_BAD_REQUEST)

    def mutate(config):
        return token_updates(config, token, identity["username"])

    config = _with_config(mutate)
    return Response(public_telegram_status(config, now=timezone.now()))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def telegram_link_view(request):
    denied = _owner_guard(request)
    if denied:
        return denied
    now = timezone.now()

    def mutate(config):
        if not str(config.get("telegram_bot_token") or "").strip():
            raise TelegramLinkError(_("Aucun jeton Telegram enregistré."), "no_token")
        if len(chat_list(config)) >= MAX_TELEGRAM_CHATS:
            raise TelegramLinkError(_("Trois discussions sont déjà liées."), "chat_limit")
        return begin_link(now)

    try:
        config = _with_config(mutate)
    except TelegramLinkError as exc:
        return _error(str(exc), exc.code, status.HTTP_400_BAD_REQUEST)
    return Response(public_telegram_status(config, now=now))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def telegram_poll_view(request):
    denied = _owner_guard(request)
    if denied:
        return denied
    now = timezone.now()
    outcome = {}

    def mutate(config):
        updates, result = poll_link(config, requests, now=now)
        outcome.update(result)
        return updates

    try:
        config = _with_config(mutate)
    except TelegramLinkError as exc:
        return _error(str(exc), exc.code, status.HTTP_400_BAD_REQUEST)

    body = public_telegram_status(config, now=now)
    body["linked"] = bool(outcome.get("linked"))
    body["chat"] = outcome.get("chat")
    body["limit_reached"] = bool(outcome.get("limit_reached"))
    return Response(body)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def telegram_unlink_view(request, chat_id):
    denied = _owner_guard(request)
    if denied:
        return denied

    def mutate(config):
        return remove_chat(config, chat_id)

    try:
        config = _with_config(mutate)
    except TelegramLinkError as exc:
        http_status = status.HTTP_404_NOT_FOUND if exc.code == "unknown_chat" else status.HTTP_400_BAD_REQUEST
        return _error(str(exc), exc.code, http_status)
    return Response(public_telegram_status(config, now=timezone.now()))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def telegram_test_view(request, chat_id):
    """Send one test message. Unknown chats are refused and never contacted."""
    denied = _owner_guard(request)
    if denied:
        return denied
    load_desktop_config, _save = _load_save()
    config = load_desktop_config()
    token = str(config.get("telegram_bot_token") or "").strip()
    if not token:
        return _error(_("Aucun jeton Telegram enregistré."), "no_token", status.HTTP_400_BAD_REQUEST)
    try:
        chat = known_chat(config, chat_id)
    except TelegramLinkError as exc:
        return _error(str(exc), exc.code, status.HTTP_404_NOT_FOUND)
    text = _("ShoeDZ : message de test. Le lien Telegram fonctionne.")
    try:
        send_telegram_message(token, chat["chat_id"], text)
    except OutboundSendError as exc:
        return _error(str(exc), "send_failed", status.HTTP_502_BAD_GATEWAY)
    return Response({"status": "ok", "chat_id": chat["chat_id"]})
