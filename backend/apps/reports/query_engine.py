"""
Safe ORM query engine for the custom report builder.

Translates a report config dict into a Django queryset, applying:
  - Source-specific base queryset with tenant isolation
  - Annotations for computed fields
  - Whitelisted filters (no raw SQL)
  - Column selection via .values()
  - Sorting
  - Row limit

Returns (rows: list[dict], column_labels: dict[str, str])
"""
import logging
from decimal import Decimal

from django.db.models import F, Q

from .field_registry import FIELD_REGISTRY

logger = logging.getLogger(__name__)

MAX_PREVIEW_ROWS = 200
MAX_COLUMNS = 8
MAX_TEMPLATES = 15

SAFE_OPERATORS = {"exact", "icontains", "gte", "lte", "gt", "lt", "isnull"}


def get_base_queryset(source: str, tenant):
    """Return the tenant-scoped base queryset for the given source."""
    if source == "sales":
        from apps.sales.models import Sale
        return Sale.objects.filter(tenant=tenant).select_related("branch", "cashier", "client")
    elif source == "inventory":
        from apps.inventory.models import Variant
        return Variant.objects.filter(tenant=tenant).select_related("product")
    elif source == "clients":
        from apps.clients.models import Client
        return Client.objects.filter(tenant=tenant)
    raise ValueError(f"Unknown source: {source}")


def _coerce_filter_value(value: str, operator: str, field_type: str):
    """Coerce the filter value string to the correct Python type."""
    if operator == "isnull":
        return value.lower() in ("true", "1", "yes")
    if field_type in ("number", "decimal"):
        try:
            return Decimal(value) if field_type == "decimal" else int(value)
        except (ValueError, TypeError):
            return None
    if field_type == "boolean":
        return value.lower() in ("true", "1", "yes")
    return value  # string / date / choice — pass through as-is


def run_report(tenant, config: dict, row_limit: int = MAX_PREVIEW_ROWS) -> tuple[list[dict], dict]:
    """
    Execute a report and return (rows, column_labels).

    Raises ValueError on invalid config (caller should catch and return 400).
    """
    source = config.get("source", "")
    columns: list[str] = config.get("columns", [])
    filters: list[dict] = config.get("filters", [])
    sort: dict = config.get("sort") or {}
    date_from: str = config.get("date_from", "")
    date_to: str = config.get("date_to", "")

    registry = FIELD_REGISTRY.get(source)
    if not registry:
        raise ValueError(f"Source invalide : {source}")

    if not columns:
        raise ValueError("Sélectionnez au moins une colonne.")
    if len(columns) > MAX_COLUMNS:
        raise ValueError(f"Maximum {MAX_COLUMNS} colonnes par rapport.")

    # Validate all column IDs
    unknown = [c for c in columns if c not in registry]
    if unknown:
        raise ValueError(f"Champs inconnus : {', '.join(unknown)}")

    if source == "sales" and not (date_from or date_to):
        raise ValueError("La source 'Ventes' exige une plage de dates.")

    qs = get_base_queryset(source, tenant)

    # Apply date range (sales only, validated above)
    if source == "sales":
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

    # Apply annotations needed by selected columns and active filters
    needed_field_ids = set(columns) | {f.get("field", "") for f in filters}
    for fid in needed_field_ids:
        fd = registry.get(fid)
        if fd and "annotation" in fd:
            qs = qs.annotate(**fd["annotation"])

    # Apply whitelisted filters
    q = Q()
    for f in filters:
        field_id = f.get("field", "")
        operator = f.get("operator", "")
        value = f.get("value", "")

        if not field_id or not operator:
            continue
        fd = registry.get(field_id)
        if not fd:
            continue
        if operator not in SAFE_OPERATORS or operator not in fd.get("operators", []):
            continue
        if value == "" and operator != "isnull":
            continue

        coerced = _coerce_filter_value(str(value), operator, fd.get("type", "string"))
        if coerced is None:
            continue

        filter_field = fd.get("filter_orm", fd["orm_field"])
        lookup = f"{filter_field}__{operator}"
        try:
            q &= Q(**{lookup: coerced})
        except Exception:
            logger.debug("Skipping filter %s %s %s", field_id, operator, value)

    if q:
        qs = qs.filter(q)

    # Apply sort
    sort_field_id = sort.get("field", "")
    if sort_field_id and sort_field_id in registry:
        fd = registry[sort_field_id]
        if fd.get("sortable", False):
            sort_orm = fd.get("sort_orm", fd["orm_field"])
            prefix = "-" if sort.get("direction") == "desc" else ""
            try:
                qs = qs.order_by(f"{prefix}{sort_orm}")
            except Exception:
                pass

    # Select only the requested columns via .values()
    orm_fields = [registry[col]["orm_field"] for col in columns]
    try:
        raw_rows = list(qs.values(*orm_fields)[:row_limit])
    except Exception as exc:
        logger.error("Report query failed: %s", exc)
        raise ValueError(f"Erreur lors de l'exécution du rapport : {exc}")

    # Rename orm keys → field_id keys and build column label map
    column_labels = {col: registry[col]["label"] for col in columns}
    renamed_rows = []
    for row in raw_rows:
        new_row = {}
        for col in columns:
            orm_key = registry[col]["orm_field"]
            val = row.get(orm_key)
            # Coerce Decimal to str for JSON serialization
            if isinstance(val, Decimal):
                val = str(val)
            new_row[col] = val
        renamed_rows.append(new_row)

    return renamed_rows, column_labels
