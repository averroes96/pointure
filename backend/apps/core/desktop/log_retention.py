"""
Keep the desktop logs to the last RETENTION_DAYS days.

The logs are size-capped (RotatingFileHandler), but a store writes little, so one 5 MB shodz.log covered a
month and a half in the pilot store's copy, and the logs hold customer data (phone numbers in requests,
sale payloads). This removes the entries older than RETENTION_DAYS from the backend's own logs:

  - shodz.log, perf.log, python-faults.log (the files being written) and their rotated copies
    (shodz.log.1 …, perf.log.1 …). desktop.log belongs to Electron, which prunes it (desktop/log-retention.js).
  - Logs are append-only, so file order is real order whatever the stamps say. A file is kept from its
    FIRST recent entry (dated within RETENTION_DAYS and not in the future): everything after it was written
    later. So entries stamped by a wrong clock go with the old ones before them (the store's log starts in
    2072) or stay with the recent ones after them (a clock set back for a while), and a file whose first
    entry is recent is not even read further.
  - A file with no recent entry is emptied (a rotated copy: deleted) only when some log in the folder has an
    entry from the last year. Otherwise the PC clock is probably wrong right now (a jump to 2072, or a reset
    to 2000), so nothing is touched rather than wiping the logs needed to diagnose it.
  - Lines without a timestamp (tracebacks, the licence banner) belong to the entry above them.
  - Files are handled as bytes, so encoding and line endings are kept. A trimmed file is written to a
    temporary file and swapped in with os.replace; a file Windows refuses to replace (in use) is skipped
    and done at the next start. A rotated file with nothing recent left is deleted.

Pure standard library: the desktop launcher calls it before Django is set up, i.e. before any log handler
has opened these files. The daily scheduler prunes the rotated copies of a long-running session too.
"""
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

RETENTION_DAYS = 30
ACTIVE_LOGS = ("shodz.log", "perf.log", "python-faults.log")
ROTATED_PATTERNS = ("shodz.log.*", "perf.log.*")

# "[2026-11-14 15:14:37,261] INFO …" (shodz.log) and "=== Backend start 2026-11-14 15:14:37 pid=…" (faults)
_TEXT_STAMP = re.compile(rb"^(?:\[|=== Backend start )(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})")
# perf.log: one JSON object per line, {"timestamp": "2026-11-14T14:14:37.261000+00:00", …}
_JSON_STAMP = re.compile(rb'^\{"timestamp": "(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)"')


