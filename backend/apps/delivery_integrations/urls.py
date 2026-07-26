from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ProviderConfigViewSet, CustomerOrderViewSet,
    ExternalOrderIngestionView, WebhookReceiverView,
    SocialIntegrationViewSet, MetaWebhookView,
    MetaOAuthURLView, MetaOAuthCallbackView,
)

router = DefaultRouter()
router.register(r'provider-configs', ProviderConfigViewSet, basename='providerconfig')
router.register(r'customer-orders', CustomerOrderViewSet, basename='customerorder')
router.register(r'social-integrations', SocialIntegrationViewSet, basename='socialintegration')

urlpatterns = [
    path('external-orders/', ExternalOrderIngestionView.as_view(), name='external-order-ingestion'),
    path('webhook/', WebhookReceiverView.as_view(), name='webhook-receiver'),
    path('meta-webhook/', MetaWebhookView.as_view(), name='meta-webhook'),
    path('meta-oauth/url/', MetaOAuthURLView.as_view(), name='meta-oauth-url'),
    path('meta-oauth/callback/', MetaOAuthCallbackView.as_view(), name='meta-oauth-callback'),
    path('', include(router.urls)),
]
