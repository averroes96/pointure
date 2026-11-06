"""Period locking service to enforce fiscal year closing (Task 6.3)."""
import datetime
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.closing.models import FiscalYear, FiscalYearStatusChoices


def normalize_business_date(date_val):
    """Normalize date_val to a datetime.date object in Africa/Algiers timezone."""
    if date_val is None:
        return timezone.localdate()
    if isinstance(date_val, datetime.datetime):
        return timezone.localdate(date_val)
    if isinstance(date_val, datetime.date):
        return date_val
    if isinstance(date_val, str):
        return datetime.date.fromisoformat(str(date_val)[:10])
    return timezone.localdate()


def is_period_closed(tenant, date=None) -> bool:
    """Check if the given date falls within a closed fiscal year for this tenant."""
    if not tenant:
        return False
    d = normalize_business_date(date)
    return FiscalYear.objects.filter(
        tenant=tenant,
        status=FiscalYearStatusChoices.CLOSED,
        start_date__lte=d,
        end_date__gte=d,
    ).exists()


def assert_period_open(tenant, date=None):
    """
    Assert that the business period for date is open.
    Raises ValidationError(code="period_closed") if date falls within a closed fiscal year.
    """
    if not tenant:
        return
    d = normalize_business_date(date)
    closed_year = FiscalYear.objects.filter(
        tenant=tenant,
        status=FiscalYearStatusChoices.CLOSED,
        start_date__lte=d,
        end_date__gte=d,
    ).first()

    if closed_year:
        raise ValidationError(
            _(
                "L'exercice fiscal %(year)s (du %(start)s au %(end)s) est clôturé. "
                "Aucune opération n'est autorisée sur cette période."
            )
            % {
                "year": closed_year.year,
                "start": closed_year.start_date,
                "end": closed_year.end_date,
            },
            code="period_closed",
        )

