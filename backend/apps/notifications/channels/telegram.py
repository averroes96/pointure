"""Telegram Bot API sender. The desktop app calls Telegram directly."""
import html

import requests


class OutboundSendError(Exception):
    """Delivery failed and the queue should retry (until the 48h deadline)."""


def send_telegram_message(token: str, chat_id: str, text: str, session=None) -> None:
    """
    POST sendMessage with HTML parse mode. Every interpolated value is escaped.
    Network and HTTP failures raise OutboundSendError. The bot token is stripped
    from the error text so it is never stored on the message.
    """
    http = session or requests
    safe = html.escape(text or "", quote=False)
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        response = http.post(
            url,
            json={
                "chat_id": chat_id,
                "text": safe,
                "parse_mode": "HTML",
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        raise OutboundSendError(_redact(str(exc), token)) from exc

    if response.status_code != 200:
        detail = ""
        try:
            detail = response.text[:300]
        except Exception:
            detail = ""
        raise OutboundSendError(_redact(f"HTTP {response.status_code} {detail}".strip(), token))


def _redact(message: str, token: str) -> str:
    if token:
        message = message.replace(token, "***")
    return message[:2000]
