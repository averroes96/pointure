import json
from datetime import date, datetime
from pathlib import Path
import pytest
from django.utils import timezone

from apps.core.models import Tenant, User, RoleChoices
from apps.closing.models import FiscalYear, FiscalYearStatusChoices
from apps.notifications.models import Notification
from apps.closing.services.reminder import (
    should_notify_prepare_count,
    should_notify_close_year,
    should_notify_closing,
    check_closing_reminders,
)


class TestShouldNotifyHelper:
    """Unit tests for the deterministic 'should notify' helpers with injected dates."""

    def test_prepare_count_before_december_15(self):
        """Dates before 15 December must NOT trigger count preparation."""
        state = {}
        assert should_notify_prepare_count(date(2026, 11, 30), state=state, year=2026) is False
        assert should_notify_prepare_count(date(2026, 12, 1), state=state, year=2026) is False
        assert should_notify_prepare_count(date(2026, 12, 14), state=state, year=2026) is False

        assert should_notify_closing("prepare_count", date(2026, 12, 14), year=2026) is False

    def test_prepare_count_from_december_15_to_31(self):
        """Dates from 15 December through 31 December must trigger count preparation."""
        state = {}
        assert should_notify_prepare_count(date(2026, 12, 15), state=state, year=2026) is True
        assert should_notify_prepare_count(date(2026, 12, 20), state=state, year=2026) is True
        assert should_notify_prepare_count(date(2026, 12, 31), state=state, year=2026) is True

        assert should_notify_closing("prepare_count", date(2026, 12, 15), year=2026) is True

    def test_prepare_count_in_new_year_returns_false(self):
        """January dates do not trigger prepare_count for the new year or prior year."""
        state = {}
        assert should_notify_prepare_count(date(2027, 1, 1), state=state, year=2026) is False
        assert should_notify_prepare_count(date(2027, 1, 1), state=state, year=2027) is False

    def test_prepare_count_idempotency_via_state(self):
        """Once recorded in the state dictionary, prepare_count must not re-trigger."""
        state = {
            "closing_reminders": {
                "prepare_count:2026": "2026-12-15T08:00:00"
            }
        }
        assert should_notify_prepare_count(date(2026, 12, 16), state=state, year=2026) is False
        assert should_notify_prepare_count(date(2026, 12, 31), state=state, year=2026) is False

        # Tenant-scoped key idempotency
        tenant_state = {
            "closing_reminders": {
                "t1:prepare_count:2026": "2026-12-15T08:00:00"
            }
        }
        assert should_notify_prepare_count(date(2026, 12, 16), state=tenant_state, tenant_id="t1", year=2026) is False
        # Other tenant is still eligible
        assert should_notify_prepare_count(date(2026, 12, 16), state=tenant_state, tenant_id="t2", year=2026) is True

    def test_close_year_before_january_1(self):
        """Closing reminder for year N cannot trigger before 1 January of year N+1."""
        state = {}
        assert should_notify_close_year(
            date(2026, 12, 31),
            is_prev_year_closed=False,
            state=state,
            prev_year=2026,
        ) is False

    def test_close_year_from_january_1_when_open(self):
        """Closing reminder for year N triggers from 1 January if year N is open."""
        state = {}
        assert should_notify_close_year(
            date(2027, 1, 1),
            is_prev_year_closed=False,
            state=state,
            prev_year=2026,
        ) is True
        assert should_notify_close_year(
            date(2027, 3, 15),
            is_prev_year_closed=False,
            state=state,
            prev_year=2026,
        ) is True

        assert should_notify_closing(
            "close_year",
            date(2027, 1, 1),
            is_prev_year_closed=False,
            year=2026,
        ) is True

    def test_close_year_when_already_closed(self):
        """If previous year is already closed, no closing reminder is sent."""
        state = {}
        assert should_notify_close_year(
            date(2027, 1, 1),
            is_prev_year_closed=True,
            state=state,
            prev_year=2026,
        ) is False
        assert should_notify_close_year(
            date(2027, 6, 1),
            is_prev_year_closed=True,
            state=state,
            prev_year=2026,
        ) is False

    def test_close_year_idempotency_via_state(self):
        """Once recorded in state, close_year must not trigger duplicate notifications."""
        state = {
            "closing_reminders": {
                "close_year:2026": "2027-01-01T08:00:00"
            }
        }
        assert should_notify_close_year(
            date(2027, 1, 2),
            is_prev_year_closed=False,
            state=state,
            prev_year=2026,
        ) is False

    def test_invalid_action_raises(self):
        with pytest.raises(ValueError, match="Unknown closing reminder action"):
            should_notify_closing("invalid_action", date(2026, 12, 15))


