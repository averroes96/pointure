from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    CourierCatalogueView, ProviderConfigViewSet, CustomerOrderViewSet,
    ExternalOrderIngestionView, ShipmentViewSet, CourierPayoutViewSet,
    CommuneMatchView, UnmatchedCommunesView,
)

router = DefaultRouter()
router.register(r'provider-configs', ProviderConfigViewSet, basename='providerconfig')
router.register(r'customer-orders', CustomerOrderViewSet, basename='customerorder')
router.register(r'shipments', ShipmentViewSet, basename='shipment')
router.register(r'payouts', CourierPayoutViewSet, basename='courierpayout')

urlpatterns = [
    path('couriers/', CourierCatalogueView.as_view(), name='courier-catalogue'),
    path('communes/', CommuneMatchView.as_view(), name='delivery-communes'),
    path('communes/unmatched/', UnmatchedCommunesView.as_view(), name='delivery-communes-unmatched'),
    path('external-orders/', ExternalOrderIngestionView.as_view(), name='external-order-ingestion'),
    path('', include(router.urls)),
]
