"""Invoicing API views."""
from decimal import Decimal

from django.db import transaction
from django.http import FileResponse, HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.models import RoleChoices
from apps.core.plan_permissions import PlanRequired
from .models import CreditNote, DeliveryNote, Invoice, InvoiceLine, InvoicePayment
from .serializers import (
    CreateDeliveryNoteSerializer,
    RegrouperBLsSerializer,
    DeliveryNoteLineSerializer,
    CreditNoteSerializer,
    CreateInvoiceSerializer,
    DeliveryNoteSerializer,
    InvoiceListSerializer,
    InvoicePaymentSerializer,
    InvoiceSerializer,
)
from .tasks import generate_invoice_pdf


class InvoiceViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Invoice.objects.select_related("client", "branch").prefetch_related("lines", "payments")
    permission_classes = [IsAuthenticated, PlanRequired("pro_wholesale")]
    filterset_fields = ["status", "client", "branch"]
    search_fields = ["number", "client__name"]
    ordering_fields = ["date", "due_date", "total_ttc", "number"]
    ordering = ["-date"]

    def get_serializer_class(self):
        if self.action == "list":
            return InvoiceListSerializer
        if self.action == "create":
            return CreateInvoiceSerializer
        return InvoiceSerializer

    def create(self, request, *args, **kwargs):
        self.require_manager()
        serializer = CreateInvoiceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            # Resolve FKs
            client = None
            if data.get("client_id"):
                from apps.clients.models import Client
                client = Client.objects.get(pk=data["client_id"], tenant=request.tenant)

            branch = None
            if data.get("branch_id"):
                from apps.core.models import Branch
                branch = Branch.objects.get(pk=data["branch_id"], tenant=request.tenant)

            # ── Credit limit check ──────────────────────────────────
            if client and client.credit_limit and client.credit_limit > 0:
                # Compute invoice total from lines (quick estimate before save)
                estimated_total = sum(
                    line_data["quantity"] * line_data["unit_price"] *
                    (1 - line_data.get("discount_pct", Decimal("0")) / 100)
                    for line_data in data["lines"]
                )
                if data.get("apply_tva"):
                    estimated_total *= (1 + data.get("tva_rate", Decimal("0.19")))

                would_be_balance = client.cached_balance + estimated_total
                if would_be_balance > client.credit_limit:
                    force = request.query_params.get("force", "").lower() in ("1", "true", "yes")
                    if not force or request.user.role == RoleChoices.CASHIER:
                        from rest_framework.exceptions import ValidationError as DRFValidationError
                        raise DRFValidationError({
                            "error": "credit_limit_exceeded",
                            "credit_limit": str(client.credit_limit),
                            "current_balance": str(client.cached_balance),
                            "invoice_total": str(estimated_total.quantize(Decimal("0.01"))),
                            "would_be_balance": str(would_be_balance.quantize(Decimal("0.01"))),
                        })

            invoice = Invoice.objects.create(
                tenant=request.tenant,
                client=client,
                branch=branch,
                date=data["date"],
                due_date=data["due_date"],
                series_prefix=data["series_prefix"],
                apply_tva=data["apply_tva"],
                tva_rate=data["tva_rate"],
                is_formal=data.get("is_formal", True),
                is_paid_in_cash=data.get("is_paid_in_cash", False),
                notes=data.get("notes", ""),
                created_by=request.user,
                status="draft",
            )

            # Create lines
            for i, line_data in enumerate(data["lines"]):
                InvoiceLine.objects.create(
                    invoice=invoice,
                    variant=line_data.get("variant"),
                    description=line_data["description"],
                    quantity=line_data["quantity"],
                    unit_price=line_data["unit_price"],
                    discount_pct=line_data.get("discount_pct", Decimal("0")),
                    cartons=line_data.get("cartons", 0),
                    order=i,
                )

            # Compute totals after lines are created
            invoice.compute_totals()
            invoice.save(update_fields=["total_ht", "tva_amount", "total_ttc"])

            # Confirm if requested — assigns number (FA-2026-00001) + sets to sent
            if data.get("confirm"):
                invoice.confirm()

            # Record initial payment if provided
            payment_data = data.get("payment")
            if payment_data and payment_data.get("amount"):
                InvoicePayment.objects.create(
                    invoice=invoice,
                    amount=payment_data["amount"],
                    method=payment_data["method"],
                    date=payment_data["date"],
                    notes=payment_data.get("notes", ""),
                    recorded_by=request.user,
                )

            # Queue PDF generation
            generate_invoice_pdf.delay(invoice.pk)

        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """Assign invoice number and set status to sent."""
        self.require_manager()
        invoice = self.get_object()
        if invoice.status != "draft":
            return Response(
                {"error": {"code": "invalid_state", "message": "Invoice is not a draft."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invoice.confirm()
        generate_invoice_pdf.delay(invoice.pk)
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """Download or stream the invoice PDF."""
        invoice = self.get_object()
        if invoice.pdf_file:
            try:
                return FileResponse(
                    invoice.pdf_file.open("rb"),
                    content_type="application/pdf",
                    as_attachment=False,
                    filename=f"invoice-{invoice.number or invoice.pk}.pdf",
                )
            except Exception:
                pass

        # Generate synchronously as fallback
        from .pdf import render_invoice_pdf
        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_invoice_pdf(invoice, language=lang)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="invoice-{invoice.number or invoice.pk}.pdf"'
        )
        return response

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        """Record a payment against this invoice."""
        self.require_manager()
        invoice = self.get_object()

        serializer = InvoicePaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payment = serializer.save(invoice=invoice, recorded_by=request.user)
        return Response(InvoicePaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf_async(self, request, pk=None):
        """Queue PDF regeneration."""
        invoice = self.get_object()
        generate_invoice_pdf.delay(invoice.pk)
        return Response({"message": "PDF generation queued."})


class DeliveryNoteViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = DeliveryNote.objects.select_related("invoice__client", "invoice__tenant")
    permission_classes = [IsAuthenticated, PlanRequired("pro_wholesale")]
    serializer_class = DeliveryNoteSerializer
    filterset_fields = ["invoice"]

    def get_queryset(self):
        return DeliveryNote.objects.filter(invoice__tenant=self.request.tenant)

    def perform_create(self, serializer):
        self.require_manager()
        dn = serializer.save(tenant=self.request.tenant)

        # Auto-populate client and copy lines if linked to an invoice
        if dn.invoice and not dn.client:
            dn.client = dn.invoice.client
            dn.save(update_fields=['client'])
            
            from .models import DeliveryNoteLine
            lines_to_create = []
            for line in dn.invoice.lines.all():
                lines_to_create.append(DeliveryNoteLine(
                    delivery_note=dn,
                    variant=line.variant,
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount_pct=line.discount_pct,
                    cartons=line.cartons,
                    order=line.order
                ))
            if lines_to_create:
                DeliveryNoteLine.objects.bulk_create(lines_to_create)

        from .tasks import generate_delivery_note_pdf
        generate_delivery_note_pdf.delay(dn.pk)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        dn = self.get_object()
        if dn.pdf_file:
            try:
                return FileResponse(dn.pdf_file.open("rb"), content_type="application/pdf")
            except Exception:
                pass
        from .pdf import render_delivery_note_pdf
        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_delivery_note_pdf(dn, language=lang)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="bl-{dn.number}.pdf"'
        return response



    @action(detail=False, methods=["post"])
    def regrouper(self, request):
        self.require_manager()
        from .serializers import RegrouperBLsSerializer
        serializer = RegrouperBLsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from apps.clients.models import Client
        client = Client.objects.get(pk=data["client_id"], tenant=request.tenant)
        
        bls = DeliveryNote.objects.filter(
            tenant=request.tenant, 
            pk__in=data["delivery_note_ids"],
            client=client,
            invoice__isnull=True
        ).prefetch_related("lines")
        
        if len(bls) != len(data["delivery_note_ids"]):
            from rest_framework.response import Response
            return Response({"error": "Some Delivery Notes were not found, don't belong to this client, or are already invoiced."}, status=400)

        with transaction.atomic():
            # Check credit limit
            estimated_total = sum(
                line.quantity * line.unit_price * (1 - line.discount_pct / 100)
                for bl in bls for line in bl.lines.all()
            )
            if data.get("apply_tva"):
                estimated_total *= (1 + data.get("tva_rate", Decimal("0.19")))
                
            if client.credit_limit and client.credit_limit > 0:
                would_be_balance = client.cached_balance + estimated_total
                if would_be_balance > client.credit_limit:
                    from rest_framework.exceptions import ValidationError as DRFValidationError
                    raise DRFValidationError({"error": "credit_limit_exceeded"})

            invoice = Invoice.objects.create(
                tenant=request.tenant,
                client=client,
                date=data["date"],
                due_date=data["due_date"],
                series_prefix=data["series_prefix"],
                apply_tva=data["apply_tva"],
                tva_rate=data["tva_rate"],
                is_formal=data.get("is_formal", True),
                is_paid_in_cash=data.get("is_paid_in_cash", False),
                notes=data.get("notes", ""),
                created_by=request.user,
                status="draft",
            )
            
            # Merge lines
            order = 0
            for bl in bls:
                bl.invoice = invoice
                bl.save(update_fields=["invoice"])
                for line in bl.lines.all():
                    InvoiceLine.objects.create(
                        invoice=invoice,
                        variant=line.variant,
                        description=f"{line.description} (BL {bl.number})",
                        quantity=line.quantity,
                        unit_price=line.unit_price,
                        discount_pct=line.discount_pct,
                        order=order
                    )
                    order += 1
                    
            invoice.recalculate_totals()
            if data.get("confirm"):
                invoice.status = "sent"
                invoice.save()
                
        from rest_framework.response import Response
        return Response(InvoiceSerializer(invoice).data, status=201)


class CreditNoteViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = CreditNote.objects.select_related("original_invoice__client")
    permission_classes = [IsAuthenticated, PlanRequired("pro_wholesale")]
    serializer_class = CreditNoteSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return CreditNote.objects.filter(tenant=self.request.tenant)

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant)


