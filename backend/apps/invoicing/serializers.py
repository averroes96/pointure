"""Invoicing serializers."""
from decimal import Decimal

from rest_framework import serializers

from .models import CreditNote, DeliveryNote, DeliveryNoteLine, Invoice, InvoiceLine, InvoicePayment, Quote, QuoteLine


class InvoiceLineSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    product_id = serializers.UUIDField(source="variant.product_id", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    colour = serializers.CharField(source="variant.colour", read_only=True)
    size_eu = serializers.CharField(source="variant.size_eu", read_only=True)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        from apps.inventory.serializers import _can_see_costs
        if not _can_see_costs(self.context.get("request")):
            data.pop("unit_cost", None)
            data.pop("unit_cost_estimated", None)
        return data

    class Meta:
        model = InvoiceLine
        fields = [
            "id", "variant", "product_id", "product_name", "colour", "size_eu",
            "description", "quantity", "unit_price", "discount_pct", "cartons", "line_total", "order",
            "unit_cost", "unit_cost_estimated",
        ]
        read_only_fields = ["id", "line_total", "unit_cost", "unit_cost_estimated"]


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
    total_paid = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id", "number", "client", "client_name", "date", "due_date",
            "status", "total_ttc", "balance_due", "total_paid", "created_at"
        ]


class InitialPaymentInput(serializers.Serializer):
    """Optional initial payment recorded at invoice creation time."""
    method = serializers.ChoiceField(choices=["cash", "ccp", "virement", "cheque"])
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    date = serializers.DateField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class CreateInvoiceSerializer(serializers.Serializer):
    """Input for creating a new invoice with lines."""
    client_id = serializers.UUIDField(required=False, allow_null=True)
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    date = serializers.DateField()
    due_date = serializers.DateField()
    series_prefix = serializers.CharField(default="FA", max_length=20)
    apply_tva = serializers.BooleanField(default=True)
    is_formal = serializers.BooleanField(default=True)
    is_paid_in_cash = serializers.BooleanField(default=False)
    is_formal = serializers.BooleanField(default=True)
    is_paid_in_cash = serializers.BooleanField(default=False)
    tva_rate = serializers.DecimalField(max_digits=5, decimal_places=2, default=Decimal("19.00"))
    notes = serializers.CharField(required=False, allow_blank=True)
    lines = InvoiceLineSerializer(many=True, min_length=1)
    confirm = serializers.BooleanField(default=False, help_text="If true, assign number (FA-2026-00001) and set status to sent.")
    payment = InitialPaymentInput(required=False, allow_null=True)



class DeliveryNoteLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryNoteLine
        fields = ["id", "variant", "description", "quantity", "unit_price", "discount_pct", "cartons", "order"]
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
    client_id = serializers.UUIDField(required=True)
    date = serializers.DateField()
    number = serializers.CharField(max_length=30)
    delivered_by = serializers.CharField(max_length=150, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    lines = DeliveryNoteLineSerializer(many=True, min_length=1)

class RegrouperBLsSerializer(serializers.Serializer):
    client_id = serializers.UUIDField(required=True)
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    delivery_note_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1
    )
    date = serializers.DateField()
    due_date = serializers.DateField()
    series_prefix = serializers.CharField(default="FA", max_length=20)
    apply_tva = serializers.BooleanField(default=True)
    is_formal = serializers.BooleanField(default=True)
    is_paid_in_cash = serializers.BooleanField(default=False)
    is_formal = serializers.BooleanField(default=True)
    is_paid_in_cash = serializers.BooleanField(default=False)
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


# ─────────────────────────────────────────────
# Quote Serializers
# ─────────────────────────────────────────────

class QuoteLineSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    product_id = serializers.UUIDField(source="variant.product_id", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    colour = serializers.CharField(source="variant.colour", read_only=True)
    size_eu = serializers.CharField(source="variant.size_eu", read_only=True)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        from apps.inventory.serializers import _can_see_costs
        if not _can_see_costs(self.context.get("request")):
            data.pop("unit_cost", None)
            data.pop("unit_cost_estimated", None)
        return data

    class Meta:
        model = QuoteLine
        fields = [
            "id", "variant", "product_id", "product_name", "colour", "size_eu",
            "description", "quantity", "unit_price", "discount_pct", "cartons", "line_total", "order",
            "unit_cost", "unit_cost_estimated",
        ]
        read_only_fields = ["id", "line_total", "unit_cost", "unit_cost_estimated"]


class QuoteSerializer(serializers.ModelSerializer):
    lines = QuoteLineSerializer(many=True, read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True, default="")
    converted_invoice_number = serializers.CharField(source="converted_invoice.number", read_only=True, default="")
    converted_delivery_note_number = serializers.CharField(source="converted_delivery_note.number", read_only=True, default="")
    has_pdf = serializers.SerializerMethodField()

    class Meta:
        model = Quote
        fields = [
            "id", "client", "client_name", "branch", "number",
            "date", "valid_until", "status", "total_ht", "tva_rate", "tva_amount",
            "total_ttc", "apply_tva", "notes",
            "converted_invoice", "converted_invoice_number",
            "converted_delivery_note", "converted_delivery_note_number",
            "lines", "has_pdf", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "number", "total_ht", "tva_amount", "total_ttc", "created_at", "updated_at"]

    def get_has_pdf(self, obj):
        return bool(obj.pdf_file)


class QuoteListSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True, default="")
    converted_invoice_number = serializers.CharField(source="converted_invoice.number", read_only=True, default="")
    converted_delivery_note_number = serializers.CharField(source="converted_delivery_note.number", read_only=True, default="")

    class Meta:
        model = Quote
        fields = [
            "id", "number", "client", "client_name", "date", "valid_until",
            "status", "total_ttc", "converted_invoice", "converted_invoice_number",
            "converted_delivery_note", "converted_delivery_note_number", "created_at",
        ]


class CreateQuoteSerializer(serializers.Serializer):
    client_id = serializers.UUIDField(required=False, allow_null=True)
    branch_id = serializers.UUIDField(required=False, allow_null=True)
    date = serializers.DateField()
    valid_until = serializers.DateField(required=False, allow_null=True)
    apply_tva = serializers.BooleanField(default=True)
    tva_rate = serializers.DecimalField(max_digits=5, decimal_places=2, default=Decimal("19.00"))
    notes = serializers.CharField(required=False, allow_blank=True)
    lines = QuoteLineSerializer(many=True, min_length=1)

