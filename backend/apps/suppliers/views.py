from decimal import Decimal
from django.db import transaction
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from .models import POLine, PurchaseOrder, POStatusChoices, Supplier, SupplierInvoice, SupplierPayment
from .serializers import (
    CreatePurchaseOrderSerializer,
    PurchaseOrderListSerializer,
    PurchaseOrderSerializer,
    ReceiveLinesSerializer,
    SupplierInvoiceSerializer,
    SupplierPaymentSerializer,
    SupplierSerializer,
)


class SupplierViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    search_fields = ["name", "contact_name"]
    filterset_fields = ["is_active"]
    ordering = ["name"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)


class PurchaseOrderViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = PurchaseOrder.objects.select_related("supplier").prefetch_related("lines")
    filterset_fields = ["status", "supplier"]
    search_fields = ["supplier__name", "reference"]

    def get_serializer_class(self):
        if self.action == "list":
            return PurchaseOrderListSerializer
        if self.action == "create":
            return CreatePurchaseOrderSerializer
        return PurchaseOrderSerializer

    def create(self, request, *args, **kwargs):
        self.require_manager()

        input_ser = CreatePurchaseOrderSerializer(data=request.data)
        input_ser.is_valid(raise_exception=True)
        data = input_ser.validated_data

        # Resolve supplier FK (must belong to this tenant)
        try:
            supplier = Supplier.objects.get(pk=data["supplier"], tenant=request.tenant)
        except Supplier.DoesNotExist:
            return Response({"supplier": "Fournisseur introuvable."}, status=status.HTTP_400_BAD_REQUEST)

        if not data.get("lines"):
            return Response({"lines": "Au moins une ligne est requise."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            po = PurchaseOrder.objects.create(
                tenant=request.tenant,
                supplier=supplier,
                reference=data.get("reference", ""),
                expected_date=data.get("expected_date"),
                notes=data.get("notes", ""),
                status=POStatusChoices.DRAFT,
                created_by=request.user,
            )
            total = Decimal("0.00")
            for line_data in data["lines"]:
                line = POLine(
                    order=po,
                    description=line_data["description"],
                    quantity_ordered=line_data["quantity_ordered"],
                    agreed_unit_price=line_data["agreed_unit_price"],
                )
                if line_data.get("variant"):
                    line.variant_id = line_data["variant"]
                line.save()
                total += line_data["agreed_unit_price"] * line_data["quantity_ordered"]
            po.total_amount = total
            po.save()

        po.refresh_from_db()
        out_ser = PurchaseOrderSerializer(po)
        return Response(out_ser.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="receive")
    def receive(self, request, pk=None):
        """
        Mark PO lines as received.
        POST /suppliers/purchase-orders/{id}/receive/
        Body: { "lines": [{"id": <line_id>, "quantity_received": <int>}, ...] }
        Auto-recalculates PO status after update.
        """
        po = self.get_object()
        if po.status == POStatusChoices.CANCELLED:
            return Response(
                {"detail": "Impossible de réceptionner une commande annulée."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        input_ser = ReceiveLinesSerializer(data=request.data)
        input_ser.is_valid(raise_exception=True)
        lines_data = input_ser.validated_data["lines"]

        line_ids = [ld["id"] for ld in lines_data]
        lines_map = {ln.id: ln for ln in POLine.objects.filter(order=po, id__in=line_ids)}

        with transaction.atomic():
            for ld in lines_data:
                line = lines_map.get(ld["id"])
                if line:
                    line.quantity_received = ld["quantity_received"]
                    line.save()

            # Re-fetch all lines to compute new status
            all_lines = list(POLine.objects.filter(order=po))
            if all_lines:
                fully_received = all(ln.quantity_received >= ln.quantity_ordered for ln in all_lines)
                partially_received = any(ln.quantity_received > 0 for ln in all_lines)
                if fully_received:
                    po.status = POStatusChoices.RECEIVED
                elif partially_received:
                    po.status = POStatusChoices.PARTIAL
                # draft/sent → unchanged if nothing received yet
            po.save()

        po.refresh_from_db()
        out_ser = PurchaseOrderSerializer(po)
        return Response(out_ser.data)

    @action(detail=True, methods=["patch"], url_path="update-status")
    def update_status(self, request, pk=None):
        """
        Manually update PO status (e.g. draft → sent, partial → cancelled).
        PATCH /suppliers/purchase-orders/{id}/update-status/
        Body: { "status": "sent" }
        """
        po = self.get_object()
        new_status = request.data.get("status")
        valid_statuses = [c[0] for c in POStatusChoices.choices]
        if new_status not in valid_statuses:
            return Response(
                {"status": f"Statut invalide. Valeurs acceptées : {valid_statuses}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        po.status = new_status
        po.save()
        out_ser = PurchaseOrderSerializer(po)
        return Response(out_ser.data)


class SupplierInvoiceViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierInvoice.objects.select_related("supplier").all()
    serializer_class = SupplierInvoiceSerializer
    filterset_fields = ["supplier"]

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant)


class SupplierPaymentViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierPayment.objects.select_related("supplier").all()
    serializer_class = SupplierPaymentSerializer
    filterset_fields = ["supplier"]

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant, recorded_by=self.request.user)
