"""
The desktop logs keep the last 30 days (apps.core.desktop.log_retention).

Context: the pilot store's single 5 MB shodz.log covered a month and a half and started with lines dated
2072 (a wrong PC clock). The logs hold customer data, and size rotation alone kept old entries for as long
as the store wrote little.
"""
import os
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path

import pytest

from apps.core.desktop import log_retention
from apps.core.desktop.log_retention import (
    RETENTION_DAYS, describe, entry_time, first_line_to_keep, prune_logs, trim_file,
)

NOW = datetime(2026, 11, 18, 10, 0, 0)


def stamp(days_ago: float, fmt: str = "shodz") -> bytes:
    when = NOW - timedelta(days=days_ago)
    if fmt == "shodz":
        return f"[{when:%Y-%m-%d %H:%M:%S},123]".encode()
    if fmt == "faults":
        return f"=== Backend start {when:%Y-%m-%d %H:%M:%S} pid=42 ===".encode()
    raise ValueError(fmt)


def shodz_line(days_ago, text="INFO shodz.desktop [MainThread] message"):
    return stamp(days_ago) + b" " + text.encode() + b"\n"


def write(directory: Path, name: str, content: bytes) -> Path:
    path = directory / name
    path.write_bytes(content)
    return path


# ─── Timestamps ───────────────────────────────────────────────────────────────

def test_entry_times_are_read_from_every_backend_format():
    assert entry_time(b"[2026-11-14 15:14:37,261] ERROR apps.core.views [waitress-5] Legacy DBF import failed\n") \
        == datetime(2026, 11, 14, 15, 14, 37)
    assert entry_time(b"=== Backend start 2026-11-14 15:14:37 pid=2192 ===\n") == datetime(2026, 11, 14, 15, 14, 37)
    perf = b'{"timestamp": "2026-11-14T14:14:37.261000+00:00", "method": "GET", "path": "/api/v1/sales/"}\n'
    utc = datetime(2026, 11, 14, 14, 14, 37, 261000, tzinfo=dt_timezone.utc)
    assert entry_time(perf) == utc.astimezone().replace(tzinfo=None)          # compared in local time


@pytest.mark.parametrize("line", [
    b"Traceback (most recent call last):\n",
    b'  File "C:\\Program Files\\ShoeDZ\\resources\\backend\\apps\\core\\views.py", line 643, in post\n',
    "╔══════════════════════════════════════════════════════════════════╗\n".encode(),
    b"\n",
    b"[not a date] something\n",
    b"[2026-13-45 99:99:99,000] impossible date\n",
])
def test_continuation_and_malformed_lines_have_no_time(line):
    assert entry_time(line) is None


# ─── Where the cut falls ──────────────────────────────────────────────────────

def test_the_file_is_kept_from_its_first_recent_entry_old_tracebacks_go_too():
    lines = [
        shodz_line(45),
        shodz_line(40, "ERROR apps.core.views Legacy DBF import failed"),
        b"Traceback (most recent call last):\n",
        b"ValueError: StockMovement object can't be deleted\n",
        shodz_line(29),
        b"  continuation of a recent entry\n",
        shodz_line(0),
    ]
    assert RETENTION_DAYS == 30
    assert first_line_to_keep(lines, NOW) == 4


def test_entries_stamped_by_a_clock_ahead_go_with_the_old_ones_before_the_first_recent_entry():
    """The store's log: 2072 at the top (clock wrong), then real dates. File order is writing order."""
    lines = [
        b"[2072-10-17 15:58:46,725] INFO shodz.desktop [MainThread] Backend starting\n",
        b"[2027-10-17 16:09:24,798] WARNING django.request Unauthorized\n",
        shodz_line(48),
        shodz_line(5),
        b"[2072-10-17 09:00:00,000] INFO written after the recent entry: kept\n",
    ]
    assert first_line_to_keep(lines, NOW) == 3


def test_entries_stamped_by_a_clock_set_back_after_a_recent_entry_are_kept():
    """Written after a recent entry, so recent in real time even though the stamp looks two months old."""
    lines = [shodz_line(40), shodz_line(10), shodz_line(60, "INFO stamped by a clock set back"), shodz_line(2)]
    assert first_line_to_keep(lines, NOW) == 1


