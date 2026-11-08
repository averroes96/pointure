"""
Closing reminder service for ShoeDZ.

Monitors calendar dates and fiscal year closing statuses to notify owners:
  - From 15 December: "Préparez l'inventaire physique de fin d'année"
  - From 1 January, while the previous fiscal year is open: "Clôturez l'exercice fiscal N"

Reuses the desktop scheduler state file to ensure reminders run idempotently
without spamming daily notifications.
"""
from datetime import date, datetime
import logging
from pathlib import Path
from typing import Optional, Union
import uuid

from django.utils import timezone
from django.utils.translation import gettext as _

from apps.core.models import RoleChoices, Tenant, User
from apps.closing.models import FiscalYear, FiscalYearStatusChoices
from apps.notifications.models import Notification
from apps.core.desktop.scheduler import load_scheduler_state, save_scheduler_state

logger = logging.getLogger(__name__)


def should_notify_prepare_count(
    current_date: date,
    state: Optional[dict] = None,
    tenant_id: Optional[Union[str, uuid.UUID]] = None,
    year: Optional[int] = None,
) -> bool:
    """
    Return True if the year-end count preparation reminder should be sent.
    Triggers from 15 December of the target year (until 31 December).
    Idempotent: checks whether the reminder was already registered in state.
    """
    target_year = year or current_date.year

    # Reminder window: from 15 December through 31 December of the target year
    if current_date.year != target_year:
        return False
    if current_date.month != 12 or current_date.day < 15:
        return False

    # Check state file idempotency
    if state is not None:
        reminders = state.get("closing_reminders", {})
        action_key = f"prepare_count:{target_year}"
        if tenant_id:
            tenant_key = f"{tenant_id}:{action_key}"
            if tenant_key in reminders or action_key in reminders:
                return False
        else:
            if action_key in reminders or any(k.endswith(f":{action_key}") for k in reminders):
                return False

    return True


def should_notify_close_year(
    current_date: date,
    is_prev_year_closed: bool,
    state: Optional[dict] = None,
    tenant_id: Optional[Union[str, uuid.UUID]] = None,
    prev_year: Optional[int] = None,
) -> bool:
    """
    Return True if the fiscal year closing reminder should be sent for prev_year.
    Triggers from 1 January following prev_year while prev_year remains open.
    Returns False if prev_year is already closed or if already notified in state.
    """
    if is_prev_year_closed:
        return False

    target_year = prev_year or (current_date.year - 1)

    # Must be on or after 1 January of (target_year + 1)
    if current_date < date(target_year + 1, 1, 1):
        return False

    # Check state file idempotency
    if state is not None:
        reminders = state.get("closing_reminders", {})
        action_key = f"close_year:{target_year}"
        if tenant_id:
            tenant_key = f"{tenant_id}:{action_key}"
            if tenant_key in reminders or action_key in reminders:
                return False
        else:
            if action_key in reminders or any(k.endswith(f":{action_key}") for k in reminders):
                return False

    return True


def should_notify_closing(
    action: str,
    current_date: date,
    is_prev_year_closed: bool = False,
    state: Optional[dict] = None,
    tenant_id: Optional[Union[str, uuid.UUID]] = None,
    year: Optional[int] = None,
) -> bool:
    """
    Unified helper with injected dates to determine if a closing reminder should notify.
    action: 'prepare_count' or 'close_year'.
    """
    if action == "prepare_count":
        return should_notify_prepare_count(
            current_date=current_date,
            state=state,
            tenant_id=tenant_id,
            year=year,
        )
    elif action == "close_year":
        return should_notify_close_year(
            current_date=current_date,
            is_prev_year_closed=is_prev_year_closed,
            state=state,
            tenant_id=tenant_id,
            prev_year=year,
        )
    raise ValueError(f"Unknown closing reminder action: {action}")


