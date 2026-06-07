"""Core serializers: Tenant, User, Branch."""
from rest_framework import serializers

from .models import AuditLog, Branch, StoreSettings, Tenant, User


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = [
            "id", "name", "plan", "is_active", "nif", "rc", "ai",
            "phone", "address", "wilaya", "logo", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    can_see_costs = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name",
            "role", "language_preference", "phone", "avatar",
            "is_active", "can_see_costs", "date_joined",
        ]
        read_only_fields = ["id", "date_joined", "can_see_costs"]

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.email


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            "email", "first_name", "last_name", "password", "confirm_password",
            "role", "language_preference", "phone",
        ]

    def validate(self, data):
        if data["password"] != data.pop("confirm_password"):
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = [
            "id", "name", "address", "wilaya", "phone",
            "is_headquarters", "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "timestamp", "user", "user_name", "action", "model_name", "object_id", "object_repr", "diff"]
        read_only_fields = ["id", "timestamp", "user", "user_name", "action", "model_name", "object_id", "object_repr", "diff"]

    def get_user_name(self, obj):
        if obj.user:
            return obj.user.get_full_name() or obj.user.email
        return "System"


class StoreSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = StoreSettings
        fields = ["id", "min_versement_pct", "versement_due_days", "versement_requires_client"]
        read_only_fields = ["id"]


class MeSerializer(serializers.ModelSerializer):
    """Detailed serializer for the /me endpoint."""
    tenant = TenantSerializer(read_only=True)
    can_see_costs = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "role",
            "language_preference", "phone", "avatar", "tenant",
            "can_see_costs", "is_active",
        ]
        read_only_fields = ["id", "tenant", "can_see_costs"]
