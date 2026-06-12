from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import WebhookDeliveryRetryView, WebhookEndpointViewSet

router = DefaultRouter()
router.register("endpoints", WebhookEndpointViewSet, basename="webhook-endpoint")

urlpatterns = router.urls + [
    path("deliveries/<int:pk>/retry/", WebhookDeliveryRetryView.as_view(), name="webhook-delivery-retry"),
]
