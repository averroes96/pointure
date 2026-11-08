"""Inventory serializers."""
from decimal import Decimal

from rest_framework import serializers

from apps.core.models import Branch, RoleChoices
from .models import DefectItem, Product, StockMovement, StockTransfer, Variant, StocktakeSession, StocktakeItem


def _can_see_costs(request) -> bool:
    """Return True if the requesting user is allowed to view cost and purchase prices."""
    user = getattr(request, "user", None) if request else None
    if not user:
        from apps.core.signals import get_current_user
        user = get_current_user()
    if not user:
        return True
    if not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    return bool(getattr(user, "can_see_costs", False))


class VariantSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_brand = serializers.CharField(source="product.brand", read_only=True, default="")
    product_reference = serializers.CharField(source="product.reference", read_only=True, default="")
    product_sale_price = serializers.DecimalField(
        source="product.sale_price", max_digits=12, decimal_places=2, read_only=True
    )
    product_semi_wholesale_price = serializers.DecimalField(
        source="product.semi_wholesale_price", max_digits=12, decimal_places=2, read_only=True
    )
    product_wholesale_price = serializers.DecimalField(
        source="product.wholesale_price", max_digits=12, decimal_places=2, read_only=True
    )
    purchase_price = serializers.DecimalField(
        source="product.purchase_price", max_digits=12, decimal_places=2, read_only=True
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

    def validate_product(self, value):
        if self.instance and value != self.instance.product:
            raise serializers.ValidationError("Le produit d'une variante ne peut pas être modifié.")
        request = self.context.get("request")
        if request and getattr(request, "tenant", None) and value.tenant_id != request.tenant.id:
            raise serializers.ValidationError("Produit introuvable.")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not _can_see_costs(request):
            data.pop("purchase_price", None)
        return data

    class Meta:
        model = Variant
        fields = [
            "id", "product", "product_name", "product_brand", "product_reference", "product_sale_price",
            "product_semi_wholesale_price", "product_wholesale_price",
            "purchase_price", "size_eu", "colour", "barcode",
            "stock_qty", "alert_threshold", "is_active", "is_low_stock", "is_out_of_stock",
        ]
        read_only_fields = ["id", "stock_qty"]


class ProductSerializer(serializers.ModelSerializer):
    variants = VariantSerializer(many=True, read_only=True)
    total_stock = serializers.IntegerField(read_only=True)
    has_low_stock = serializers.BooleanField(read_only=True)
    is_total_low_stock = serializers.BooleanField(read_only=True)
    margin_pct = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    location = serializers.SerializerMethodField()
    barcode = serializers.SerializerMethodField()
    default_variant_id = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "brand", "reference", "category", "gender", "season",
            "purchase_price", "sale_price", "semi_wholesale_price", "wholesale_price",
            "margin_pct", "image", "description",
            "is_active", "is_demo", "alert_threshold", "pairs_per_carton", "carton_breakdown", "total_stock",
            "has_low_stock", "is_total_low_stock", "variants", "created_at",
            "location", "barcode", "default_variant_id",
        ]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        data = super().validate(attrs)
        carton_breakdown = data.get("carton_breakdown")
        pairs_per_carton = data.get("pairs_per_carton")
        if carton_breakdown:
            if pairs_per_carton is None and self.instance:
                pairs_per_carton = self.instance.pairs_per_carton
            if pairs_per_carton is not None:
                total_breakdown = sum(int(qty) for qty in carton_breakdown.values() if qty)
                if total_breakdown > 0 and total_breakdown != int(pairs_per_carton):
                    raise serializers.ValidationError({
                        "carton_breakdown": f"La somme des paires par pointure ({total_breakdown}) doit être égale à pairs_per_carton ({pairs_per_carton})."
                    })
        return data

    def get_barcode(self, obj):
        v = obj.variants.first()
        return v.barcode if v else ""

    def get_default_variant_id(self, obj):
        v = obj.variants.first()
        return v.id if v else None

    def get_location(self, obj):
        request = self.context.get("request")
        if not request:
            return ""
        
        query_params = getattr(request, "query_params", getattr(request, "GET", {}))
        branch_id = query_params.get("branch_id")
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
        if not _can_see_costs(request):
            data.pop("purchase_price", None)
            data.pop("pamp", None)
            data.pop("margin_pct", None)
        return data


