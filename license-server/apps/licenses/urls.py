from django.urls import path

from .views import ActivateView, HeartbeatView, VersionView

urlpatterns = [
    path("activate/", ActivateView.as_view(), name="license-activate"),
    path("heartbeat/", HeartbeatView.as_view(), name="license-heartbeat"),
    path("version/", VersionView.as_view(), name="app-version"),
]
