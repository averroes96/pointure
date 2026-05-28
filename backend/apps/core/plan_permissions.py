"""
Plan-based DRF permission classes.

Usage:
    class MyViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
        permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]

`PlanRequired(min_plan)` returns a *class* (not an instance) so DRF can
instantiate it normally via `permission()` in `get_permissions()`.
"""
from rest_framework.permissions import BasePermission

PLAN_RANK = {
    "free": 0,
    "pro_retail": 1,
    "pro_wholesale": 2,
    "enterprise": 3,
}


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
