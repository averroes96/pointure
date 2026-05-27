"""Core URL patterns."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import BranchViewSet, MeView, TenantSettingsView, UserViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("branches", BranchViewSet, basename="branch")
router.register("me", MeView, basename="me")
router.register("tenant", TenantSettingsView, basename="tenant")

urlpatterns = [
    path("", include(router.urls)),
]
