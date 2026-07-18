from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import WebhookDelivery, WebhookEndpoint


@admin.register(WebhookEndpoint)
class WebhookEndpointAdmin(ModelAdmin):
    list_display = ["name", "url", "tenant", "is_active", "created_at"]
    list_filter = ["is_active", "tenant"]
    search_fields = ["name", "url"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(ModelAdmin):
    list_display = ["idempotency_key", "endpoint", "event_type", "status", "attempts", "created_at"]
    list_filter = ["status", "event_type"]
    search_fields = ["event_type", "endpoint__name"]
    readonly_fields = [
        "idempotency_key", "endpoint", "tenant", "event_type", "payload",
        "status", "attempts", "response_status", "response_body",
        "created_at", "delivered_at", "next_attempt_at",
    ]

    def has_add_permission(self, request):
        return False
