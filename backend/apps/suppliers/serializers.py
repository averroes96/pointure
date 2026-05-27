from rest_framework import serializers
from .models import POLine, PurchaseOrder, Supplier, SupplierInvoice, SupplierPayment


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "contact_name", "phone", "email", "address",
                  "origin_country", "payment_terms", "outstanding_balance",
                  "notes", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]


class POLineSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = POLine
        fields = ["id", "variant", "description", "quantity_ordered",
                  "quantity_received", "agreed_unit_price", "line_total"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    lines = POLineSerializer(many=True, read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = ["id", "supplier", "status", "expected_date", "reference",
                  "notes", "total_amount", "created_by", "lines", "created_at"]
        read_only_fields = ["id", "created_at", "created_by"]


class SupplierInvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierInvoice
        fields = ["id", "supplier", "purchase_order", "invoice_number",
                  "date", "due_date", "total_amount", "notes", "created_at"]
        read_only_fields = ["id", "created_at"]


class SupplierPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierPayment
        fields = ["id", "supplier", "supplier_invoice", "amount", "method",
                  "cheque_number", "bank", "due_date", "date", "notes",
                  "recorded_by", "created_at"]
        read_only_fields = ["id", "created_at", "recorded_by"]
