"""Mobile-specific API endpoints (cloud deployment only)."""
from decimal import Decimal

from django.db.models import F, Sum
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.core.throttling import MobileRateThrottle

from apps.core.mixins import TenantScopedViewSetMixin
from apps.mobile.models import DeviceToken
from apps.mobile.serializers import DeviceTokenSerializer


class DeviceTokenViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Register / unregister FCM and APNs push tokens."""

    serializer_class = DeviceTokenSerializer
    throttle_classes = [MobileRateThrottle]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return DeviceToken.objects.filter(
            tenant=self.request.tenant,
            user=self.request.user,
        )

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant, user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        # Allow deletion by token value (not just PK) for client convenience.
        token_val = kwargs.get("pk")
        qs = self.get_queryset()
        deleted, _ = qs.filter(token=token_val).delete()
        if not deleted:
            # Fall back to PK-based delete
            return super().destroy(request, *args, **kwargs)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _setup_tenant(request):
    """Replicate TenantScopedViewSetMixin.initial() for plain APIViews."""
    from apps.core.managers import set_current_tenant
    user = request.user
    if user.is_authenticated and not user.is_superuser:
        tenant = getattr(user, "tenant", None)
        request.tenant = tenant
        set_current_tenant(tenant)
    else:
        request.tenant = None
        set_current_tenant(None)


class BarcodeScanView(APIView):
    """
    GET /mobile/scan/?barcode=<code>

    Returns full product + variant + per-branch stock context in a single call,
    so the mobile app avoids multiple round-trips over a potentially slow connection.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [MobileRateThrottle]

    def get(self, request):
        _setup_tenant(request)
        barcode = request.query_params.get("barcode", "").strip()
        if not barcode:
            return Response(
                {"error": "barcode query parameter is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.inventory.models import Variant, StockMovement
        from apps.core.models import Branch

        # The stored barcode is 14 digits (13-digit base + EAN check digit).
        # Some phone cameras decode only 13 digits in EAN-13 mode; others read
        # all 14 via CODE-128. Try exact match first, then prefix match.
        base_qs = Variant.objects.filter(
            tenant=request.tenant, is_active=True
        ).select_related("product")

        variant = (
            base_qs.filter(barcode=barcode).first()
            or base_qs.filter(barcode__startswith=barcode).first()
            or base_qs.filter(barcode__startswith=barcode[:13]).first()
            if len(barcode) >= 13 else
            base_qs.filter(barcode=barcode).first()
        )

        if not variant:
            return Response(
                {"error": "not_found", "scanned": barcode},
                status=status.HTTP_404_NOT_FOUND,
            )

        product = variant.product

        # Per-branch stock: aggregate StockMovement quantities
        branches = Branch.objects.filter(tenant=request.tenant)
        stock_by_branch = []
        for branch in branches:
            qty = (
                StockMovement.objects.filter(variant=variant, branch=branch)
                .aggregate(total=Sum("quantity_delta"))["total"]
                or 0
            )
            stock_by_branch.append(
                {
                    "branch_id": branch.id,
                    "branch_name": branch.name,
                    "stock_qty": qty,
                }
            )

        can_see_costs = getattr(request.user, "can_see_costs", False)

        product_data = {
            "id": product.id,
            "name": product.name,
            "brand": product.brand,
            "category": product.category,
            "sale_price": str(product.sale_price),
        }
        if can_see_costs:
            product_data["purchase_price"] = str(product.purchase_price)

        return Response(
            {
                "variant": {
                    "id": variant.id,
                    "barcode": variant.barcode,
                    "size_eu": variant.size_eu,
                    "colour": variant.colour,
                    "stock_qty": variant.stock_qty,
                    "alert_threshold": variant.alert_threshold,
                    "is_low_stock": variant.is_low_stock,
                    "is_out_of_stock": variant.is_out_of_stock,
                },
                "product": product_data,
                "stock_by_branch": stock_by_branch,
            }
        )


class MobileDashboardView(APIView):
    """
    GET /mobile/dashboard/

    Lightweight KPI summary optimised for mobile — single query, no heavy joins.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [MobileRateThrottle]

    def get(self, request):
        _setup_tenant(request)
        from django.utils import timezone
        from apps.sales.models import Sale
        from apps.clients.models import Client, Cheque
        from apps.suppliers.models import PurchaseOrder

        tenant = request.tenant
        today = timezone.now().date()

        from apps.core.models import RoleChoices
        role = getattr(request.user, "role", None)
        can_see_sales = role in (RoleChoices.OWNER, RoleChoices.MANAGER)

        # Today's revenue — owners and managers only
        payload: dict = {"as_of": str(today)}
        if can_see_sales:
            today_revenue = (
                Sale.objects.filter(
                    tenant=tenant, created_at__date=today, status="completed"
                ).aggregate(total=Sum("total_amount"))["total"]
                or Decimal("0")
            )
            sale_count_today = Sale.objects.filter(
                tenant=tenant, created_at__date=today, status="completed"
            ).count()
            payload["today_revenue"] = today_revenue
            payload["sale_count_today"] = sale_count_today

        # Low stock Product count
        from apps.inventory.models import Product
        from django.db.models import Sum
        from django.db.models.functions import Coalesce

        low_stock_count = Product.objects.filter(
            tenant=tenant,
            is_active=True,
            alert_threshold__gt=0,
        ).annotate(
            computed_total_stock=Coalesce(Sum('variants__stock_qty'), 0)
        ).filter(
            computed_total_stock__lte=F("alert_threshold")
        ).count()

        # Cheques due within 3 days
        cutoff = today + timezone.timedelta(days=3)
        cheques_due_soon = Cheque.objects.filter(
            tenant=tenant,
            status="pending",
            due_date__gte=today,
            due_date__lte=cutoff,
        ).count()

        # Pending purchase orders
        pending_pos = PurchaseOrder.objects.filter(
            tenant=tenant, status__in=["draft", "sent"]
        ).count()

        payload.update({
            "low_stock_count": low_stock_count,
            "cheques_due_soon": cheques_due_soon,
            "pending_purchase_orders": pending_pos,
        })

        return Response(
            payload
        )