def check_closing_reminders(
    now: Optional[Union[datetime, date]] = None,
    state: Optional[dict] = None,
    save_state: bool = True,
    state_path: Optional[Path] = None,
) -> list[Notification]:
    """
    Execute daily check for fiscal year closing reminders across all active tenants.
    Creates Notification entries for owners and persists runs into the scheduler state.
    """
    if now is None:
        current_date = timezone.localdate()
    elif isinstance(now, datetime):
        current_date = now.date()
    else:
        current_date = now

    if state is None:
        state = load_scheduler_state(state_path)

    reminders = state.setdefault("closing_reminders", {})
    created_notifications: list[Notification] = []
    state_changed = False

    tenants = Tenant.objects.filter(is_active=True)

    for tenant in tenants:
        owners = list(User.objects.filter(tenant=tenant, role=RoleChoices.OWNER, is_active=True))
        if not owners:
            continue

        curr_year = current_date.year

        # 1. Check prepare year-end count (from 15 December)
        if should_notify_prepare_count(current_date, state=state, tenant_id=tenant.id, year=curr_year):
            title = _("Préparez l'inventaire physique de fin d'année")
            body = _(
                "L'exercice fiscal %(year)d se termine bientôt. "
                "Préparez ou planifiez votre inventaire physique de stock."
            ) % {"year": curr_year}

            for owner in owners:
                already_exists = Notification.objects.filter(
                    user=owner,
                    type=Notification.TypeChoices.CLOSING_REMINDER,
                    related_object_type="FiscalYear",
                    related_object_id=f"prepare_{curr_year}",
                ).exists()

                if not already_exists:
                    notif = Notification.objects.create(
                        tenant=tenant,
                        user=owner,
                        type=Notification.TypeChoices.CLOSING_REMINDER,
                        title=title,
                        body=body,
                        related_object_type="FiscalYear",
                        related_object_id=f"prepare_{curr_year}",
                    )
                    created_notifications.append(notif)

            reminders[f"{tenant.id}:prepare_count:{curr_year}"] = current_date.isoformat()
            state_changed = True

        # 2. Check close fiscal year N (from 1 January, while previous year is open)
        prev_year = curr_year - 1
        tenant_first_year = (
            min(tenant.created_at.year, current_date.year)
            if getattr(tenant, "created_at", None)
            else current_date.year
        )
        has_prev_record = FiscalYear.objects.filter(tenant=tenant, year=prev_year).exists()

        # If prev_year predates the store's existence and has no explicit record, skip
        if prev_year < tenant_first_year and not has_prev_record:
            continue

        is_prev_closed = FiscalYear.objects.filter(
            tenant=tenant,
            year=prev_year,
            status=FiscalYearStatusChoices.CLOSED,
        ).exists()

        if should_notify_close_year(
            current_date,
            is_prev_year_closed=is_prev_closed,
            state=state,
            tenant_id=tenant.id,
            prev_year=prev_year,
        ):
            title = _("Clôturez l'exercice fiscal %(year)d") % {"year": prev_year}
            body = _(
                "L'exercice fiscal %(year)d est toujours ouvert. "
                "Procédez à la clôture annuelle dans Clôture d'exercice."
            ) % {"year": prev_year}

            for owner in owners:
                already_exists = Notification.objects.filter(
                    user=owner,
                    type=Notification.TypeChoices.CLOSING_REMINDER,
                    related_object_type="FiscalYear",
                    related_object_id=f"close_{prev_year}",
                ).exists()

                if not already_exists:
                    notif = Notification.objects.create(
                        tenant=tenant,
                        user=owner,
                        type=Notification.TypeChoices.CLOSING_REMINDER,
                        title=title,
                        body=body,
                        related_object_type="FiscalYear",
                        related_object_id=f"close_{prev_year}",
                    )
                    created_notifications.append(notif)

            reminders[f"{tenant.id}:close_year:{prev_year}"] = current_date.isoformat()
            state_changed = True

    if save_state and state_changed:
        save_scheduler_state(state, path=state_path)

    return created_notifications
