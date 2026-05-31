"""
TenantMiddleware — sets request.tenant and thread-local tenant from the
authenticated user. Used for session-based auth (Django admin, tests).

For DRF + JWT requests, tenant is re-resolved inside TenantScopedViewSetMixin.initial()
AFTER DRF has completed JWT token authentication, because at middleware time
request.user is still AnonymousUser for Bearer token requests.
"""
from .managers import clear_current_tenant, set_current_tenant
from .signals import set_current_user


class TenantMiddleware:
    """
    Resolves tenant from session-authenticated user (Django admin / tests).
    For JWT API requests the real resolution happens in the viewset mixin.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Default to None; overridden in viewset mixin after DRF auth for JWT
        request.tenant = None
        set_current_tenant(None)

        # For session-based auth (admin, tests) the user IS available here
        if request.user.is_authenticated and not request.user.is_superuser:
            tenant = getattr(request.user, "tenant", None)
            request.tenant = tenant
            set_current_tenant(tenant)
            set_current_user(request.user)

        try:
            response = self.get_response(request)
        finally:
            clear_current_tenant()

        return response
