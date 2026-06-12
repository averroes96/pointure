from rest_framework import serializers
from .models import ReportTemplate
from .field_registry import FIELD_REGISTRY, MAX_COLUMNS, OPERATOR_LABELS
from .query_engine import MAX_TEMPLATES


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