def test_a_file_whose_first_entry_is_recent_is_kept_whole_and_not_read_further(monkeypatch):
    lines = [shodz_line(20), b"  more\n", shodz_line(1)] + [shodz_line(99)] * 1000
    calls = []
    real = log_retention.entry_time
    monkeypatch.setattr(log_retention, "entry_time", lambda line: calls.append(line) or real(line))
    assert first_line_to_keep(lines, NOW) == 0
    assert len(calls) == 1


def test_everything_goes_when_every_entry_is_old():
    lines = [shodz_line(60), b"  more\n", shodz_line(31)]
    assert first_line_to_keep(lines, NOW) == len(lines)


@pytest.mark.parametrize("pc_clock,lines", [
    # The PC clock jumped forward (the store's 2072): the real entries all look years old.
    (datetime(2072, 10, 17, 15, 58), [shodz_line(40), shodz_line(2)]),
    # The PC clock was reset to 2000 (dead battery): every real entry looks like it is in the future.
    (datetime(2000, 1, 1, 0, 0), [shodz_line(40), shodz_line(2)]),
    # Only entries stamped by a clock ahead of today's: their real age is unknown.
    (NOW, [b"[2072-10-17 15:58:46,725] INFO a\n", b"[2072-10-17 16:00:00,000] INFO b\n"]),
])
def test_nothing_is_removed_when_the_pc_clock_itself_looks_wrong(pc_clock, lines):
    assert first_line_to_keep(lines, pc_clock) == 0


# ─── Files ────────────────────────────────────────────────────────────────────

def test_a_file_keeps_its_bytes_encoding_and_line_endings(tmp_path):
    recent = stamp(2) + " Vente enregistrée — client «Amine» \x00\r\n".encode("utf-8") + b"\xff\xfe raw bytes\r\n"
    path = write(tmp_path, "shodz.log", shodz_line(40) + recent)
    assert trim_file(path, NOW) == 1
    assert path.read_bytes() == recent
    assert not (tmp_path / "shodz.log.tmp").exists()


def test_a_file_without_old_entries_is_not_rewritten(tmp_path):
    path = write(tmp_path, "shodz.log", shodz_line(3) + shodz_line(1))
    old = NOW.timestamp() - 3600
    os.utime(path, (old, old))
    assert trim_file(path, NOW) == 0
    assert path.stat().st_mtime == old


def test_prune_trims_the_active_logs_and_deletes_fully_old_rotated_copies(tmp_path):
    write(tmp_path, "shodz.log", shodz_line(35) + shodz_line(2))
    write(tmp_path, "shodz.log.1", shodz_line(50) + shodz_line(40))                          # all old
    write(tmp_path, "shodz.log.2", shodz_line(45) + shodz_line(10))                          # partly old
    perf_old = f'{{"timestamp": "{(NOW - timedelta(days=40)).isoformat()}+00:00", "path": "/x"}}\n'.encode()
    perf_new = f'{{"timestamp": "{(NOW - timedelta(days=1)).isoformat()}+00:00", "path": "/y"}}\n'.encode()
    write(tmp_path, "perf.log", perf_old + perf_new)
    write(tmp_path, "python-faults.log", b"\n" + stamp(33, "faults") + b"\nFatal Python error\n\n"
          + stamp(3, "faults") + b"\n")

    report = prune_logs(tmp_path, now=NOW)

    assert report == {
        "trimmed": {"shodz.log": 1, "shodz.log.2": 1, "perf.log": 1, "python-faults.log": 4},
        "deleted": ["shodz.log.1"],
        "skipped": [],
    }
    assert (tmp_path / "shodz.log").read_bytes() == shodz_line(2)
    assert (tmp_path / "shodz.log.2").read_bytes() == shodz_line(10)
    assert (tmp_path / "perf.log").read_bytes() == perf_new
    assert (tmp_path / "python-faults.log").read_bytes() == stamp(3, "faults") + b"\n"
    assert not (tmp_path / "shodz.log.1").exists()


def test_an_active_log_with_only_old_entries_is_emptied_not_deleted(tmp_path):
    write(tmp_path, "shodz.log", shodz_line(90))
    assert prune_logs(tmp_path, now=NOW)["trimmed"] == {"shodz.log": 1}
    assert (tmp_path / "shodz.log").exists() and (tmp_path / "shodz.log").read_bytes() == b""


