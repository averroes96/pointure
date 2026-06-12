from rest_framework import serializers
from .models import Promotion


class PromotionSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)

    class Meta:
        model = Promotion
        fields = [
            "id", "name", "description", "is_active",
            "start_date", "end_date",
            "category", "product", "product_name",
            "min_quantity", "min_amount",
            "discount_pct", "discount_amount",
            "priority", "max_uses", "uses_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "uses_count", "created_at", "updated_at"]

    def validate(self, attrs):
        if not attrs.get("discount_pct") and not attrs.get("discount_amount"):
            raise serializers.ValidationError(
                "Définissez au moins un effet : discount_pct ou discount_amount."
            )
        if attrs.get("discount_pct") and attrs.get("discount_amount"):
            raise serializers.ValidationError(
                "Choisissez soit discount_pct soit discount_amount, pas les deux."
            )
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        if start and end and end < start:
            raise serializers.ValidationError("La date de fin doit être après la date de début.")
        return attrs