@pytest.mark.django_db
class TestCheckClosingRemindersIntegration:
    """Integration tests for check_closing_reminders creating Notifications."""

    @pytest.fixture(autouse=True)
    def setup_data(self):
        self.tenant = Tenant.objects.create(name="Store Oran")
        self.owner = User.objects.create_user(
            email="owner@oran.dz",
            password="pass",
            role=RoleChoices.OWNER,
            tenant=self.tenant,
        )
        self.cashier = User.objects.create_user(
            email="cashier@oran.dz",
            password="pass",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

    def test_no_reminder_before_dec_15(self, tmp_path: Path):
        state_file = tmp_path / "scheduler_state.json"
        notifs = check_closing_reminders(
            now=date(2026, 12, 10),
            state_path=state_file,
            save_state=True,
        )
        assert len(notifs) == 0
        assert Notification.objects.filter(tenant=self.tenant).count() == 0

    def test_prepare_count_notification_created_for_owner_only(self, tmp_path: Path):
        state_file = tmp_path / "scheduler_state.json"

        # Dec 15 triggers reminder
        notifs = check_closing_reminders(
            now=date(2026, 12, 15),
            state_path=state_file,
            save_state=True,
        )
        assert len(notifs) == 1
        notif = notifs[0]
        assert notif.user == self.owner
        assert notif.type == Notification.TypeChoices.CLOSING_REMINDER
        assert "inventaire physique" in notif.title.lower()
        assert notif.related_object_type == "FiscalYear"
        assert notif.related_object_id == "prepare_2026"

        # Cashier must have 0 notifications
        assert Notification.objects.filter(user=self.cashier).count() == 0

        # State file persisted the reminder
        with open(state_file, "r", encoding="utf-8") as f:
            state_data = json.load(f)
        assert f"{self.tenant.id}:prepare_count:2026" in state_data["closing_reminders"]

        # Running next day is idempotent
        subsequent_notifs = check_closing_reminders(
            now=date(2026, 12, 16),
            state_path=state_file,
            save_state=True,
        )
        assert len(subsequent_notifs) == 0
        assert Notification.objects.filter(tenant=self.tenant).count() == 1

    def test_close_fiscal_year_notification_when_previous_year_open(self, tmp_path: Path):
        state_file = tmp_path / "scheduler_state.json"

        # 2 Jan 2027: previous year 2026 has no FiscalYear row or is OPEN
        notifs = check_closing_reminders(
            now=date(2027, 1, 2),
            state_path=state_file,
            save_state=True,
        )
        assert len(notifs) == 1
        notif = notifs[0]
        assert notif.user == self.owner
        assert "2026" in notif.title
        assert notif.related_object_type == "FiscalYear"
        assert notif.related_object_id == "close_2026"

        # Second run on 3 Jan is idempotent
        subsequent = check_closing_reminders(
            now=date(2027, 1, 3),
            state_path=state_file,
            save_state=True,
        )
        assert len(subsequent) == 0

    def test_no_close_notification_when_previous_year_already_closed(self, tmp_path: Path):
        state_file = tmp_path / "scheduler_state.json"

        # 2026 is already closed
        FiscalYear.objects.create(
            tenant=self.tenant,
            year=2026,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            status=FiscalYearStatusChoices.CLOSED,
            closed_at=timezone.now(),
            closed_by=self.owner,
        )

        notifs = check_closing_reminders(
            now=date(2027, 1, 2),
            state_path=state_file,
            save_state=True,
        )
        assert len(notifs) == 0
        assert Notification.objects.filter(tenant=self.tenant).count() == 0
