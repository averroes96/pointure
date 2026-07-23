"""Core URL patterns."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AuditLogViewSet, BranchViewSet, MeView, StoreSettingsView, 
    TenantSettingsView, UserViewSet, SyncReceiverView,
    WilayaViewSet, CommuneViewSet
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("branches", BranchViewSet, basename="branch")
router.register("me", MeView, basename="me")
router.register("tenant", TenantSettingsView, basename="tenant")
router.register("audit-logs", AuditLogViewSet, basename="auditlog")
router.register("store-settings", StoreSettingsView, basename="store-settings")
router.register("wilayas", WilayaViewSet, basename="wilaya")
router.register("communes", CommuneViewSet, basename="commune")

urlpatterns = [
    path("sync/push/", SyncReceiverView.as_view(), name="sync-push"),
    path("", include(router.urls)),
]
