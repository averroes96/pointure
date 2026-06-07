"""Client serializers."""
from rest_framework import serializers

from .models import Cheque, Client, ClientLedger


class ClientSerializer(serializers.ModelSerializer):
    is_over_credit_limit = serializers.BooleanField(read_only=True)

    class Meta:
        model = Client
        fields = [
            "id", "name", "phone", "email", "address", "wilaya",
            "client_type", "nif", "rc", "credit_limit", "cached_balance",
            "is_over_credit_limit", "is_active", "notes", "created_at",
        ]
        read_only_fields = ["id", "cached_balance", "is_over_credit_limit", "created_at"]


class ClientLedgerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientLedger
        fields = [
            "id", "entry_type", "amount", "description",
            "reference_type", "reference_id", "date", "balance_after", "created_at",
        ]
        read_only_fields = ["id", "created_at", "balance_after"]


class RecordPaymentSerializer(serializers.Serializer):
    """Input for recording a client payment."""
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    method = serializers.ChoiceField(choices=["cash", "cheque", "ccp", "virement"])
    date = serializers.DateField()
    notes = serializers.CharField(required=False, allow_blank=True)
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
    client_id = serializers.IntegerField()
    client_name = serializers.CharField()
    phone = serializers.CharField()
    wilaya = serializers.CharField()
    current = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_30 = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_60 = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_90 = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_90_plus = serializers.DecimalField(max_digits=12, decimal_places=2)
    total = serializers.DecimalField(max_digits=12, decimal_places=2)
