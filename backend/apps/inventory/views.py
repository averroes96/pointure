"""Inventory API views."""
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.models import RoleChoices
from apps.inventory.models import (
    MovementReasonChoices,
    Product,
    StockMovement,
    StockTransfer,
    Variant,
)
from apps.inventory.serializers import (
    GenerateVariantsSerializer,
    ProductListSerializer,
    ProductSerializer,
    StockAdjustmentSerializer,
    StockMovementSerializer,
    StockTransferSerializer,
    VariantSerializer,
)


class ProductViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Product.objects.prefetch_related("variants")
    filterset_fields = ["category", "gender", "season", "is_active", "brand"]
    search_fields = ["name", "brand", "reference"]
    ordering_fields = ["name", "sale_price", "purchase_price", "created_at"]
    ordering = ["name"]

    def get_serializer_class(self):
        if self.action == "list":
            return ProductListSerializer
        return ProductSerializer

    @action(detail=True, methods=["post"], url_path="generate-variants")
    def generate_variants(self, request, pk=None):
        """Bulk create variants for this product."""
        product = self.get_object()
        self.require_manager()

        serializer = GenerateVariantsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        sizes = serializer.validated_data["sizes"]
        colours = serializer.validated_data["colours"]
        threshold = serializer.validated_data["alert_threshold"]

        created = 0
        errors = []

        with transaction.atomic():
            for size in sizes:
                for colour in colours:
                    try:
                        _, was_created = Variant.objects.get_or_create(
                            tenant=request.tenant,
                            product=product,
                            size_eu=size,
                            colour=colour,
                            defaults={"alert_threshold": threshold},
                        )
                        if was_created:
                            created += 1
                    except Exception as e:
                        errors.append({"size": size, "colour": colour, "error": str(e)})

        return Response(
            {"created": created, "skipped": len(sizes) * len(colours) - created, "errors": errors},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="stock-by-branch")
    def stock_by_branch(self, request, pk=None):
        """Return per-branch stock breakdown for all variants of this product."""
        product = self.get_object()
        from apps.core.models import Branch
        from django.db.models import Sum

        branches = Branch.objects.filter(tenant=request.tenant)
        result = []
        for branch in branches:
            variants_data = []
            for variant in product.variants.filter(is_active=True):
                branch_stock = StockMovement.objects.filter(
                    variant=variant, branch=branch
                ).aggregate(total=Sum("quantity_delta"))["total"] or 0
                variants_data.append({
                    "variant_id": variant.pk,
                    "size_eu": variant.size_eu,
                    "colour": variant.colour,
                    "stock": branch_stock,
                })
            result.append({"branch_id": branch.pk, "branch_name": branch.name, "variants": variants_data})

        return Response(result)


class VariantViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Variant.objects.select_related("product")
    serializer_class = VariantSerializer
    filterset_fields = ["product", "size_eu", "colour", "is_active"]
    search_fields = ["barcode", "colour", "product__name", "product__brand"]

    def get_queryset(self):
        qs = super().get_queryset()
        # Allow lookup by barcode for POS
        barcode = self.request.query_params.get("barcode")
        if barcode:
            return qs.filter(barcode=barcode)
        return qs


class StockMovementViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only view of all stock movements. Adjustments go via /adjust endpoint."""
    queryset = StockMovement.objects.select_related("variant__product", "branch", "user")
    serializer_class = StockMovementSerializer
    filterset_fields = ["variant", "branch", "reason"]
    ordering_fields = ["timestamp"]
    ordering = ["-timestamp"]

    @action(detail=False, methods=["post"], url_path="adjust")
    def adjust(self, request):
        """Manual stock adjustment (manager+ only)."""
        self.require_manager()

        serializer = StockAdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        variant = data["variant"]

        # Ensure variant belongs to this tenant
        if variant.tenant != request.tenant:
            return Response(
                {"error": {"code": "permission_denied", "message": "Variant not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        movement = StockMovement.objects.create(
            tenant=request.tenant,
            variant=variant,
            branch=data.get("branch"),
            quantity_delta=data["quantity_delta"],
            reason=data["reason"],
            notes=data.get("notes", ""),
            user=request.user,
        )

        return Response(StockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)


class StockTransferViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = StockTransfer.objects.select_related(
        "from_branch", "to_branch", "variant__product", "created_by", "received_by"
    )
    serializer_class = StockTransferSerializer
    filterset_fields = ["status", "from_branch", "to_branch"]
    search_fields = ["variant__product__name", "from_branch__name", "to_branch__name"]

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant, created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_transfer(self, request, pk=None):
        """Mark a pending transfer as in_transit (goods have left the source branch)."""
        self.require_manager()
        transfer = self.get_object()
        if transfer.status != "pending":
            return Response(
                {"detail": "Seul un transfert en attente peut être expédié."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transfer.status = "in_transit"
        transfer.save(update_fields=["status"])
        return Response(StockTransferSerializer(transfer).data)

    @action(detail=True, methods=["post"], url_path="receive")
    def receive(self, request, pk=None):
        """Confirm receipt: create stock movements and mark transfer as received."""
        self.require_manager()
        transfer = self.get_object()
        if transfer.status not in ("pending", "in_transit"):
            return Response(
                {"detail": "Seul un transfert en attente ou en transit peut être réceptionné."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transfer.mark_received(request.user)
        return Response(StockTransferSerializer(transfer).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        """Cancel a transfer that hasn't been received yet."""
        self.require_manager()
        transfer = self.get_object()
        if transfer.status in ("received", "cancelled"):
            return Response(
                {"detail": "Ce transfert ne peut plus être annulé."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transfer.status = "cancelled"
        transfer.save(update_fields=["status"])
        return Response(StockTransferSerializer(transfer).data)


class LowStockViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Variants currently below alert threshold."""
    serializer_class = VariantSerializer

    def get_queryset(self):
        from django.db.models import F
        return Variant.objects.filter(
            tenant=self.request.tenant,
            is_active=True,
            alert_threshold__gt=0,
            stock_qty__lte=F("alert_threshold"),
        ).select_related("product")
