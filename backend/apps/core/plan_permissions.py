"""
Plan-based DRF permission classes and quota enforcement.

Usage:
    # Feature gate (binary):
    class MyViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
        permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]

    # Quota check (in perform_create):
    def perform_create(self, serializer):
        check_quota(self.request, "clients", Client.objects.filter(tenant=self.request.tenant).count())
        serializer.save(tenant=self.request.tenant)

`PlanRequired(min_plan)` returns a *class* (not an instance) so DRF can
instantiate it normally via `permission()` in `get_permissions()`.
"""
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

PLAN_RANK = {
    "free": 0,
    "pro_retail": 1,
    "pro_wholesale": 2,
    "enterprise": 3,
}

# Per-plan resource quotas. None means unlimited.
PLAN_QUOTAS: dict[str, dict[str, int | None]] = {
    "free": {
        "clients": 100,
        "products": 50,
        "users": 3,
        "branches": 1,
    },
    "pro_retail": {
        "clients": None,
        "products": None,
        "users": 10,
        "branches": 3,
    },
    "pro_wholesale": {
        "clients": None,
        "products": None,
        "users": None,
        "branches": 5,
    },
    "enterprise": {
        "clients": None,
        "products": None,
        "users": None,
        "branches": None,
    },
}

_RESOURCE_LABELS = {
    "clients": "clients",
    "products": "produits",
    "users": "utilisateurs",
    "branches": "agences",
}


def check_quota(request, resource: str, current_count: int) -> None:
    """
    Raise PermissionDenied (HTTP 403) if the tenant has reached their quota.

    Args:
        request:       The DRF request object (provides request.tenant and request.user).
        resource:      One of "clients", "products", "users", "branches".
        current_count: The number of existing records for this tenant.
    """
    if not request or not request.user:
        return
    if request.user.is_superuser:
        return

    tenant = getattr(request, "tenant", None)
    if not tenant:
        tenant = getattr(request.user, "tenant", None)
        
    if not tenant:
        return

    plan = getattr(tenant, "plan", "free") or "free"
    limits = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])
    limit = limits.get(resource)

    if limit is None:
        return  # unlimited on this plan

    if current_count >= limit:
        label = _RESOURCE_LABELS.get(resource, resource)
        raise PermissionDenied(
            detail={
                "error": "quota_exceeded",
                "resource": resource,
                "limit": limit,
                "current": current_count,
                "current_plan": plan,
                "message": (
                    f"Limite atteinte : votre plan {plan} autorise {limit} {label} maximum. "
                    f"Passez à un plan supérieur pour en créer davantage."
                ),
                "upgrade_url": "/settings/billing",
            }
        )


def PlanRequired(min_plan: str) -> type:
    """
    Factory that returns a DRF permission class gating on tenant plan.
    Usage in permission_classes: PlanRequired("pro_retail")
    """
    required_rank = PLAN_RANK.get(min_plan, 0)

    class _PlanRequired(BasePermission):
        message = {
            "error": "plan_upgrade_required",
            "message": "Your current plan does not include this feature.",
            "required_plan": min_plan,
            "upgrade_url": "/settings/billing",
        }

        def has_permission(self, request, view):
            if not request.user or not request.user.is_authenticated:
                return False
            if request.user.is_superuser:
                return True
            
            tenant = getattr(request, "tenant", None)
            if not tenant:
                tenant = getattr(request.user, "tenant", None)
                
            if not tenant:
                return False
                
            current_rank = PLAN_RANK.get(tenant.plan, 0)
            if current_rank < required_rank:
                self.message = {
                    "error": "plan_upgrade_required",
                    "required_plan": min_plan,
                    "current_plan": tenant.plan,
                    "upgrade_url": "/settings/billing",
                }
                return False
            return True

    _PlanRequired.__name__ = f"PlanRequired_{min_plan}"
    _PlanRequired.__qualname__ = f"PlanRequired_{min_plan}"
    return _PlanRequired
