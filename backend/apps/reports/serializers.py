from rest_framework import serializers
from apps.inventory.models import CategoryChoices, GenderChoices
from .models import ReportTemplate
from .field_registry import FIELD_REGISTRY
from .query_engine import MAX_COLUMNS


class SizeCurveQuerySerializer(serializers.Serializer):
    product = serializers.UUIDField(required=False)
    brand = serializers.CharField(required=False, allow_blank=True, max_length=100)
    category = serializers.ChoiceField(choices=CategoryChoices.choices, required=False)
    gender = serializers.ChoiceField(choices=GenderChoices.choices, required=False)
    weeks = serializers.IntegerField(required=False, min_value=1, max_value=104, default=8)


class ReportTemplateSerializer(serializers.ModelSerializer):
    created_by_email = serializers.EmailField(source="created_by.email", read_only=True)

    class Meta:
        model = ReportTemplate
        fields = [
            "id", "name", "source", "config",
            "is_public", "created_by_email",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by_email", "created_at", "updated_at"]

    def validate_source(self, value):
        if value not in FIELD_REGISTRY:
            raise serializers.ValidationError(f"Source invalide. Valeurs acceptées : {', '.join(FIELD_REGISTRY)}")
        return value

    def validate_config(self, value):
        columns = value.get("columns", [])
        if len(columns) > MAX_COLUMNS:
            raise serializers.ValidationError(f"Maximum {MAX_COLUMNS} colonnes par rapport.")
        return value
