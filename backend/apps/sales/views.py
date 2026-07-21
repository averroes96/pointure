"""Sales API views."""
import datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from .models import CashReconciliation, Payment, Return, Sale
from .serializers import (
    AddPaymentSerializer, CashReconciliationSerializer, CreateExchangeSerializer,
    CreateReconciliationSerializer, CreateReturnSerializer, CreateSaleSerializer, SaleSerializer,
)


class SaleViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Sale.objects.prefetch_related(
        "items__variant__product",
        "payments",
        "client__loyalty_accounts",
        "exchanges",
    )
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

    @action(detail=True, methods=["post"], url_path="add-payment")
    def add_payment(self, request, pk=None):
        """Add a payment to a partially_paid sale."""
        sale = self.get_object()
        if sale.status != "partially_paid":
            return Response(
                {"detail": "Seules les ventes en cours de versement acceptent des paiements supplementaires."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = AddPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from django.db.models import Sum as DjSum

        with transaction.atomic():
            Payment.objects.create(
                sale=sale,
                amount=data["amount"],
                method=data["method"],
                notes=data.get("notes", ""),
            )
            total_paid = sale.payments.aggregate(t=DjSum("amount"))["t"] or Decimal("0.00")
            if total_paid >= sale.total_amount:
                sale.status = "completed"
                sale.save(update_fields=["status"])
                loyalty_summary = CreateSaleSerializer._process_loyalty(
                    sale=sale,
                    tenant=sale.tenant,
                    client=sale.client,
                    receipt_number=sale.receipt_number,
                    redeem_points=0,
                    loyalty_program=None,
                    loyalty_account=None,
                )
            else:
                loyalty_summary = {"points_earned": 0, "points_redeemed": 0}

        resp_data = SaleSerializer(sale).data
        resp_data["points_earned"] = loyalty_summary.get("points_earned", 0)
        return Response(resp_data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a partially_paid sale (manager/owner only)."""
        if request.user.role not in ("owner", "manager"):
            return Response(
                {"detail": "Seuls les managers peuvent annuler un versement."},
                status=status.HTTP_403_FORBIDDEN,
            )
        sale = self.get_object()
        if sale.status != "partially_paid":
            return Response(
                {"detail": "Seules les ventes en cours de versement peuvent etre annulees ici."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sale.status = "cancelled"
        sale.save(update_fields=["status"])
        return Response(SaleSerializer(sale).data)

    @action(detail=True, methods=["post"])
    def returns(self, request, pk=None):
        """Process a return for this sale."""
        sale = self.get_object()
        if sale.status == "refunded":
            return Response(
                {"detail": "Cette vente a déjà été entièrement remboursée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if sale.status != "completed":
            return Response(
                {"detail": "Seules les ventes complétées peuvent être retournées."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CreateReturnSerializer(data=request.data, context={"sale": sale})
        serializer.is_valid(raise_exception=True)
        return_obj = serializer.create_return(sale, processed_by=request.user)
        return Response(
            {"id": return_obj.pk, "message": "Return processed successfully."},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def exchange(self, request, pk=None):
        """Process a return-as-exchange for this sale."""
        sale = self.get_object()
        if sale.status == "refunded":
            return Response(
                {"detail": "Cette vente a déjà été entièrement remboursée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if sale.status != "completed":
            return Response(
                {"detail": "Seules les ventes complétées peuvent faire l'objet d'un échange."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CreateExchangeSerializer(
            data=request.data, context={"sale": sale, "request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.create_exchange(sale, processed_by=request.user)
        sale.refresh_from_db()
        return Response(SaleSerializer(sale).data, status=status.HTTP_200_OK)

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

        # Versement metrics
        versement_payments_qs = Payment.objects.filter(
            sale__tenant=request.tenant,
            sale__created_at__date=target_date,
            sale__status="partially_paid",
        )
        if branch_id:
            versement_payments_qs = versement_payments_qs.filter(sale__branch_id=branch_id)
        versement_collected = versement_payments_qs.aggregate(total=Sum("amount"))["total"] or 0

        outstanding_versements_qs = Sale.objects.filter(
            tenant=request.tenant,
            status="partially_paid",
        )
        if branch_id:
            outstanding_versements_qs = outstanding_versements_qs.filter(branch_id=branch_id)
        outstanding_versements = outstanding_versements_qs.count()

        return Response(
            {
                "date": str(target_date),
                "branch_id": branch_id,
                "total_revenue": total_revenue,
                "sale_count": sale_count,
                "total_refunds": total_refunds,
                "net_revenue": total_revenue - total_refunds,
                "by_payment_method": method_breakdown,
                "versement_collected_today": versement_collected,
                "outstanding_versements": outstanding_versements,
            }
        )


class CashReconciliationViewSet(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    queryset = CashReconciliation.objects.all()
    serializer_class = CashReconciliationSerializer
    ordering = ["-date"]

    def get_queryset(self):
        return CashReconciliation.objects.filter(
            tenant=self.request.tenant
        ).select_related("submitted_by", "approved_by", "branch")

    @action(detail=False, methods=["get"])
    def history(self, request):
        """List recent reconciliations with optional date/branch filters."""
        qs = self.get_queryset()
        date_filter = request.query_params.get("date")
        branch_filter = request.query_params.get("branch")
        if date_filter:
            qs = qs.filter(date=date_filter)
        if branch_filter:
            qs = qs.filter(branch_id=branch_filter)
        return Response(CashReconciliationSerializer(qs[:60], many=True).data)

    @action(detail=False, methods=["post"])
    def submit(self, request):
        """Submit an end-of-day reconciliation. Fetches system totals automatically."""
        serializer = CreateReconciliationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        target_date = data["date"]
        branch_id = data.get("branch")

        # Block re-submission of an already-approved reconciliation
        existing = CashReconciliation.objects.filter(
            tenant=request.tenant, date=target_date, branch_id=branch_id
        ).first()
        if existing and existing.status == "approved":
            return Response(
                {"detail": "Cette fermeture de caisse a déjà été approuvée et ne peut plus être modifiée."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Snapshot system totals for completed sales on this date
        sales_qs = Sale.objects.filter(
            tenant=request.tenant, created_at__date=target_date, status="completed"
        )
        if branch_id:
            sales_qs = sales_qs.filter(branch_id=branch_id)

        by_method = Payment.objects.filter(sale__in=sales_qs).values("method").annotate(
            total=Sum("amount")
        )
        method_totals = {row["method"]: row["total"] or Decimal("0") for row in by_method}

        returns_qs = Return.objects.filter(tenant=request.tenant, created_at__date=target_date)
        if branch_id:
            returns_qs = returns_qs.filter(original_sale__branch_id=branch_id)
        total_refunds = returns_qs.aggregate(total=Sum("refund_amount"))["total"] or Decimal("0")

        system_snapshot = {
            "system_cash": method_totals.get("cash", Decimal("0")),
            "system_cheque": method_totals.get("cheque", Decimal("0")),
            "system_ccp": method_totals.get("ccp", Decimal("0")),
            "system_virement": method_totals.get("virement", Decimal("0")),
            "system_account": method_totals.get("account", Decimal("0")),
            "system_sales_count": sales_qs.count(),
            "system_total_refunds": total_refunds,
        }
        actual = {
            "opening_float": data.get("opening_float", Decimal("0")),
            "expenses": data.get("expenses", Decimal("0")),
            "cash_drops": data.get("cash_drops", Decimal("0")),
            "actual_cash": data["actual_cash"],
            "actual_cheque": data["actual_cheque"],
            "actual_ccp": data["actual_ccp"],
            "actual_virement": data["actual_virement"],
            "notes": data["notes"],
            "submitted_by": request.user,
        }

        if existing:
            for k, v in {**system_snapshot, **actual}.items():
                setattr(existing, k, v)
            existing.save()
            return Response(CashReconciliationSerializer(existing).data)

        rec = CashReconciliation.objects.create(
            tenant=request.tenant,
            date=target_date,
            branch_id=branch_id,
            **system_snapshot,
            **actual,
        )
        return Response(CashReconciliationSerializer(rec).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """Approve a pending reconciliation — manager/owner only."""
        if request.user.role not in ("owner", "manager"):
            return Response({"detail": "Seuls les managers peuvent approuver une fermeture de caisse."}, status=403)
        rec = self.get_object()
        if rec.status == "approved":
            return Response({"detail": "Déjà approuvé."}, status=status.HTTP_400_BAD_REQUEST)
        rec.status = "approved"
        rec.approved_by = request.user
        rec.approved_at = timezone.now()
        rec.save(update_fields=["status", "approved_by", "approved_at"])
        return Response(CashReconciliationSerializer(rec).data)
