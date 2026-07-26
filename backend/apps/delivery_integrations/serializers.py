from rest_framework import serializers

from .models import ProviderConfig, CustomerOrder, SocialIntegration


class ProviderConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProviderConfig
        fields = [
            "id",
            "provider",
            "api_id",
            "api_secret",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "api_secret": {"write_only": True}
        }


class CustomerOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerOrder
        fields = [
            "id",
            "source",
            "customer_name",
            "customer_phone",
            "wilaya",
            "commune",
            "address",
            "customer_notes",
            "status",
            "shipping_fee",
            "provider",
            "tracking_number",
            "sale",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "provider",
            "tracking_number",
            "sale",
            "created_at",
            "updated_at",
        ]


class CustomerOrderDispatchSerializer(serializers.Serializer):
    """
    Serializer used when a store manager validates a draft order and dispatches it.
    """
    provider = serializers.ChoiceField(choices=[('yalidine', 'Yalidine'), ('zr_express', 'ZR Express'), ('maystro', 'Maystro Delivery'), ('noest', 'NOEST')])
    # The total price the customer pays on delivery (COD amount).
    # Stores set this manually — it may or may not match the sum of product prices.
    total_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    # The manager must select the specific variants that correspond to what the customer ordered.
    variant_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        help_text="The exact inventory variants to include in the Sale."
    )
    quantities = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False
    )

    def validate(self, attrs):
        if len(attrs["variant_ids"]) != len(attrs["quantities"]):
            raise serializers.ValidationError("variant_ids and quantities must be the same length.")
        return attrs


class SocialIntegrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SocialIntegration
        fields = [
            "id",
            "platform",
            "page_id",
            "page_name",
            "access_token",
            "is_active",
            "ai_enabled",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "access_token": {"write_only": True}
        }

