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
    variant_label = serializers.SerializerMethodField()

    class Meta:
        model = POLine
        fields = [
            "id", "variant", "variant_label", "description", "quantity_ordered",
            "quantity_received", "agreed_unit_price", "line_total",
        ]

    def get_variant_label(self, obj) -> str | None:
        if not obj.variant_id:
            return None
        v = obj.variant
        if v.colour and v.colour != "N/A":
            return f"{v.product.name} · EU{v.size_eu} · {v.colour}"
        return f"{v.product.name} · EU{v.size_eu}"


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
    supplier_phone = serializers.CharField(source="supplier.phone", read_only=True)
    supplier_email = serializers.EmailField(source="supplier.email", read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "supplier", "supplier_name", "supplier_phone", "supplier_email",
            "status", "expected_date", "reference", "notes", "total_amount",
            "created_by", "lines", "created_at",
        ]
        read_only_fields = ["id", "created_at", "created_by"]


# ── Input serializers (create / receive) ───────────────────────────────────────

class NewVariantInputSerializer(serializers.Serializer):
    """
    Inline variant creation during PO receiving.

    Either supply product_id (link to an existing product) OR product_name + brand
    to find-or-create the product. product_id takes precedence when present.
    """
    product_id     = serializers.IntegerField(required=False, allow_null=True, default=None)
    product_name   = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    brand          = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    category       = serializers.ChoiceField(
        choices=["sneakers", "boots", "sandals", "formal", "sport", "kids", "slippers", "other"],
        default="other",
    )
    size_eu        = serializers.IntegerField(min_value=1, max_value=60)
    colour         = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
    purchase_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, default=Decimal("0"))
    sale_price     = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, default=Decimal("0"))


class CartonSizeInputSerializer(serializers.Serializer):
    """One entry per EU size in a carton-mode receive. quantity is the total pairs for this size."""
    size_eu   = serializers.IntegerField(min_value=15, max_value=60)
    quantity  = serializers.IntegerField(min_value=0)
    # Variant resolution — same logic as top-level receive
    variant_id  = serializers.IntegerField(required=False, allow_null=True, default=None)
    new_variant = NewVariantInputSerializer(required=False, allow_null=True, default=None)


class POLineInputSerializer(serializers.Serializer):
    variant = serializers.IntegerField(required=False, allow_null=True, default=None)
    description = serializers.CharField(max_length=300)
    quantity_ordered = serializers.IntegerField(min_value=1, required=False)
    cartons = serializers.IntegerField(min_value=0, required=False, default=0)
    agreed_unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    carton_sizes = CartonSizeInputSerializer(many=True, required=False, allow_null=True, default=None)

    def validate(self, data):
        if not data.get("carton_sizes") and not data.get("quantity_ordered"):
            raise serializers.ValidationError("quantity_ordered est requis si carton_sizes n'est pas fourni.")
        return data


class CreatePurchaseOrderSerializer(serializers.Serializer):
    supplier = serializers.IntegerField()
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    expected_date = serializers.DateField(required=False, allow_null=True, default=None)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    lines = POLineInputSerializer(many=True)
    
    # Direct Reception options
    receive_immediately = serializers.BooleanField(required=False, default=False)
    branch = serializers.IntegerField(required=False, allow_null=True, default=None)
    bl_reference = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")


class ReceiveLineInputSerializer(serializers.Serializer):
    id               = serializers.IntegerField()
    quantity_received = serializers.IntegerField(min_value=0)
    # Resolution for unlinked lines (mutually exclusive — send one or neither)
    variant_id   = serializers.IntegerField(required=False, allow_null=True, default=None)
    new_variant  = NewVariantInputSerializer(required=False, allow_null=True, default=None)
    # Carton mode: per-size expansion (overrides variant_id / new_variant when present)
    # quantity_received is ignored and recomputed as sum of carton_sizes quantities.
    carton_sizes = CartonSizeInputSerializer(many=True, required=False, allow_null=True, default=None)


class ReceiveLinesSerializer(serializers.Serializer):
    lines = ReceiveLineInputSerializer(many=True)
    # Supplier's delivery note reference (BL number) — stored on each StockMovement
    bl_reference = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    # Branch that received the stock — defaults to HQ if omitted
    branch = serializers.IntegerField(required=False, allow_null=True, default=None)


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
