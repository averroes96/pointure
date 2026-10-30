"""Core serializers: Tenant, User, Branch."""
from rest_framework import serializers

from .models import AuditLog, Branch, StoreSettings, Tenant, User, Wilaya, Commune

class WilayaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wilaya
        fields = ["id", "code", "name", "ar_name"]

class CommuneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Commune
        fields = ["id", "post_code", "name", "ar_name", "wilaya"]




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
    has_pin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name",
            "role", "language_preference", "phone", "avatar",
            "is_active", "can_see_costs", "date_joined",
            "max_discount_pct", "can_modify_price", "can_process_returns", "can_cancel_sale",
            "has_pin",
        ]
        read_only_fields = ["id", "date_joined", "can_see_costs", "has_pin"]

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.phone or obj.email

    def get_has_pin(self, obj):
        return bool(obj.pin_code)


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)
    pin_code = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            "email", "first_name", "last_name", "password", "confirm_password",
            "role", "language_preference", "phone",
            "max_discount_pct", "can_modify_price", "can_process_returns", "can_cancel_sale",
            "pin_code",
        ]

    def validate(self, data):
        if data["password"] != data.pop("confirm_password"):
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        pin = data.get("pin_code")
        if pin:
            pin_str = pin.strip()
            if not pin_str.isdigit() or len(pin_str) not in (4, 6):
                raise serializers.ValidationError({"pin_code": "Le code PIN doit comporter 4 ou 6 chiffres numériques."})
        return data

    def create(self, validated_data):
        password = validated_data.pop("password")
        pin = validated_data.pop("pin_code", None)
        user = User(**validated_data)
        user.set_password(password)
        if pin:
            user.set_pin(pin)
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
        fields = [
            "id", "min_versement_pct", "versement_due_days",
            "versement_requires_client", "enable_variants", "allow_negative_stock",
            "require_manager_pin_for_returns", "require_manager_pin_for_discounts", "default_max_discount_pct",
            "enable_layaway", "min_layaway_deposit_pct", "layaway_duration_days",
        ]
        read_only_fields = ["id"]


class MeSerializer(serializers.ModelSerializer):
    """Detailed serializer for the /me endpoint."""
    tenant = TenantSerializer(read_only=True)
    can_see_costs = serializers.BooleanField(read_only=True)
    has_pin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "role",
            "language_preference", "phone", "avatar", "tenant",
            "can_see_costs", "is_active",
            "max_discount_pct", "can_modify_price", "can_process_returns", "can_cancel_sale",
            "has_pin",
        ]
        read_only_fields = ["id", "tenant", "can_see_costs", "has_pin"]

    def get_has_pin(self, obj):
        return bool(obj.pin_code)


from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.utils.translation import gettext_lazy as _

class PhoneOrEmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Accepts 'username', 'email', or 'phone' as the login credential,
    allowing dual login via Algerian phone number or email address.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Remove default USERNAME_FIELD requirement from SimpleJWT
        self.fields.pop(self.username_field, None)
        # Add flexible username/identifier field
        self.fields["username"] = serializers.CharField(
            required=False,
            allow_blank=True,
            write_only=True,
            help_text="Phone number or email address",
        )
        # Also allow clients posting 'phone' or 'email' directly
        self.fields["phone"] = serializers.CharField(required=False, allow_blank=True, write_only=True)
        self.fields["email"] = serializers.CharField(required=False, allow_blank=True, write_only=True)

    def validate(self, attrs):
        identifier = (
            attrs.get("username")
            or attrs.get("phone")
            or attrs.get("email")
        )
        if not identifier or not str(identifier).strip():
            raise serializers.ValidationError({
                "username": _("Un numéro de téléphone ou une adresse email est requis.")
            })

        authenticate_kwargs = {
            "username": str(identifier).strip(),
            "password": attrs.get("password", ""),
        }
        if "request" in self.context:
            authenticate_kwargs["request"] = self.context["request"]

        from django.contrib.auth import authenticate
        self.user = authenticate(**authenticate_kwargs)

        from rest_framework_simplejwt.settings import api_settings
        from rest_framework import exceptions
        if not api_settings.USER_AUTHENTICATION_RULE(self.user):
            raise exceptions.AuthenticationFailed(
                self.error_messages["no_active_account"],
                "no_active_account",
            )

        data = {}
        refresh = self.get_token(self.user)
        data["refresh"] = str(refresh)
        data["access"] = str(refresh.access_token)

        if api_settings.UPDATE_LAST_LOGIN:
            from django.contrib.auth.models import update_last_login
            update_last_login(None, self.user)

        return data

