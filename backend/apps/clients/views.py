"""Client API views."""
from decimal import Decimal

from django.db import models, transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

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
    filterset_fields = ["wilaya", "is_active", "client_type"]
    search_fields = ["name", "phone", "nif", "rc"]
    ordering_fields = ["name", "cached_balance", "created_at"]
    ordering = ["name"]

    def perform_create(self, serializer):
        from apps.core.plan_permissions import check_quota
        check_quota(self.request, "clients", Client.objects.filter(tenant=self.request.tenant).count())
        serializer.save(tenant=self.request.tenant)

    @action(detail=False, methods=["post"], url_path="import")
    def import_clients(self, request):
        """
        POST /clients/import/
        Body: multipart/form-data with field 'file' (CSV or XLSX).
        Query: ?dry_run=true to validate without saving.

        CSV columns:
          name* , phone, address, wilaya, client_type, nif, rc, notes
        (* required)
        Deduplication: rows whose phone already exists for this tenant are skipped.
        """
        from apps.core.imports import parse_upload

        self.require_manager()
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Champ 'file' manquant."}, status=status.HTTP_400_BAD_REQUEST)

        dry_run = request.query_params.get("dry_run", "").lower() in ("1", "true", "yes")
        tenant = request.tenant

        rows, parse_error = parse_upload(file_obj)
        if parse_error:
            return Response({"detail": parse_error}, status=status.HTTP_400_BAD_REQUEST)
        if not rows:
            return Response({"detail": "Le fichier est vide."}, status=status.HTTP_400_BAD_REQUEST)

        VALID_CLIENT_TYPES = {"retail", "wholesale"}

        created = 0
        skipped = 0
        errors = []

        # Pre-load existing phones to avoid N+1 in the loop
        existing_phones = set(
            Client.objects.filter(tenant=tenant).exclude(phone="")
            .values_list("phone", flat=True)
        )

        with transaction.atomic():
            for i, row in enumerate(rows, start=2):
                name = row.get("name", "").strip()
                if not name:
                    errors.append({"row": i, "message": "Le nom est obligatoire."})
                    continue

                phone = row.get("phone", "").strip()
                if phone and phone in existing_phones:
                    skipped += 1
                    continue

                client_type = row.get("client_type", "retail").strip().lower() or "retail"
                if client_type not in VALID_CLIENT_TYPES:
                    client_type = "retail"

                wilaya = row.get("wilaya", "").strip()
                if len(wilaya) > 2:
                    wilaya = wilaya[:2]

                if not dry_run:
                    Client.objects.create(
                        tenant=tenant,
                        name=name,
                        phone=phone,
                        address=row.get("address", "").strip(),
                        wilaya=wilaya,
                        client_type=client_type,
                        nif=row.get("nif", "").strip(),
                        rc=row.get("rc", "").strip(),
                    )
                    if phone:
                        existing_phones.add(phone)

                created += 1

            if dry_run:
                transaction.set_rollback(True)

        return Response({
            "dry_run": dry_run,
            "created": created,
            "skipped": skipped,
            "errors": errors,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def ledger(self, request, pk=None):
        """Client account statement."""
        client = self.get_object()
        from django.db.models import Q
        
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        entry_type = request.query_params.get("type")
        search = request.query_params.get("search")
        min_amount = request.query_params.get("min_amount")
        max_amount = request.query_params.get("max_amount")

        qs = client.ledger_entries.all().order_by("-date", "-created_at")
        
        if from_date:
            qs = qs.filter(date__gte=from_date)
        if to_date:
            qs = qs.filter(date__lte=to_date)
            
        if entry_type:
            qs = qs.filter(entry_type=entry_type)
            
        if search:
            qs = qs.filter(
                Q(description__icontains=search) |
                Q(reference_id__icontains=search) |
                Q(reference_type__icontains=search)
            )
            
        if min_amount:
            qs = qs.filter(amount__gte=min_amount)
        if max_amount:
            qs = qs.filter(amount__lte=max_amount)

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = ClientLedgerSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = ClientLedgerSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        """Record a payment from this client."""
        client = self.get_object()
        self.require_manager()

        serializer = RecordPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            method_labels = {
                "cash": "ESPÈCES",
                "cheque": "CHÈQUE",
                "virement": "VIREMENT",
                "ccp": "CCP"
            }
            method_label = method_labels.get(data["method"], data["method"].upper())
            
            # Create ledger credit entry
            entry = ClientLedger.objects.create(
                client=client,
                entry_type="credit",
                amount=data["amount"],
                description=f"Paiement — {method_label}",
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

            # Auto-allocate client payment to target invoice or oldest open/partial invoices
            from apps.invoicing.models import Invoice, InvoicePayment
            unallocated = data["amount"]
            invoice_id = data.get("invoice_id")
            target_invoice = None
            if invoice_id:
                target_invoice = Invoice.objects.filter(
                    pk=invoice_id, client=client, status__in=["sent", "partial", "overdue"]
                ).first()

            open_invoices = list(Invoice.objects.filter(
                client=client,
                status__in=["sent", "partial", "overdue"],
            ).order_by("date", "created_at"))

            if target_invoice and target_invoice in open_invoices:
                open_invoices.remove(target_invoice)
                open_invoices.insert(0, target_invoice)

            for inv in open_invoices:
                if unallocated <= Decimal("0.00"):
                    break
                rem = inv.balance_due
                if rem <= Decimal("0.00"):
                    continue
                pay_amt = min(unallocated, rem)
                InvoicePayment.objects.create(
                    invoice=inv,
                    amount=pay_amt,
                    method=data["method"] if data["method"] in ["cash", "cheque", "virement"] else "cash",
                    date=data["date"],
                    notes=data.get("notes") or f"Règlement client" + (f" (Facture {inv.number})" if inv == target_invoice else ""),
                    recorded_by=request.user,
                )
                unallocated -= pay_amt

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
        perm = PlanRequired("pro_wholesale")()
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

    @action(detail=False, methods=["get"], url_path="ageing-csv")
    def ageing_csv(self, request):
        """
        Same debt-ageing data as /clients/ageing/ but returned as a CSV file
        for download in spreadsheet applications.
        """
        from apps.core.plan_permissions import PlanRequired
        from rest_framework.exceptions import PermissionDenied as DRFPermissionDenied
        from django.http import HttpResponse
        from django.utils import timezone
        import csv, io

        perm = PlanRequired("pro_wholesale")()
        if not perm.has_permission(request, self):
            raise DRFPermissionDenied(perm.message)

        today = timezone.now().date()
        rows = self._compute_ageing(today)

        output = io.StringIO()
        writer = csv.writer(output, delimiter=";")
        writer.writerow([
            "Client", "Téléphone", "Wilaya",
            "Courant (0-30j)", "31-60j", "61-90j", "+90j", "Total",
        ])
        for row in rows:
            writer.writerow([
                row["client_name"],
                row.get("phone") or "",
                row.get("wilaya") or "",
                row["current"],
                row["days_30"],
                row["days_60"],
                row["days_90_plus"],
                row["total"],
            ])

        today_str = today.isoformat()
        response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = (
            f'attachment; filename="vieillissement-creances-{today_str}.csv"'
        )
        return response

    def _compute_ageing(self, today):
        """
        Compute comprehensive client debt ageing report.
        Integrates:
        1. Invoices (Invoice model)
        2. POS credit / versement sales (Sale model with status=partially_paid or is_versement=True)
        3. ClientLedger debit entries
        4. Real-time balance recomputation.
        Bucket mapping matches UI headers:
        - current: 0-30 days old
        - days_30: 31-60 days old
        - days_60: 61-90 days old
        - days_90_plus: 90+ days old
        """
        from apps.invoicing.models import Invoice
        from apps.sales.models import Sale
        from apps.clients.models import ClientLedger, Client
        from decimal import Decimal

        tenant = self.request.tenant

        # Get all clients with positive cached_balance or active unpaid invoices/sales
        client_ids = set(
            Client.objects.filter(tenant=tenant, cached_balance__gt=0).values_list("id", flat=True)
        )
        invoice_client_ids = set(
            Invoice.objects.filter(tenant=tenant, status__in=["sent", "partial", "overdue"], client__isnull=False).values_list("client_id", flat=True)
        )
        sale_client_ids = set(
            Sale.objects.filter(tenant=tenant, status="partially_paid", client__isnull=False).values_list("client_id", flat=True)
        )
        all_ids = client_ids | invoice_client_ids | sale_client_ids

        clients = Client.objects.filter(id__in=all_ids).order_by("name")
        result = []

        for client in clients:
            # Guarantee up-to-date ledger balance
            client.recompute_balance()
            if client.cached_balance <= Decimal("0.00"):
                continue

            buckets = {
                "current": Decimal("0.00"),
                "days_30": Decimal("0.00"),
                "days_60": Decimal("0.00"),
                "days_90": Decimal("0.00"),
                "days_90_plus": Decimal("0.00"),
            }

            accounted_debt = Decimal("0.00")

            # 1. Unpaid formal invoices
            invoices = Invoice.objects.filter(
                client=client,
                status__in=["sent", "partial", "overdue"],
            )
            for inv in invoices:
                remaining = inv.total_ttc - inv.total_paid
                if remaining <= Decimal("0.00"):
                    continue

                inv_date = inv.date or inv.due_date
                age_days = (today - inv_date).days

                if age_days <= 30:
                    buckets["current"] += remaining
                elif age_days <= 60:
                    buckets["days_30"] += remaining
                elif age_days <= 90:
                    buckets["days_60"] += remaining
                else:
                    buckets["days_90_plus"] += remaining

                accounted_debt += remaining

            # 2. Unpaid POS versement/credit sales (not attached to an invoice)
            sales = Sale.objects.filter(
                client=client,
                status="partially_paid",
            )
            for sale in sales:
                paid = sum(p.amount for p in sale.payments.all())
                remaining = sale.total_amount - paid
                if remaining <= Decimal("0.00"):
                    continue

                sale_date = sale.created_at.date()
                age_days = (today - sale_date).days

                if age_days <= 30:
                    buckets["current"] += remaining
                elif age_days <= 60:
                    buckets["days_30"] += remaining
                elif age_days <= 90:
                    buckets["days_60"] += remaining
                else:
                    buckets["days_90_plus"] += remaining

                accounted_debt += remaining

            # 3. Unallocated ledger balance (if cached_balance exceeds invoice/sale totals)
            unallocated = client.cached_balance - accounted_debt
            if unallocated > Decimal("0.00"):
                last_debit = client.ledger_entries.filter(entry_type="debit").order_by("-date").first()
                entry_date = last_debit.date if last_debit else today
                age_days = (today - entry_date).days

                if age_days <= 30:
                    buckets["current"] += unallocated
                elif age_days <= 60:
                    buckets["days_30"] += unallocated
                elif age_days <= 90:
                    buckets["days_60"] += unallocated
                else:
                    buckets["days_90_plus"] += unallocated

            total_debt = sum(buckets.values())
            # If client's ledger balance is lower than invoice total (due to general payments), scale buckets to match cached_balance
            if client.cached_balance < total_debt and total_debt > Decimal("0.00"):
                ratio = client.cached_balance / total_debt
                buckets["current"] = (buckets["current"] * ratio).quantize(Decimal("0.01"))
                buckets["days_30"] = (buckets["days_30"] * ratio).quantize(Decimal("0.01"))
                buckets["days_60"] = (buckets["days_60"] * ratio).quantize(Decimal("0.01"))
                buckets["days_90_plus"] = (buckets["days_90_plus"] * ratio).quantize(Decimal("0.01"))
                total_debt = client.cached_balance

            if total_debt > Decimal("0.00"):
                result.append({
                    "client_id": client.pk,
                    "client_name": client.name,
                    "phone": client.phone or "",
                    "wilaya": client.wilaya or "",
                    "current": str(buckets["current"]),
                    "days_30": str(buckets["days_30"]),
                    "days_60": str(buckets["days_60"]),
                    "days_90": "0.00",
                    "days_90_plus": str(buckets["days_90_plus"]),
                    "total": str(total_debt),
                })

        return result


class ClientLedgerViewSet(viewsets.ReadOnlyModelViewSet):
    """Global ledger view for all clients."""
    permission_classes = [IsAuthenticated]
    queryset = ClientLedger.objects.select_related("client").order_by("-date", "-created_at")
    serializer_class = ClientLedgerSerializer
    filterset_fields = ["client", "entry_type", "reference_type"]
    ordering_fields = ["date", "amount"]
    
    def get_queryset(self):
        # We must filter by the client's tenant. Since we removed TenantScopedViewSetMixin,
        # we access the tenant via the authenticated user.
        from django.db.models import Q
        tenant = getattr(self.request.user, "tenant", None)
        qs = super().get_queryset().filter(client__tenant=tenant)
        
        from_date = self.request.query_params.get("from")
        to_date = self.request.query_params.get("to")
        entry_type = self.request.query_params.get("type")
        search = self.request.query_params.get("search")
        min_amount = self.request.query_params.get("min_amount")
        max_amount = self.request.query_params.get("max_amount")

        if from_date:
            qs = qs.filter(date__gte=from_date)
        if to_date:
            qs = qs.filter(date__lte=to_date)
            
        if entry_type:
            qs = qs.filter(entry_type=entry_type)
            
        if search:
            qs = qs.filter(
                Q(description__icontains=search) |
                Q(reference_id__icontains=search) |
                Q(reference_type__icontains=search) |
                Q(client__name__icontains=search)
            )
            
        if min_amount:
            qs = qs.filter(amount__gte=min_amount)
        if max_amount:
            qs = qs.filter(amount__lte=max_amount)
            
        return qs

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
