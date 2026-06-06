"""Sales API views."""
import datetime

from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from .models import Sale
from .serializers import CreateReturnSerializer, CreateSaleSerializer, SaleSerializer


class SaleViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Sale.objects.prefetch_related("items__variant__product", "payments")
    serializer_class = SaleSerializer
    filterset_fields = ["branch", "cashier", "status", "client"]
    search_fields = ["receipt_number"]
    ordering_fields = ["created_at", "total_amount"]
    ordering = ["-created_at"]
    http_method_names = ["get", "post", "head", "options"]  # No PUT/PATCH/DELETE

    def get_serializer_class(self):
        if self.action == "create":
            return CreateSaleSerializer
        return SaleSerializer

    def create(self, request, *args, **kwargs):
        serializer = CreateSaleSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        sale = serializer.create_sale(
            serializer.validated_data,
            tenant=request.tenant,
            cashier=request.user,
        )
        resp_data = SaleSerializer(sale).data
        loyalty = getattr(sale, "_loyalty_summary", {})
        resp_data["points_earned"] = loyalty.get("points_earned", 0)
        resp_data["points_redeemed"] = loyalty.get("points_redeemed", 0)
        return Response(resp_data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def returns(self, request, pk=None):
        """Process a return for this sale."""
        sale = self.get_object()
        serializer = CreateReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return_obj = serializer.create_return(sale, processed_by=request.user)
        return Response(
            {"id": return_obj.pk, "message": "Return processed successfully."},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], url_path="daily-summary")
    def daily_summary(self, request):
        """
        Returns a cash summary for a given date.
        Query params: ?date=2026-05-26&branch_id=1
        """
        date_str = request.query_params.get("date")
        branch_id = request.query_params.get("branch_id")

        if date_str:
            try:
                target_date = datetime.date.fromisoformat(date_str)
            except ValueError:
                return Response(
                    {"error": {"code": "invalid_date", "message": "Date must be YYYY-MM-DD."}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            target_date = timezone.now().date()

        sales_qs = Sale.objects.filter(
            tenant=request.tenant,
            created_at__date=target_date,
            status="completed",
        )
        if branch_id:
            sales_qs = sales_qs.filter(branch_id=branch_id)

        from .models import Payment
        payments_qs = Payment.objects.filter(sale__in=sales_qs)

        by_method = payments_qs.values("method").annotate(total=Sum("amount"))
        method_breakdown = {item["method"]: item["total"] for item in by_method}

        from .models import Return
        returns_qs = Return.objects.filter(tenant=request.tenant, created_at__date=target_date)
        if branch_id:
            returns_qs = returns_qs.filter(original_sale__branch_id=branch_id)

        total_refunds = returns_qs.aggregate(total=Sum("refund_amount"))["total"] or 0

        total_revenue = sales_qs.aggregate(total=Sum("total_amount"))["total"] or 0
        sale_count = sales_qs.count()

        return Response(
            {
                "date": str(target_date),
                "branch_id": branch_id,
                "total_revenue": total_revenue,
                "sale_count": sale_count,
                "total_refunds": total_refunds,
                "net_revenue": total_revenue - total_refunds,
                "by_payment_method": method_breakdown,
            }
        )
