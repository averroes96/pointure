from decimal import Decimal

from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.core.permissions import MANAGER_OR_OWNER
from .models import Cheque, Client, ClientLedger


class ClientSerializer(serializers.ModelSerializer):
    is_over_credit_limit = serializers.BooleanField(read_only=True)
    risk_grade = serializers.SerializerMethodField()
    risk_details = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = [
            "id", "name", "phone", "email", "address", "wilaya",
            "client_type", "price_tier", "nif", "rc", "credit_limit", "cached_balance",
            "is_over_credit_limit", "is_active", "is_blocked", "risk_grade", "risk_details",
            "notes", "created_at",
        ]
        read_only_fields = [
            "id", "cached_balance", "is_over_credit_limit", "risk_grade", "risk_details", "created_at"
        ]

    def get_risk_grade(self, obj) -> str:
        bulk_map = self.context.get("bulk_risk_map")
        if bulk_map and obj.id in bulk_map:
            return bulk_map[obj.id]["grade"]
        from .services.risk import client_risk
        return client_risk(obj)["grade"]

    def get_risk_details(self, obj) -> dict:
        bulk_map = self.context.get("bulk_risk_map")
        if bulk_map and obj.id in bulk_map:
            res = bulk_map[obj.id].copy()
            res["overdue_amount"] = str(res["overdue_amount"])
            return res
        from .services.risk import client_risk
        res = client_risk(obj).copy()
        res["overdue_amount"] = str(res["overdue_amount"])
        return res

    def _is_manager_or_owner(self) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        return bool(user.is_superuser or getattr(user, "role", None) in MANAGER_OR_OWNER)

    def create(self, validated_data):
        new_limit = validated_data.get("credit_limit")
        if new_limit is not None and Decimal(str(new_limit)) != Decimal("0.00"):
            if not self._is_manager_or_owner():
                raise PermissionDenied(
                    "Seul un manager ou le propriétaire peut définir le plafond de crédit d'un client."
                )
        if validated_data.get("is_blocked"):
            if not self._is_manager_or_owner():
                raise PermissionDenied(
                    "Seul un manager ou le propriétaire peut bloquer un client."
                )
        tier = validated_data.get("price_tier")
        ctype = validated_data.get("client_type")
        if (tier and tier != "detail") or ctype == "wholesale":
            if not self._is_manager_or_owner():
                raise PermissionDenied(
                    "Seul un manager ou le propriétaire peut attribuer un tarif de gros ou demi-gros."
                )
        if "price_tier" not in validated_data and validated_data.get("client_type") == "wholesale":
            validated_data["price_tier"] = "gros"
        elif "client_type" not in validated_data and validated_data.get("price_tier") in ("demi_gros", "gros"):
            validated_data["client_type"] = "wholesale"
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "credit_limit" in validated_data and validated_data["credit_limit"] != instance.credit_limit:
            if not self._is_manager_or_owner():
                raise PermissionDenied(
                    "Seul un manager ou le propriétaire peut modifier le plafond de crédit d'un client."
                )
        if "is_blocked" in validated_data and validated_data["is_blocked"] != instance.is_blocked:
            if not self._is_manager_or_owner():
                raise PermissionDenied(
                    "Seul un manager ou le propriétaire peut modifier l'état de blocage d'un client."
                )
        if "price_tier" in validated_data and validated_data["price_tier"] != instance.price_tier:
            if not self._is_manager_or_owner():
                raise PermissionDenied(
                    "Seul un manager ou le propriétaire peut modifier la tarification d'un client."
                )
        if "client_type" in validated_data and validated_data["client_type"] != instance.client_type:
            if not self._is_manager_or_owner():
                raise PermissionDenied(
                    "Seul un manager ou le propriétaire peut modifier le type d'un client."
                )
        return super().update(instance, validated_data)


class ClientLedgerSerializer(serializers.ModelSerializer):
    client_id = serializers.UUIDField(source="client.id", read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)

    class Meta:
        model = ClientLedger
        fields = [
            "id", "client_id", "client_name", "entry_type", "amount", "description",
            "reference_type", "reference_id", "date", "balance_after", "created_at",
        ]
        read_only_fields = ["id", "created_at", "balance_after"]


class RecordPaymentSerializer(serializers.Serializer):
    """Input for recording a client payment."""
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=["cash", "cheque", "ccp", "virement"])
    date = serializers.DateField()
    notes = serializers.CharField(required=False, allow_blank=True)
    invoice_id = serializers.UUIDField(required=False, allow_null=True)
    # Cheque-specific
    cheque_number = serializers.CharField(required=False, allow_blank=True)
    cheque_bank = serializers.CharField(required=False, allow_blank=True)
    cheque_due_date = serializers.DateField(required=False, allow_null=True)

    def validate(self, data):
        if data["method"] == "cheque":
            if not data.get("cheque_number"):
                raise serializers.ValidationError(
                    {"cheque_number": "Cheque number is required for cheque payments."}
                )
        return data


class ChequeSerializer(serializers.ModelSerializer):
    days_until_due = serializers.IntegerField(read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = Cheque
        fields = [
            "id", "client", "client_name", "supplier", "supplier_name",
            "direction", "number", "bank", "amount", "due_date",
            "status", "days_until_due", "notified_at", "notes", "created_at",
        ]
        read_only_fields = ["id", "created_at", "notified_at", "days_until_due"]


class DebtAgeingRowSerializer(serializers.Serializer):
    """One row in the debt ageing report."""
    client_id = serializers.UUIDField()
    client_name = serializers.CharField()
    phone = serializers.CharField()
    wilaya = serializers.CharField()
    current = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_30 = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_60 = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_90 = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_90_plus = serializers.DecimalField(max_digits=12, decimal_places=2)
    total = serializers.DecimalField(max_digits=12, decimal_places=2)
