"""
Core Time Verification & Anti-Tamper Service for ShoeDZ / Pointure.

Provides reliable time synchronization and anomaly detection:
1. Online: Queries trusted HTTPS servers (Google, Cloudflare) via standard HTTP Date header.
2. Offline / Dead CMOS Battery Guard: Enforces a monotonic high-water mark based on the
   last legitimate recorded transaction. If the system clock resets to 2000/2010 or is rolled
   back, it prevents backdating and clamps time forward.

The network check NEVER runs inside a request (AGENTS.md §3, §4.7). The stores run this
app offline most of the time, and a DNS lookup on a LAN without internet can hang far past
any socket timeout: inside a request that froze the user for up to 17 s. Instead:

  - `sync_time()` / `get_trusted_now()` answer at once from the cached state. The cheap,
    database-only anti-rollback check runs synchronously (once, then after every attempt);
  - a network refresh is requested in a background thread when one is due, one at a time,
    with a hard deadline, and backs off while offline (15 min → 6 h);
  - an explicit "resync" (`force=True`) may wait a few seconds for that thread, no more.
"""
import email.utils
import logging
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from typing import Optional, Tuple

from django.db import connection
from django.utils import timezone

logger = logging.getLogger(__name__)

# Fallback trusted HTTPS endpoints for Date header verification
TRUSTED_TIME_URLS = [
    "https://www.google.com",
    "https://cloudflare.com",
    "https://1.1.1.1",
]

CACHE_TTL_SECONDS = 900                 # 15 minutes between network attempts after a success
# Wait before the next attempt after 1, 2, 3… failures in a row (offline): 15 min → 6 h.
BACKOFF_SECONDS = (900, 1800, 3600, 7200, 14400, 21600)
NETWORK_DEADLINE_SECONDS = 8.0          # one whole attempt, all hosts together
FORCED_WAIT_SECONDS = 3.0               # an explicit "resync" waits at most this long

# In-memory sync state
_state = {
    "skew_seconds": 0.0,
    "last_sync_time": 0.0,              # monotonic time of the last finished network attempt
    "sync_source": None,
    "boot_monotonic": time.monotonic(),
    "anomaly_detected": False,
    "anomaly_type": None,
    "anomaly_message": "",
    "refreshing": False,                # a background attempt is queued or running
    "failures": 0,                      # network attempts failed in a row
    "next_attempt": 0.0,                # monotonic time before which no attempt is requested
    "guard_checked": False,             # the database-only guard ran at least once
}
_flag_lock = threading.Lock()           # check-and-set of `refreshing`
_refresh_lock = threading.Lock()        # one network attempt at a time


def fetch_network_time(
    timeout: float = 2.5, deadline: float = NETWORK_DEADLINE_SECONDS,
) -> Tuple[Optional[datetime], Optional[str]]:
    """
    Attempt to fetch true UTC datetime from reliable HTTPS endpoints.
    Uses standard library urllib.request to read the HTTP Date header.
    Returns (utc_datetime, source_url) or (None, None). Blocking: never call it from a
    request (see the module docstring). At least one host is tried; further hosts only
    while the whole attempt is under `deadline` seconds.
    """
    started = time.monotonic()
    for index, url in enumerate(TRUSTED_TIME_URLS):
        if index and time.monotonic() - started >= deadline:
            break
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


# ─── Checks (no network) ──────────────────────────────────────────────────────

def _apply_rollback_guard(os_now: datetime, last_tx: Optional[datetime], now_monotonic: float,
                          attempted: bool) -> None:
    """
    Database high-water-mark check: is the local clock behind the last recorded transaction?
    `attempted` is True after a network attempt that failed (the store is offline): only then
    is the source reported as "offline_os". Before any attempt it stays unset, so a refresh in
    flight is not reported as "offline".
    """
    if last_tx and os_now < (last_tx - timedelta(minutes=5)):
        # Local clock is BEHIND last recorded transaction!
        # Advance skew so that trusted time is at least last_tx + monotonic elapsed
        elapsed = now_monotonic - _state["boot_monotonic"]
        min_target = last_tx + timedelta(seconds=max(1.0, elapsed))
        _state["skew_seconds"] = (min_target - os_now).total_seconds()
        _state["sync_source"] = "db_high_water_mark"
        _state["anomaly_detected"] = True
        _state["anomaly_type"] = "CLOCK_ROLLED_BACK"
        _state["anomaly_message"] = (
            f"L'horloge système ({os_now.strftime('%d/%m/%Y %H:%M')}) est antérieure "
            f"à la dernière vente enregistrée ({last_tx.strftime('%d/%m/%Y %H:%M')}). "
            f"Mode anti-recul activé."
        )
        return

    _state["anomaly_detected"] = False
    _state["anomaly_type"] = None
    _state["anomaly_message"] = ""
    if attempted and _state["sync_source"] is None:
        _state["sync_source"] = "offline_os"


