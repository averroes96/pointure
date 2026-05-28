"""
HTTP client for the ShoeDZ license server.

Calls:
  POST <LICENSE_SERVER_URL>/api/activate/
  POST <LICENSE_SERVER_URL>/api/heartbeat/

Both endpoints return { "valid": bool, ... }.
"""
import logging
import socket

import requests
from django.conf import settings

from .machine_id import get_machine_id

logger = logging.getLogger(__name__)

_TIMEOUT = 10  # seconds


def _server_url() -> str:
    return getattr(settings, "LICENSE_SERVER_URL", "https://licenses.shodz.app").rstrip("/")


def _app_version() -> str:
    return getattr(settings, "APP_VERSION", "1.0.0")


def _hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return ""


def activate(license_key: str) -> dict:
    """
    Register this machine with the license server.

    Returns the parsed JSON body, or a synthetic ``{"valid": False, "error":
    "network_error"}`` dict on connection failure.
    """
    url = f"{_server_url()}/api/activate/"
    payload = {
        "license_key": license_key,
        "machine_id": get_machine_id(),
        "hostname": _hostname(),
        "app_version": _app_version(),
    }
    try:
        resp = requests.post(url, json=payload, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        logger.warning("License activation request failed: %s", exc)
        return {"valid": False, "error": "network_error"}


def heartbeat(license_key: str) -> dict:
    """
    Send a heartbeat to the license server for an already-activated machine.

    Returns the parsed JSON body, or ``{"valid": False, "error":
    "network_error"}`` on connection failure.
    """
    url = f"{_server_url()}/api/heartbeat/"
    payload = {
        "license_key": license_key,
        "machine_id": get_machine_id(),
        "app_version": _app_version(),
    }
    try:
        resp = requests.post(url, json=payload, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        logger.warning("License heartbeat request failed: %s", exc)
        return {"valid": False, "error": "network_error"}
