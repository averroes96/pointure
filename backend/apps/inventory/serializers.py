"""Inventory serializers."""
from decimal import Decimal

from rest_framework import serializers

from apps.core.models import Branch, RoleChoices
from .models import Product, StockMovement, StockTransfer, Variant


class VariantSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sale_price = serializers.DecimalField(
        source="product.sale_price", max_digits=12, decimal_places=2, read_only=True
    )
    stock_qty = serializers.SerializerMethodField()
    is_low_stock = serializers.SerializerMethodField()
    is_out_of_stock = serializers.SerializerMethodField()

    def _effective_stock(self, obj):
        """Return branch_stock_qty annotation when present, else the global cached field."""
        bsq = getattr(obj, "branch_stock_qty", None)
        return bsq if bsq is not None else obj.stock_qty

    def get_stock_qty(self, obj):
        return self._effective_stock(obj)

    def get_is_low_stock(self, obj):
        stock = self._effective_stock(obj)
        return obj.alert_threshold > 0 and stock <= obj.alert_threshold

    def get_is_out_of_stock(self, obj):
        return self._effective_stock(obj) <= 0

    class Meta:
        model = Variant
        fields = [
            "id", "product", "product_name", "product_sale_price",
            "size_eu", "colour", "barcode",
            "stock_qty", "alert_threshold", "is_active", "is_low_stock", "is_out_of_stock",
        ]
        read_only_fields = ["id", "barcode"]


class ProductSerializer(serializers.ModelSerializer):
    variants = VariantSerializer(many=True, read_only=True)
    total_stock = serializers.IntegerField(read_only=True)
    has_low_stock = serializers.BooleanField(read_only=True)
    is_total_low_stock = serializers.BooleanField(read_only=True)
    margin_pct = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    location = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "brand", "reference", "category", "gender", "season",
            "purchase_price", "sale_price", "margin_pct", "image", "description",
            "is_active", "alert_threshold", "pairs_per_carton", "total_stock", "has_low_stock", "is_total_low_stock", "variants", "created_at",
            "location",
        ]
        read_only_fields = ["id", "created_at"]

    def get_location(self, obj):
        request = self.context.get("request")
        if not request:
            return ""
        
        branch_id = request.query_params.get("branch_id")
        if not branch_id and hasattr(request, "data"):
            branch_id = request.data.get("branch_id")
            
        if not branch_id or branch_id == "null":
            return ""
        
        loc = obj.branch_locations.filter(branch_id=branch_id).first()
        return loc.location if loc else ""

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        # Hide purchase price and margin from cashiers
        if request and not request.user.can_see_costs:
            data.pop("purchase_price", None)
            data.pop("pamp", None)
            data.pop("margin_pct", None)
        return data


class ProductListSerializer(serializers.ModelSerializer):
    """
    List serializer — includes variants so the POS search can show size/colour
    grid immediately without a second fetch. The queryset already prefetches
    variants so this adds zero extra DB queries.
    """
    total_stock = serializers.SerializerMethodField()
    has_low_stock = serializers.BooleanField(read_only=True)
    is_total_low_stock = serializers.BooleanField(read_only=True)
    variants = VariantSerializer(many=True, read_only=True)
    location = serializers.SerializerMethodField()

    def get_location(self, obj):
        request = self.context.get("request")
        if not request or not getattr(request, "branch", None):
            return ""
        
        # Check prefetched locations if available
        if hasattr(obj, "prefetched_locations"):
            locs = [l for l in obj.prefetched_locations if l.branch_id == request.branch.id]
            return locs[0].location if locs else ""
        
        loc = obj.branch_locations.filter(branch=request.branch).first()
        return loc.location if loc else ""

    def get_total_stock(self, obj):
        # Sum from the prefetch cache. When branch_id was passed the variants
        # carry a branch_stock_qty annotation; fall back to global stock_qty otherwise.
        return sum(
            getattr(v, "branch_stock_qty", None) if getattr(v, "branch_stock_qty", None) is not None
            else v.stock_qty
            for v in obj.variants.all()
        )

    class Meta:
        model = Product
        fields = [
            "id", "name", "brand", "reference", "category", "gender",
            "sale_price", "wholesale_price", "purchase_price", "pamp", "total_stock", "has_low_stock", "is_total_low_stock",
            "alert_threshold", "image", "is_active", "wholesale_price", "variants", "location",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not request.user.can_see_costs:
            data.pop("purchase_price", None)
            data.pop("pamp", None)
        return data


class GenerateVariantsSerializer(serializers.Serializer):
    """Input for the bulk variant generation endpoint."""
    sizes = serializers.ListField(
        child=serializers.IntegerField(min_value=28, max_value=47),
        min_length=1, max_length=20,
    )
    colours = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False, allow_empty=True, max_length=20,
    )
    alert_threshold = serializers.IntegerField(default=3, min_value=0)


