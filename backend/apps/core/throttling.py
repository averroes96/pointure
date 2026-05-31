"""Custom DRF throttle classes."""
from rest_framework.throttling import SimpleRateThrottle


class LoginRateThrottle(SimpleRateThrottle):
    """
    5 login attempts per 15 minutes per IP.
    Keyed by IP only (not user) so it applies to unauthenticated requests.
    """
    scope = "login"

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class PasswordResetRateThrottle(SimpleRateThrottle):
    """3 password-reset requests per hour per IP."""
    scope = "password_reset"

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class MobileRateThrottle(SimpleRateThrottle):
    """Generous limit for the mobile app — keyed by authenticated user."""
    scope = "mobile"

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            ident = request.user.pk
        else:
            ident = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}
