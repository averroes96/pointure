import json
from datetime import datetime, timedelta
from pathlib import Path
import pytest

from apps.core.desktop.scheduler import (
    load_scheduler_state,
    save_scheduler_state,
    should_run_daily_tasks,
)


class TestDesktopScheduler:
    def test_should_run_daily_tasks_when_never_run(self):
        """If last_run is None, tasks should always run."""
        now = datetime(2026, 11, 5, 10, 0, 0)
        assert should_run_daily_tasks(None, now=now) is True

    def test_should_not_run_if_already_ran_today_within_24h(self):
        """If already ran today and less than 24h passed, do not run again."""
        last_run = datetime(2026, 11, 5, 8, 30, 0)
        now_1h_later = datetime(2026, 11, 5, 9, 30, 0)
        now_evening = datetime(2026, 11, 5, 22, 0, 0)

        assert should_run_daily_tasks(last_run, now=now_1h_later) is False
        assert should_run_daily_tasks(last_run, now=now_evening) is False

    def test_should_run_if_calendar_date_differs(self):
        """If the date changed (e.g. yesterday evening to today morning), run daily tasks."""
        last_run = datetime(2026, 11, 5, 23, 0, 0)
        now_next_morning = datetime(2026, 11, 6, 8, 0, 0)

        assert should_run_daily_tasks(last_run, now=now_next_morning) is True

    def test_should_run_if_24h_or_more_passed(self):
        """If more than 24 hours have passed, run daily tasks."""
        last_run = datetime(2026, 11, 1, 10, 0, 0)
        now = datetime(2026, 11, 5, 10, 0, 0)

        assert should_run_daily_tasks(last_run, now=now) is True

    def test_should_not_run_if_last_run_in_slight_future(self):
        """Minor clock adjustment into future should not trigger re-run."""
        last_run = datetime(2026, 11, 5, 10, 5, 0)
        now = datetime(2026, 11, 5, 10, 0, 0)

        assert should_run_daily_tasks(last_run, now=now) is False

    def test_state_load_and_atomic_save(self, tmp_path: Path):
        """Verify load_scheduler_state and save_scheduler_state write atomically."""
        state_file = tmp_path / "scheduler_state.json"

        # 1. Non-existent file returns empty dict
        assert load_scheduler_state(state_file) == {}

        # 2. Save state
        test_now = datetime(2026, 11, 5, 12, 30, 0)
        save_scheduler_state({"last_daily_tasks": test_now.isoformat()}, path=state_file)

        assert state_file.exists()
        # Verify content is valid JSON
        with open(state_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["last_daily_tasks"] == test_now.isoformat()

        # 3. Load state back
        loaded = load_scheduler_state(state_file)
        assert loaded["last_daily_tasks"] == test_now.isoformat()

        # 4. Overwrite state
        new_now = datetime(2026, 11, 6, 9, 0, 0)
        loaded["last_daily_tasks"] = new_now.isoformat()
        loaded["custom_key"] = 123
        save_scheduler_state(loaded, path=state_file)

        reloaded = load_scheduler_state(state_file)
        assert reloaded["last_daily_tasks"] == new_now.isoformat()
        assert reloaded["custom_key"] == 123
        # Ensure temporary file was cleanly replaced and removed
        assert not state_file.with_name(f"{state_file.name}.tmp").exists()

