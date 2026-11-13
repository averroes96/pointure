"""Supplier management API views."""
import hashlib
import json

from django.core.cache import cache
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.http import HttpResponse
from django.utils.translation import gettext_lazy as _
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import IsManagerOrOwner
from .models import (
    ClaimStatusChoices,
    ImportSizeModeChoices,
    POLine,
    POStatusChoices,
    PurchaseOrder,
    Supplier,
    SupplierImportTemplate,
    SupplierInvoice,
    SupplierPayment,
    SupplierReturnClaim,
)
from .serializers import (
    CreatePurchaseOrderSerializer,
    POImportConfirmRequestSerializer,
    POLineInputSerializer,
    PurchaseOrderListSerializer,
    PurchaseOrderSerializer,
    ReceiveLinesSerializer,
    SupplierImportTemplateSerializer,
    SupplierInvoiceSerializer,
    SupplierPaymentSerializer,
    SupplierReturnClaimSerializer,
    SupplierSerializer,
)
from .services import (
    auto_map_headers,
    detect_encoding_and_decode,
    detect_header_row_and_headers,
    execute_po_import,
    expand_imported_order_lines,
    parse_integer_value,
    parse_supplier_order_file,
    reconcile_with_catalog,
    scan_purchase_order_image,
)


class DuplicatePOImportError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = _("Une confirmation identique a été reçue récemment. Réessayez dans 10 secondes.")
    default_code = "duplicate_po_import"


def _resolve_product(tenant, nv: dict, branch=None):
    """
    Find or create a Product from a new_variant payload.
    If nv["product_id"] is set, returns the existing product directly.
    Otherwise, searches by name+brand or creates a new one.
    Also persists size_range on the product and upserts ProductLocation if branch is provided.
    """
    from decimal import Decimal
    from apps.inventory.models import Product

    product_id = nv.get("product_id")
    product = None
    if product_id:
        product = Product.objects.filter(tenant=tenant, id=product_id).first()

    if not product:
        ref = (nv.get("reference") or "").strip()
        name = (nv.get("product_name") or "").strip()
        brand = (nv.get("brand") or "").strip()
        if ref:
            product = Product.objects.filter(tenant=tenant, reference__iexact=ref).first()
        if not product and name:
            product = Product.objects.filter(
                tenant=tenant,
                name__iexact=name,
                brand__iexact=brand,
            ).first()

    if product:
        update_fields = []
        sale_price = nv.get("sale_price")
        if sale_price and Decimal(str(sale_price)) > Decimal("0") and product.sale_price != Decimal(str(sale_price)):
            product.sale_price = Decimal(str(sale_price))
            update_fields.append("sale_price")
        ppc = nv.get("pairs_per_carton")
        if ppc and int(ppc) > 0 and product.pairs_per_carton != int(ppc):
            if not product.carton_breakdown:
                product.pairs_per_carton = int(ppc)
                update_fields.append("pairs_per_carton")
        ref = (nv.get("reference") or "").strip()
        if ref and not product.reference:
            product.reference = ref
            update_fields.append("reference")
        size_range = (nv.get("size_range") or "").strip()
        if size_range and product.size_range != size_range:
            product.size_range = size_range
            update_fields.append("size_range")
        if update_fields:
            product.save(update_fields=update_fields)
    else:
        product = Product.objects.create(
            tenant=tenant,
            name=nv.get("product_name", "") or nv.get("reference", "Article"),
            reference=(nv.get("reference") or "").strip(),
            brand=nv.get("brand", ""),
            category=nv.get("category", "other"),
            purchase_price=nv.get("purchase_price", 0),
            sale_price=nv.get("sale_price", 0),
            pairs_per_carton=nv.get("pairs_per_carton", 10),
            size_range=(nv.get("size_range") or "").strip(),
            is_active=True,
        )

    # Persist / update ProductLocation if location is provided and tenant has non-free plan
    location = (nv.get("location") or "").strip()
    if location and branch and getattr(tenant, "plan", "free") != "free":
        from apps.inventory.models import ProductLocation
        ProductLocation.objects.update_or_create(
            tenant=tenant,
            branch=branch,
            product=product,
            defaults={"location": location},
        )

    return product


def _resolve_variant(tenant, product, size_eu: int, colour: str):
    """Find an existing variant or create it."""
    from apps.inventory.models import Variant

    if not size_eu or int(size_eu) <= 0:
        size_eu = 0
        colour_clean = (colour or "").strip()
        if not colour_clean or colour_clean in ("N/A", "Standard"):
            colour_clean = "Standard"
            existing = (
                Variant.objects.filter(product=product, size_eu=0).first()
                or Variant.objects.filter(product=product, is_active=True).first()
            )
            if existing:
                return existing
        colour = colour_clean

    return (
        Variant.objects.filter(product=product, size_eu=size_eu, colour=colour).first()
        or Variant.objects.create(
            product=product,
            tenant=tenant,
            size_eu=size_eu,
            colour=colour or "Standard",
            is_active=True,
        )
    )


class SupplierViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    search_fields = ["name", "contact_name", "phone", "email", "origin_country"]
    ordering_fields = ["name", "outstanding_balance", "created_at"]
    ordering = ["name"]

    @action(detail=False, methods=["post"], url_path="import")
    def import_suppliers(self, request):
        """
        POST /suppliers/import/
        Body: multipart/form-data with field 'file' (CSV or XLSX).
        Query: ?dry_run=true to validate without saving.
        """
        from apps.core.services.importer import DataImportEngine, auto_map_columns, parse_file_data

        self.require_manager()
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Champ 'file' manquant."}, status=status.HTTP_400_BAD_REQUEST)

        dry_run = request.query_params.get("dry_run", "").lower() in ("1", "true", "yes")
        duplicate_mode = request.query_params.get("duplicate_mode", "skip")

        raw_bytes = file_obj.read()
        headers, rows, parse_error = parse_file_data(raw_bytes, file_obj.name)
        if parse_error:
            return Response({"detail": str(parse_error)}, status=status.HTTP_400_BAD_REQUEST)
        if not rows:
            return Response({"detail": "Le fichier est vide."}, status=status.HTTP_400_BAD_REQUEST)

        mapping = auto_map_columns(headers, "suppliers")
        engine = DataImportEngine(
            tenant=request.tenant,
            entity_type="suppliers",
            user=request.user,
            duplicate_mode=duplicate_mode,
        )

        if dry_run:
            preview = engine.validate_and_preview(headers, rows, mapping)
            return Response(preview)

        result = engine.execute_import(rows, mapping)
        return Response(result)

    @action(detail=False, methods=["get"], url_path="payables-ageing")
    def payables_ageing(self, request):
        """
        GET /suppliers/payables-ageing/
        Per-supplier breakdown of outstanding payables into ageing buckets:
        current (not yet due), 1-30j, 31-60j, 61-90j, 90j+ overdue.
        """
        from decimal import Decimal
        from django.db.models import DecimalField, OuterRef, Subquery, Sum
        from django.db.models.functions import Coalesce
        from django.utils import timezone

        self.require_manager()
        tenant = request.tenant
        today = timezone.now().date()

        # Annotate every invoice with its total paid amount in one query
        payments_subq = (
            SupplierPayment.objects
            .filter(supplier_invoice=OuterRef("pk"))
            .values("supplier_invoice")
            .annotate(paid=Sum("amount"))
            .values("paid")
        )
        invoices = (
            SupplierInvoice.objects
            .filter(tenant=tenant)
            .select_related("supplier")
            .annotate(amount_paid=Coalesce(
                Subquery(payments_subq, output_field=DecimalField(max_digits=12, decimal_places=2)),
                Decimal("0"),
            ))
        )

        supplier_rows: dict = {}
        for inv in invoices:
            remaining = inv.total_amount - inv.amount_paid
            if remaining <= Decimal("0"):
                continue

            days = (today - inv.due_date).days
            if days <= 0:
                bucket = "current"
            elif days <= 30:
                bucket = "days_30"
            elif days <= 60:
                bucket = "days_60"
            elif days <= 90:
                bucket = "days_90"
            else:
                bucket = "days_90_plus"

            sid = inv.supplier_id
            if sid not in supplier_rows:
                supplier_rows[sid] = {
                    "supplier_id": sid,
                    "supplier_name": inv.supplier.name,
                    "phone": inv.supplier.phone or "",
                    "email": inv.supplier.email or "",
                    "current": Decimal("0"),
                    "days_30": Decimal("0"),
                    "days_60": Decimal("0"),
                    "days_90": Decimal("0"),
                    "days_90_plus": Decimal("0"),
                    "total": Decimal("0"),
                }
            supplier_rows[sid][bucket] += remaining
            supplier_rows[sid]["total"] += remaining

        result = sorted(supplier_rows.values(), key=lambda r: r["supplier_name"])
        return Response(result)

    @action(detail=False, methods=["get"], url_path="payables-ageing-csv")
    def payables_ageing_csv(self, request):
        """GET /suppliers/payables-ageing-csv/ — CSV download of payables ageing."""
        import csv
        import io
        from django.utils import timezone

        self.require_manager()
        # Reuse the ageing logic via self
        resp = self.payables_ageing(request)
        rows = resp.data

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Fournisseur", "Téléphone", "Courant (0j)",
            "1-30j", "31-60j", "61-90j", "+90j", "Total",
        ])
        for row in rows:
            writer.writerow([
                row["supplier_name"], row["phone"],
                row["current"], row["days_30"], row["days_60"],
                row["days_90"], row["days_90_plus"], row["total"],
            ])

        today = timezone.now().date().isoformat()
        response = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="payables-ageing-{today}.csv"'
        return response

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



def _reception_unit_cost(line, po):
    from apps.suppliers.services.landed_cost import reception_unit_cost
    return reception_unit_cost(line, po)