class ProductListSerializer(serializers.ModelSerializer):
    """
    List serializer — includes variants so the POS search can show size/colour
    grid immediately without a second fetch. The queryset already prefetches
    variants and branch_locations so all properties are computed in-memory
    with zero extra DB queries.
    """
    total_stock = serializers.SerializerMethodField()
    has_low_stock = serializers.SerializerMethodField()
    is_total_low_stock = serializers.SerializerMethodField()
    variants = VariantSerializer(many=True, read_only=True)
    location = serializers.SerializerMethodField()
    barcode = serializers.SerializerMethodField()
    default_variant_id = serializers.SerializerMethodField()

    def get_barcode(self, obj):
        variants = obj.variants.all()
        return variants[0].barcode if variants else ""

    def get_default_variant_id(self, obj):
        variants = obj.variants.all()
        return variants[0].id if variants else None

    def get_location(self, obj):
        request = self.context.get("request")
        if not request:
            return ""

        query_params = getattr(request, "query_params", getattr(request, "GET", {}))
        target_branch_id = query_params.get("branch_id")
        if not target_branch_id and getattr(request, "branch", None):
            target_branch_id = str(request.branch.id)

        if not target_branch_id:
            return ""

        # Check prefetched locations in-memory with ZERO database queries
        locs = getattr(obj, "prefetched_locations", None)
        if locs is None:
            locs = obj.branch_locations.all()
        for loc in locs:
            if str(loc.branch_id) == str(target_branch_id):
                return loc.location
        return ""

    def get_total_stock(self, obj):
        # Sum from the prefetch cache. When branch_id was passed the variants
        # carry a branch_stock_qty annotation; fall back to global stock_qty otherwise.
        return sum(
            getattr(v, "branch_stock_qty", None) if getattr(v, "branch_stock_qty", None) is not None
            else v.stock_qty
            for v in obj.variants.all()
        )

    def get_has_low_stock(self, obj):
        # Computed in-memory from prefetched variants cache with zero extra queries
        for v in obj.variants.all():
            stock = getattr(v, "branch_stock_qty", None)
            if stock is None:
                stock = v.stock_qty
            if v.alert_threshold > 0 and stock <= v.alert_threshold:
                return True
        return False

    def get_is_total_low_stock(self, obj):
        # Computed in-memory from prefetched variants cache with zero extra queries
        if not obj.alert_threshold or obj.alert_threshold <= 0:
            return False
        total = self.get_total_stock(obj)
        return total <= obj.alert_threshold

    class Meta:
        model = Product
        fields = [
            "id", "name", "brand", "reference", "category", "gender",
            "sale_price", "semi_wholesale_price", "wholesale_price", "purchase_price", "pamp", "total_stock",
            "has_low_stock", "is_total_low_stock", "alert_threshold", "pairs_per_carton", "carton_breakdown",
            "image", "is_active", "is_demo", "variants", "location", "barcode", "default_variant_id",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not _can_see_costs(request):
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
    barcode = serializers.CharField(max_length=64, required=False, allow_blank=True, write_only=True)
    initial_stock = serializers.IntegerField(required=False, default=0, min_value=0, write_only=True)

    class Meta:
        model = Product
        fields = [
            "id", "name", "brand", "reference", "category", "gender", "season",
            "purchase_price", "sale_price", "semi_wholesale_price", "wholesale_price",
            "pairs_per_carton", "carton_breakdown", "image", "description", "is_active",
            "alert_threshold", "variants", "location", "barcode", "initial_stock",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        data = super().validate(attrs)
        carton_breakdown = data.get("carton_breakdown")
        pairs_per_carton = data.get("pairs_per_carton")
        if carton_breakdown:
            if pairs_per_carton is None and self.instance:
                pairs_per_carton = self.instance.pairs_per_carton
            if pairs_per_carton is not None:
                total_breakdown = sum(int(qty) for qty in carton_breakdown.values() if qty)
                if total_breakdown > 0 and total_breakdown != int(pairs_per_carton):
                    raise serializers.ValidationError({
                        "carton_breakdown": f"La somme des paires par pointure ({total_breakdown}) doit être égale à pairs_per_carton ({pairs_per_carton})."
                    })
        return data


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


# ── DefectItem Serializers ───────────────────────────────────────────────────

class DefectItemSerializer(serializers.ModelSerializer):
    variant_str = serializers.CharField(source="variant.__str__", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    product_reference = serializers.CharField(source="variant.product.reference", read_only=True, default="")
    product_image = serializers.SerializerMethodField()
    size_eu = serializers.IntegerField(source="variant.size_eu", read_only=True)
    colour = serializers.CharField(source="variant.colour", read_only=True, default="")
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default="")
    claim_number = serializers.CharField(source="return_claim.claim_number", read_only=True, default="")
    sale_receipt_number = serializers.SerializerMethodField()
    logged_by_email = serializers.CharField(source="logged_by.email", read_only=True, default="")
    resolved_by_email = serializers.CharField(source="resolved_by.email", read_only=True, default="")
    defect_reason_display = serializers.CharField(source="get_defect_reason_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = DefectItem
        fields = [
            "id",
            "variant", "variant_str", "product_name", "product_reference", "product_image",
            "size_eu", "colour", "branch", "branch_name",
            "supplier", "supplier_name", "purchase_order", "sale_return", "sale_exchange", "sale_receipt_number",
            "return_claim", "claim_number",
            "quantity", "cost_price", "defect_reason", "defect_reason_display",
            "photo", "status", "status_display", "notes",
            "logged_by", "logged_by_email", "resolved_by", "resolved_by_email", "resolved_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "created_at", "updated_at", "logged_by", "resolved_by", "resolved_at", "return_claim",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not _can_see_costs(request):
            data.pop("cost_price", None)
        return data

    def get_sale_receipt_number(self, obj) -> str:
        if obj.sale_return and obj.sale_return.original_sale:
            return obj.sale_return.original_sale.receipt_number or f"#{obj.sale_return.original_sale.id}"
        if obj.sale_exchange and obj.sale_exchange.original_sale:
            return obj.sale_exchange.original_sale.receipt_number or f"#{obj.sale_exchange.original_sale.id}"
        return ""

    def get_product_image(self, obj) -> str:
        if obj.variant and obj.variant.product and obj.variant.product.image:
            return obj.variant.product.image.url
        return ""


# ─────────────────────────────────────────────
# Stocktake Serializers
# ─────────────────────────────────────────────

class StocktakeItemSerializer(serializers.ModelSerializer):
    variant_str = serializers.CharField(source="variant.__str__", read_only=True)
    product_id = serializers.IntegerField(source="variant.product.id", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    product_brand = serializers.CharField(source="variant.product.brand", read_only=True, default="")
    product_reference = serializers.CharField(source="variant.product.reference", read_only=True, default="")
    product_image = serializers.SerializerMethodField()
    size_eu = serializers.IntegerField(source="variant.size_eu", read_only=True)
    colour = serializers.CharField(source="variant.colour", read_only=True, default="")
    barcode = serializers.CharField(source="variant.barcode", read_only=True, default="")
    variance_qty = serializers.IntegerField(read_only=True)
    variance_cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = StocktakeItem
        fields = [
            "id", "session", "variant", "variant_str",
            "product_id", "product_name", "product_brand", "product_reference", "product_image",
            "size_eu", "colour", "barcode",
            "expected_qty", "counted_qty", "variance_qty",
            "unit_cost", "unit_price", "variance_cost",
            "last_scanned_at", "notes",
        ]
        read_only_fields = ["id", "session", "variant", "expected_qty", "unit_cost", "unit_price"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not _can_see_costs(request):
            data.pop("unit_cost", None)
            data.pop("variance_cost", None)
        return data

    def get_product_image(self, obj) -> str:
        if obj.variant and obj.variant.product and obj.variant.product.image:
            try:
                return obj.variant.product.image.url
            except Exception:
                return ""
        return ""


class StocktakeSessionListSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, default="Toutes succursales")
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default="")
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    item_count = serializers.IntegerField(source="items.count", read_only=True)

    class Meta:
        model = StocktakeSession
        fields = [
            "id", "title", "branch", "branch_name", "status", "status_display",
            "scope_brand", "scope_category", "notes",
            "total_expected", "total_counted", "total_variance", "total_variance_cost",
            "item_count", "created_by", "created_by_name", "completed_by", "completed_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "status_display",
            "branch",
            "branch_name",
            "total_expected",
            "total_counted",
            "total_variance",
            "total_variance_cost",
            "item_count",
            "created_by",
            "created_by_name",
            "completed_by",
            "completed_at",
            "created_at",
            "updated_at",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not _can_see_costs(request):
            data.pop("total_variance_cost", None)
        return data


class StocktakeSessionDetailSerializer(StocktakeSessionListSerializer):
    items = StocktakeItemSerializer(many=True, read_only=True)

    class Meta(StocktakeSessionListSerializer.Meta):
        fields = StocktakeSessionListSerializer.Meta.fields + ["items"]


class CreateStocktakeSessionSerializer(serializers.ModelSerializer):
    auto_populate = serializers.BooleanField(default=True, write_only=True, help_text="Pré-charger le stock théorique de tous les articles")
    scope_location = serializers.CharField(required=False, allow_blank=True, write_only=True, help_text="Rayon / Emplacement ciblé")
    scope_reference = serializers.CharField(required=False, allow_blank=True, write_only=True, help_text="Préfixe de référence ou nom ciblé")
    only_in_stock = serializers.BooleanField(default=False, write_only=True, help_text="Inclure uniquement les articles ayant un stock théorique > 0")

    class Meta:
        model = StocktakeSession
        fields = [
            "id", "title", "branch", "scope_brand", "scope_category", "notes",
            "status", "total_expected", "total_counted", "total_variance",
            "auto_populate", "scope_location", "scope_reference", "only_in_stock",
        ]
        read_only_fields = ["id", "status", "total_expected", "total_counted", "total_variance"]



