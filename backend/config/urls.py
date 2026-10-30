"""ShoeDZ — Root URL Configuration."""
import django.urls.converters
_original_register_converter = django.urls.converters.register_converter

def register_converter_silent(converter, type_name):
    try:
        _original_register_converter(converter, type_name)
    except ValueError:
        pass

django.urls.converters.register_converter = register_converter_silent
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)
from apps.core.views import PasswordResetRequestView, PasswordResetConfirmView
from apps.core.setup_views import SetupStatusView, SetupView
from apps.core.throttling import LoginRateThrottle, PasswordResetRateThrottle
from apps.core.serializers import PhoneOrEmailTokenObtainPairSerializer


class ThrottledLoginView(TokenObtainPairView):
    throttle_classes = [LoginRateThrottle]
    serializer_class = PhoneOrEmailTokenObtainPairSerializer


class ThrottledPasswordResetView(PasswordResetRequestView):
    throttle_classes = [PasswordResetRateThrottle]


api_v1 = [
    # First-run setup wizard (unauthenticated, local mode only)
    path("setup/status/", SetupStatusView.as_view(), name="setup-status"),
    path("setup/", SetupView.as_view(), name="setup"),
    # Authentication — throttled at the URL level
    path("auth/login/", ThrottledLoginView.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/verify/", TokenVerifyView.as_view(), name="token_verify"),
    path("auth/password-reset/", ThrottledPasswordResetView.as_view(), name="password-reset-request"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    # App routes
    path("core/", include("apps.core.urls")),
    path("inventory/", include("apps.inventory.urls")),
    path("sales/", include("apps.sales.urls")),
    path("invoicing/", include("apps.invoicing.urls")),
    path("clients/", include("apps.clients.urls")),
    path("suppliers/", include("apps.suppliers.urls")),
    path("reports/", include("apps.reports.urls")),
    path("notifications/", include("apps.notifications.urls")),
    path("mobile/", include("apps.mobile.urls")),
    path("loyalty/", include("apps.loyalty.urls")),
    path("promotions/", include("apps.promotions.urls")),
    path("events/", include("apps.events.urls")),
    path("webhooks/", include("apps.webhooks.urls")),
    path("deliveries/", include("apps.delivery_integrations.urls")),
    path("desktop/", include("apps.core.desktop.urls")),
    # OpenAPI
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

    try:
        import debug_toolbar
        urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
    except ImportError:
        pass

if getattr(settings, "DESKTOP_MODE", False):
    from django.urls import re_path
    from django.views.static import serve as serve_media
    from apps.core.desktop.views import health_check, spa_index
    urlpatterns += [
        path("api/v1/health/", health_check, name="desktop-health"),
        # static() is a no-op when DEBUG=False, so serve local media explicitly.
        re_path(r"^media/(?P<path>.*)$", serve_media, {"document_root": settings.MEDIA_ROOT}),
        # Client-side routes only: never answer API/static/asset requests or
        # file-like paths (*.js, *.css, *.png ...) with index.html.
        re_path(r"^(?!api/|admin/|static/|media/|assets/)(?!.*\.[A-Za-z0-9]{1,8}$).*$", spa_index, name="spa-catchall"),
    ]
