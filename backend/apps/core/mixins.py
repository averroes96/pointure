"""
DRF Viewset mixins for tenant scoping and role-based permission enforcement.

WHY initial() instead of middleware for JWT requests:
  Django's TenantMiddleware runs before DRF processes the Authorization header.
  At middleware time request.user is still AnonymousUser for JWT requests, so
  request.tenant ends up None. DRF calls initial() → perform_authentication()
  which processes the JWT token. We override initial() here so that by the time
  get_queryset() runs, request.user and request.tenant are both correct.
"""
from rest_framework.exceptions import PermissionDenied

from apps.core.managers import set_current_tenant
from apps.core.signals import set_current_user
from apps.core.models import RoleChoices


class TenantScopedViewSetMixin:
    """
    Mixin for all DRF ViewSets dealing with TenantScopedModel.

    - Resolves and enforces tenant after DRF authentication completes
    - Forces queryset to current tenant
    - Auto-sets tenant on create
    - Provides role-check helpers
    """

    def initial(self, request, *args, **kwargs):
        """
        Override DRF's initial() to resolve request.tenant BEFORE check_permissions()
        is called. This ensures PlanRequired and other tenant-aware permission classes
        receive the correct tenant.

        Order matters:
          1. perform_authentication() → resolves request.user from JWT/session
          2. Set request.tenant (using the now-known user)
          3. super().initial() → check_permissions(), check_throttles()
             (perform_authentication inside super is idempotent — result is cached)
        """
        # Step 1: resolve user from token/session
        self.perform_authentication(request)

        # Step 2: resolve tenant while user is known, BEFORE check_permissions fires
        user = request.user
        if user.is_authenticated and not user.is_superuser:
            tenant = getattr(user, "tenant", None)
            request.tenant = tenant
            set_current_tenant(tenant)
            set_current_user(user)
        else:
            # Superuser or anonymous — no tenant scope
            request.tenant = None
            set_current_tenant(None)

        # Step 3: run the rest of DRF's initial (check_permissions, check_throttles…)
        super().initial(request, *args, **kwargs)

    def _get_tenant(self):
        """Return the resolved tenant for the current request."""
        return getattr(self.request, "tenant", None)

    def get_queryset(self):
        """Return queryset scoped to the authenticated user's tenant."""
        qs = super().get_queryset()
        user = self.request.user

        if user.is_superuser:
            # Superusers bypass tenant scoping — they can see all data
            return self.get_queryset_class().objects.unscoped()

        tenant = self._get_tenant()
        if tenant:
            return qs.filter(tenant=tenant)

        # Authenticated but no tenant assigned — return nothing (safety net)
        return qs.none()

    def perform_create(self, serializer):
        """Auto-assign tenant on create from the authenticated user."""
        tenant = self._get_tenant()
        kwargs = {"tenant": tenant}
        # Some views pass branch via request data; others default to user's branch
        if "branch" not in serializer.validated_data:
            branch = getattr(self.request.user, "default_branch", None)
            if branch:
                kwargs["branch"] = branch
        serializer.save(**kwargs)

    def require_role(self, *roles):
        """Raise PermissionDenied if user's role is not in the given roles."""
        role = getattr(self.request.user, "role", None)
        if role not in roles:
            raise PermissionDenied("Insufficient role for this action.")

    def require_manager(self):
        self.require_role(RoleChoices.OWNER, RoleChoices.MANAGER)

    def require_owner(self):
        self.require_role(RoleChoices.OWNER)

    def get_queryset_class(self):
        """Return the model class for this viewset's queryset."""
        return self.queryset.model
