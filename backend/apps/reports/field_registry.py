"""
Field registry for the custom report builder.

Each source defines the fields available for column selection, filtering,
and sorting. Fields map user-friendly IDs to ORM expressions.

Design:
  orm_field   — used in .values() and in post-processing key lookup
  filter_orm  — used in .filter(**{filter_orm + "__" + operator: value})
  sort_orm    — used in .order_by() (defaults to orm_field)
  annotation  — dict passed to .annotate() before .values() (for computed fields)
  operators   — whitelist of allowed filter operators (prevents injection)
  choices     — valid values for "exact" / "in" operators on choice fields
"""
from django.db.models.functions import TruncDate

OPERATOR_LABELS = {
    "exact": "=",
    "icontains": "contient",
    "gte": "≥",
    "lte": "≤",
    "gt": ">",
    "lt": "<",
    "in": "parmi",
    "isnull": "est vide",
}

# ── Sales (base queryset: Sale) ───────────────────────────────────────────────

SALES_FIELDS = {
    "sale_date": {
        "label": "Date de vente",
        "type": "date",
        "annotation": {"sale_date": TruncDate("created_at")},
        "orm_field": "sale_date",
        "filter_orm": "created_at__date",
        "sort_orm": "created_at",
        "operators": ["gte", "lte"],
        "sortable": True,
    },
    "receipt_number": {
        "label": "N° reçu",
        "type": "string",
        "orm_field": "receipt_number",
        "filter_orm": "receipt_number",
        "operators": ["icontains", "exact"],
        "sortable": True,
    },
    "branch_name": {
        "label": "Agence",
        "type": "string",
        "orm_field": "branch__name",
        "filter_orm": "branch__name",
        "sort_orm": "branch__name",
        "operators": ["exact", "icontains"],
        "sortable": True,
    },
    "cashier_email": {
        "label": "Caissier",
        "type": "string",
        "orm_field": "cashier__email",
        "filter_orm": "cashier__email",
        "sort_orm": "cashier__email",
        "operators": ["exact", "icontains"],
        "sortable": True,
    },
    "client_name": {
        "label": "Client",
        "type": "string",
        "orm_field": "client__name",
        "filter_orm": "client__name",
        "sort_orm": "client__name",
        "operators": ["icontains"],
        "sortable": True,
    },
    "status": {
        "label": "Statut",
        "type": "choice",
        "orm_field": "status",
        "filter_orm": "status",
        "operators": ["exact"],
        "choices": ["completed", "cancelled", "refunded", "partially_paid"],
        "sortable": True,
    },
    "total_amount": {
        "label": "Montant total",
        "type": "decimal",
        "orm_field": "total_amount",
        "filter_orm": "total_amount",
        "operators": ["gte", "lte", "exact"],
        "sortable": True,
    },
    "discount_amount": {
        "label": "Remise",
        "type": "decimal",
        "orm_field": "discount_amount",
        "filter_orm": "discount_amount",
        "operators": ["gte", "lte"],
        "sortable": True,
    },
    "amount_paid": {
        "label": "Payé",
        "type": "decimal",
        "orm_field": "amount_paid",
        "filter_orm": "amount_paid",
        "operators": ["gte", "lte"],
        "sortable": True,
    },
    "balance_due": {
        "label": "Solde restant",
        "type": "decimal",
        "orm_field": "balance_due",
        "filter_orm": "balance_due",
        "operators": ["gte", "lte", "exact"],
        "sortable": True,
    },
    "notes": {
        "label": "Notes",
        "type": "string",
        "orm_field": "notes",
        "filter_orm": "notes",
        "operators": ["icontains"],
        "sortable": False,
    },
}

# ── Inventory (base queryset: Variant) ────────────────────────────────────────

