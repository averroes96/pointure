from decimal import Decimal
from rest_framework import serializers
from .models import POLine, PurchaseOrder, Supplier, SupplierInvoice, SupplierPayment


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            "id", "name", "contact_name", "phone", "email", "address",
            "origin_country", "payment_terms", "outstanding_balance",
            "notes", "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


# ── POLine ─────────────────────────────────────────────────────────────────────

class POLineSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = POLine
        fields = [
            "id", "variant", "description", "quantity_ordered",
            "quantity_received", "agreed_unit_price", "line_total",
        ]


# ── Purchase Order (list / detail) ─────────────────────────────────────────────

class PurchaseOrderListSerializer(serializers.ModelSerializer):
    """Lightweight — used for list endpoints (no nested lines)."""
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "supplier", "supplier_name", "status", "reference",
            "expected_date", "total_amount", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    """Full detail — includes nested lines."""
    lines = POLineSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "supplier", "supplier_name", "status", "expected_date",
            "reference", "notes", "total_amount", "created_by", "lines", "created_at",
        ]
        read_only_fields = ["id", "created_at", "created_by"]


# ── Input serializers (create / receive) ───────────────────────────────────────

class POLineInputSerializer(serializers.Serializer):
    variant = serializers.IntegerField(required=False, allow_null=True, default=None)
    description = serializers.CharField(max_length=300)
    quantity_ordered = serializers.IntegerField(min_value=1)
    agreed_unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class CreatePurchaseOrderSerializer(serializers.Serializer):
    supplier = serializers.IntegerField()
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    expected_date = serializers.DateField(required=False, allow_null=True, default=None)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    lines = POLineInputSerializer(many=True)


class ReceiveLineInputSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    quantity_received = serializers.IntegerField(min_value=0)


class ReceiveLinesSerializer(serializers.Serializer):
    lines = ReceiveLineInputSerializer(many=True)


# ── Supplier Invoice / Payment ─────────────────────────────────────────────────

class SupplierInvoiceSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = SupplierInvoice
        fields = [
            "id", "supplier", "supplier_name", "purchase_order",
            "invoice_number", "date", "due_date", "total_amount", "notes", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class SupplierPaymentSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = SupplierPayment
        fields = [
            "id", "supplier", "supplier_name", "supplier_invoice",
            "amount", "method", "cheque_number", "bank",
            "due_date", "date", "notes", "recorded_by", "created_at",
        ]
        read_only_fields = ["id", "created_at", "recorded_by"]