def _process_receive_lines(po, lines_data, bl_reference, branch_id, tenant, user):
    from decimal import Decimal
    from apps.inventory.models import StockMovement, MovementReasonChoices, Variant, Product
    from apps.core.models import Branch

    # Resolve branch: explicit > HQ > first active
    target_branch = None
    if branch_id:
        target_branch = Branch.objects.filter(tenant=tenant, id=branch_id).first()
    if not target_branch:
        target_branch = (
            Branch.objects.filter(tenant=tenant, is_headquarters=True, is_active=True).first()
            or Branch.objects.filter(tenant=tenant, is_active=True).first()
        )

    line_ids = [ld["id"] for ld in lines_data]
    lines_map = {
        ln.id: ln
        for ln in POLine.objects.filter(order=po, id__in=line_ids).select_related("variant__product")
    }

    movements_created = 0
    discrepancies = []
    created_variants = []
    product_reception_totals = {}

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
                    raise ValueError(
                        f"Ligne {line.id}: la quantité reçue cumulée "
                        f"({line.quantity_received + total_received}) dépasse "
                        f"la quantité commandée ({line.quantity_ordered})."
                    )

                for cs in carton_sizes:
                    cs_qty = cs.get("quantity", 0)
                    if cs_qty <= 0:
                        continue

                    cs_variant = None
                    if cs.get("variant_id"):
                        cs_variant = Variant.objects.filter(
                            tenant=tenant, id=cs["variant_id"]
                        ).first()
                    elif cs.get("new_variant"):
                        nv = cs["new_variant"]
                        product = _resolve_product(tenant, nv, branch=target_branch)
                        if product:
                            cs_variant = _resolve_variant(
                                tenant, product, cs["size_eu"], nv.get("colour", "")
                            )
                            created_variants.append({
                                "line_id": line.id,
                                "size_eu": cs["size_eu"],
                                "variant_id": cs_variant.id,
                                "label": str(cs_variant),
                            })

                    if cs_variant:
                        if cs_qty > 0:
                            StockMovement.objects.create(
                                tenant=tenant,
                                variant=cs_variant,
                                branch=target_branch,
                                quantity_delta=cs_qty,
                                reason=MovementReasonChoices.RECEPTION,
                                reference_id=bl_reference or po.reference or f"PO-{str(po.id)[:8]}",
                                reference_type="PurchaseOrder",
                                bl_reference=bl_reference,
                                notes=f"{notes_base} | EU{cs['size_eu']}" if cs.get("size_eu", 0) > 0 else notes_base,
                                user=user,
                            )
                            movements_created += 1
                            
                            pid = cs_variant.product_id
                            if pid not in product_reception_totals:
                                from decimal import Decimal
                                product_reception_totals[pid] = {"qty": 0, "value": Decimal("0")}
                            product_reception_totals[pid]["qty"] += cs_qty
                            product_reception_totals[pid]["value"] += cs_qty * _reception_unit_cost(line, po)

                        # Check if any pairs arrived defective
                        defect_qty = cs.get("defect_quantity", 0)
                        if defect_qty > 0:
                            from apps.inventory.models import DefectItem, DefectStatusChoices
                            DefectItem.objects.create(
                                tenant=tenant,
                                variant=cs_variant,
                                branch=target_branch,
                                supplier=po.supplier,
                                purchase_order=po,
                                quantity=defect_qty,
                                cost_price=_reception_unit_cost(line, po),
                                defect_reason=cs.get("defect_reason") or "other",
                                notes=f"Réception {po_ref}: {cs.get('defect_notes', '')}".strip(),
                                logged_by=user,
                                status=DefectStatusChoices.QUARANTINED,
                            )

                # Accumulate (not replace) so second partial receives are tracked correctly
                line.quantity_received += total_received
                line.save(update_fields=["quantity_received"])

            else:
                # ── Standard mode: single variant per line ───────────────
                variant_id_from_request = ld.get("variant_id")
                new_variant_data = ld.get("new_variant")

                if not line.variant_id and variant_id_from_request:
                    linked = Variant.objects.filter(
                        tenant=tenant, id=variant_id_from_request
                    ).first()
                    if linked:
                        line.variant = linked
                        line.save(update_fields=["variant"])

                elif not line.variant_id and new_variant_data:
                    product = _resolve_product(tenant, new_variant_data, branch=target_branch)
                    if product:
                        variant = _resolve_variant(
                            tenant,
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
                    raise ValueError(
                        f"Ligne {line.id}: la quantité reçue ({new_qty}) "
                        f"dépasse la quantité commandée ({line.quantity_ordered})."
                    )

                delta = new_qty - line.quantity_received
                line.quantity_received = new_qty
                line.save(update_fields=["quantity_received"])

                if delta > 0 and line.variant_id:
                    StockMovement.objects.create(
                        tenant=tenant,
                        variant_id=line.variant_id,
                        branch=target_branch,
                        quantity_delta=delta,
                        reason=MovementReasonChoices.RECEPTION,
                        reference_id=bl_reference or po.reference or f"PO-{str(po.id)[:8]}",
                        reference_type="PurchaseOrder",
                        bl_reference=bl_reference,
                        notes=notes_base,
                        user=user,
                    )
                    movements_created += 1
                    
                    pid = line.variant.product_id
                    if pid not in product_reception_totals:
                        from decimal import Decimal
                        product_reception_totals[pid] = {"qty": 0, "value": Decimal("0")}
                    product_reception_totals[pid]["qty"] += delta
                    product_reception_totals[pid]["value"] += delta * _reception_unit_cost(line, po)

                defect_qty = ld.get("defect_quantity", 0)
                if defect_qty > 0 and line.variant_id:
                    from apps.inventory.models import DefectItem, DefectStatusChoices
                    DefectItem.objects.create(
                        tenant=tenant,
                        variant_id=line.variant_id,
                        branch=target_branch,
                        supplier=po.supplier,
                        purchase_order=po,
                        quantity=defect_qty,
                        cost_price=_reception_unit_cost(line, po),
                        defect_reason=ld.get("defect_reason") or "other",
                        notes=f"Réception {po_ref}: {ld.get('defect_notes', '')}".strip(),
                        logged_by=user,
                        status=DefectStatusChoices.QUARANTINED,
                    )

        # ── Recalculate PAMP for all received products ─────────────────────
        if product_reception_totals:
            from apps.inventory.models import Product
            for pid, pdata in product_reception_totals.items():
                rec_qty = pdata["qty"]
                rec_val = pdata["value"]
                if rec_qty <= 0:
                    continue
                product = Product.objects.filter(id=pid, tenant=tenant).first()
                if not product:
                    continue

                # Total stock across all variants after current movements
                current_stock = product.total_stock
                prior_stock = current_stock - rec_qty
                current_cost_basis = (
                    product.pamp
                    if (product.pamp and product.pamp > Decimal("0.00"))
                    else (product.purchase_price or Decimal("0.00"))
                )

                if prior_stock <= 0 or current_cost_basis <= Decimal("0.00"):
                    new_pamp = rec_val / Decimal(rec_qty)
                else:
                    prior_val = Decimal(prior_stock) * current_cost_basis
                    new_pamp = (prior_val + rec_val) / Decimal(current_stock)

                product.pamp = new_pamp.quantize(Decimal("0.01"))
                product.purchase_price = (rec_val / Decimal(rec_qty)).quantize(Decimal("0.01"))
                product.save(update_fields=["pamp", "purchase_price"])

        # Re-compute PO status from all lines
        all_lines = list(POLine.objects.filter(order=po))
        if all_lines:
            if all(ln.quantity_received >= ln.quantity_ordered for ln in all_lines):
                po.status = POStatusChoices.RECEIVED
            elif any(ln.quantity_received > 0 for ln in all_lines):
                po.status = POStatusChoices.PARTIAL
        po.save()

        # Auto-create or update SupplierInvoice ONLY when PO status is fully received
        if po.status == POStatusChoices.RECEIVED:
            rate = po.exchange_rate if po.exchange_rate is not None else Decimal("1")
            received_total = sum(
                (ln.quantity_received * ln.agreed_unit_price * rate for ln in all_lines),
                Decimal("0"),
            ).quantize(Decimal("0.01"))
            if received_total > 0:
                from django.utils import timezone
                inv, created = SupplierInvoice.objects.get_or_create(
                    tenant=tenant,
                    purchase_order=po,
                    defaults={
                        "supplier": po.supplier,
                        "invoice_number": bl_reference or po.reference or f"BR-{str(po.id)[:8]}",
                        "date": timezone.now().date(),
                        "due_date": timezone.now().date(),
                        "total_amount": received_total,
                    },
                )
                if not created:
                    inv.total_amount = received_total
                    if bl_reference:
                        inv.invoice_number = bl_reference
                    inv.save()

                po.supplier.recompute_balance()

    po.refresh_from_db()
    return {
        "movements_created": movements_created,
        "created_variants": created_variants,
        "discrepancies": discrepancies,
    }


class PurchaseOrderViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = PurchaseOrder.objects.select_related("supplier").prefetch_related("lines__variant__product")
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    filterset_fields = ["status", "supplier"]
    search_fields = ["reference", "supplier__name"]
    ordering_fields = ["created_at", "expected_date", "total_amount"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return PurchaseOrderListSerializer
        return PurchaseOrderSerializer

    @action(detail=False, methods=["post"], url_path="parse-pdf")
    def parse_pdf(self, request):
        if "file" not in request.FILES:
            return Response({"error": "No file provided"}, status=400)
        
        pdf_file = request.FILES["file"]
        
        from .pdf_parser import parse_supplier_invoice
        try:
            result = parse_supplier_invoice(pdf_file)
            return Response(result)
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    @action(detail=False, methods=["post"], url_path="import-preview")
    def import_preview(self, request):
        """
        POST /suppliers/purchase-orders/import-preview/
        Accepts:
          - multipart 'file' (CSV or Excel) OR JSON with 'data_rows' + 'headers'
          - optional 'supplier_id'
          - optional 'template_id'
          - optional overrides: 'column_map', 'size_mode', 'header_row', 'default_colour', 'default_pairs_per_carton'
        Returns preview of detected columns, auto mapping, applied template, expanded lines and match summary.
        """
        self.require_manager()
        file_obj = request.FILES.get("file")

        raw_rows = []
        encoding = "utf-8"
        delimiter = ";"

        if file_obj:
            raw_bytes = file_obj.read()
            raw_rows, encoding, delimiter, parse_err = parse_supplier_order_file(raw_bytes, file_obj.name)
            if parse_err:
                return Response({"detail": str(parse_err)}, status=status.HTTP_400_BAD_REQUEST)
        elif "raw_rows" in request.data:
            raw_rows = request.data.get("raw_rows") or []
        else:
            return Response({"detail": "Aucun fichier ou données fournis."}, status=status.HTTP_400_BAD_REQUEST)

        if not raw_rows:
            return Response({"detail": "Le fichier ou les données sont vides."}, status=status.HTTP_400_BAD_REQUEST)

        # Supplier and Template lookup
        supplier_id = request.data.get("supplier_id")
        template_id = request.data.get("template_id")
        applied_template = None

        if template_id:
            applied_template = SupplierImportTemplate.objects.filter(tenant=request.tenant, id=template_id).first()
        elif supplier_id:
            applied_template = SupplierImportTemplate.objects.filter(
                tenant=request.tenant, supplier_id=supplier_id
            ).first()

        # Available templates for this supplier / global
        available_templates_qs = SupplierImportTemplate.objects.filter(tenant=request.tenant)
        if supplier_id:
            from django.db.models import Q
            available_templates_qs = available_templates_qs.filter(
                Q(supplier_id=supplier_id) | Q(supplier__isnull=True)
            )
        templates_data = SupplierImportTemplateSerializer(available_templates_qs, many=True).data

        # Determine header row
        req_header_row = request.data.get("header_row")
        if req_header_row:
            try:
                header_row_idx = max(1, int(req_header_row))
            except (ValueError, TypeError):
                header_row_idx = 1
        elif applied_template and applied_template.header_row:
            header_row_idx = applied_template.header_row
        else:
            header_row_idx, _, _ = detect_header_row_and_headers(raw_rows)

        # Slice headers and data rows based on header_row_idx
        best_header_row_idx, auto_headers, auto_data_rows = detect_header_row_and_headers(raw_rows)
        if header_row_idx == best_header_row_idx:
            headers = auto_headers
            data_rows = auto_data_rows
        else:
            actual_idx = header_row_idx - 1
            if actual_idx < len(raw_rows):
                headers = [str(c or "").strip() or f"Colonne {i+1}" for i, c in enumerate(raw_rows[actual_idx])]
                data_rows = raw_rows[actual_idx + 1:]
            else:
                headers = auto_headers
                data_rows = auto_data_rows

        # Auto-mapping and size columns
        auto_mapping, size_matrix_cols, suggested_size_mode = auto_map_headers(headers)

        # Column map to use
        req_col_map = request.data.get("column_map")
        if isinstance(req_col_map, dict) and req_col_map:
            column_map = req_col_map
        elif applied_template and applied_template.column_map:
            column_map = applied_template.column_map
        else:
            column_map = {k: v for k, v in auto_mapping.items() if v}

        # Size mode to use
        size_mode = (
            request.data.get("size_mode")
            or (applied_template.size_mode if applied_template else None)
            or suggested_size_mode
        )

        default_colour = (
            request.data.get("default_colour")
            or (applied_template.default_colour if applied_template else "")
            or ""
        )
        default_ppc_raw = (
            request.data.get("default_pairs_per_carton")
            or (applied_template.default_pairs_per_carton if applied_template else None)
        )
        default_ppc = (
            parse_integer_value(default_ppc_raw, default=10)
            if default_ppc_raw is not None and str(default_ppc_raw).strip() != ""
            else None
        )

        # Expand rows into lines
        expanded_lines = expand_imported_order_lines(
            headers=headers,
            data_rows=data_rows,
            column_map=column_map,
            size_mode=size_mode,
            default_colour=default_colour,
            default_pairs_per_carton=default_ppc,
            tenant=request.tenant,
        )

        # Reconcile lines with catalog
        preview_lines, summary = reconcile_with_catalog(expanded_lines, tenant=request.tenant)

        return Response({
            "detected_encoding": encoding,
            "detected_delimiter": delimiter,
            "header_row": header_row_idx,
            "headers": headers,
            "auto_mapping": auto_mapping,
            "column_map": column_map,
            "size_mode": size_mode,
            "size_matrix_columns": size_matrix_cols,
            "default_colour": default_colour,
            "default_pairs_per_carton": default_ppc,
            "templates": templates_data,
            "applied_template_id": str(applied_template.id) if applied_template else None,
            "raw_rows": raw_rows[:50],
            "total_raw_rows": len(raw_rows),
            "preview_lines": preview_lines,
            "summary": summary,
        })

    @action(detail=False, methods=["post"], url_path="import-confirm")
    def import_confirm(self, request):
        """
        POST /suppliers/purchase-orders/import-confirm/
        Confirms import, creates PurchaseOrder(status="draft") and POLines.
        Optionally saves a SupplierImportTemplate for this supplier.
        """
        self.require_manager()
        ser = POImportConfirmRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        supplier = Supplier.objects.filter(tenant=request.tenant, id=data["supplier_id"]).first()
        if not supplier:
            return Response({"detail": "Fournisseur introuvable."}, status=status.HTTP_404_NOT_FOUND)

        lines = data["lines"]
        if not lines:
            return Response({"detail": "Aucune ligne à importer."}, status=status.HTTP_400_BAD_REQUEST)

        fingerprint_data = json.dumps(
            {
                "tenant_id": str(request.tenant.id),
                "supplier_id": str(supplier.id),
                "lines": lines,
            },
            cls=DjangoJSONEncoder,
            sort_keys=True,
            separators=(",", ":"),
        )
        fingerprint = hashlib.sha256(fingerprint_data.encode("utf-8")).hexdigest()
        cache_key = f"po_import_confirm:{fingerprint}"
        if not cache.add(cache_key, "processing", timeout=10):
            raise DuplicatePOImportError()

        try:
            po, stats = execute_po_import(
                tenant=request.tenant,
                user=request.user,
                supplier=supplier,
                lines=lines,
                reference=data.get("reference", ""),
                expected_date=data.get("expected_date"),
                notes=data.get("notes", ""),
                quick_create_products=data.get("quick_create_products", True),
                save_as_template=data.get("save_as_template", False),
                template_name=data.get("template_name", ""),
                template_data=data.get("template_data", {}),
            )
        except Exception:
            cache.delete(cache_key)
            raise

        return Response({
            "purchase_order": PurchaseOrderSerializer(po).data,
            "stats": stats,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="scan-image")
    def scan_image(self, request):
        """
        POST /suppliers/purchase-orders/scan-image/
        Offline OpenCV + RapidOCR image/photo scanner using PURCHASE_ORDER_PROFILE.
        Extracts spatial tokens, table rows, supplier metadata, and reconciles with catalog.
        """
        import logging
        from django.utils.translation import gettext as _

        self.require_manager()
        uploaded_file = request.FILES.get("file") or request.FILES.get("image")
        if not uploaded_file:
            return Response(
                {"detail": _("Veuillez fournir une image ou photo du bon fournisseur.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filename = (uploaded_file.name or "").lower()
        allowed_exts = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")
        if filename and not any(filename.endswith(ext) for ext in allowed_exts):
            return Response(
                {"detail": _("Format d'image non supporté. Utilisez PNG, JPG, WEBP ou BMP.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_bytes = uploaded_file.read()
        if not raw_bytes:
            return Response(
                {"detail": _("Le fichier image est vide.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = scan_purchase_order_image(raw_bytes, tenant=request.tenant)
        except ImportError as e:
            logging.getLogger(__name__).warning("OCR module unavailable: %s", e)
            return Response(
                {"detail": _("Le module de reconnaissance optique n'est pas disponible sur ce serveur (dépendances système OpenCV/libGL manquantes).")},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:
            logging.getLogger(__name__).exception("Error scanning purchase order image")
            return Response(
                {"detail": _("Impossible d'analyser cette image. Vérifiez que le fichier est une image valide.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(result, status=status.HTTP_200_OK)



    def create(self, request, *args, **kwargs):
        input_ser = CreatePurchaseOrderSerializer(data=request.data)
        input_ser.is_valid(raise_exception=True)
        data = input_ser.validated_data

        supplier = Supplier.objects.filter(tenant=request.tenant, id=data["supplier"]).first()
        if not supplier:
            return Response({"detail": "Fournisseur introuvable."}, status=status.HTTP_404_NOT_FOUND)

        from decimal import Decimal
        with transaction.atomic():
            target_branch = None
            if data.get("branch"):
                from apps.core.models import Branch
                target_branch = Branch.objects.filter(tenant=request.tenant, id=data["branch"]).first()
            elif hasattr(request, "branch") and request.branch:
                target_branch = request.branch
            else:
                from apps.core.models import Branch
                target_branch = Branch.objects.filter(tenant=request.tenant, is_headquarters=True).first()

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
            lines_data_for_receive = []

            for line_data in data["lines"]:
                variant_id = line_data.get("variant")
                carton_sizes = line_data.get("carton_sizes") or []
                new_variant_data = line_data.get("new_variant")

                qty_ordered = line_data.get("quantity_ordered")
                if carton_sizes:
                    qty_ordered = sum(cs.get("quantity", 0) for cs in carton_sizes)

                variant = None
                if variant_id:
                    from apps.inventory.models import Variant
                    variant = Variant.objects.filter(tenant=request.tenant, id=variant_id).first()
                elif new_variant_data:
                    product = _resolve_product(request.tenant, new_variant_data, branch=target_branch)
                    if product:
                        variant = _resolve_variant(
                            request.tenant,
                            product,
                            new_variant_data.get("size_eu", 0),
                            new_variant_data.get("colour", ""),
                        )
                        variant_id = variant.id
                elif carton_sizes:
                    for cs in carton_sizes:
                        if cs.get("new_variant"):
                            _resolve_product(request.tenant, cs["new_variant"], branch=target_branch)

                line = POLine.objects.create(
                    order=po,
                    variant=variant,
                    description=line_data["description"],
                    quantity_ordered=qty_ordered,
                    agreed_unit_price=line_data["agreed_unit_price"],
                    cartons=line_data.get("cartons", 0),
                    pairs_per_carton=line_data.get("pairs_per_carton", 10),
                )
                total += line.agreed_unit_price * line.quantity_ordered

                lines_data_for_receive.append({
                    "id": line.id,
                    "quantity_received": qty_ordered,
                    "variant_id": variant_id,
                    "new_variant": new_variant_data,
                    "carton_sizes": carton_sizes
                })

            po.total_amount = total
            po.save(update_fields=["total_amount"])

            if data.get("receive_immediately"):
                for ld in lines_data_for_receive:
                    if not ld["variant_id"] and not ld["carton_sizes"]:
                        from rest_framework.exceptions import ValidationError
                        raise ValidationError("En réception directe, chaque ligne doit être liée à une variante ou utiliser le mode carton.")

                _process_receive_lines(
                    po=po,
                    lines_data=lines_data_for_receive,
                    bl_reference=data.get("bl_reference", ""),
                    branch_id=data.get("branch"),
                    tenant=request.tenant,
                    user=request.user
                )
            elif data.get("confirm"):
                po.status = POStatusChoices.SENT
                po.save(update_fields=["status"])

        po.refresh_from_db()
        out_ser = PurchaseOrderSerializer(po)
        return Response(out_ser.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        po = self.get_object()
        if po.status != POStatusChoices.DRAFT:
            return Response(
                {"detail": "Impossible de modifier une commande qui n'est plus à l'état brouillon."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        input_ser = CreatePurchaseOrderSerializer(data=request.data)
        input_ser.is_valid(raise_exception=True)
        data = input_ser.validated_data

        supplier = Supplier.objects.filter(tenant=request.tenant, id=data["supplier"]).first()
        if not supplier:
            return Response({"detail": "Fournisseur introuvable."}, status=status.HTTP_404_NOT_FOUND)

        from decimal import Decimal
        with transaction.atomic():
            po.supplier = supplier
            po.reference = data.get("reference", "")
            po.expected_date = data.get("expected_date")
            po.notes = data.get("notes", "")
            po.save()

            po.lines.all().delete()
            
            total = Decimal("0")
            lines_data_for_receive = []

            for line_data in data["lines"]:
                variant_id = line_data.get("variant")
                carton_sizes = line_data.get("carton_sizes") or []
                
                qty_ordered = line_data.get("quantity_ordered")
                if carton_sizes:
                    qty_ordered = sum(cs.get("quantity", 0) for cs in carton_sizes)

                variant = None
                if variant_id:
                    from apps.inventory.models import Variant
                    variant = Variant.objects.filter(tenant=request.tenant, id=variant_id).first()

                line = POLine.objects.create(
                    order=po,
                    variant=variant,
                    description=line_data["description"],
                    quantity_ordered=qty_ordered,
                    agreed_unit_price=line_data["agreed_unit_price"],
                    cartons=line_data.get("cartons", 0),
                    pairs_per_carton=line_data.get("pairs_per_carton", 10),
                )
                total += line.agreed_unit_price * line.quantity_ordered
                
                lines_data_for_receive.append({
                    "id": line.id,
                    "quantity_received": qty_ordered,
                    "variant_id": variant_id,
                    "new_variant": None,
                    "carton_sizes": carton_sizes
                })

            po.total_amount = total
            po.save(update_fields=["total_amount"])

            if data.get("receive_immediately"):
                for ld in lines_data_for_receive:
                    if not ld["variant_id"] and not ld["carton_sizes"]:
                        from rest_framework.exceptions import ValidationError
                        raise ValidationError("En réception directe, chaque ligne doit être liée à une variante ou utiliser le mode carton.")

                _process_receive_lines(
                    po=po,
                    lines_data=lines_data_for_receive,
                    bl_reference=data.get("bl_reference", ""),
                    branch_id=data.get("branch"),
                    tenant=request.tenant,
                    user=request.user
                )
            elif data.get("confirm"):
                po.status = POStatusChoices.SENT
                po.save(update_fields=["status"])

        po.refresh_from_db()
        out_ser = PurchaseOrderSerializer(po)
        return Response(out_ser.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        self.require_manager()
        po = self.get_object()
        
        if po.status == POStatusChoices.CANCELLED:
            return Response(
                {"error": {"code": "already_cancelled", "message": "Purchase order is already cancelled."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        has_received = po.lines.filter(quantity_received__gt=0).exists()
        if has_received:
            return Response(
                {"error": {"code": "has_received", "message": "Cannot cancel a purchase order that has received items."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        po.status = POStatusChoices.CANCELLED
        po.save(update_fields=["status"])
        return Response(PurchaseOrderSerializer(po).data)

    @action(detail=True, methods=["post"], url_path="landed-cost/apply")
    def landed_cost_apply(self, request, pk=None):
        from apps.suppliers.services.landed_cost import apply_landed_cost
        return Response(apply_landed_cost(self.get_object()))

    @action(detail=True, methods=["get", "put"], url_path="landed-cost")
    def landed_cost(self, request, pk=None):
        from apps.suppliers.services.landed_cost import landed_cost_state, save_landed_cost
        from apps.suppliers.serializers import LandedCostWriteSerializer
        po = self.get_object()
        if request.method == "GET":
            return Response(landed_cost_state(po))
        ser = LandedCostWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response(save_landed_cost(po, ser.validated_data))

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
        from apps.closing.services.lock import assert_period_open
        assert_period_open(request.tenant)

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

        try:
            res_data = _process_receive_lines(po, lines_data, bl_reference, branch_id, request.tenant, request.user)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            **PurchaseOrderSerializer(po).data,
            **res_data
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

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """Download the purchase order as a PDF."""
        po = self.get_object()
        from apps.invoicing.pdf import render_purchase_order_pdf
        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_purchase_order_pdf(po, language=lang)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        ref = po.reference or str(po.pk)
        response["Content-Disposition"] = f'inline; filename="commande-{ref}.pdf"'
        return response


class SupplierInvoiceViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierInvoice.objects.select_related("supplier", "purchase_order")
    serializer_class = SupplierInvoiceSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    filterset_fields = ["supplier", "purchase_order"]
    ordering_fields = ["date", "due_date", "total_amount"]
    ordering = ["-date"]

    def perform_create(self, serializer):
        from apps.closing.services.lock import assert_period_open
        assert_period_open(self.request.tenant, serializer.validated_data.get("date"))
        serializer.save(tenant=self.request.tenant)

    def perform_update(self, serializer):
        from apps.closing.services.lock import assert_period_open
        if self.get_object().date:
            assert_period_open(self.request.tenant, self.get_object().date)
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
        """Download the supplier invoice as a PDF."""
        invoice = self.get_object()
        from apps.invoicing.pdf import render_supplier_invoice_pdf
        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_supplier_invoice_pdf(invoice, language=lang)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="supplier-invoice-{invoice.invoice_number}.pdf"'
        )
        return response


class SupplierPaymentViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierPayment.objects.select_related("supplier", "supplier_invoice")
    serializer_class = SupplierPaymentSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    filterset_fields = ["supplier", "supplier_invoice", "method"]
    ordering_fields = ["date", "amount"]
    ordering = ["-date"]

    def perform_create(self, serializer):
        from apps.closing.services.lock import assert_period_open
        assert_period_open(self.request.tenant, serializer.validated_data.get("date"))
        serializer.save(tenant=self.request.tenant, recorded_by=self.request.user)

    def perform_update(self, serializer):
        from apps.closing.services.lock import assert_period_open
        if self.get_object().date:
            assert_period_open(self.request.tenant, self.get_object().date)
        if serializer.validated_data.get("date"):
            assert_period_open(self.request.tenant, serializer.validated_data.get("date"))
        serializer.save()

    def perform_destroy(self, instance):
        from apps.closing.services.lock import assert_period_open
        if instance.date:
            assert_period_open(self.request.tenant, instance.date)
        instance.delete()


class SupplierReturnClaimViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierReturnClaim.objects.select_related("supplier", "created_by").prefetch_related("items__variant__product")
    serializer_class = SupplierReturnClaimSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    filterset_fields = ["supplier", "status", "credit_note_applied"]
    search_fields = ["claim_number", "supplier__name", "notes"]
    ordering_fields = ["created_at", "total_amount", "status"]
    ordering = ["-created_at"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant, created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="apply-credit")
    def apply_credit(self, request, pk=None):
        """Approve claim and deduct total_amount from supplier balance as a credit note (Avoir)."""
        claim = self.get_object()
        if claim.credit_note_applied:
            return Response({"detail": "L'avoir a déjà été appliqué sur ce fournisseur."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            claim.credit_note_applied = True
            claim.status = ClaimStatusChoices.ACCEPTED
            claim.save(update_fields=["credit_note_applied", "status"])
            
            # Update all attached defect items to returned
            from apps.inventory.models import DefectStatusChoices
            from django.utils import timezone
            claim.items.update(
                status=DefectStatusChoices.RETURNED,
                resolved_by=request.user,
                resolved_at=timezone.now(),
            )
            claim.supplier.recompute_balance()

        return Response(SupplierReturnClaimSerializer(claim).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """Download the supplier return claim note as a PDF."""
        claim = self.get_object()
        from apps.invoicing.pdf import render_return_claim_pdf
        lang = request.query_params.get("lang", "fr")
        pdf_bytes = render_return_claim_pdf(claim, language=lang)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="bon-retour-{claim.claim_number}.pdf"'
        )
        return response


class SupplierImportTemplateViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD for saved supplier order import configuration templates.
    """
    queryset = SupplierImportTemplate.objects.select_related("supplier").all()
    serializer_class = SupplierImportTemplateSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    search_fields = ["name", "supplier__name"]
    ordering_fields = ["name", "updated_at", "created_at"]
    ordering = ["-updated_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        supplier_id = self.request.query_params.get("supplier")
        if supplier_id:
            from django.db.models import Q
            qs = qs.filter(Q(supplier_id=supplier_id) | Q(supplier__isnull=True))
        return qs