INVENTORY_FIELDS = {
    "product_name": {
        "label": "Produit",
        "type": "string",
        "orm_field": "product__name",
        "filter_orm": "product__name",
        "sort_orm": "product__name",
        "operators": ["icontains", "exact"],
        "sortable": True,
    },
    "brand": {
        "label": "Marque",
        "type": "string",
        "orm_field": "product__brand",
        "filter_orm": "product__brand",
        "sort_orm": "product__brand",
        "operators": ["icontains", "exact"],
        "sortable": True,
    },
    "category": {
        "label": "Catégorie",
        "type": "choice",
        "orm_field": "product__category",
        "filter_orm": "product__category",
        "operators": ["exact"],
        "choices": ["sneakers", "boots", "sandals", "formal", "sport", "kids", "slippers", "other"],
        "sortable": True,
    },
    "gender": {
        "label": "Genre",
        "type": "choice",
        "orm_field": "product__gender",
        "filter_orm": "product__gender",
        "operators": ["exact"],
        "choices": ["M", "F", "K", "U"],
        "sortable": False,
    },
    "barcode": {
        "label": "Code-barres",
        "type": "string",
        "orm_field": "barcode",
        "filter_orm": "barcode",
        "operators": ["exact", "icontains"],
        "sortable": False,
    },
    "size_eu": {
        "label": "Pointure (EU)",
        "type": "number",
        "orm_field": "size_eu",
        "filter_orm": "size_eu",
        "operators": ["exact", "gte", "lte"],
        "sortable": True,
    },
    "colour": {
        "label": "Couleur",
        "type": "string",
        "orm_field": "colour",
        "filter_orm": "colour",
        "operators": ["icontains", "exact"],
        "sortable": True,
    },
    "stock_qty": {
        "label": "Stock total",
        "type": "number",
        "orm_field": "stock_qty",
        "filter_orm": "stock_qty",
        "operators": ["gte", "lte", "exact"],
        "sortable": True,
    },
    "alert_threshold": {
        "label": "Seuil d'alerte",
        "type": "number",
        "orm_field": "alert_threshold",
        "filter_orm": "alert_threshold",
        "operators": ["gte", "lte"],
        "sortable": True,
    },
    "sale_price": {
        "label": "Prix de vente",
        "type": "decimal",
        "orm_field": "product__sale_price",
        "filter_orm": "product__sale_price",
        "sort_orm": "product__sale_price",
        "operators": ["gte", "lte", "exact"],
        "sortable": True,
    },
    "purchase_price": {
        "label": "Prix d'achat",
        "type": "decimal",
        "orm_field": "product__purchase_price",
        "filter_orm": "product__purchase_price",
        "sort_orm": "product__purchase_price",
        "operators": ["gte", "lte"],
        "sortable": True,
    },
    "is_active": {
        "label": "Actif",
        "type": "boolean",
        "orm_field": "is_active",
        "filter_orm": "is_active",
        "operators": ["exact"],
        "choices": ["true", "false"],
        "sortable": False,
    },
}

# ── Clients (base queryset: Client) ───────────────────────────────────────────

CLIENTS_FIELDS = {
    "name": {
        "label": "Nom",
        "type": "string",
        "orm_field": "name",
        "filter_orm": "name",
        "operators": ["icontains", "exact"],
        "sortable": True,
    },
    "phone": {
        "label": "Téléphone",
        "type": "string",
        "orm_field": "phone",
        "filter_orm": "phone",
        "operators": ["icontains", "exact"],
        "sortable": False,
    },
    "wilaya": {
        "label": "Wilaya",
        "type": "number",
        "orm_field": "wilaya",
        "filter_orm": "wilaya",
        "operators": ["exact"],
        "sortable": True,
    },
    "client_type": {
        "label": "Type",
        "type": "choice",
        "orm_field": "client_type",
        "filter_orm": "client_type",
        "operators": ["exact"],
        "choices": ["retail", "wholesale"],
        "sortable": True,
    },
    "credit_limit": {
        "label": "Limite de crédit",
        "type": "decimal",
        "orm_field": "credit_limit",
        "filter_orm": "credit_limit",
        "operators": ["gte", "lte"],
        "sortable": True,
    },
    "cached_balance": {
        "label": "Solde dû",
        "type": "decimal",
        "orm_field": "cached_balance",
        "filter_orm": "cached_balance",
        "operators": ["gte", "lte", "exact"],
        "sortable": True,
    },
    "is_active_client": {
        "label": "Actif",
        "type": "boolean",
        "orm_field": "is_active",
        "filter_orm": "is_active",
        "operators": ["exact"],
        "choices": ["true", "false"],
        "sortable": False,
    },
    "enrolled_since": {
        "label": "Date d'inscription",
        "type": "date",
        "annotation": {"enrolled_since": TruncDate("created_at")},
        "orm_field": "enrolled_since",
        "filter_orm": "created_at__date",
        "sort_orm": "created_at",
        "operators": ["gte", "lte"],
        "sortable": True,
    },
    "nif": {
        "label": "NIF",
        "type": "string",
        "orm_field": "nif",
        "filter_orm": "nif",
        "operators": ["exact", "icontains"],
        "sortable": False,
    },
}

FIELD_REGISTRY = {
    "sales": SALES_FIELDS,
    "inventory": INVENTORY_FIELDS,
    "clients": CLIENTS_FIELDS,
}

VALID_SOURCES = set(FIELD_REGISTRY.keys())
