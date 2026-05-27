"""
AuditLog signals — automatically record create/update/delete on financial models.
"""
import json
import threading

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

# Track previous state for diff calculation
_pre_save_state = threading.local()

# Models to audit (imported lazily to avoid circular imports)
AUDITED_MODELS = [
    "Invoice", "InvoicePayment", "Payment", "Sale",
    "StockMovement", "CreditNote",
]

# Current request user (set by middleware)
_current_user = threading.local()


def set_current_user(user):
    _current_user.user = user


def get_current_user():
    return getattr(_current_user, "user", None)


def _get_tenant_from_instance(instance):
    return getattr(instance, "tenant", None)


def _model_to_dict(instance):
    """Convert model instance to dict for diff tracking."""
    from django.forms.models import model_to_dict
    try:
        return model_to_dict(instance)
    except Exception:
        return {}


def _write_audit(instance, action, diff=None):
    """Write an AuditLog entry. Safe to call from signals."""
    from apps.core.models import AuditLog

    tenant = _get_tenant_from_instance(instance)
    if not tenant:
        return

    user = get_current_user()

    AuditLog.objects.create(
        tenant=tenant,
        user=user,
        action=action,
        model_name=instance.__class__.__name__,
        object_id=str(instance.pk),
        object_repr=str(instance)[:300],
        diff=diff or {},
    )
