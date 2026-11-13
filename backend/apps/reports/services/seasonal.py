"""
Aïd and rentrée comparisons.

Aïd dates are 1 Shawwal and 10 Dhu al-Hijjah on the Umm al-Qura calendar,
from 2020 through 2035. Algeria confirms them by moon sighting, so each
date is estimated until the owner edits it. The rentrée defaults to
1 September and is edited the same way.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import DecimalField, ExpressionWrapper, F, Sum
from django.db.models.functions import Coalesce
from hijridate import Hijri

from apps.reports.services.size_curve import SOLD_STATUSES

AID_FROM = date(2020, 1, 1)
AID_TO = date(2035, 12, 31)
HIJRI_YEARS = range(1441, 1459)
DEFAULT_DAYS_BEFORE = 30


def window_for(event_date: date, days_before: int) -> tuple[date, date]:
    """Inclusive shopping window: the N days before the event, not the day itself."""
    start = event_date - timedelta(days=int(days_before))
    end = event_date - timedelta(days=1)
    return start, end


def iter_calculated_events():
    for year in HIJRI_YEARS:
        fitr = Hijri(year, 10, 1).to_gregorian()
        adha = Hijri(year, 12, 10).to_gregorian()
        if AID_FROM <= fitr <= AID_TO:
            yield ("aid_el_fitr", fitr, f"Aïd el Fitr {fitr.year}", f"aid_el_fitr:{year}")
        if AID_FROM <= adha <= AID_TO:
            yield ("aid_el_adha", adha, f"Aïd el Adha {adha.year}", f"aid_el_adha:{year}")
    for year in range(AID_FROM.year, AID_TO.year + 1):
        yield ("rentree", date(year, 9, 1), f"Rentrée {year}", f"rentree:{year}")


def ensure_seasonal_events(tenant):
    from apps.reports.models import SeasonalEvent
    existing = set(
        SeasonalEvent.objects.filter(tenant=tenant)
        .exclude(seed_key="")
        .values_list("seed_key", flat=True)
    )
    missing = [
        SeasonalEvent(
            tenant=tenant,
            kind=kind,
            date=day,
            label=label,
            is_estimated=True,
            seed_key=seed_key,
        )
        for kind, day, label, seed_key in iter_calculated_events()
        if seed_key not in existing
    ]
    if missing:
        SeasonalEvent.objects.bulk_create(missing, ignore_conflicts=True)


def _money(value) -> str:
    amount = value if isinstance(value, Decimal) else Decimal(value or 0)
    return str(amount.quantize(Decimal("0.01")))


def window_stats(tenant, start: date, end: date) -> dict:
    from apps.sales.models import Return, ReturnItem, Sale, SaleItem

    if end < start:
        return {"revenue": "0.00", "pairs": 0, "top_models": [], "top_sizes": []}

    net_expr = ExpressionWrapper(
        F("total_amount") - Coalesce(F("timbre_fiscal"), Decimal("0.00")),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )
    sales = Sale.objects.filter(
        tenant=tenant,
        status__in=SOLD_STATUSES,
        created_at__date__gte=start,
        created_at__date__lte=end,
    )
    revenue = sales.aggregate(total=Sum(net_expr))["total"] or Decimal("0.00")
    refunds = Return.objects.filter(
        tenant=tenant,
        original_sale__status__in=SOLD_STATUSES,
        created_at__date__gte=start,
        created_at__date__lte=end,
    ).aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")

    sold_models = _grouped_qty(
        SaleItem.objects.filter(sale__in=sales),
        "variant__product_id", "variant__product__name", "variant__product__brand",
    )
    returned_models = _grouped_qty(
        ReturnItem.objects.filter(
            return_obj__tenant=tenant,
            return_obj__original_sale__status__in=SOLD_STATUSES,
            return_obj__created_at__date__gte=start,
            return_obj__created_at__date__lte=end,
        ),
        "variant__product_id", "variant__product__name", "variant__product__brand",
    )
    models = _net_ranked(sold_models, returned_models, "name")

    sold_sizes = _grouped_qty(SaleItem.objects.filter(sale__in=sales), "variant__size_eu")
    returned_sizes = _grouped_qty(
        ReturnItem.objects.filter(
            return_obj__tenant=tenant,
            return_obj__original_sale__status__in=SOLD_STATUSES,
            return_obj__created_at__date__gte=start,
            return_obj__created_at__date__lte=end,
        ),
        "variant__size_eu",
    )
    sizes = _net_ranked(sold_sizes, returned_sizes, "size_eu")
    pairs = sum(row["pairs"] for row in models)
    return {
        "revenue": _money(revenue - refunds),
        "pairs": pairs,
        "top_models": models[:5],
        "top_sizes": sizes[:5],
    }


def _grouped_qty(qs, *fields):
    rows = {}
    annotations = qs.values(*fields).annotate(qty=Sum("quantity"))
    for row in annotations:
        key = row[fields[0]]
        name = row.get(fields[1]) if len(fields) > 1 else key
        brand = row.get(fields[2]) if len(fields) > 2 else ""
        label = f"{brand} {name}".strip() if brand else name
        rows[key] = {"label": label, "qty": row["qty"] or 0}
    return rows


def _net_ranked(sold, returned, field_name):
    keys = set(sold) | set(returned)
    ranked = []
    for key in keys:
        qty = sold.get(key, {}).get("qty", 0) - returned.get(key, {}).get("qty", 0)
        if qty <= 0:
            continue
        label = sold.get(key, returned.get(key, {})).get("label", key)
        ranked.append({field_name: label, "pairs": qty})
    ranked.sort(key=lambda row: (-row["pairs"], str(row[field_name])))
    return ranked


def seasonal_comparison(tenant, *, kind: str, days_before: int, today: date) -> dict:
    from apps.reports.models import SeasonalEvent
    ensure_seasonal_events(tenant)
    events = list(
        SeasonalEvent.objects.filter(tenant=tenant, kind=kind).order_by("date")
    )
    current = next((event for event in events if event.date >= today), None)
    if current is None and events:
        current = events[-1]
    occurrences = []
    for event in events:
        start, end = window_for(event.date, days_before)
        stats = window_stats(tenant, start, end)
        occurrences.append({
            "id": str(event.pk),
            "date": event.date.isoformat(),
            "label": event.label,
            "is_estimated": event.is_estimated,
            "is_current": current is not None and event.pk == current.pk,
            "window_start": start.isoformat(),
            "window_end": end.isoformat(),
            **stats,
        })
    return {"event": kind, "days_before": days_before, "occurrences": occurrences}


def next_aid_preview(tenant, *, today: date, days_before: int = DEFAULT_DAYS_BEFORE):
    from apps.reports.models import SeasonalEvent
    ensure_seasonal_events(tenant)
    upcoming = (
        SeasonalEvent.objects.filter(
            tenant=tenant,
            kind__in=[SeasonalEvent.Kind.AID_EL_FITR, SeasonalEvent.Kind.AID_EL_ADHA],
            date__gte=today,
        )
        .order_by("date")
        .first()
    )
    if upcoming is None:
        return None
    previous = (
        SeasonalEvent.objects.filter(
            tenant=tenant, kind=upcoming.kind, date__lt=upcoming.date,
        )
        .order_by("-date")
        .first()
    )
    if previous is None:
        stats = {"pairs": 0, "top_sizes": []}
    else:
        start, end = window_for(previous.date, days_before)
        stats = window_stats(tenant, start, end)
    return {
        "event": upcoming.kind,
        "label": upcoming.label,
        "date": upcoming.date.isoformat(),
        "days_until": (upcoming.date - today).days,
        "days_before": days_before,
        "last_year_pairs": stats["pairs"],
        "last_year_top_sizes": [row["size_eu"] for row in stats["top_sizes"][:3]],
    }
