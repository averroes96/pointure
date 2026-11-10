"""Invoicing API views."""
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)

from django.db import transaction
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.models import RoleChoices
from apps.core.permissions import ALL_ROLES, MANAGER_OR_OWNER, RolePermission
from apps.core.plan_permissions import PlanRequired
from apps.core.utils.task_runner import run_task
from apps.inventory.services.costing import current_unit_cost
from .models import (
    CreditNote,
    DeliveryNote,
    Invoice,
    InvoiceLine,
    InvoicePayment,
    InvoiceStatusChoices,
    Quote,
    QuoteLine,
    QuoteStatusChoices,
)
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
    QuoteSerializer,
    QuoteListSerializer,
    CreateQuoteSerializer,
)
from .pdf import render_quote_pdf
from .tasks import generate_invoice_pdf, generate_quote_pdf, generate_delivery_note_pdf


class InvoiceViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Invoice.objects.select_related("client", "branch").prefetch_related("lines", "payments")
    permission_classes = [IsAuthenticated, PlanRequired("pro_wholesale"), RolePermission]
    role_permissions = {
        "create": MANAGER_OR_OWNER,
        "update": MANAGER_OR_OWNER,
        "partial_update": MANAGER_OR_OWNER,
        "destroy": MANAGER_OR_OWNER,
        "confirm": MANAGER_OR_OWNER,
        "cancel": MANAGER_OR_OWNER,
        "record_payment": MANAGER_OR_OWNER,
        "default": ALL_ROLES,
    }
    filterset_fields = ["status", "client", "branch"]
    search_fields = ["number", "client__name"]
    ordering_fields = ["date", "due_date", "total_ttc", "number", "created_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return InvoiceListSerializer
        if self.action == "create":
            return CreateInvoiceSerializer
        return InvoiceSerializer

    def create(self, request, *args, **kwargs):
        self.require_manager()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from apps.closing.services.lock import assert_period_open
        assert_period_open(request.tenant, data["date"])
        if data.get("payment") and data["payment"].get("date"):
            assert_period_open(request.tenant, data["payment"]["date"])

        with transaction.atomic():
            # Resolve FKs
            client = None
            if data.get("client_id"):
                from apps.clients.models import Client
                client = Client.objects.get(pk=data["client_id"], tenant=request.tenant)

            # ── Credit limit & blocked client check ──────────────────
            estimated_total = sum(
                line_data["quantity"] * line_data["unit_price"] *
                (1 - line_data.get("discount_pct", Decimal("0")) / 100)
                for line_data in data["lines"]
            )
            if data.get("apply_tva"):
                estimated_total *= (1 + data.get("tva_rate", Decimal("19.00")) / Decimal("100"))

            force = request.query_params.get("force", "").lower() in ("1", "true", "yes")
            from apps.invoicing.services.credit_check import assert_client_can_take_credit
            assert_client_can_take_credit(client, estimated_total, user=request.user, force=force, is_drf=True)

            branch = None
            if data.get("branch_id"):
                from apps.core.models import Branch
                branch = Branch.objects.get(pk=data["branch_id"], tenant=request.tenant)

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
                variant = line_data.get("variant")
                InvoiceLine.objects.create(
                    invoice=invoice,
                    variant=variant,
                    description=line_data["description"],
                    quantity=line_data["quantity"],
                    unit_price=line_data["unit_price"],
                    discount_pct=line_data.get("discount_pct", Decimal("0")),
                    cartons=line_data.get("cartons", 0),
                    order=i,
                    unit_cost=current_unit_cost(variant),
                    unit_cost_estimated=False,
                )

            # Compute totals after lines are created
            invoice.compute_totals()
            invoice.save(update_fields=["total_ht", "tva_amount", "total_ttc"])

            # Confirm if requested — assigns number (FA-2026-00001) + sets to sent
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

            # Confirm if requested
            if data.get("confirm"):
                invoice.confirm(user=request.user, force=force)
            else:
                invoice.update_status()

            # Queue PDF generation after transaction commits
            transaction.on_commit(lambda: run_task(generate_invoice_pdf, invoice.pk))

        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        """Update an invoice as long as no payment is registered."""
        self.require_manager()
        invoice = self.get_object()
        
        if invoice.payments.exists():
            return Response(
                {"detail": "Impossible de modifier une facture ayant déjà un paiement enregistré."},
                status=status.HTTP_400_BAD_REQUEST,
            )
            
        if hasattr(invoice, 'delivery_notes') and invoice.delivery_notes.exists():
            return Response(
                {"detail": "Impossible de modifier la facture car un bon de livraison (BL) a déjà été généré. Veuillez d'abord supprimer le BL pour libérer le stock."},
                status=status.HTTP_400_BAD_REQUEST,
            )
            
        if invoice.status == InvoiceStatusChoices.CANCELLED:
            return Response(
                {"detail": "Impossible de modifier une facture annulée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CreateInvoiceSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from apps.closing.services.lock import assert_period_open
        assert_period_open(request.tenant, invoice.date)
        assert_period_open(request.tenant, data["date"])
        if data.get("payment") and data["payment"].get("date"):
            assert_period_open(request.tenant, data["payment"]["date"])

        with transaction.atomic():
            old_branch_id = str(invoice.branch_id) if invoice.branch_id else None
            new_branch_id = str(data.get("branch_id")) if data.get("branch_id") else None

            # Non-draft invoices have stock deducted — check if we can delta update
            had_stock_deducted = invoice.status != InvoiceStatusChoices.DRAFT
            can_delta_update = had_stock_deducted and (old_branch_id == new_branch_id)

            if had_stock_deducted and not can_delta_update:
                invoice._restore_inventory(ref_prefix="Retour changement dépôt", user=request.user)

            if can_delta_update:
                old_lines_data = list(invoice.lines.all())

            # Update main invoice fields
            invoice.client_id = data.get("client_id")
            invoice.branch_id = data.get("branch_id")
            invoice.date = data["date"]
            invoice.due_date = data["due_date"]
            invoice.series_prefix = data["series_prefix"]
            invoice.apply_tva = data["apply_tva"]
            invoice.tva_rate = data["tva_rate"]
            invoice.is_formal = data.get("is_formal", True)
            invoice.is_paid_in_cash = data.get("is_paid_in_cash", False)
            invoice.notes = data.get("notes", "")
            invoice.save()

            # Recreate lines
            invoice.lines.all().delete()
            new_lines = []
            for i, line_data in enumerate(data["lines"]):
                variant = line_data.get("variant")
                l = InvoiceLine.objects.create(
                    invoice=invoice,
                    variant=variant,
                    description=line_data["description"],
                    quantity=line_data["quantity"],
                    unit_price=line_data["unit_price"],
                    discount_pct=line_data.get("discount_pct", Decimal("0")),
                    cartons=line_data.get("cartons", 0),
                    order=i,
                    unit_cost=current_unit_cost(variant),
                    unit_cost_estimated=False,
                )
                new_lines.append(l)

            # Recompute totals
            invoice.compute_totals()
            invoice.save(update_fields=["total_ht", "tva_amount", "total_ttc"])

            # Record initial payment if provided (only if one doesn't exist yet, or just add it)
            payment_data = data.get("payment")
            if payment_data and payment_data.get("amount"):
                from apps.invoicing.models import InvoicePayment
                InvoicePayment.objects.create(
                    invoice=invoice,
                    amount=payment_data["amount"],
                    method=payment_data["method"],
                    date=payment_data["date"],
                    notes=payment_data.get("notes", ""),
                    recorded_by=request.user,
                )

            # Handle confirm for drafts → assigns number + changes status
            if data.get("confirm") and invoice.status == InvoiceStatusChoices.DRAFT:
                invoice.confirm(user=request.user)
            else:
                invoice.update_status()
                # If invoice is non-draft (was already, or just became), update stock
                if invoice.status != InvoiceStatusChoices.DRAFT:
                    if can_delta_update:
                        invoice._update_inventory_delta(old_lines_data, new_lines, user=request.user)
                    else:
                        invoice._deduct_inventory(lines=new_lines, user=request.user)

            # Re-queue PDF generation after transaction commits
            transaction.on_commit(lambda: run_task(generate_invoice_pdf, invoice.pk))

        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        """Delete an invoice only if user is manager+ and the invoice is still a draft."""
        self.require_manager()
        invoice = self.get_object()
        from apps.closing.services.lock import assert_period_open
        if invoice.date:
            assert_period_open(request.tenant, invoice.date)
        if invoice.status != InvoiceStatusChoices.DRAFT:
            return Response(
                {"detail": "Seule une facture brouillon peut être supprimée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

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
        force = request.query_params.get("force", "").lower() in ("1", "true", "yes")
        from apps.invoicing.services.credit_check import assert_client_can_take_credit
        assert_client_can_take_credit(invoice.client, invoice.total_ttc, user=request.user, force=force, is_drf=True)
        invoice.confirm(user=request.user, force=force)
        transaction.on_commit(lambda: run_task(generate_invoice_pdf, invoice.pk))
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel an invoice if no payments have been made."""
        self.require_manager()
        invoice = self.get_object()

        from apps.closing.services.lock import assert_period_open
        assert_period_open(request.tenant, invoice.date)
        assert_period_open(request.tenant, timezone.localdate())
        
        if invoice.status == InvoiceStatusChoices.CANCELLED:
            return Response(
                {"error": {"code": "already_cancelled", "message": "Invoice is already cancelled."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
            
        if invoice.total_paid > 0:
            return Response(
                {"error": {"code": "has_payments", "message": "Cannot cancel an invoice with payments. Issue a Credit Note instead."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if invoice.delivery_notes.exists():
            return Response(
                {"error": {"code": "has_delivery_notes", "message": "Cannot cancel an invoice with active delivery notes."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reverse client ledger entry if exists
        from apps.clients.models import ClientLedger
        ClientLedger.objects.filter(reference_type="Invoice", reference_id=str(invoice.pk)).delete()

        # Restore inventory if not a draft (draft hasn't deducted stock)
        if invoice.status != InvoiceStatusChoices.DRAFT:
            invoice._restore_inventory(ref_prefix="Annulation", user=request.user)

        invoice.status = InvoiceStatusChoices.CANCELLED
        invoice.save(update_fields=["status"])
        
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """Download or stream the invoice PDF."""
        invoice = self.get_object()
        from apps.core.desktop.pdf_client import is_placeholder_pdf
        if invoice.pdf_file:
            try:
                f = invoice.pdf_file.open("rb")
                header = f.read(512)
                f.seek(0)
                if not is_placeholder_pdf(header):
                    return FileResponse(
                        f,
                        content_type="application/pdf",
                        as_attachment=False,
                        filename=f"invoice-{invoice.number or invoice.pk}.pdf",
                    )
                logger.info("Cached PDF for invoice %s is a placeholder; regenerating.", invoice.pk)
                try:
                    invoice.pdf_file.delete(save=False)
                except Exception:
                    pass
                Invoice.objects.filter(pk=invoice.pk).update(pdf_file=None)
                invoice.pdf_file = None
            except Exception:
                pass

        # Generate synchronously on demand and persist if valid (not placeholder)
        from django.core.files.base import ContentFile
        from .pdf import render_invoice_pdf
        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_invoice_pdf(invoice, language=lang)
        if not is_placeholder_pdf(pdf_bytes):
            filename = f"invoices/pdf/invoice-{invoice.number or invoice.pk}.pdf"
            try:
                invoice.pdf_file.save(filename, ContentFile(pdf_bytes), save=False)
                Invoice.objects.filter(pk=invoice.pk).update(pdf_file=invoice.pdf_file.name)
            except Exception:
                pass
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

        from apps.closing.services.lock import assert_period_open
        assert_period_open(request.tenant, serializer.validated_data["date"])

        payment = serializer.save(invoice=invoice, recorded_by=request.user)
        return Response(InvoicePaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="generate-pdf")
    def generate_pdf_async(self, request, pk=None):
        """Queue PDF regeneration."""
        invoice = self.get_object()
        transaction.on_commit(lambda: run_task(generate_invoice_pdf, invoice.pk))
        return Response({"message": "PDF generation queued."})


class DeliveryNoteViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = DeliveryNote.objects.select_related("invoice__client", "invoice__tenant")
    permission_classes = [IsAuthenticated, PlanRequired("pro_wholesale"), RolePermission]
    role_permissions = {
        "create": MANAGER_OR_OWNER,
        "update": MANAGER_OR_OWNER,
        "partial_update": MANAGER_OR_OWNER,
        "destroy": MANAGER_OR_OWNER,
        "regrouper": MANAGER_OR_OWNER,
        "default": ALL_ROLES,
    }
    serializer_class = DeliveryNoteSerializer
    filterset_fields = ["invoice"]

    def get_queryset(self):
        return DeliveryNote.objects.filter(tenant=self.request.tenant)

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
        transaction.on_commit(lambda: run_task(generate_delivery_note_pdf, dn.pk))

    def perform_update(self, serializer):
        from apps.closing.services.lock import assert_period_open
        instance = self.get_object()
        if instance.date:
            assert_period_open(self.request.tenant, instance.date)
        if serializer.validated_data.get("date"):
            assert_period_open(self.request.tenant, serializer.validated_data.get("date"))
        serializer.save()

    def perform_destroy(self, instance):
        from apps.closing.services.lock import assert_period_open
        if instance.date:
            assert_period_open(self.request.tenant, instance.date)
        instance.delete()

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        dn = self.get_object()
        from apps.core.desktop.pdf_client import is_placeholder_pdf
        if dn.pdf_file:
            try:
                f = dn.pdf_file.open("rb")
                header = f.read(512)
                f.seek(0)
                if not is_placeholder_pdf(header):
                    return FileResponse(f, content_type="application/pdf")
                logger.info("Cached PDF for delivery note %s is a placeholder; regenerating.", dn.pk)
                try:
                    dn.pdf_file.delete(save=False)
                except Exception:
                    pass
                DeliveryNote.objects.filter(pk=dn.pk).update(pdf_file=None)
                dn.pdf_file = None
            except Exception:
                pass
        from django.core.files.base import ContentFile
        from .pdf import render_delivery_note_pdf
        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_delivery_note_pdf(dn, language=lang)
        if not is_placeholder_pdf(pdf_bytes):
            filename = f"delivery_notes/pdf/bl-{dn.number}.pdf"
            try:
                dn.pdf_file.save(filename, ContentFile(pdf_bytes), save=False)
                DeliveryNote.objects.filter(pk=dn.pk).update(pdf_file=dn.pdf_file.name)
            except Exception:
                pass
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="bl-{dn.number}.pdf"'
        return response



    @action(detail=False, methods=["post"])
    def regrouper(self, request):
        self.require_manager()
        from .serializers import RegrouperBLsSerializer
        serializer = RegrouperBLsSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from apps.closing.services.lock import assert_period_open
        assert_period_open(request.tenant, data["date"])

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
            branch = None
            if data.get("branch_id"):
                from apps.core.models import Branch
                branch = Branch.objects.get(pk=data["branch_id"], tenant=request.tenant)
            elif getattr(request.user, "default_branch", None):
                branch = request.user.default_branch
            else:
                from apps.core.models import Branch
                branch = (
                    Branch.objects.filter(tenant=request.tenant, is_headquarters=True).first()
                    or Branch.objects.filter(tenant=request.tenant).first()
                )

            # Check credit limit and blocked client
            estimated_total = sum(
                line.quantity * line.unit_price * (1 - line.discount_pct / 100)
                for bl in bls for line in bl.lines.all()
            )
            if data.get("apply_tva"):
                estimated_total *= (1 + data.get("tva_rate", Decimal("19.00")) / Decimal("100"))

            force = request.query_params.get("force", "").lower() in ("1", "true", "yes")
            from apps.invoicing.services.credit_check import assert_client_can_take_credit
            assert_client_can_take_credit(client, estimated_total, user=request.user, force=force, is_drf=True)

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
                        cartons=line.cartons,
                        order=order,
                        unit_cost=current_unit_cost(line.variant),
                        unit_cost_estimated=False,
                    )
                    order += 1
                    
            invoice.save()
            if data.get("confirm"):
                invoice.confirm(user=request.user)

            transaction.on_commit(lambda: run_task(generate_invoice_pdf, invoice.pk))
                
        from rest_framework.response import Response
        return Response(InvoiceSerializer(invoice).data, status=201)


class CreditNoteViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = CreditNote.objects.select_related("original_invoice__client")
    permission_classes = [IsAuthenticated, PlanRequired("pro_wholesale"), RolePermission]
    role_permissions = {
        "create": MANAGER_OR_OWNER,
        "default": ALL_ROLES,
    }
    serializer_class = CreditNoteSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return CreditNote.objects.filter(tenant=self.request.tenant)

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant)


class QuoteViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Quote.objects.select_related(
        "client", "branch", "converted_invoice", "converted_delivery_note"
    ).prefetch_related("lines__variant__product")
    permission_classes = [IsAuthenticated, PlanRequired("pro_wholesale"), RolePermission]
    role_permissions = {
        "create": MANAGER_OR_OWNER,
        "update": MANAGER_OR_OWNER,
        "partial_update": MANAGER_OR_OWNER,
        "destroy": MANAGER_OR_OWNER,
        "send": MANAGER_OR_OWNER,
        "accept": MANAGER_OR_OWNER,
        "cancel": MANAGER_OR_OWNER,
        "convert_to_invoice": MANAGER_OR_OWNER,
        "convert_to_delivery_note": MANAGER_OR_OWNER,
        "default": ALL_ROLES,
    }
    filterset_fields = ["status", "client", "branch"]
    search_fields = ["number", "client__name"]
    ordering_fields = ["date", "valid_until", "total_ttc", "number", "created_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return QuoteListSerializer
        if self.action in ["create", "update", "partial_update"]:
            return CreateQuoteSerializer
        return QuoteSerializer

    def create(self, request, *args, **kwargs):
        self.require_manager()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            client = None
            if data.get("client_id"):
                from apps.clients.models import Client
                client = Client.objects.get(pk=data["client_id"], tenant=request.tenant)

            branch = None
            if data.get("branch_id"):
                from apps.core.models import Branch
                branch = Branch.objects.get(pk=data["branch_id"], tenant=request.tenant)

            quote = Quote.objects.create(
                tenant=request.tenant,
                client=client,
                branch=branch,
                date=data["date"],
                valid_until=data.get("valid_until"),
                apply_tva=data.get("apply_tva", True),
                tva_rate=data.get("tva_rate", Decimal("19.00")),
                notes=data.get("notes", ""),
                created_by=request.user,
                status=QuoteStatusChoices.DRAFT,
            )

            for i, line_data in enumerate(data["lines"]):
                variant = line_data.get("variant")
                QuoteLine.objects.create(
                    quote=quote,
                    variant=variant,
                    description=line_data.get("description", ""),
                    quantity=line_data["quantity"],
                    unit_price=line_data["unit_price"],
                    discount_pct=line_data.get("discount_pct", Decimal("0")),
                    cartons=line_data.get("cartons", 0),
                    order=i,
                    unit_cost=current_unit_cost(variant),
                    unit_cost_estimated=False,
                )

            quote.compute_totals()
            quote.save(update_fields=["total_ht", "tva_amount", "total_ttc"])
            transaction.on_commit(lambda: run_task(generate_quote_pdf, quote.pk))

        return Response(QuoteSerializer(quote).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        self.require_manager()
        quote = self.get_object()
        if quote.status in [QuoteStatusChoices.CONVERTED, QuoteStatusChoices.CANCELLED]:
            return Response(
                {"error": {"code": "invalid_state", "message": "Cannot modify converted or cancelled quote."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = CreateQuoteSerializer(data=request.data, partial=kwargs.get("partial", False), context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            if "client_id" in data:
                from apps.clients.models import Client
                quote.client = Client.objects.get(pk=data["client_id"], tenant=request.tenant) if data.get("client_id") else None
            if "branch_id" in data:
                from apps.core.models import Branch
                quote.branch = Branch.objects.get(pk=data["branch_id"], tenant=request.tenant) if data.get("branch_id") else None
            if "date" in data:
                quote.date = data["date"]
            if "valid_until" in data:
                quote.valid_until = data["valid_until"]
            if "apply_tva" in data:
                quote.apply_tva = data["apply_tva"]
            if "tva_rate" in data:
                quote.tva_rate = data["tva_rate"]
            if "notes" in data:
                quote.notes = data["notes"]

            if "lines" in data:
                quote.lines.all().delete()
                for i, line_data in enumerate(data["lines"]):
                    variant = line_data.get("variant")
                    QuoteLine.objects.create(
                        quote=quote,
                        variant=variant,
                        description=line_data.get("description", ""),
                        quantity=line_data["quantity"],
                        unit_price=line_data["unit_price"],
                        discount_pct=line_data.get("discount_pct", Decimal("0")),
                        cartons=line_data.get("cartons", 0),
                        order=i,
                        unit_cost=current_unit_cost(variant),
                        unit_cost_estimated=False,
                    )

            quote.compute_totals()
            quote.save()
            transaction.on_commit(lambda: run_task(generate_quote_pdf, quote.pk))

        return Response(QuoteSerializer(quote).data)

    def destroy(self, request, *args, **kwargs):
        self.require_manager()
        quote = self.get_object()
        if quote.status == QuoteStatusChoices.CONVERTED:
            return Response(
                {"error": {"code": "invalid_state", "message": "Cannot delete a converted quote."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        self.require_manager()
        quote = self.get_object()
        quote.send(user=request.user)
        return Response(QuoteSerializer(quote).data)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        self.require_manager()
        quote = self.get_object()
        quote.accept(user=request.user)
        return Response(QuoteSerializer(quote).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        self.require_manager()
        quote = self.get_object()
        try:
            quote.cancel(user=request.user)
        except Exception as e:
            return Response(
                {"error": {"code": "invalid_action", "message": str(e)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(QuoteSerializer(quote).data)

    @action(detail=True, methods=["post"], url_path="convert-to-invoice")
    def convert_to_invoice(self, request, pk=None):
        self.require_manager()
        quote = self.get_object()
        force = request.query_params.get("force", "").lower() in ("1", "true", "yes")
        from apps.invoicing.services.credit_check import assert_client_can_take_credit
        assert_client_can_take_credit(quote.client, quote.total_ttc, user=request.user, force=force, is_drf=True)
        try:
            invoice = quote.convert_to_invoice(user=request.user, force=force)
        except Exception as e:
            return Response(
                {"error": {"code": "conversion_failed", "message": str(e)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transaction.on_commit(lambda: run_task(generate_invoice_pdf, invoice.pk))
        return Response({
            "quote": QuoteSerializer(quote).data,
            "invoice_id": invoice.id,
            "invoice_number": invoice.number,
        })

    @action(detail=True, methods=["post"], url_path="convert-to-delivery-note")
    def convert_to_delivery_note(self, request, pk=None):
        self.require_manager()
        quote = self.get_object()
        force = request.query_params.get("force", "").lower() in ("1", "true", "yes")
        from apps.invoicing.services.credit_check import assert_client_can_take_credit
        assert_client_can_take_credit(quote.client, quote.total_ttc, user=request.user, force=force, is_drf=True)
        try:
            dn = quote.convert_to_delivery_note(user=request.user, force=force)
        except Exception as e:
            return Response(
                {"error": {"code": "conversion_failed", "message": str(e)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transaction.on_commit(lambda: run_task(generate_delivery_note_pdf, dn.pk))
        return Response({
            "quote": QuoteSerializer(quote).data,
            "delivery_note_id": dn.id,
            "delivery_note_number": dn.number,
        })

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        quote = self.get_object()
        from apps.core.desktop.pdf_client import is_placeholder_pdf

        if request.query_params.get("regenerate") == "1":
            try:
                if quote.pdf_file:
                    quote.pdf_file.delete(save=False)
                Quote.objects.filter(pk=quote.pk).update(pdf_file=None)
                quote.pdf_file = None
            except Exception:
                pass

        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_quote_pdf(quote, language=lang)
        if not is_placeholder_pdf(pdf_bytes):
            filename = f"quotes/pdf/quote-{quote.number or quote.pk}.pdf"
            try:
                from django.core.files.base import ContentFile
                quote.pdf_file.save(filename, ContentFile(pdf_bytes), save=False)
                Quote.objects.filter(pk=quote.pk).update(pdf_file=quote.pdf_file.name)
            except Exception:
                pass
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="quote-{quote.number or quote.pk}.pdf"'
        )
        return response