def entry_time(line: bytes) -> Optional[datetime]:
    """When the entry starting on this line was written (local time), or None for a continuation line."""
    match = _TEXT_STAMP.match(line)
    if match:
        try:
            return datetime.strptime(f"{match.group(1).decode()} {match.group(2).decode()}", "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    match = _JSON_STAMP.match(line)
    if match:
        try:
            stamp = datetime.fromisoformat(match.group(1).decode().replace("Z", "+00:00"))
        except ValueError:
            return None
        return stamp.astimezone().replace(tzinfo=None) if stamp.tzinfo else stamp
    return None


FUTURE_TOLERANCE = timedelta(days=1)    # a stamp later than this is from a clock ahead of the PC's
CLOCK_DOUBT = timedelta(days=365)       # newest entry older than this: suspect the PC clock, not the log


TAIL_BYTES = 64 * 1024                  # enough to find the last entry of a log


def first_line_to_keep(lines: List[bytes], now: datetime, retention_days: int = RETENTION_DAYS,
                       clock_trusted: Optional[bool] = None) -> int:
    """
    Index of the first line to keep (0: keep everything, len(lines): nothing is recent).

    `clock_trusted` says whether some log in the folder has a recent entry (see prune_logs); left out, it
    is judged on this file alone: its newest believable entry must be less than CLOCK_DOUBT old.
    """
    cutoff = now - timedelta(days=retention_days)
    newest_plausible = None
    for index, line in enumerate(lines):
        stamp = entry_time(line)
        if stamp is None or stamp > now + FUTURE_TOLERANCE:
            continue                    # a continuation line, or stamped by a clock ahead of the PC's
        if stamp >= cutoff:
            return index                # the first recent entry: everything after it was written later
        newest_plausible = stamp if newest_plausible is None else max(newest_plausible, stamp)
    if newest_plausible is None:
        return 0                        # only future stamps: their real age is unknown
    if clock_trusted is None:
        clock_trusted = newest_plausible >= now - CLOCK_DOUBT
    return len(lines) if clock_trusted else 0     # untrusted: the PC clock is probably wrong right now


def newest_believable_time(path: Path, now: datetime) -> Optional[datetime]:
    """Time of the last entry of `path` that is not stamped in the future (reads the tail only)."""
    size = path.stat().st_size
    with path.open("rb") as handle:
        handle.seek(max(0, size - TAIL_BYTES))
        tail = handle.read()
    for line in reversed(tail.splitlines()):
        stamp = entry_time(line)
        if stamp is not None and stamp <= now + FUTURE_TOLERANCE:
            return stamp
    return None


def trim_file(path: Path, now: datetime, retention_days: int = RETENTION_DAYS,
              clock_trusted: Optional[bool] = None) -> int:
    """Remove the entries older than `retention_days` from `path`; returns the number of lines removed."""
    lines = path.read_bytes().splitlines(keepends=True)
    keep_from = first_line_to_keep(lines, now, retention_days, clock_trusted)
    if keep_from == 0:
        return 0
    temporary = path.with_name(path.name + ".tmp")
    try:
        temporary.write_bytes(b"".join(lines[keep_from:]))
        os.replace(temporary, path)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise
    return keep_from


def prune_logs(log_dir: Path, *, now: Optional[datetime] = None, retention_days: int = RETENTION_DAYS,
               include_active: bool = True) -> dict:
    """
    Apply the retention to the backend logs in `log_dir`. `include_active=False` leaves the files being
    written alone (they are open in this process): the scheduler uses it.

    Returns {"trimmed": {name: lines removed}, "deleted": [names], "skipped": [names]}.
    """
    report = {"trimmed": {}, "deleted": [], "skipped": []}
    log_dir = Path(log_dir)
    if not log_dir.is_dir():
        return report
    now = now or datetime.now()

    rotated = sorted({p for pattern in ROTATED_PATTERNS for p in log_dir.glob(pattern)
                      if p.is_file() and not p.name.endswith(".tmp")})
    present = [log_dir / name for name in ACTIVE_LOGS if (log_dir / name).is_file()]
    active = present if include_active else []

    # Judge the clock once for the folder: an entry from the last CLOCK_DOUBT anywhere means the clock agrees
    # with the logs, so a fully old copy goes however old it is; none means the clock may be wrong now.
    newest = None
    for path in rotated + present:
        try:
            stamp = newest_believable_time(path, now)
        except OSError:
            continue
        if stamp is not None and (newest is None or stamp > newest):
            newest = stamp
    clock_trusted = newest is not None and newest >= now - CLOCK_DOUBT

    for path in rotated + active:
        try:
            removed = trim_file(path, now, retention_days, clock_trusted)
            if removed and path in rotated and path.stat().st_size == 0:
                path.unlink()
                report["deleted"].append(path.name)
            elif removed:
                report["trimmed"][path.name] = removed
        except OSError:
            report["skipped"].append(path.name)
    return report


def describe(report: dict, retention_days: int = RETENTION_DAYS) -> str:
    """One log line for a pruning report ("" when nothing was removed or skipped)."""
    parts = [f"{name}: {count} line(s)" for name, count in sorted(report["trimmed"].items())]
    if report["deleted"]:
        parts.append(f"deleted {', '.join(report['deleted'])}")
    if report["skipped"]:
        parts.append(f"in use, retried next start: {', '.join(report['skipped'])}")
    return f"Log retention ({retention_days} days): " + "; ".join(parts) if parts else ""
