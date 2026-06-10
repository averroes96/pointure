"""Supplier management API views."""
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from .models import POLine, POStatusChoices, PurchaseOrder, Supplier, SupplierInvoice, SupplierPayment
from .serializers import (
    CreatePurchaseOrderSerializer,
    POLineInputSerializer,
    PurchaseOrderListSerializer,
    PurchaseOrderSerializer,
    ReceiveLinesSerializer,
    SupplierInvoiceSerializer,
    SupplierPaymentSerializer,
    SupplierSerializer,
)


def _resolve_product(tenant, nv: dict):
    """
    Find or create a Product from a new_variant payload.
    If nv["product_id"] is set, returns the existing product directly.
    Otherwise, searches by name+brand or creates a new one.
    """
    from apps.inventory.models import Product

    product_id = nv.get("product_id")
    if product_id:
        return Product.objects.filter(tenant=tenant, id=product_id).first()

    return (
        Product.objects.filter(
            tenant=tenant,
            name__iexact=nv.get("product_name", ""),
            brand__iexact=nv.get("brand", ""),
        ).first()
        or Product.objects.create(
            tenant=tenant,
            name=nv.get("product_name", ""),
            brand=nv.get("brand", ""),
            category=nv.get("category", "other"),
            purchase_price=nv.get("purchase_price", 0),
            sale_price=nv.get("sale_price", 0),
            is_active=True,
        )
    )


def _resolve_variant(tenant, product, size_eu: int, colour: str):
    """Find an existing variant or create it."""
    from apps.inventory.models import Variant

    return (
        Variant.objects.filter(product=product, size_eu=size_eu, colour=colour).first()
        or Variant.objects.create(
            product=product,
            tenant=tenant,
            size_eu=size_eu,
            colour=colour,
            is_active=True,
        )
    )


class SupplierViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    search_fields = ["name", "contact_name", "phone", "email", "origin_country"]
    ordering_fields = ["name", "outstanding_balance", "created_at"]
    ordering = ["name"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        from decimal import Decimal
        supplier = self.get_object()
        self.require_manager()

        amount = Decimal(str(request.data.get("amount", 0)))
        method = request.data.get("method", "cash")

        payment = SupplierPayment.objects.create(
            tenant=request.tenant,
            supplier=supplier,
            amount=amount,
            method=method,
            cheque_number=request.data.get("cheque_number", ""),
            bank=request.data.get("bank", ""),
            date=request.data.get("date"),
            notes=request.data.get("notes", ""),
            recorded_by=request.user,
        )
        return Response(SupplierPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class PurchaseOrderViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = PurchaseOrder.objects.select_related("supplier").prefetch_related("lines__variant__product")
    serializer_class = PurchaseOrderSerializer
    filterset_fields = ["status", "supplier"]
    search_fields = ["reference", "supplier__name"]
    ordering_fields = ["created_at", "expected_date", "total_amount"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return PurchaseOrderListSerializer
        return PurchaseOrderSerializer

    def create(self, request, *args, **kwargs):
        input_ser = CreatePurchaseOrderSerializer(data=request.data)
        input_ser.is_valid(raise_exception=True)
        data = input_ser.validated_data

        supplier = Supplier.objects.filter(tenant=request.tenant, id=data["supplier"]).first()
        if not supplier:
            return Response({"detail": "Fournisseur introuvable."}, status=status.HTTP_404_NOT_FOUND)

        from decimal import Decimal
        with transaction.atomic():
            po = PurchaseOrder.objects.create(
                tenant=request.tenant,
                supplier=supplier,
                reference=data.get("reference", ""),
                expected_date=data.get("expected_date"),
                notes=data.get("notes", ""),
                created_by=request.user,
                status=POStatusChoices.DRAFT,
            )
            total = Decimal("0")
            for line_data in data["lines"]:
                variant_id = line_data.get("variant")
                variant = None
                if variant_id:
                    from apps.inventory.models import Variant
                    variant = Variant.objects.filter(tenant=request.tenant, id=variant_id).first()

                line = POLine.objects.create(
                    order=po,
                    variant=variant,
                    description=line_data["description"],
                    quantity_ordered=line_data["quantity_ordered"],
                    agreed_unit_price=line_data["agreed_unit_price"],
                )
                total += line.agreed_unit_price * line.quantity_ordered

            po.total_amount = total
            po.save(update_fields=["total_amount"])

        out_ser = PurchaseOrderSerializer(po)
        return Response(out_ser.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="receive")
    def receive(self, request, pk=None):
        """
        Mark PO lines as received and automatically create StockMovement records.

        POST /suppliers/purchase-orders/{id}/receive/
        Body: {
            "lines": [
                {
                    "id": <line_id>,
                    "quantity_received": <int>,
                    "variant_id": <int|null>,          // link to existing variant
                    "new_variant": {                   // create variant on the fly
                        "product_id": <int|null>,      // link to existing product (takes priority)
                        "product_name": "...",
                        "brand": "...",
                        "category": "...",
                        "size_eu": <int>,
                        "colour": "...",
                        "purchase_price": "...",
                        "sale_price": "..."
                    },
                    "carton_sizes": [                  // carton mode: per-size expansion
                        { "size_eu": 36, "quantity": 9, "variant_id": null, "new_variant": {...} },
                        ...
                    ]
                },
                ...
            ],
            "bl_reference": "BL-2026-001",   // optional supplier delivery note ref
            "branch": <branch_id>            // optional; defaults to HQ
        }
        """
        from apps.inventory.models import StockMovement, MovementReasonChoices, Variant, Product
        from apps.core.models import Branch

        po = self.get_object()
        if po.status == POStatusChoices.CANCELLED:
            return Response(
                {"detail": "Impossible de réceptionner une commande annulée."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        input_ser = ReceiveLinesSerializer(data=request.data)
        input_ser.is_valid(raise_exception=True)
        lines_data = input_ser.validated_data["lines"]
        bl_reference = input_ser.validated_data.get("bl_reference", "")
        branch_id = input_ser.validated_data.get("branch")

        # Resolve branch: explicit > HQ > first active
        target_branch = None
        if branch_id:
            target_branch = Branch.objects.filter(tenant=request.tenant, id=branch_id).first()
        if not target_branch:
            target_branch = (
                Branch.objects.filter(tenant=request.tenant, is_headquarters=True, is_active=True).first()
                or Branch.objects.filter(tenant=request.tenant, is_active=True).first()
            )

        line_ids = [ld["id"] for ld in lines_data]
        lines_map = {
            ln.id: ln
            for ln in POLine.objects.filter(order=po, id__in=line_ids).select_related("variant__product")
        }

        movements_created = 0
        discrepancies = []
        created_variants = []

        with transaction.atomic():
            for ld in lines_data:
                line = lines_map.get(ld["id"])
                if not line:
                    continue

                po_ref = bl_reference or po.reference or f"PO-{po.id}"
                notes_base = (
                    f"Réception {po_ref} | {po.supplier.name}"
                    + (f" | BL: {bl_reference}" if bl_reference else "")
                )

                carton_sizes = ld.get("carton_sizes") or []

                if carton_sizes:
                    # ── Carton mode: one StockMovement per size ──────────────
                    total_received = 0
                    for cs in carton_sizes:
                        cs_qty = cs.get("quantity", 0)
                        if cs_qty <= 0:
                            continue
                        total_received += cs_qty

                    # Guard: cumulative received must not exceed ordered
                    if line.quantity_received + total_received > line.quantity_ordered:
                        return Response(
                            {
                                "detail": (
                                    f"Ligne {line.id}: la quantité reçue cumulée "
                                    f"({line.quantity_received + total_received}) dépasse "
                                    f"la quantité commandée ({line.quantity_ordered})."
                                )
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    for cs in carton_sizes:
                        cs_qty = cs.get("quantity", 0)
                        if cs_qty <= 0:
                            continue

                        cs_variant = None
                        if cs.get("variant_id"):
                            cs_variant = Variant.objects.filter(
                                tenant=request.tenant, id=cs["variant_id"]
                            ).first()
                        elif cs.get("new_variant"):
                            nv = cs["new_variant"]
                            product = _resolve_product(request.tenant, nv)
                            if product:
                                cs_variant = _resolve_variant(
                                    request.tenant, product, cs["size_eu"], nv.get("colour", "")
                                )
                                created_variants.append({
                                    "line_id": line.id,
                                    "size_eu": cs["size_eu"],
                                    "variant_id": cs_variant.id,
                                    "label": str(cs_variant),
                                })

                        if cs_variant:
                            StockMovement.objects.create(
                                tenant=request.tenant,
                                variant=cs_variant,
                                branch=target_branch,
                                quantity_delta=cs_qty,
                                reason=MovementReasonChoices.RECEPTION,
                                reference_id=str(po.id),
                                reference_type="PurchaseOrder",
                                bl_reference=bl_reference,
                                notes=f"{notes_base} | EU{cs['size_eu']}",
                                user=request.user,
                            )
                            movements_created += 1

                    # Accumulate (not replace) so second partial receives are tracked correctly
                    line.quantity_received += total_received
                    line.save(update_fields=["quantity_received"])

                else:
                    # ── Standard mode: single variant per line ───────────────
                    variant_id_from_request = ld.get("variant_id")
                    new_variant_data = ld.get("new_variant")

                    if not line.variant_id and variant_id_from_request:
                        linked = Variant.objects.filter(
                            tenant=request.tenant, id=variant_id_from_request
                        ).first()
                        if linked:
                            line.variant = linked
                            line.save(update_fields=["variant"])

                    elif not line.variant_id and new_variant_data:
                        product = _resolve_product(request.tenant, new_variant_data)
                        if product:
                            variant = _resolve_variant(
                                request.tenant,
                                product,
                                new_variant_data["size_eu"],
                                new_variant_data.get("colour", ""),
                            )
                            line.variant = variant
                            line.save(update_fields=["variant"])
                            created_variants.append({
                                "line_id": line.id,
                                "variant_id": variant.id,
                                "label": str(variant),
                            })

                    line.refresh_from_db(fields=["variant"])

                    new_qty = ld["quantity_received"]
                    if new_qty > line.quantity_ordered:
                        return Response(
                            {
                                "detail": (
                                    f"Ligne {line.id}: la quantité reçue ({new_qty}) "
                                    f"dépasse la quantité commandée ({line.quantity_ordered})."
                                )
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    delta = new_qty - line.quantity_received
                    line.quantity_received = new_qty
                    line.save(update_fields=["quantity_received"])

                    if delta > 0 and line.variant_id:
                        StockMovement.objects.create(
                            tenant=request.tenant,
                            variant_id=line.variant_id,
                            branch=target_branch,
                            quantity_delta=delta,
                            reason=MovementReasonChoices.RECEPTION,
                            reference_id=str(po.id),
                            reference_type="PurchaseOrder",
                            bl_reference=bl_reference,
                            notes=notes_base,
                            user=request.user,
                        )
                        movements_created += 1

            # Re-compute PO status from all lines
            all_lines = list(POLine.objects.filter(order=po))
            if all_lines:
                if all(ln.quantity_received >= ln.quantity_ordered for ln in all_lines):
                    po.status = POStatusChoices.RECEIVED
                elif any(ln.quantity_received > 0 for ln in all_lines):
                    po.status = POStatusChoices.PARTIAL
            po.save()

            # Discrepancies
            for ln in all_lines:
                if ln.quantity_received < ln.quantity_ordered:
                    discrepancies.append({
                        "line_id": ln.id,
                        "description": ln.description,
                        "ordered": ln.quantity_ordered,
                        "received": ln.quantity_received,
                        "shortage": ln.quantity_ordered - ln.quantity_received,
                    })

        po.refresh_from_db()
        return Response({
            **PurchaseOrderSerializer(po).data,
            "movements_created": movements_created,
            "created_variants": created_variants,
            "discrepancies": discrepancies,
        })

    @action(detail=True, methods=["patch"], url_path="update-status")
    def update_status(self, request, pk=None):
        """
        Manually update PO status (e.g. draft → sent, partial → cancelled).
        PATCH /suppliers/purchase-orders/{id}/update-status/
        Body: { "status": "sent" }
        """
        po = self.get_object()
        new_status = request.data.get("status")
        allowed = {
            POStatusChoices.DRAFT: [POStatusChoices.SENT, POStatusChoices.CANCELLED],
            POStatusChoices.SENT: [POStatusChoices.DRAFT, POStatusChoices.CANCELLED],
            POStatusChoices.PARTIAL: [POStatusChoices.CANCELLED],
        }
        if new_status not in allowed.get(po.status, []):
            return Response(
                {"detail": f"Transition {po.status} → {new_status} non autorisée."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        po.status = new_status
        po.save(update_fields=["status"])
        return Response(PurchaseOrderSerializer(po).data)


class SupplierInvoiceViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierInvoice.objects.select_related("supplier", "purchase_order")
    serializer_class = SupplierInvoiceSerializer
    filterset_fields = ["supplier", "purchase_order"]
    ordering_fields = ["date", "due_date", "total_amount"]
    ordering = ["-date"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)


class SupplierPaymentViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierPayment.objects.select_related("supplier", "supplier_invoice")
    serializer_class = SupplierPaymentSerializer
    filterset_fields = ["supplier", "supplier_invoice", "method"]
    ordering_fields = ["date", "amount"]
    ordering = ["-date"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant, recorded_by=self.request.user)