class ProductCreateSerializer(serializers.ModelSerializer):
    """
    Handles product creation with optional inline variant generation.
    When `variants` is provided, the cartesian product of sizes × colours
    is created atomically alongside the product.
    """
    variants = GenerateVariantsSerializer(required=False, write_only=True)
    location = serializers.CharField(max_length=255, required=False, allow_blank=True, write_only=True)

    class Meta:
        model = Product
        fields = [
            "id", "name", "brand", "reference", "category", "gender", "season",
            "purchase_price", "sale_price", "image", "description", "is_active", "alert_threshold", "variants", "location",
        ]
        read_only_fields = ["id"]


class StockMovementSerializer(serializers.ModelSerializer):
    variant_str = serializers.CharField(source="variant.__str__", read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    reference_id = serializers.SerializerMethodField()

    class Meta:
        model = StockMovement
        fields = [
            "id", "variant", "variant_str", "branch", "branch_name",
            "quantity_delta", "reason", "reference_id", "reference_type",
            "bl_reference", "notes", "user_email", "timestamp",
        ]
        read_only_fields = ["id", "timestamp", "user_email"]

    def get_reference_id(self, obj) -> str:
        if obj.bl_reference:
            return obj.bl_reference
        ref = obj.reference_id or ""
        if len(ref) == 36 and "-" in ref:
            return f"#{ref[:8]}"
        return ref


class StockAdjustmentSerializer(serializers.Serializer):
    """Input for manual stock adjustment."""
    variant = serializers.PrimaryKeyRelatedField(queryset=Variant.objects.all())
    branch = serializers.PrimaryKeyRelatedField(
        queryset=Branch.objects.all(),
        required=False,
        allow_null=True,
    )
    quantity_delta = serializers.IntegerField()
    reason = serializers.ChoiceField(
        choices=["adjustment", "damaged", "return", "initial", "reception"]
    )
    notes = serializers.CharField(required=False, allow_blank=True)


class _BulkAdjustmentItemSerializer(serializers.Serializer):
    """One entry in a bulk stock adjustment."""
    variant = serializers.PrimaryKeyRelatedField(queryset=Variant.objects.all())
    quantity_delta = serializers.IntegerField()


class BulkStockAdjustmentSerializer(serializers.Serializer):
    """Input for bulk stock adjustment — multiple variants in one request."""
    adjustments = _BulkAdjustmentItemSerializer(many=True, min_length=1, max_length=200)
    branch = serializers.PrimaryKeyRelatedField(
        queryset=Branch.objects.all(),
        required=False,
        allow_null=True,
    )
    reason = serializers.ChoiceField(
        choices=["adjustment", "damaged", "return", "initial", "reception"]
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class StockTransferSerializer(serializers.ModelSerializer):
    # Denormalized read-only fields so the frontend never needs a second fetch
    from_branch_name = serializers.CharField(source="from_branch.name", read_only=True)
    to_branch_name = serializers.CharField(source="to_branch.name", read_only=True)
    variant_str = serializers.CharField(source="variant.__str__", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    created_by_email = serializers.CharField(source="created_by.email", read_only=True, default="")

    class Meta:
        model = StockTransfer
        fields = [
            "id",
            "from_branch", "from_branch_name",
            "to_branch", "to_branch_name",
            "variant", "variant_str", "product_name",
            "quantity", "status", "notes",
            "created_by", "created_by_email",
            "received_by",
            "created_at", "received_at",
        ]
        read_only_fields = [
            "id", "created_at", "received_at",
            "created_by", "received_by", "status",
        ]
