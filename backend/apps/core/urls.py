"""Core URL patterns."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AuditLogViewSet, BranchViewSet, MeView, StoreSettingsView, 
    TenantSettingsView, UserViewSet, SyncReceiverView,
    WilayaViewSet, CommuneViewSet, LegacyDBFImportView
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

from .import_views import (
    ImportTemplateView,
    ImportParseView,
    ImportPreviewView,
    ImportExecuteView,
)

urlpatterns = [
    path("sync/push/", SyncReceiverView.as_view(), name="sync-push"),
    path("legacy-import/", LegacyDBFImportView.as_view(), name="legacy-import"),
    path("import/template/", ImportTemplateView.as_view(), name="import-template"),
    path("import/parse/", ImportParseView.as_view(), name="import-parse"),
    path("import/preview/", ImportPreviewView.as_view(), name="import-preview"),
    path("import/execute/", ImportExecuteView.as_view(), name="import-execute"),
    path("", include(router.urls)),
]
