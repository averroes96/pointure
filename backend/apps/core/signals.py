"""
AuditLog signals — automatically record create/update/delete on financial models.
"""
import datetime
import decimal
import threading
import uuid

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

# Track previous state for diff calculation
_pre_save_state = threading.local()

# Models to audit (imported lazily to avoid circular imports)
AUDITED_MODELS = [
    # Financial & Sales
    "Invoice", "InvoicePayment", "Payment", "Sale",
    "StockMovement", "CreditNote", "Return",
    
    # Catalog Integrity
    "Product", "Variant",
    
    # Client Management
    "Client", "Cheque",
    
    # Configuration & Security
    "StoreSettings", "User", "Branch"
]

# Current request user (set by middleware)
_current_user = threading.local()


def set_current_user(user):
    _current_user.user = user


def get_current_user():
    return getattr(_current_user, "user", None)


def _get_tenant_from_instance(instance):
    return getattr(instance, "tenant", None)


def _json_safe(value):
    """Convert a value to a JSON-serializable type."""
    from django.db.models.fields.files import FieldFile
    if isinstance(value, FieldFile):
        return value.name  # relative path string, or None
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


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


# ── Signal receivers ──────────────────────────────────────────────────────────

def _is_audited(instance):
    return instance.__class__.__name__ in AUDITED_MODELS


@receiver(pre_save)
def audit_pre_save(sender, instance, **kwargs):
    """Capture the previous DB state before saving so we can diff it."""
    if not _is_audited(instance):
        return
    if instance.pk:
        try:
            _pre_save_state.state = _model_to_dict(
                sender.objects.get(pk=instance.pk)
            )
        except sender.DoesNotExist:
            _pre_save_state.state = None
    else:
        _pre_save_state.state = None


@receiver(post_save)
def audit_post_save(sender, instance, created, **kwargs):
    """Write a CREATE or UPDATE audit log entry."""
    if not _is_audited(instance):
        return

    action = "create" if created else "update"
    diff = {}
    after = _model_to_dict(instance)

    if created:
        diff = {
            field: {
                "from": None,
                "to": _json_safe(after.get(field)),
            }
            for field in after
        }
    else:
        before = getattr(_pre_save_state, "state", None) or {}
        diff = {
            field: {
                "from": _json_safe(before.get(field)),
                "to": _json_safe(after.get(field)),
            }
            for field in after
            if before.get(field) != after.get(field)
        }

    _write_audit(instance, action, diff)
    _pre_save_state.state = None


@receiver(post_delete)
def audit_post_delete(sender, instance, **kwargs):
    """Write a DELETE audit log entry."""
    if not _is_audited(instance):
        return
        
    before = _model_to_dict(instance)
    diff = {
        field: {
            "from": _json_safe(before.get(field)),
            "to": None,
        }
        for field in before
    }
    
    _write_audit(instance, "delete", diff)

import json
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.serializers.json import DjangoJSONEncoder
from django.forms.models import model_to_dict

from .models import TenantScopedModel, SyncOutbox, AuditLog

def serialize_model(instance):
    """Safely serialize a Django model instance to JSON dict."""
    try:
        return model_to_dict(instance)
    except Exception:
        return {}

@receiver(post_save)
def sync_outbox_post_save(sender, instance, created, **kwargs):
    # Only track TenantScopedModel subclasses
    if not issubclass(sender, TenantScopedModel):
        return
    
    # Don't track SyncOutbox itself if it ever inherits it, or AuditLog
    if sender in (SyncOutbox, AuditLog):
        return
        
    action = AuditLog.ActionChoices.CREATE if created else AuditLog.ActionChoices.UPDATE
    payload = serialize_model(instance)
    
    # We must handle UUIDs in JSON
    # It's better to just stringify the payload or rely on a robust serializer
    try:
        payload_json = json.loads(json.dumps(payload, cls=DjangoJSONEncoder))
    except TypeError:
        payload_json = {}

    SyncOutbox.objects.create(
        tenant=instance.tenant,
        model_name=sender.__name__,
        object_id=str(instance.pk),
        action=action,
        payload=payload_json
    )

@receiver(post_delete)
def sync_outbox_post_delete(sender, instance, **kwargs):
    if not issubclass(sender, TenantScopedModel):
        return
        
    if sender in (SyncOutbox, AuditLog):
        return
        
    SyncOutbox.objects.create(
        tenant=instance.tenant,
        model_name=sender.__name__,
        object_id=str(instance.pk),
        action=AuditLog.ActionChoices.DELETE,
        payload={"id": str(instance.pk)}
    )