def test_electrons_logs_and_unknown_files_are_left_alone(tmp_path):
    for name in ("desktop.log", "desktop.old.log", "notes.txt"):
        write(tmp_path, name, shodz_line(90))
    assert prune_logs(tmp_path, now=NOW) == {"trimmed": {}, "deleted": [], "skipped": []}
    assert all((tmp_path / name).read_bytes() == shodz_line(90) for name in ("desktop.log", "desktop.old.log", "notes.txt"))


def test_without_the_active_files_only_rotated_copies_are_pruned(tmp_path):
    write(tmp_path, "shodz.log", shodz_line(90))
    write(tmp_path, "shodz.log.3", shodz_line(90))
    report = prune_logs(tmp_path, now=NOW, include_active=False)
    assert report == {"trimmed": {}, "deleted": ["shodz.log.3"], "skipped": []}
    assert (tmp_path / "shodz.log").read_bytes() == shodz_line(90)


def test_a_file_windows_refuses_to_replace_is_skipped_intact(tmp_path, monkeypatch):
    content = shodz_line(40) + shodz_line(1)
    write(tmp_path, "shodz.log", content)

    def in_use(source, destination):
        raise PermissionError(32, "The process cannot access the file because it is being used by another process")

    monkeypatch.setattr(log_retention.os, "replace", in_use)
    report = prune_logs(tmp_path, now=NOW)
    assert report == {"trimmed": {}, "deleted": [], "skipped": ["shodz.log"]}
    assert (tmp_path / "shodz.log").read_bytes() == content
    assert not (tmp_path / "shodz.log.tmp").exists()


def test_a_missing_log_folder_is_not_an_error(tmp_path):
    assert prune_logs(tmp_path / "nope", now=NOW) == {"trimmed": {}, "deleted": [], "skipped": []}


def test_the_report_reads_as_one_log_line():
    assert describe({"trimmed": {}, "deleted": [], "skipped": []}) == ""
    assert describe({"trimmed": {"shodz.log": 812}, "deleted": ["shodz.log.4"], "skipped": ["perf.log"]}) == (
        "Log retention (30 days): shodz.log: 812 line(s); deleted shodz.log.4; in use, retried next start: perf.log"
    )


# ─── Scheduler ────────────────────────────────────────────────────────────────

def test_the_daily_job_prunes_rotated_copies_of_the_configured_log_folder(tmp_path, settings):
    from apps.core.desktop.scheduler import prune_rotated_logs

    settings.LOG_DIR = tmp_path
    today = datetime.now()
    recent = f"[{today - timedelta(hours=2):%Y-%m-%d %H:%M:%S},000] INFO recent\n".encode()
    old = f"[{today - timedelta(days=60):%Y-%m-%d %H:%M:%S},000] INFO old\n".encode()
    write(tmp_path, "shodz.log", old + recent)
    write(tmp_path, "perf.log.1", old)
    assert prune_rotated_logs() == {"trimmed": {}, "deleted": ["perf.log.1"], "skipped": []}
    assert (tmp_path / "shodz.log").read_bytes() == old + recent      # being written: trimmed at the next start


def test_rotated_copies_years_old_go_when_the_current_log_is_recent(tmp_path):
    write(tmp_path, "shodz.log", shodz_line(1))
    write(tmp_path, "shodz.log.5", shodz_line(800) + shodz_line(790))
    assert prune_logs(tmp_path, now=NOW) == {"trimmed": {}, "deleted": ["shodz.log.5"], "skipped": []}


def test_nothing_goes_when_no_log_has_an_entry_from_the_last_year(tmp_path):
    """Every log looks years old: the PC clock probably jumped forward, so the logs are kept to diagnose it."""
    write(tmp_path, "shodz.log", shodz_line(800) + shodz_line(500))
    write(tmp_path, "shodz.log.1", shodz_line(900))
    assert prune_logs(tmp_path, now=NOW) == {"trimmed": {}, "deleted": [], "skipped": []}
    assert (tmp_path / "shodz.log.1").exists()


def test_the_daily_job_never_raises(settings, monkeypatch):
    from apps.core.desktop import scheduler

    settings.LOG_DIR = "/definitely/not/a/folder"
    assert scheduler.prune_rotated_logs() == {"trimmed": {}, "deleted": [], "skipped": []}

    def boom(*args, **kwargs):
        raise RuntimeError("disk gone")

    monkeypatch.setattr(log_retention, "prune_logs", boom)
    assert scheduler.prune_rotated_logs() is None
