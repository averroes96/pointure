from rest_framework import serializers

from .models import WEBHOOK_EVENT_CHOICES, WebhookDelivery, WebhookEndpoint

VALID_EVENT_TYPES = {v for v, _ in WEBHOOK_EVENT_CHOICES}


class WebhookEndpointSerializer(serializers.ModelSerializer):
    delivery_count = serializers.SerializerMethodField()
    last_delivery_status = serializers.SerializerMethodField()

    class Meta:
        model = WebhookEndpoint
        fields = [
            "id", "name", "url", "secret", "events", "is_active",
            "created_at", "updated_at", "delivery_count", "last_delivery_status",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "delivery_count", "last_delivery_status"]
        extra_kwargs = {"secret": {"write_only": True}}

    def get_delivery_count(self, obj):
        return obj.deliveries.count()

    def get_last_delivery_status(self, obj):
        last = obj.deliveries.order_by("-created_at").first()
        return last.status if last else None

    def validate_events(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("events doit être une liste.")
        invalid = [e for e in value if e not in VALID_EVENT_TYPES]
        if invalid:
            raise serializers.ValidationError(f"Types d'événement invalides : {', '.join(invalid)}")
        return value

    def validate_url(self, value):
        if not value.startswith(("http://", "https://")):
            raise serializers.ValidationError("L'URL doit commencer par http:// ou https://")
        return value


class WebhookDeliverySerializer(serializers.ModelSerializer):
    endpoint_name = serializers.CharField(source="endpoint.name", read_only=True)
    endpoint_url = serializers.URLField(source="endpoint.url", read_only=True)

    class Meta:
        model = WebhookDelivery
        fields = [
            "id", "idempotency_key", "endpoint_name", "endpoint_url",
            "event_type", "status", "attempts", "response_status",
            "response_body", "created_at", "delivered_at", "next_attempt_at",
        ]
