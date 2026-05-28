"""Client API views."""
from decimal import Decimal

from django.db import models, transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from .models import Cheque, Client, ClientLedger
from .serializers import (
    ChequeSerializer,
    ClientLedgerSerializer,
    ClientSerializer,
    DebtAgeingRowSerializer,
    RecordPaymentSerializer,
)


class ClientViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Client.objects.all()
    serializer_class = ClientSerializer
    filterset_fields = ["wilaya", "is_active"]
    search_fields = ["name", "phone", "nif", "rc"]
    ordering_fields = ["name", "cached_balance", "created_at"]
    ordering = ["name"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)

    @action(detail=True, methods=["get"])
    def ledger(self, request, pk=None):
        """Client account statement."""
        client = self.get_object()
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")

        qs = client.ledger_entries.all()
        if from_date:
            qs = qs.filter(date__gte=from_date)
        if to_date:
            qs = qs.filter(date__lte=to_date)

        serializer = ClientLedgerSerializer(qs, many=True)
        return Response({
            "client": ClientSerializer(client).data,
            "entries": serializer.data,
            "balance": client.cached_balance,
        })

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        """Record a payment from this client."""
        client = self.get_object()
        self.require_manager()

        serializer = RecordPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            # Create ledger credit entry
            entry = ClientLedger.objects.create(
                client=client,
                entry_type="credit",
                amount=data["amount"],
                description=f"Payment — {data['method'].upper()}",
                reference_type="Payment",
                date=data["date"],
            )

            # If cheque, create Cheque record
            if data["method"] == "cheque" and data.get("cheque_number"):
                Cheque.objects.create(
                    tenant=self.request.tenant,
                    client=client,
                    direction="receivable",
                    number=data["cheque_number"],
                    bank=data.get("cheque_bank", ""),
                    amount=data["amount"],
                    due_date=data.get("cheque_due_date") or data["date"],
                )

        return Response(
            ClientLedgerSerializer(entry).data, status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=["get"])
    def ageing(self, request):
        """
        Debt ageing report. Returns per-client breakdown into buckets:
        current / 30 / 60 / 90 / 90+ days overdue.
        Computed via a single optimised query using CASE WHEN.
        """
        from apps.core.plan_permissions import PlanRequired
        from rest_framework.exceptions import PermissionDenied as DRFPermissionDenied
        perm = PlanRequired("pro_wholesale")
        if not perm.has_permission(request, self):
            raise DRFPermissionDenied(perm.message)

        from django.db.models import Case, F, Q, Sum, When
        from django.utils import timezone

        today = timezone.now().date()

        # Get all overdue invoices for this tenant's clients
        from apps.invoicing.models import Invoice

        rows = (
            Invoice.objects.filter(
                tenant=request.tenant,
                status__in=["partial", "sent", "overdue"],
                client__isnull=False,
            )
            .values("client_id", "client__name", "client__phone", "client__wilaya")
            .annotate(
                current=Sum(
                    Case(
                        When(due_date__gte=today, then=F("total_ttc")),
                        default=Decimal("0.00"),
                        output_field=models.DecimalField(),
                    )
                ),
                days_30=Sum(
                    Case(
                        When(
                            due_date__lt=today,
                            due_date__gte=today - models.ExpressionWrapper(
                                models.Value(30), output_field=models.IntegerField()
                            ),
                            then=F("total_ttc"),
                        ),
                        default=Decimal("0.00"),
                        output_field=models.DecimalField(),
                    )
                ),
            )
            .order_by("client__name")
        )

        # Simplified ageing calculation using raw annotated approach
        ageing_data = self._compute_ageing(today)
        return Response(ageing_data)

    def _compute_ageing(self, today):
        """Compute debt ageing data via Python post-processing for flexibility."""
        from apps.invoicing.models import Invoice
        import datetime

        clients = Client.objects.filter(
            tenant=self.request.tenant,
            cached_balance__gt=0,
        )
        result = []

        for client in clients:
            invoices = Invoice.objects.filter(
                client=client,
                status__in=["sent", "partial", "overdue"],
            )
            buckets = {"current": Decimal("0"), "days_30": Decimal("0"),
                       "days_60": Decimal("0"), "days_90": Decimal("0"),
                       "days_90_plus": Decimal("0")}

            for inv in invoices:
                remaining = inv.total_ttc - inv.total_paid
                if remaining <= 0:
                    continue
                days_overdue = (today - inv.due_date).days
                if days_overdue <= 0:
                    buckets["current"] += remaining
                elif days_overdue <= 30:
                    buckets["days_30"] += remaining
                elif days_overdue <= 60:
                    buckets["days_60"] += remaining
                elif days_overdue <= 90:
                    buckets["days_90"] += remaining
                else:
                    buckets["days_90_plus"] += remaining

            total = sum(buckets.values())
            if total > 0:
                result.append({
                    "client_id": client.pk,
                    "client_name": client.name,
                    "phone": client.phone,
                    "wilaya": client.wilaya,
                    **buckets,
                    "total": total,
                })

        return result


class ChequeViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Cheque.objects.select_related("client", "supplier")
    serializer_class = ChequeSerializer
    filterset_fields = ["status", "direction", "client"]
    ordering_fields = ["due_date", "amount"]
    ordering = ["due_date"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)

    @action(detail=True, methods=["post"], url_path="mark-deposited")
    def mark_deposited(self, request, pk=None):
        cheque = self.get_object()
        self.require_manager()
        cheque.status = "deposited"
        cheque.save(update_fields=["status"])
        return Response(ChequeSerializer(cheque).data)

    @action(detail=True, methods=["post"], url_path="mark-bounced")
    def mark_bounced(self, request, pk=None):
        cheque = self.get_object()
        self.require_manager()
        cheque.status = "bounced"
        cheque.save(update_fields=["status"])
        return Response(ChequeSerializer(cheque).data)

    @action(detail=False, methods=["get"], url_path="upcoming")
    def upcoming(self, request):
        """Cheques due in the next N days (default 7)."""
        days = int(request.query_params.get("days", 7))
        today = timezone.now().date()
        cutoff = today + timezone.timedelta(days=days)
        qs = self.get_queryset().filter(
            status="pending",
            due_date__gte=today,
            due_date__lte=cutoff,
        )
        return Response(ChequeSerializer(qs, many=True).data)
