"""
Core Time Verification & Anti-Tamper Service for ShoeDZ / Pointure.

Provides reliable time synchronization and anomaly detection:
1. Online: Queries trusted HTTPS servers (Google, Cloudflare) via standard HTTP Date header.
2. Offline / Dead CMOS Battery Guard: Enforces a monotonic high-water mark based on the
   last legitimate recorded transaction. If the system clock resets to 2000/2010 or is rolled
   back, it prevents backdating and clamps time forward.
"""
import email.utils
import logging
import os
import time
import urllib.request
from datetime import datetime, timedelta
from typing import Optional, Tuple
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# Fallback trusted HTTPS endpoints for Date header verification
TRUSTED_TIME_URLS = [
    "https://www.google.com",
    "https://cloudflare.com",
    "https://1.1.1.1",
]

# In-memory sync state
_state = {
    "skew_seconds": 0.0,
    "last_sync_time": 0.0,
    "sync_source": None,
    "boot_monotonic": time.monotonic(),
    "anomaly_detected": False,
    "anomaly_type": None,
    "anomaly_message": "",
}

CACHE_TTL_SECONDS = 900  # 15 minutes between network sync attempts


def fetch_network_time(timeout: float = 2.5) -> Tuple[Optional[datetime], Optional[str]]:
    """
    Attempt to fetch true UTC datetime from reliable HTTPS endpoints.
    Uses standard library urllib.request to read the HTTP Date header.
    Returns (utc_datetime, source_url) or (None, None).
    """
    for url in TRUSTED_TIME_URLS:
        try:
            req = urllib.request.Request(
                url,
                method="HEAD",
                headers={"User-Agent": "ShoeDZ-TimeSync/1.2"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                date_header = resp.headers.get("Date")
                if date_header:
                    dt = email.utils.parsedate_to_datetime(date_header)
                    if dt:
                        return dt, url
        except Exception:
            continue
    return None, None


def get_last_known_transaction_time() -> Optional[datetime]:
    """
    Retrieve the most recent transaction timestamp recorded in the database.
    Checks Sale and StockMovement created_at.
    """
    try:
        from apps.sales.models import Sale
        last_sale = Sale.objects.order_by("-created_at").values_list("created_at", flat=True).first()
        if last_sale:
            return last_sale
    except Exception:
        pass

    try:
        from apps.inventory.models import StockMovement
        last_mov = StockMovement.objects.order_by("-timestamp").values_list("timestamp", flat=True).first()
        if last_mov:
            return last_mov
    except Exception:
        pass

    return None


def sync_time(force: bool = False) -> dict:
    """
    Synchronize system time offset and perform health / anti-tamper check.
    """
    now_monotonic = time.monotonic()

    # Return cached check if within TTL and not forced
    if not force and _state["last_sync_time"] > 0 and (now_monotonic - _state["last_sync_time"]) < CACHE_TTL_SECONDS:
        return get_time_status()

    os_now = timezone.now()
    net_time, source = fetch_network_time()
    last_tx = get_last_known_transaction_time()

    anomaly = False
    anomaly_type = None
    anomaly_msg = ""

    if net_time is not None:
        # We are online: calculate exact skew
        skew = (net_time - os_now).total_seconds()
        _state["skew_seconds"] = skew
        _state["sync_source"] = source
        _state["last_sync_time"] = now_monotonic

        # Check for severe skew
        if abs(skew) > 86400:  # More than 1 day off (e.g. CMOS battery year reset)
            anomaly = True
            anomaly_type = "DEAD_BATTERY_OR_DATE_RESET"
            anomaly_msg = f"L'horloge locale est décalée de {abs(skew)/86400:.1f} jour(s). Date réseau vérifiée : {net_time.strftime('%d/%m/%Y')}."
        elif abs(skew) > 300:  # More than 5 minutes off
            anomaly = True
            anomaly_type = "CLOCK_SKEW_WARNING"
            anomaly_msg = f"Décalage horaire détecté ({skew:+.0f}s). L'heure est automatiquement ajustée."
    else:
        # Offline mode: check against database high-water mark
        if last_tx and os_now < (last_tx - timedelta(minutes=5)):
            # Local clock is BEHIND last recorded transaction!
            anomaly = True
            anomaly_type = "CLOCK_ROLLED_BACK"
            anomaly_msg = (
                f"L'horloge système ({os_now.strftime('%d/%m/%Y %H:%M')}) est antérieure "
                f"à la dernière vente enregistrée ({last_tx.strftime('%d/%m/%Y %H:%M')}). "
                f"Mode anti-recul activé."
            )
            # Advance skew so that trusted time is at least last_tx + monotonic elapsed
            elapsed = now_monotonic - _state["boot_monotonic"]
            min_target = last_tx + timedelta(seconds=max(1.0, elapsed))
            _state["skew_seconds"] = (min_target - os_now).total_seconds()
            _state["sync_source"] = "db_high_water_mark"
        else:
            if _state["sync_source"] is None:
                _state["sync_source"] = "offline_os"

    _state["last_sync_time"] = now_monotonic
    _state["anomaly_detected"] = anomaly
    _state["anomaly_type"] = anomaly_type
    _state["anomaly_message"] = anomaly_msg

    return get_time_status()


def get_trusted_now() -> datetime:
    """
    Return the trusted current timezone-aware datetime.
    Corrects for network skew or enforces monotonic high-water mark.
    """
    if _state["last_sync_time"] == 0 and not _state.get("is_syncing"):
        _state["is_syncing"] = True
        try:
            sync_time()
        finally:
            _state["is_syncing"] = False

    os_now = timezone.now()
    trusted = os_now + timedelta(seconds=_state["skew_seconds"])

    # Final guard: never produce a timestamp before last known transaction
    last_tx = get_last_known_transaction_time()
    if last_tx and trusted < last_tx:
        trusted = last_tx + timedelta(seconds=1)

    return trusted


def get_time_status() -> dict:
    """Return dictionary of current time status and anomaly diagnostics."""
    trusted_now = get_trusted_now()
    os_now = timezone.now()
    last_tx = get_last_known_transaction_time()

    return {
        "current_time": trusted_now.isoformat(),
        "current_time_display": trusted_now.strftime("%d/%m/%Y %H:%M:%S"),
        "timezone": str(timezone.get_current_timezone()),
        "is_online": _state["sync_source"] not in ("offline_os", "db_high_water_mark", None),
        "is_synchronized": _state["sync_source"] is not None and _state["sync_source"] not in ("offline_os", None),
        "sync_source": _state["sync_source"],
        "skew_seconds": round(_state["skew_seconds"], 2),
        "anomaly_detected": _state["anomaly_detected"],
        "anomaly_type": _state["anomaly_type"],
        "anomaly_message": _state["anomaly_message"],
        "last_known_transaction": last_tx.isoformat() if last_tx else None,
        "os_time": os_now.isoformat(),
    }