def _apply_network_time(net_time: datetime, source: str, os_now: datetime) -> None:
    """We are online: record the exact skew and flag a clock that is far off."""
    skew = (net_time - os_now).total_seconds()
    _state["skew_seconds"] = skew
    _state["sync_source"] = source

    anomaly, anomaly_type, anomaly_msg = False, None, ""
    if abs(skew) > 86400:  # More than 1 day off (e.g. CMOS battery year reset)
        anomaly = True
        anomaly_type = "DEAD_BATTERY_OR_DATE_RESET"
        anomaly_msg = f"L'horloge locale est décalée de {abs(skew)/86400:.1f} jour(s). Date réseau vérifiée : {net_time.strftime('%d/%m/%Y')}."
    elif abs(skew) > 300:  # More than 5 minutes off
        anomaly = True
        anomaly_type = "CLOCK_SKEW_WARNING"
        anomaly_msg = f"Décalage horaire détecté ({skew:+.0f}s). L'heure est automatiquement ajustée."
    _state["anomaly_detected"] = anomaly
    _state["anomaly_type"] = anomaly_type
    _state["anomaly_message"] = anomaly_msg


def _ensure_local_guard() -> None:
    """Run the database-only guard once, before the first answer (a few cheap queries)."""
    if _state["guard_checked"]:
        return
    _apply_rollback_guard(timezone.now(), get_last_known_transaction_time(), time.monotonic(), attempted=False)
    _state["guard_checked"] = True


# ─── Network refresh (background only) ────────────────────────────────────────

def refresh_network_time() -> bool:
    """
    One network attempt plus the matching checks. BLOCKING: run it from a background thread
    or a scheduler, never from a request. One attempt at a time (returns False at once if
    another is running). Returns True when a network time was obtained.

    Success: next attempt in CACHE_TTL_SECONDS. Failure (offline): the database guard runs
    and the next attempt backs off 15 min → 6 h; a success resets it.
    """
    if not _refresh_lock.acquire(blocking=False):
        return False
    try:
        _state["refreshing"] = True
        os_now = timezone.now()
        net_time, source = fetch_network_time()
        now_monotonic = time.monotonic()

        if net_time is not None:
            _apply_network_time(net_time, source, os_now)
            _state["failures"] = 0
            _state["next_attempt"] = now_monotonic + CACHE_TTL_SECONDS
        else:
            _apply_rollback_guard(os_now, get_last_known_transaction_time(), now_monotonic, attempted=True)
            _state["failures"] += 1
            step = min(_state["failures"], len(BACKOFF_SECONDS)) - 1
            _state["next_attempt"] = now_monotonic + BACKOFF_SECONDS[step]

        _state["last_sync_time"] = now_monotonic
        _state["guard_checked"] = True
        return net_time is not None
    finally:
        _state["refreshing"] = False
        _refresh_lock.release()


def _refresh_thread() -> None:
    try:
        refresh_network_time()
    except Exception:
        logger.exception("Time synchronization failed")
    finally:
        _state["refreshing"] = False
        connection.close()      # this thread's own database connection


def request_refresh(force: bool = False) -> Optional[threading.Thread]:
    """
    Start a background network refresh when one is due (or `force`) and none is running.
    Returns the thread, or None when nothing was started. Never blocks.
    """
    with _flag_lock:
        if _state["refreshing"] or (not force and time.monotonic() < _state["next_attempt"]):
            return None
        _state["refreshing"] = True
    thread = threading.Thread(target=_refresh_thread, name="time-sync", daemon=True)
    try:
        thread.start()
    except Exception:
        _state["refreshing"] = False
        logger.exception("Could not start the time synchronization thread")
        return None
    return thread


def sync_time(force: bool = False, wait: float = 0.0) -> dict:
    """
    Current time status. NEVER does network work itself: it answers from the cached state,
    after the database-only guard, and requests a background refresh when one is due.
    `force` (an explicit "resync") skips the backoff and, with `wait` > 0, waits at most that
    many seconds for the refresh before answering.
    """
    _ensure_local_guard()
    thread = request_refresh(force=force)
    if thread is not None and force and wait > 0:
        thread.join(wait)
    return get_time_status()


def _trusted_from(last_tx: Optional[datetime]) -> datetime:
    trusted = timezone.now() + timedelta(seconds=_state["skew_seconds"])
    # Final guard: never produce a timestamp before last known transaction
    if last_tx and trusted < last_tx:
        trusted = last_tx + timedelta(seconds=1)
    return trusted


def get_trusted_now() -> datetime:
    """
    Return the trusted current timezone-aware datetime.
    Corrects for network skew or enforces monotonic high-water mark. Never touches the
    network, so a sale is never delayed by it.
    """
    _ensure_local_guard()
    return _trusted_from(get_last_known_transaction_time())


def get_time_status() -> dict:
    """Return dictionary of current time status and anomaly diagnostics."""
    _ensure_local_guard()
    last_tx = get_last_known_transaction_time()
    trusted_now = _trusted_from(last_tx)
    os_now = timezone.now()

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
        "refreshing": _state["refreshing"],
    }
