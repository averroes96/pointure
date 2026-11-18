"""
Backup rotation survives a wrong PC clock, and a failed backup leaves nothing behind.

Context: rotation ranks backups by file modification time, which comes from the PC's clock. One store's
log showed the clock at 2072, then 2027, then 2026 within minutes (a dead CMOS battery). A backup made
while the clock is in the past would rank as the oldest and be deleted at once, while the log still said
"created successfully"; a safety backup made before a reset was rotated like any other.
"""
import os
import sqlite3
import time
from pathlib import Path

import pytest

from apps.core.desktop import backup
from apps.core.desktop.backup import MAX_BACKUP_COPIES, PRE_RESET_PREFIX, perform_database_backup, rotate_backups

DAY = 86400


def _make(directory: Path, name: str, age_days: float, content: bytes = b"x") -> Path:
    path = directory / name
    path.write_bytes(content)
    stamp = time.time() - age_days * DAY
    os.utime(path, (stamp, stamp))
    return path


def _names(directory: Path):
    return sorted(p.name for p in directory.glob("*.sqlite3"))


def test_the_most_recent_backups_are_kept_and_the_older_ones_deleted(tmp_path):
    for age in range(20):
        _make(tmp_path, f"db_backup_age_{age:02d}.sqlite3", age_days=age)
    rotate_backups(tmp_path)

    assert _names(tmp_path) == [f"db_backup_age_{age:02d}.sqlite3" for age in range(MAX_BACKUP_COPIES)]


def test_the_backup_just_made_is_kept_even_when_the_clock_put_it_in_the_past(tmp_path):
    for day in range(MAX_BACKUP_COPIES):
        _make(tmp_path, f"db_backup_old_{day:02d}.sqlite3", age_days=day + 1)
    fresh = _make(tmp_path, "db_backup_20260101_120000.sqlite3", age_days=9000)      # modification time in 1999

    rotate_backups(tmp_path, protect=fresh)

    kept = _names(tmp_path)
    assert fresh.name in kept
    assert len(kept) == MAX_BACKUP_COPIES                              # the oldest real backup made room for it
    assert "db_backup_old_13.sqlite3" not in kept


def test_a_backup_dated_in_the_future_ranks_as_the_newest(tmp_path):
    """Kept on purpose: it holds real data from the wrong-clock period, so it is never the one to go."""
    for day in range(MAX_BACKUP_COPIES):
        _make(tmp_path, f"db_backup_real_{day:02d}.sqlite3", age_days=day)
    future = _make(tmp_path, "db_backup_20721017_155942.sqlite3", age_days=-18000)    # 2075

    rotate_backups(tmp_path)

    kept = _names(tmp_path)
    assert future.name in kept and len(kept) == MAX_BACKUP_COPIES
    assert "db_backup_real_13.sqlite3" not in kept


def test_pre_reset_safety_backups_are_never_rotated(tmp_path):
    safety = [_make(tmp_path, f"{PRE_RESET_PREFIX}_2025{n:04d}_000000.sqlite3", age_days=300 + n) for n in range(3)]
    for day in range(30):
        _make(tmp_path, f"db_backup_20260{day:03d}_000000.sqlite3", age_days=day)

    rotate_backups(tmp_path)

    kept = _names(tmp_path)
    assert all(p.name in kept for p in safety)
    assert len([n for n in kept if not n.startswith(PRE_RESET_PREFIX)]) == MAX_BACKUP_COPIES


# ─── perform_database_backup ──────────────────────────────────────────────────

@pytest.fixture
def data_dir(tmp_path, settings):
    settings.DATA_DIR = tmp_path
    database = tmp_path / "db.sqlite3"
    connection = sqlite3.connect(database)
    connection.execute("create table t (a integer)")
    connection.execute("insert into t values (1)")
    connection.commit()
    connection.close()
    return tmp_path, database


def _backups(tmp_path):
    return _names(tmp_path / "backups")


def test_a_backup_taken_under_a_clock_in_the_past_survives_its_own_rotation(data_dir, monkeypatch):
    tmp_path, database = data_dir
    backups = tmp_path / "backups"
    backups.mkdir()
    for day in range(MAX_BACKUP_COPIES):
        _make(backups, f"db_backup_2026{day:04d}_000000.sqlite3", age_days=day + 1)

    real_rotate = backup.rotate_backups

    def rotate_under_a_past_clock(directory, *args, **kwargs):
        newest = max(directory.glob("db_backup_*.sqlite3"), key=lambda p: p.name)   # the name carries the time of the copy
        past = time.time() - 9000 * DAY
        os.utime(newest, (past, past))                                              # as if the PC clock were in 1999
        return real_rotate(directory, *args, **kwargs)

    monkeypatch.setattr(backup, "rotate_backups", rotate_under_a_past_clock)

    created = perform_database_backup(db_path=database)

    assert created is not None and created.exists()
    assert created.name in _backups(tmp_path)
    assert len(_backups(tmp_path)) == MAX_BACKUP_COPIES


def test_a_failed_backup_returns_none_and_leaves_no_partial_file(data_dir, monkeypatch):
    tmp_path, database = data_dir
    real_connect = sqlite3.connect

    class DiskFullSource:
        def backup(self, *args, **kwargs):
            raise sqlite3.OperationalError("database or disk is full")

        def close(self):
            pass

    def connect(path, *args, **kwargs):
        return DiskFullSource() if str(path) == str(database) else real_connect(path, *args, **kwargs)

    monkeypatch.setattr(backup.sqlite3, "connect", connect)

    assert perform_database_backup(db_path=database) is None
    assert _backups(tmp_path) == []
