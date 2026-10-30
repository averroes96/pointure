"""Sales API views."""
import datetime
import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.inventory.models import MovementReasonChoices, StockMovement
from .models import (
    CashMovement, CashMovementType, CashReconciliation, CashSession,
    CashSessionStatus, Payment, Return, Sale,
)
from .serializers import (
    AddPaymentSerializer, CashMovementCreateSerializer, CashMovementSerializer,
    CashReconciliationSerializer, CashSessionSerializer, CloseCashSessionSerializer,
    CreateExchangeSerializer, CreateReconciliationSerializer, CreateReturnSerializer,
    CreateSaleSerializer, OpenCashSessionSerializer, SaleSerializer,
    verify_manager_pin_helper,
)
from .services.z_report import (
    compute_session_stats,
    render_daily_detailed_report,
    render_thermal_z_report,
)

logger = logging.getLogger(__name__)


class SaleViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Sale.objects.select_related(
        "cashier",
        "client",
        "branch",
    ).prefetch_related(
        "items__variant__product",
        "payments",
        "client__loyalty_accounts",
        "exchanges",
    )
    serializer_class = SaleSerializer
    filterset_fields = ["branch", "cashier", "status", "client", "is_layaway"]
    search_fields = [
        "receipt_number",
        "client__name",
        "client__phone",
        "cashier__first_name",
        "cashier__last_name",
        "cashier__email",
        "items__variant__product__name",
        "items__variant__product__reference",
        "items__variant__barcode",
        "notes",
    ]
    ordering_fields = ["created_at", "total_amount"]
    ordering = ["-created_at"]
    http_method_names = ["get", "post", "head", "options"]  # No PUT/PATCH/DELETE

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        date_from = params.get("from") or params.get("date_from")
        if date_from:
            try:
                qs = qs.filter(created_at__date__gte=datetime.date.fromisoformat(date_from))
            except ValueError:
                pass

        date_to = params.get("to") or params.get("date_to")
        if date_to:
            try:
                qs = qs.filter(created_at__date__lte=datetime.date.fromisoformat(date_to))
            except ValueError:
                pass

        payment_method = params.get("payment_method")
        if payment_method:
            qs = qs.filter(payments__method=payment_method)

        client_type = params.get("client_type")
        if client_type == "walk_in":
            qs = qs.filter(client__isnull=True)
        elif client_type == "registered":
            qs = qs.filter(client__isnull=False)

        has_balance = params.get("has_balance")
        if has_balance in ("true", "1"):
            qs = qs.filter(status__in=["partially_paid", "layaway"])

        min_amount = params.get("min_amount")
        if min_amount:
            try:
                qs = qs.filter(total_amount__gte=Decimal(str(min_amount)))
            except Exception:
                pass

        max_amount = params.get("max_amount")
        if max_amount:
            try:
                qs = qs.filter(total_amount__lte=Decimal(str(max_amount)))
            except Exception:
                pass

        return qs.distinct()

    def get_serializer_class(self):
        if self.action == "create":
            return CreateSaleSerializer
        return SaleSerializer

    def create(self, request, *args, **kwargs):
        serializer = CreateSaleSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            logger.warning("Create sale validation failed: %s | payload: %s", serializer.errors, request.data)
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
        """Add a payment to a partially_paid or layaway sale."""
        sale = self.get_object()
        if sale.status not in ("partially_paid", "layaway"):
            return Response(
                {"detail": "Seules les ventes en cours de versement ou réservation acceptent des paiements supplémentaires."},
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
            if not sale.is_layaway and total_paid >= sale.total_amount:
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

    @action(detail=True, methods=["post"], url_path="collect-layaway")
    def collect_layaway(self, request, pk=None):
        """Complete and collect a layaway sale (customer pays balance and picks up items)."""
        sale = self.get_object()
        if not sale.is_layaway or sale.status != "layaway":
            return Response(
                {"detail": "Cette vente n'est pas une réservation en attente de retrait."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # If there's an outstanding balance, check if payment is provided
            balance = sale.balance_due
            if balance > Decimal("0.00"):
                amount_raw = request.data.get("amount")
                if not amount_raw:
                    return Response(
                        {"detail": f"Un règlement du solde restant de {balance:.2f} DZD est requis pour retirer les articles."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                try:
                    amount = Decimal(str(amount_raw))
                except Exception:
                    return Response({"detail": "Montant invalide."}, status=status.HTTP_400_BAD_REQUEST)

                if amount < balance:
                    return Response(
                        {"detail": f"Le montant fourni ({amount:.2f} DZD) ne couvre pas la totalité du solde restant ({balance:.2f} DZD)."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                method = request.data.get("method", "cash")
                notes = request.data.get("notes", "Règlement solde retrait réservation")
                Payment.objects.create(
                    sale=sale,
                    amount=amount,
                    method=method,
                    notes=notes,
                )

            sale.status = "completed"
            sale.layaway_collected_at = timezone.now()
            sale.save(update_fields=["status", "layaway_collected_at"])

            # Now that customer has paid and taken the pair, award loyalty points
            loyalty_summary = CreateSaleSerializer._process_loyalty(
                sale=sale,
                tenant=sale.tenant,
                client=sale.client,
                receipt_number=sale.receipt_number,
                redeem_points=0,
                loyalty_program=None,
                loyalty_account=None,
            )

        resp_data = SaleSerializer(sale).data
        resp_data["points_earned"] = loyalty_summary.get("points_earned", 0)
        return Response(resp_data)

    @action(detail=True, methods=["post"], url_path="cancel-layaway")
    def cancel_layaway(self, request, pk=None):
        """Cancel a layaway sale, releasing locked stock back into shelf inventory."""
        sale = self.get_object()
        if not sale.is_layaway or sale.status != "layaway":
            return Response(
                {"detail": "Seule une réservation en cours peut être annulée ici."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Cashier check: requires manager PIN or permission
        if request.user.role == "cashier":
            pin = request.data.get("manager_pin", "")
            mgr = verify_manager_pin_helper(request.tenant, pin)
            if not mgr and not getattr(request.user, "can_process_returns", False):
                return Response(
                    {"detail": "Code PIN manager requis pour autoriser l'annulation d'une réservation."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        refund_deposit = request.data.get("refund_deposit", True)
        deposit_forfeited = request.data.get("deposit_forfeited", False)
        notes = request.data.get("notes", "")

        with transaction.atomic():
            # 1. Release reserved stock back into inventory
            for item in sale.items.all():
                StockMovement.objects.create(
                    tenant=sale.tenant,
                    variant=item.variant,
                    branch=sale.branch,
                    quantity_delta=item.quantity,
                    reason=MovementReasonChoices.LAYAWAY_RELEASE,
                    reference_id=sale.receipt_number or str(sale.pk),
                    reference_type="Sale",
                    user=request.user,
                )

            # 2. If deposit is refunded in cash, record petty cash out in current cash drawer session
            if refund_deposit and not deposit_forfeited and sale.amount_paid > Decimal("0.00"):
                active_session = CashSession.objects.filter(
                    tenant=request.tenant,
                    cashier=request.user,
                    status=CashSessionStatus.OPEN,
                ).order_by("-opened_at").first()
                if not active_session and sale.branch:
                    active_session = CashSession.objects.filter(
                        tenant=request.tenant,
                        branch=sale.branch,
                        status=CashSessionStatus.OPEN,
                    ).order_by("-opened_at").first()

                if active_session:
                    CashMovement.objects.create(
                        session=active_session,
                        type=CashMovementType.OUT,
                        amount=sale.amount_paid,
                        category="Remboursement Réservation",
                        notes=f"Remboursement acompte réservation {sale.receipt_number}: {notes}".strip(),
                        created_by=request.user,
                    )

            # 3. Update sale status
            sale.status = "cancelled"
            sale.layaway_deposit_forfeited = bool(deposit_forfeited)
            if notes:
                sale.notes = f"{sale.notes}\n[Annulation Réservation] {notes}".strip()
            sale.save(update_fields=["status", "layaway_deposit_forfeited", "notes"])

        return Response(SaleSerializer(sale).data)

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
        serializer = CreateReturnSerializer(
            data=request.data,
            context={"sale": sale, "request": request, "processed_by": request.user},
        )
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
            data=request.data, context={"sale": sale, "request": request, "processed_by": request.user}
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
            target_date = timezone.localdate()

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

        # All active sales today (completed + partially_paid + layaway)
        today_active_qs = Sale.objects.filter(
            tenant=request.tenant,
            created_at__date=target_date,
            status__in=["completed", "partially_paid", "layaway"],
        )
        if branch_id:
            today_active_qs = today_active_qs.filter(branch_id=branch_id)

        today_active_revenue = today_active_qs.aggregate(total=Sum("total_amount"))["total"] or Decimal("0.00")
        today_active_count = today_active_qs.count()

        from .models import SaleItem
        today_items_sold = (
            SaleItem.objects.filter(sale__in=today_active_qs)
            .aggregate(total=Sum("quantity"))["total"]
            or 0
        )

        return Response(
            {
                "date": str(target_date),
                "branch_id": branch_id,
                "total_revenue": total_revenue,
                "sale_count": sale_count,
                "today_active_revenue": today_active_revenue,
                "today_active_count": today_active_count,
                "today_items_sold": today_items_sold,
                "total_refunds": total_refunds,
                "net_revenue": total_revenue - total_refunds,
                "by_payment_method": method_breakdown,
                "versement_collected_today": versement_collected,
                "outstanding_versements": outstanding_versements,
            }
        )

    @action(detail=False, methods=["get"], url_path="daily-detailed-report")
    def daily_detailed_report(self, request):
        """
        Returns an 80mm thermal HTML report of all sales, returns, cash movements,
        and stock movements for the given date (defaults to today).
        Query params: ?date=YYYY-MM-DD&branch_id=<uuid>
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
            target_date = timezone.localdate()

        branch = None
        if branch_id:
            from apps.core.models import Branch
            branch = Branch.objects.filter(tenant=request.tenant, id=branch_id).first()

        lang = request.GET.get("lang") or request.headers.get("Accept-Language", "fr")[:2]
        html = render_daily_detailed_report(
            tenant=request.tenant,
            target_date=target_date,
            branch=branch,
            user=request.user,
            lang=lang,
        )
        return Response(
            {
                "date": str(target_date),
                "branch_id": branch_id,
                "report_html": html,
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


class CashSessionViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    Cash Register Session ViewSet.
    Handles shift open, movements (in/out), live X-Report, shift close with counted cash,
    and closing Z-Report generation.
    """
    queryset = CashSession.objects.all()
    serializer_class = CashSessionSerializer
    ordering = ["-opened_at"]

    def get_queryset(self):
        qs = CashSession.objects.filter(
            tenant=self.request.tenant
        ).select_related("cashier", "closed_by", "approved_by", "branch").prefetch_related("movements__created_by")
        
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        branch_param = self.request.query_params.get("branch")
        if branch_param:
            qs = qs.filter(branch_id=branch_param)
        cashier_param = self.request.query_params.get("cashier")
        if cashier_param:
            qs = qs.filter(cashier_id=cashier_param)
        date_param = self.request.query_params.get("date")
        if date_param:
            qs = qs.filter(opened_at__date=date_param)

        return qs

    @action(detail=False, methods=["get"])
    def current(self, request):
        """
        Get the currently active open CashSession for this user or register.
        """
        branch_id = request.query_params.get("branch")
        # 1. Search for active session of this cashier
        session = CashSession.objects.filter(
            tenant=request.tenant,
            cashier=request.user,
            status=CashSessionStatus.OPEN,
        ).order_by("-opened_at").first()

        # 2. If not found and branch provided, check open session for branch
        if not session and branch_id:
            session = CashSession.objects.filter(
                tenant=request.tenant,
                branch_id=branch_id,
                status=CashSessionStatus.OPEN,
            ).order_by("-opened_at").first()

        # 3. If still not found, check any open session in tenant
        if not session:
            session = CashSession.objects.filter(
                tenant=request.tenant,
                status=CashSessionStatus.OPEN,
            ).order_by("-opened_at").first()

        if not session:
            return Response(None, status=status.HTTP_200_OK)

        return Response(CashSessionSerializer(session).data)

    @action(detail=False, methods=["post"])
    def open_session(self, request):
        """
        Open a new cash register session (Shift).
        """
        serializer = OpenCashSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Check if already open session for this cashier
        existing = CashSession.objects.filter(
            tenant=request.tenant,
            cashier=request.user,
            status=CashSessionStatus.OPEN,
        ).first()
        if existing:
            return Response(
                {"detail": f"Une session est déjà ouverte (#{existing.session_number}). Fermez-la avant d'en ouvrir une nouvelle."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        branch = None
        branch_id = data.get("branch_id")
        if branch_id:
            from apps.core.models import Branch
            branch = Branch.objects.filter(pk=branch_id, tenant=request.tenant).first()

        session = CashSession.objects.create(
            tenant=request.tenant,
            branch=branch,
            cashier=request.user,
            opening_float=data.get("opening_float", Decimal("0.00")),
            status=CashSessionStatus.OPEN,
        )
        return Response(CashSessionSerializer(session).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def movement(self, request, pk=None):
        """
        Record a cash movement (in/out) in this session.
        """
        session = self.get_object()
        if session.status != CashSessionStatus.OPEN:
            return Response(
                {"detail": "Impossible d'ajouter un mouvement à une session fermée."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = CashMovementCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        movement = CashMovement.objects.create(
            session=session,
            type=data["type"],
            amount=data["amount"],
            category=data["category"],
            notes=data.get("notes", ""),
            created_by=request.user,
        )
        return Response(CashMovementSerializer(movement).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """
        Close a cash session: record cashier physical count, snapshot system numbers,
        compute cash gap, and generate closing Z-Report.
        """
        session = self.get_object()
        if session.status == CashSessionStatus.CLOSED:
            return Response(
                {"detail": "Cette session est déjà fermée."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = CloseCashSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        stats = compute_session_stats(session)

        actual_cash = data["actual_cash"]
        actual_tpe = data.get("actual_tpe", Decimal("0.00"))
        actual_baridimob = data.get("actual_baridimob", Decimal("0.00"))
        actual_cheque = data.get("actual_cheque", Decimal("0.00"))
        actual_ccp = data.get("actual_ccp", Decimal("0.00"))
        actual_virement = data.get("actual_virement", Decimal("0.00"))
        closing_notes = data.get("closing_notes", "")

        expected_cash = stats["expected_cash"]
        cash_gap = actual_cash - expected_cash

        session.status = CashSessionStatus.CLOSED
        session.closed_at = timezone.now()
        session.closed_by = request.user

        session.system_sales_count = stats["sales_count"]
        session.system_total_sales = stats["total_sales"]
        session.system_cash_sales = stats["cash_sales"]
        session.system_tpe_sales = stats["tpe_sales"]
        session.system_baridimob_sales = stats["baridimob_sales"]
        session.system_cheque_sales = stats["cheque_sales"]
        session.system_ccp_sales = stats["ccp_sales"]
        session.system_virement_sales = stats["virement_sales"]
        session.system_account_sales = stats["account_sales"]
        session.system_refunds_amount = stats["refunds_amount"]
        session.system_refunds_count = stats["refunds_count"]

        session.total_cash_in = stats["total_cash_in"]
        session.total_cash_out = stats["total_cash_out"]
        session.expected_cash = expected_cash

        session.actual_cash = actual_cash
        session.actual_tpe = actual_tpe
        session.actual_baridimob = actual_baridimob
        session.actual_cheque = actual_cheque
        session.actual_ccp = actual_ccp
        session.actual_virement = actual_virement
        session.cash_gap = cash_gap
        session.closing_notes = closing_notes

        session.save()

        store_name = getattr(request.tenant, "name", "ShoeDZ") or "ShoeDZ"
        lang = request.data.get("lang") or request.GET.get("lang") or request.headers.get("Accept-Language", "fr")[:2]
        html = render_thermal_z_report(session, is_x_report=False, stats=stats, store_name=store_name, lang=lang)

        return Response({
            "session": CashSessionSerializer(session).data,
            "z_report_html": html,
        })

    @action(detail=True, methods=["get"])
    def x_report(self, request, pk=None):
        """
        Instant live flash reading (Rapport X) without closing the session.
        """
        session = self.get_object()
        stats = compute_session_stats(session)
        store_name = getattr(request.tenant, "name", "ShoeDZ") or "ShoeDZ"
        lang = request.GET.get("lang") or request.headers.get("Accept-Language", "fr")[:2]
        html = render_thermal_z_report(session, is_x_report=True, stats=stats, store_name=store_name, lang=lang)
        return Response({
            "session": CashSessionSerializer(session).data,
            "stats": stats,
            "x_report_html": html,
        })

    @action(detail=True, methods=["get"])
    def z_report(self, request, pk=None):
        """
        Reprint or view thermal Z-Report for a closed session.
        """
        session = self.get_object()
        store_name = getattr(request.tenant, "name", "ShoeDZ") or "ShoeDZ"
        lang = request.GET.get("lang") or request.headers.get("Accept-Language", "fr")[:2]
        html = render_thermal_z_report(session, is_x_report=False, store_name=store_name, lang=lang)
        return Response({
            "session": CashSessionSerializer(session).data,
            "z_report_html": html,
        })

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """
        Manager approval for cash session discrepancy / closing.
        """
        if request.user.role not in ("owner", "manager"):
            return Response(
                {"detail": "Seuls les managers peuvent approuver une session de caisse."},
                status=status.HTTP_403_FORBIDDEN,
            )
        session = self.get_object()
        if session.approved_by:
            return Response(
                {"detail": "Cette session a déjà été approuvée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        session.approved_by = request.user
        session.approved_at = timezone.now()
        session.save(update_fields=["approved_by", "approved_at"])
        return Response(CashSessionSerializer(session).data)

