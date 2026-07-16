"""Invoicing serializers."""
from decimal import Decimal

from rest_framework import serializers

from .models import CreditNote, DeliveryNote, DeliveryNoteLine, Invoice, InvoiceLine, InvoicePayment


class InvoiceLineSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = InvoiceLine
        fields = [
            "id", "variant", "description", "quantity",
            "unit_price", "discount_pct", "line_total", "order",
        ]
        read_only_fields = ["id", "line_total"]


class InvoicePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoicePayment
        fields = ["id", "amount", "method", "cheque_ref", "date", "notes", "recorded_by", "created_at"]
        read_only_fields = ["id", "created_at", "recorded_by"]


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    payments = InvoicePaymentSerializer(many=True, read_only=True)
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total_paid = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    has_pdf = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            "id", "client", "client_name", "branch", "number", "series_prefix",
            "date", "due_date", "status", "total_ht", "tva_rate", "tva_amount",
            "total_ttc", "apply_tva", "total_paid", "balance_due",
            "notes", "lines", "payments", "has_pdf", "created_at",
        ]
        read_only_fields = ["id", "number", "total_ht", "tva_amount", "total_ttc", "created_at"]

    def get_has_pdf(self, obj):
        return bool(obj.pdf_file)


class InvoiceListSerializer(serializers.ModelSerializer):
    """Lightweight list serializer."""
    client_name = serializers.CharField(source="client.name", read_only=True)
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id", "number", "client", "client_name", "date", "due_date",
            "status", "total_ttc", "balance_due",
        ]


class InitialPaymentInput(serializers.Serializer):
    """Optional initial payment recorded at invoice creation time."""
    method = serializers.ChoiceField(choices=["cash", "ccp", "virement", "cheque"])
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    date = serializers.DateField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class CreateInvoiceSerializer(serializers.Serializer):
    """Input for creating a new invoice with lines."""
    client_id = serializers.IntegerField(required=False, allow_null=True)
    branch_id = serializers.IntegerField(required=False, allow_null=True)
    date = serializers.DateField()
    due_date = serializers.DateField()
    series_prefix = serializers.CharField(default="FA", max_length=20)
    apply_tva = serializers.BooleanField(default=True)
    tva_rate = serializers.DecimalField(max_digits=5, decimal_places=2, default=Decimal("19.00"))
    notes = serializers.CharField(required=False, allow_blank=True)
    lines = InvoiceLineSerializer(many=True, min_length=1)
    confirm = serializers.BooleanField(default=False, help_text="If true, assign number (FA-2026-00001) and set status to sent.")
    payment = InitialPaymentInput(required=False, allow_null=True)



class DeliveryNoteLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryNoteLine
        fields = ["id", "variant", "description", "quantity", "unit_price", "discount_pct", "order"]
        read_only_fields = ["id"]

class DeliveryNoteSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source="invoice.number", read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True, default="")
    lines = DeliveryNoteLineSerializer(many=True, read_only=True)

    class Meta:
        model = DeliveryNote
        fields = [
            "id", "client", "client_name", "invoice", "invoice_number",
            "number", "date", "delivered_by", "notes", "lines", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

class CreateDeliveryNoteSerializer(serializers.Serializer):
    client_id = serializers.IntegerField(required=True)
    date = serializers.DateField()
    number = serializers.CharField(max_length=30)
    delivered_by = serializers.CharField(max_length=150, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    lines = DeliveryNoteLineSerializer(many=True, min_length=1)

class RegrouperBLsSerializer(serializers.Serializer):
    client_id = serializers.IntegerField(required=True)
    delivery_note_ids = serializers.ListField(
        child=serializers.IntegerField(), min_length=1
    )
    date = serializers.DateField()
    due_date = serializers.DateField()
    series_prefix = serializers.CharField(default="FA", max_length=20)
    apply_tva = serializers.BooleanField(default=True)
    tva_rate = serializers.DecimalField(max_digits=5, decimal_places=2, default=Decimal("19.00"))
    notes = serializers.CharField(required=False, allow_blank=True)
    confirm = serializers.BooleanField(default=False)



class CreditNoteSerializer(serializers.ModelSerializer):
    # Read-only denormalized fields for list/detail views
    original_invoice_number = serializers.CharField(
        source="original_invoice.number", read_only=True
    )
    client_name = serializers.CharField(
        source="original_invoice.client.name", read_only=True, default=""
    )
    original_invoice_tva_rate = serializers.DecimalField(
        source="original_invoice.tva_rate", max_digits=5, decimal_places=2, read_only=True
    )

    class Meta:
        model = CreditNote
        fields = [
            "id", "original_invoice", "original_invoice_number",
            "original_invoice_tva_rate", "client_name",
            "number", "reason", "total_ht", "tva_amount", "total_ttc", "date", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
