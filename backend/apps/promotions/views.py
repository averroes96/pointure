"""Promotions API views."""
from decimal import Decimal

from django.db import models as django_models
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from .models import Promotion
from .serializers import PromotionSerializer


class PromotionViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """CRUD for promotions + applicable-promotion lookup used by the POS."""

    queryset = Promotion.objects.select_related("product")
    serializer_class = PromotionSerializer
    filterset_fields = ["is_active", "category", "product"]
    ordering_fields = ["priority", "start_date", "created_at"]
    ordering = ["-priority", "start_date"]

    def get_queryset(self):
        if self.request.user.is_superuser:
            return Promotion.objects.select_related("product").all()
        return Promotion.objects.select_related("product").filter(tenant=self.request.tenant)

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)

    @action(detail=False, methods=["get"])
    def applicable(self, request):
        """
        GET /promotions/applicable/?variant=<id>&qty=<n>

        Returns the best matching active promotion for the given variant and
        quantity, or HTTP 204 if nothing applies.

        Response on match:
            { id, name, discount_pct, discount_amount, computed_discount }

        The POS uses `computed_discount` to auto-fill the line discount, and
        `name` to show a badge to the cashier.
        """
        variant_id = request.query_params.get("variant")
        try:
            qty = max(1, int(request.query_params.get("qty", 1)))
        except (TypeError, ValueError):
            qty = 1

        if not variant_id:
            return Response(
                {"error": "variant query parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.inventory.models import Variant
        variant = (
            Variant.objects
            .filter(tenant=request.tenant, id=variant_id, is_active=True)
            .select_related("product")
            .first()
        )
        if not variant:
            return Response(status=status.HTTP_404_NOT_FOUND)

        today = timezone.now().date()
        unit_price = variant.product.sale_price
        line_amount = unit_price * qty

        candidates = (
            Promotion.objects.filter(
                tenant=request.tenant,
                is_active=True,
                start_date__lte=today,
            )
            .filter(
                django_models.Q(end_date__isnull=True) | django_models.Q(end_date__gte=today)
            )
            .filter(
                django_models.Q(max_uses__isnull=True)
                | django_models.Q(uses_count__lt=django_models.F("max_uses"))
            )
            .select_related("product")
            .order_by("-priority", "id")
        )

        for promo in candidates:
            if promo.matches(variant, qty, Decimal(str(line_amount))):
                computed = promo.compute_discount(Decimal(str(unit_price)), qty)
                return Response({
                    "id": promo.id,
                    "name": promo.name,
                    "discount_pct": str(promo.discount_pct) if promo.discount_pct else None,
                    "discount_amount": str(promo.discount_amount) if promo.discount_amount else None,
                    "computed_discount": str(computed),
                })

        # No promotion matches
        return Response(status=status.HTTP_204_NO_CONTENT)
