"""
AuditLog signals — automatically record create/update/delete on financial models.
"""
import json
import logging
import threading

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

# Track previous state for diff calculation
_pre_save_state = threading.local()

# Models to audit (imported lazily to avoid circular imports)
AUDITED_MODELS = [
    # Financial & Sales
    "Invoice", "InvoicePayment", "Payment", "Sale",
    "StockMovement", "CreditNote", "Return", "HeldSale",
    
    # Catalog Integrity
    "Product", "Variant",
    
    # Client Management
    "Client", "Cheque",
    
    # Configuration & Security
    "StoreSettings", "User", "Branch",

    # Cash, Promotions, Loyalty, Stock & Supplier operations
    "CashSession", "CashMovement", "Promotion", "LoyaltyAccount",
    "StockTransfer", "DefectItem", "StocktakeSession",
    "SupplierPayment", "PurchaseOrder",

    # Fiscal Year Closing
    "FiscalYear",
]

# Current request user (set by middleware)
_current_user = threading.local()


def set_current_user(user):
    _current_user.user = user


def get_current_user():
    return getattr(_current_user, "user", None)


def _get_tenant_from_instance(instance):
    tenant = getattr(instance, "tenant", None)
    if tenant is None:
        # Child rows without their own tenant FK (e.g. CashMovement) inherit it from the session.
        session = getattr(instance, "session", None)
        tenant = getattr(session, "tenant", None)
    return tenant


class _AuditJSONEncoder(DjangoJSONEncoder):
    """Django's encoder, then str() for anything JSON still cannot store."""

    def default(self, o):
        try:
            return super().default(o)
        except TypeError:
            return str(o)


def _json_safe(value):
    """Walk containers so files, sets and bytes reach the encoder as plain values."""
    from django.db.models.fields.files import FieldFile
    if isinstance(value, FieldFile):
        return value.name  # relative path string, or None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, set):
        return [_json_safe(item) for item in value]
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", errors="replace")
    return value


def _freeze_for_json(value):
    """Return a structure json.dumps can store, including time, Decimal and JSON."""
    return json.loads(json.dumps(_json_safe(value), cls=_AuditJSONEncoder))


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

    # Skip historical migration models defensively
    if getattr(instance.__class__, "__module__", "") == "__fake__":
        return

    tenant = _get_tenant_from_instance(instance)
    tenant_id = getattr(instance, "tenant_id", None) or getattr(tenant, "pk", tenant)
    if not tenant_id:
        return

    user = get_current_user()
    user_id = None
    if user:
        u_tenant = getattr(user, "tenant_id", None) or getattr(getattr(user, "tenant", None), "pk", None)
        if str(u_tenant) == str(tenant_id):
            user_id = getattr(user, "pk", None)

    diff = dict(diff or {})
    # Record the manager who authorized the action with their PIN, if any.
    authorizer = getattr(instance, "authorized_by", None) or getattr(instance, "_authorized_by", None)
    if authorizer is not None:
        if isinstance(authorizer, dict):
            diff["_authorized_by"] = authorizer
        else:
            diff["_authorized_by"] = {
                "id": str(getattr(authorizer, "pk", authorizer)),
                "name": (getattr(authorizer, "get_full_name", lambda: "")() or getattr(authorizer, "email", str(authorizer))),
            }

    try:
        diff = _freeze_for_json(diff)
        with transaction.atomic():
            AuditLog.objects.create(
                tenant_id=tenant_id,
                user_id=user_id,
                action=action,
                model_name=instance.__class__.__name__,
                object_id=str(instance.pk),
                object_repr=str(instance)[:300],
                diff=diff,
            )
    except Exception:
        logger.exception(
            "Audit log write failed for %s %s",
            instance.__class__.__name__,
            getattr(instance, "pk", None),
        )


# ── Signal receivers ──────────────────────────────────────────────────────────

def _is_audited(instance):
    # Historical models from migrations are created dynamically under the '__fake__' module.
    # Never audit migrations or historical models.
    if getattr(instance.__class__, "__module__", "") == "__fake__":
        return False
    return instance.__class__.__name__ in AUDITED_MODELS


@receiver(pre_save)
def audit_pre_save(sender, instance, **kwargs):
    """Capture the previous DB state before saving so we can diff it."""
    if kwargs.get("raw"):
        return
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
    if kwargs.get("raw"):
        return
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
                "from": _freeze_for_json(_json_safe(before.get(field))),
                "to": _freeze_for_json(_json_safe(after.get(field))),
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
            "from": _freeze_for_json(_json_safe(before.get(field))),
            "to": None,
        }
        for field in before
    }
    
    _write_audit(instance, "delete", diff)

from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
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
    if kwargs.get("raw"):
        return
    if getattr(instance.__class__, "__module__", "") == "__fake__":
        return
    # Only track TenantScopedModel subclasses
    if not issubclass(sender, TenantScopedModel):
        return
    
    # Don't track SyncOutbox itself if it ever inherits it, or AuditLog
    if sender in (SyncOutbox, AuditLog):
        return
        
    action = AuditLog.ActionChoices.CREATE if created else AuditLog.ActionChoices.UPDATE
    payload = serialize_model(instance)

    tenant_id = getattr(instance, "tenant_id", None) or getattr(getattr(instance, "tenant", None), "pk", None)
    if not tenant_id:
        return

    try:
        payload_json = _freeze_for_json(payload)
        with transaction.atomic():
            SyncOutbox.objects.create(
                tenant_id=tenant_id,
                model_name=sender.__name__,
                object_id=str(instance.pk),
                action=action,
                payload=payload_json,
            )
    except Exception:
        logger.exception(
            "Sync outbox write failed for %s %s",
            sender.__name__,
            getattr(instance, "pk", None),
        )

@receiver(post_delete)
def sync_outbox_post_delete(sender, instance, **kwargs):
    if getattr(instance.__class__, "__module__", "") == "__fake__":
        return
    if not issubclass(sender, TenantScopedModel):
        return
        
    if sender in (SyncOutbox, AuditLog):
        return

    tenant_id = getattr(instance, "tenant_id", None) or getattr(getattr(instance, "tenant", None), "pk", None)
    if not tenant_id:
        return

    try:
        with transaction.atomic():
            SyncOutbox.objects.create(
                tenant_id=tenant_id,
                model_name=sender.__name__,
                object_id=str(instance.pk),
                action=AuditLog.ActionChoices.DELETE,
                payload={"id": str(instance.pk)},
            )
    except Exception:
        logger.exception(
            "Sync outbox delete failed for %s %s",
            sender.__name__,
            getattr(instance, "pk", None),
        )
