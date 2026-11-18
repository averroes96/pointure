"""
Find records dated in the future:  python manage.py check_future_dated_records

A PC whose clock jumped forward (a dead CMOS battery gave 2072 in one store's log) can stamp sales, stock
movements and payments with a date that has not happened yet. That matters twice:
  - reports, daily summaries and the fiscal-year lock see those rows on days that have not come;
  - the anti-rollback guard (apps.core.services.time_service) never dates a new sale before the latest
    sale or stock movement, so ONE sale in the far future makes every following sale carry a future date.

This command only reads. It lists, per table and field, how many rows are dated after "now" and the
earliest and latest of them, then says whether the guard is affected. Run it on a store's database copy
or on the live one: it takes a few seconds on a store with a few years of sales.
"""
from datetime import timedelta

from django.apps import apps
from django.core.management.base import BaseCommand
from django.db import models
from django.utils import timezone

PROJECT_APPS_EXCLUDED = {"admin", "auth", "contenttypes", "sessions", "token_blacklist"}
# Event-time fields end in "_at" (or are called "timestamp"); these words mark moments meant to be in the future.
FUTURE_BY_DESIGN = ("expire", "valid", "scheduled", "next", "retry", "due", "until", "deadline", "claim", "lock")
GUARD_TOLERANCE = timedelta(minutes=5)       # same tolerance as the rollback guard in time_service


def event_time_fields():
    """(model, field) for every date-time field that records when something happened."""
    for model in apps.get_models():
        if model._meta.app_label in PROJECT_APPS_EXCLUDED or model._meta.proxy:
            continue
        for field in model._meta.get_fields():
            if not isinstance(field, models.DateTimeField) or not getattr(field, "column", None):
                continue
            name = field.name
            if not (name == "timestamp" or name.endswith("_at")):
                continue
            if any(word in name for word in FUTURE_BY_DESIGN):
                continue
            yield model, field


class Command(BaseCommand):
    help = "List records dated in the future (a wrong PC clock) and say whether the time guard is affected."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tolerance-minutes", type=int, default=10,
            help="Ignore records dated less than this many minutes ahead of the PC clock (default 10).",
        )

    def handle(self, *args, **options):
        now = timezone.now()
        cutoff = now + timedelta(minutes=options["tolerance_minutes"])
        self.stdout.write(f"PC clock: {timezone.localtime(now):%d/%m/%Y %H:%M:%S}\n")

        findings = []
        for model, field in event_time_fields():
            rows = model._base_manager.filter(**{f"{field.name}__gt": cutoff})
            result = rows.aggregate(
                count=models.Count("pk"), first=models.Min(field.name), last=models.Max(field.name),
            )
            if result["count"]:
                findings.append((model._meta.label, field.name, result["count"], result["first"], result["last"]))

        if not findings:
            self.stdout.write("No record is dated in the future.")
        else:
            self.stdout.write("Records dated in the future:")
            for label, name, count, first, last in sorted(findings):
                self.stdout.write(
                    f"  {label}.{name}: {count} row(s), from {timezone.localtime(first):%d/%m/%Y %H:%M} "
                    f"to {timezone.localtime(last):%d/%m/%Y %H:%M}"
                )

        self._report_guard(now)

    def _report_guard(self, now):
        from apps.core.services.time_service import get_last_known_transaction_time

        latest = get_last_known_transaction_time()
        self.stdout.write("")
        if latest is None:
            self.stdout.write("Time guard: no sale or stock movement yet, nothing to compare with.")
        elif latest > now + GUARD_TOLERANCE:
            ahead = latest - now
            self.stdout.write(self.style.WARNING(
                f"Time guard AFFECTED: the latest sale or stock movement is dated "
                f"{timezone.localtime(latest):%d/%m/%Y %H:%M}, {ahead.days} day(s) ahead of the PC clock. "
                f"New sales and stock movements are dated one second after it until that date is reached."
            ))
        else:
            self.stdout.write("Time guard: not affected (the latest sale or stock movement is not ahead of the PC clock).")
