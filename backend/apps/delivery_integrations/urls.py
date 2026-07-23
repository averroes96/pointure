from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ProviderConfigViewSet, CustomerOrderViewSet,
    ExternalOrderIngestionView, WebhookReceiverView
)

router = DefaultRouter()
router.register(r'provider-configs', ProviderConfigViewSet, basename='providerconfig')
router.register(r'customer-orders', CustomerOrderViewSet, basename='customerorder')

urlpatterns = [
    path('external-orders/', ExternalOrderIngestionView.as_view(), name='external-order-ingestion'),
    path('webhook/', WebhookReceiverView.as_view(), name='webhook-receiver'),
    path('', include(router.urls)),
]
