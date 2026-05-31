from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.mobile.views import BarcodeScanView, DeviceTokenViewSet, MobileDashboardView

router = DefaultRouter()
router.register("devices", DeviceTokenViewSet, basename="mobile-device")

urlpatterns = [
    path(r"scan/", BarcodeScanView.as_view(), name="mobile-scan"),
    path(r"dashboard/", MobileDashboardView.as_view(), name="mobile-dashboard"),
    path(r"", include(router.urls)),
]
