"""
Central role-based DRF permission classes (Task 2.1 / D6).

Provides:
- IsOwner: allows only owner (or superuser).
- IsManagerOrOwner: allows owner or manager (or superuser).
- RolePermission: reads a per-ViewSet `role_permissions = {"action": {"owner", "manager"}, "default": ...}` map.
"""
from rest_framework.permissions import BasePermission

from apps.core.models import RoleChoices

OWNER_ONLY = frozenset({RoleChoices.OWNER})
MANAGER_OR_OWNER = frozenset({RoleChoices.OWNER, RoleChoices.MANAGER})
ALL_ROLES = frozenset({RoleChoices.OWNER, RoleChoices.MANAGER, RoleChoices.CASHIER})


class IsOwner(BasePermission):
    """Allow access only to store owners (and superusers)."""

    message = "Seul le propriétaire est autorisé à effectuer cette action."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return getattr(user, "role", None) == RoleChoices.OWNER


class IsManagerOrOwner(BasePermission):
    """Allow access only to managers and owners (and superusers)."""

    message = "Seuls les managers et le propriétaire sont autorisés à effectuer cette action."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return getattr(user, "role", None) in MANAGER_OR_OWNER


class RolePermission(BasePermission):
    """
    Action-aware role permission class for DRF ViewSets.

    Reads `view.role_permissions`, a dict mapping ViewSet action names
    (or HTTP method names in lowercase) to an iterable of allowed role strings,
    with an optional `"default"` fallback entry.
    """

    message = "Droits insuffisants pour effectuer cette action."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True

        role_map = getattr(view, "role_permissions", None) or {}
        action = getattr(view, "action", None) or request.method.lower()

        allowed_roles = role_map.get(action)
        if allowed_roles is None:
            allowed_roles = role_map.get("default", MANAGER_OR_OWNER)

        return getattr(user, "role", None) in allowed_roles

