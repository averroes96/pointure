from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    CourierCatalogueView, ProviderConfigViewSet, CustomerOrderViewSet,
    ExternalOrderIngestionView, ShipmentViewSet,
)

router = DefaultRouter()
router.register(r'provider-configs', ProviderConfigViewSet, basename='providerconfig')
router.register(r'customer-orders', CustomerOrderViewSet, basename='customerorder')
router.register(r'shipments', ShipmentViewSet, basename='shipment')

urlpatterns = [
    path('couriers/', CourierCatalogueView.as_view(), name='courier-catalogue'),
    path('external-orders/', ExternalOrderIngestionView.as_view(), name='external-order-ingestion'),
    path('', include(router.urls)),
]
