"""
Date-range filters that SQLite can answer from an index.

`created_at__date__gte=day` makes Django wrap the column in a function
(`django_datetime_cast_date(created_at, 'Africa/Algiers', 'UTC')`), so no index on `created_at`
can be used and every row of the tenant is read, converted and compared. On a store with a few
years of sales that was most of the 1-15 s the report pages took.

`day_range` returns the same filter as a half-open range of datetimes
(`created_at >= start of first day AND created_at < start of the day after the last`), in the
current time zone, so the result is identical and an index on the column is used.
"""
from datetime import date, datetime, time, timedelta

from django.utils import timezone


def start_of_day(day: date) -> datetime:
    """Midnight at the start of `day`, in the current time zone."""
    return timezone.make_aware(datetime.combine(day, time.min))


def day_range(field: str, start: date | None = None, end: date | None = None, *, prefix: str = "") -> dict:
    """
    Keyword filters equal to `{field}__date__gte=start, {field}__date__lte=end` (either may be None).

    `prefix` is the relation path, e.g. day_range("created_at", a, b, prefix="sale__").
    Usage: `qs.filter(**day_range("created_at", from_date, to_date))`.
    """
    name = f"{prefix}{field}"
    bounds = {}
    if start is not None:
        bounds[f"{name}__gte"] = start_of_day(start)
    if end is not None:
        bounds[f"{name}__lt"] = start_of_day(end + timedelta(days=1))
    return bounds


def on_day(field: str, day: date, *, prefix: str = "") -> dict:
    """Keyword filters equal to `{field}__date=day`."""
    return day_range(field, day, day, prefix=prefix)
