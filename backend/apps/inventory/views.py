"""Inventory API views."""
from django.db import transaction
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.models import RoleChoices
from apps.inventory.models import (
    MovementReasonChoices,
    Product,
    StockMovement,
    StockTransfer,
    Variant,
)
from apps.inventory.serializers import (
    BulkStockAdjustmentSerializer,
    GenerateVariantsSerializer,
    ProductCreateSerializer,
    ProductListSerializer,
    ProductSerializer,
    StockAdjustmentSerializer,
    StockMovementSerializer,
    StockTransferSerializer,
    VariantSerializer,
)


class ProductViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Product.objects.prefetch_related("variants")
    filterset_fields = ["category", "gender", "season", "is_active", "brand"]
    search_fields = ["name", "brand", "reference", "branch_locations__location"]
    ordering_fields = ["name", "sale_price", "purchase_price", "created_at"]
    ordering = ["name"]

    def get_serializer_class(self):
        if self.action in ["list", "low_stock"]:
            return ProductListSerializer
        return ProductSerializer

    def get_queryset(self):
        from django.db.models import IntegerField, OuterRef, Prefetch, Subquery, Sum, Value
        from django.db.models.functions import Coalesce

        qs = super().get_queryset()
        branch_id = self.request.query_params.get("branch_id")
        if not branch_id:
            return qs

        branch_stock_subq = (
            StockMovement.objects
            .filter(variant_id=OuterRef("pk"), branch_id=branch_id)
            .order_by()
            .values("variant_id")
            .annotate(total=Sum("quantity_delta"))
            .values("total")
        )
        branch_variant_qs = (
            Variant.objects
            .filter(tenant=self._get_tenant())
            .annotate(branch_stock_qty=Coalesce(
                Subquery(branch_stock_subq, output_field=IntegerField()),
                Value(0),
            ))
        )
        # prefetch_related(None) clears the class-level prefetch so we can
        # replace it with the branch-annotated queryset.
        return qs.prefetch_related(None).prefetch_related(
            Prefetch("variants", queryset=branch_variant_qs)
        )

    def perform_create(self, serializer):
        from apps.core.plan_permissions import check_quota
        check_quota(self.request, "products", Product.objects.filter(tenant=self.request.tenant).count())
        serializer.save(tenant=self.request.tenant)

    def update(self, request, *args, **kwargs):
        location = request.data.get("location")
        response = super().update(request, *args, **kwargs)
        branch_id = request.data.get('branch_id')
        if location is not None and getattr(request.tenant, "plan", "free") != "free" and branch_id and branch_id != "null":
            product = self.get_object()
            from apps.inventory.models import ProductLocation
            ProductLocation.objects.update_or_create(
                tenant=request.tenant,
                branch_id=branch_id,
                product=product,
                defaults={"location": location}
            )
        return response

    def create(self, request, *args, **kwargs):
        """
        Override create to handle the optional nested `variants` field.
        When provided, product + all size×colour variants are created atomically.
        """
        create_serializer = ProductCreateSerializer(data=request.data)
        create_serializer.is_valid(raise_exception=True)

        variants_data = create_serializer.validated_data.pop("variants", None)
        location_data = create_serializer.validated_data.pop("location", None)

        # Check quota before creating
        from apps.core.plan_permissions import check_quota
        check_quota(request, "products", Product.objects.filter(tenant=request.tenant).count())

        with transaction.atomic():
            product = Product(**create_serializer.validated_data, tenant=request.tenant)
            # Handle image upload (multipart)
            if "image" in request.FILES:
                product.image = request.FILES["image"]
            product.save()
            
            branch_id = request.data.get('branch_id')
            if location_data is not None and getattr(request.tenant, "plan", "free") != "free" and branch_id and branch_id != "null":
                from apps.inventory.models import ProductLocation
                ProductLocation.objects.create(
                    tenant=request.tenant,
                    branch_id=branch_id,
                    product=product,
                    location=location_data
                )

            # Generate variants if sizes/colours were provided
            if variants_data:
                sizes = variants_data.get("sizes", [])
                colours = variants_data.get("colours") or ["N/A"]
                threshold = variants_data.get("alert_threshold", 3)
                for size in sizes:
                    for colour in colours:
                        Variant.objects.get_or_create(
                            tenant=request.tenant,
                            product=product,
                            size_eu=size,
                            colour=colour,
                            defaults={"alert_threshold": threshold},
                        )

        # Refresh and return using the detail serializer
        product.refresh_from_db()
        out_serializer = ProductSerializer(product, context={"request": request})
        return Response(out_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="import")
    def import_products(self, request):
        """
        POST /inventory/products/import/
        Body: multipart/form-data with field 'file' (CSV or XLSX).
        Query: ?dry_run=true to validate without saving.

        CSV columns (one row = one variant):
          name*, sale_price*, size_eu*, colour*,
          brand, category, gender, purchase_price, alert_threshold, reference, barcode
        (* required)
        """
        from decimal import Decimal, InvalidOperation
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

        REQUIRED = {"name", "sale_price", "size_eu", "colour"}
        VALID_CATEGORIES = {c[0] for c in Product._meta.get_field("category").choices}
        VALID_GENDERS = {g[0] for g in Product._meta.get_field("gender").choices}

        created_products = 0
        created_variants = 0
        skipped = 0
        errors = []

        with transaction.atomic():
            for i, row in enumerate(rows, start=2):  # row 1 is header
                missing = REQUIRED - set(row.keys())
                if missing:
                    errors.append({"row": i, "message": f"Colonnes manquantes : {', '.join(sorted(missing))}"})
                    continue

                name = row.get("name", "").strip()
                brand = row.get("brand", "").strip()
                if not name:
                    errors.append({"row": i, "message": "Le nom ne peut pas être vide."})
                    continue

                # Parse numerics
                try:
                    sale_price = Decimal(row["sale_price"].replace(" ", "").replace(",", "."))
                except (InvalidOperation, KeyError):
                    errors.append({"row": i, "message": f"sale_price invalide : {row.get('sale_price')}"})
                    continue

                try:
                    purchase_price = Decimal(row.get("purchase_price", "0").replace(" ", "").replace(",", ".") or "0")
                except InvalidOperation:
                    purchase_price = Decimal("0")

                try:
                    size_eu = int(row["size_eu"])
                    if not (28 <= size_eu <= 47):
                        raise ValueError
                except (ValueError, KeyError):
                    errors.append({"row": i, "message": f"size_eu invalide (28–47) : {row.get('size_eu')}"})
                    continue

                colour = row.get("colour", "").strip()
                if not colour:
                    errors.append({"row": i, "message": "La couleur ne peut pas être vide."})
                    continue

                try:
                    alert_threshold = int(row.get("alert_threshold", "3") or "3")
                except ValueError:
                    alert_threshold = 3

                category = row.get("category", "other").strip().lower() or "other"
                if category not in VALID_CATEGORIES:
                    category = "other"

                gender = row.get("gender", "U").strip().upper() or "U"
                if gender not in VALID_GENDERS:
                    gender = "U"

                if dry_run:
                    created_variants += 1
                    continue

                product, product_created = Product.objects.get_or_create(
                    tenant=tenant,
                    name=name,
                    brand=brand,
                    defaults={
                        "category": category,
                        "gender": gender,
                        "sale_price": sale_price,
                        "purchase_price": purchase_price,
                        "reference": row.get("reference", "").strip(),
                    },
                )
                if product_created:
                    created_products += 1

                _, variant_created = Variant.objects.get_or_create(
                    tenant=tenant,
                    product=product,
                    size_eu=size_eu,
                    colour=colour,
                    defaults={
                        "alert_threshold": alert_threshold,
                        "barcode": row.get("barcode", "").strip() or "",
                    },
                )
                if variant_created:
                    created_variants += 1
                else:
                    skipped += 1

            if dry_run:
                transaction.set_rollback(True)

        return Response({
            "dry_run": dry_run,
            "created_products": created_products,
            "created_variants": created_variants,
            "skipped": skipped,
            "errors": errors,
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="low-stock")
    def low_stock(self, request):
        """Products currently at or below their global alert threshold."""
        from django.db.models import F, Sum
        from django.db.models.functions import Coalesce

        qs = self.get_queryset().filter(
            is_active=True,
            alert_threshold__gt=0,
        ).annotate(
            computed_total_stock=Coalesce(Sum("variants__stock_qty"), 0)
        ).filter(
            computed_total_stock__lte=F("alert_threshold")
        )

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="generate-variants")
    def generate_variants(self, request, pk=None):
        """Bulk create variants for this product."""
        product = self.get_object()
        self.require_manager()

        serializer = GenerateVariantsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        sizes = serializer.validated_data.get("sizes", [])
        colours = serializer.validated_data.get("colours") or ["N/A"]
        threshold = serializer.validated_data["alert_threshold"]

        created = 0
        errors = []

        with transaction.atomic():
            for size in sizes:
                for colour in colours:
                    try:
                        _, was_created = Variant.objects.get_or_create(
                            tenant=request.tenant,
                            product=product,
                            size_eu=size,
                            colour=colour,
                            defaults={"alert_threshold": threshold},
                        )
                        if was_created:
                            created += 1
                    except Exception as e:
                        errors.append({"size": size, "colour": colour, "error": str(e)})

        return Response(
            {"created": created, "skipped": len(sizes) * len(colours) - created, "errors": errors},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="stock-by-branch")
    def stock_by_branch(self, request, pk=None):
        """Return per-branch stock breakdown for all variants of this product."""
        product = self.get_object()
        from apps.core.models import Branch
        from django.db.models import Sum

        branches = Branch.objects.filter(tenant=request.tenant)
        result = []
        for branch in branches:
            variants_data = []
            for variant in product.variants.filter(is_active=True):
                branch_stock = StockMovement.objects.filter(
                    variant=variant, branch=branch
                ).aggregate(total=Sum("quantity_delta"))["total"] or 0
                variants_data.append({
                    "variant_id": variant.pk,
                    "size_eu": variant.size_eu,
                    "colour": variant.colour,
                    "stock": branch_stock,
                })
            result.append({"branch_id": branch.pk, "branch_name": branch.name, "variants": variants_data})

        return Response(result)

    @action(detail=True, methods=["get"], url_path="barcode-labels")
    def barcode_labels(self, request, pk=None):
        """
        Return a PDF of barcode labels — one label per page, page sized to
        the label (82 mm × 40 mm) so the printer doesn't add blank space.

        Rendered via WeasyPrint (already used for invoices in this project).
        The frontend fetches the PDF via axios (JWT header), creates a blob URL
        and opens it in a new tab where the browser renders it inline.
        """
        product = self.get_object()
        variants = (
            product.variants
            .filter(is_active=True)
            .exclude(barcode__isnull=True)
            .exclude(barcode="")
            .order_by("size_eu", "colour")
        )

        labels_html = "\n".join(_render_label(product, v) for v in variants)

        if not labels_html:
            labels_html = (
                '<p style="font-family:sans-serif;color:#888;padding:4mm;">'
                "Aucune variante active avec code-barres.</p>"
            )

        html_string = _barcode_page(
            title=f"{product.name} — Étiquettes",
            labels_html=labels_html,
        )

        try:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html_string, base_url=".").write_pdf()
        except Exception as exc:
            # WeasyPrint unavailable or rendering error — surface the message
            return HttpResponse(
                f"PDF generation failed: {exc}",
                content_type="text/plain",
                status=500,
            )

        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in product.name)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="barcodes_{safe_name}.pdf"'
        return response


# ── CODE-128C renderer ────────────────────────────────────────────────────────
# CODE-128C encodes pairs of digits 00-99 → very compact for even-length numbers.
# Our barcodes are 14 digits (always even), so CODE-128C is the perfect fit.

# 107 symbol patterns (11 modules each), index = code value.
# Index 103 = Start A, 104 = Start B, 105 = Start C.
_CODE128 = [
    "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",  # 0-4
    "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",  # 5-9
    "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",  # 10-14
    "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",  # 15-19
    "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",  # 20-24
    "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",  # 25-29
    "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",  # 30-34
    "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",  # 35-39
    "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",  # 40-44
    "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",  # 45-49
    "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",  # 50-54
    "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",  # 55-59
    "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",  # 60-64
    "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",  # 65-69
    "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",  # 70-74
    "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",  # 75-79
    "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",  # 80-84
    "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",  # 85-89
    "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",  # 90-94
    "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",  # 95-99
    "10111101110", "11101011110", "11110101110",                                # 100-102
    "11010000100", "11010010000", "11010011100",                                # 103=StartA 104=StartB 105=StartC
]
_CODE128_STOP = "1100011101011"   # Stop character: 13 modules
_CODE128_START_C = 105


def _barcode_svg(value: str, height: int = 60, module_w: float = 2.0) -> str:
    """
    Encode a numeric string of even length as a CODE-128C SVG barcode.
    Returns bare SVG bars only — no embedded text (caller adds human-readable number).
    Uses width="76mm" so WeasyPrint scales it to exactly 76 mm regardless of pixel DPI.
    Falls back gracefully: returns "" if value is invalid.
    """
    if not value or not value.isdigit() or len(value) % 2 != 0:
        return ""

    pairs = [int(value[i:i + 2]) for i in range(0, len(value), 2)]

    # Check character
    check = _CODE128_START_C
    for pos, pair in enumerate(pairs, start=1):
        check += pos * pair
    check %= 103

    bits = (
        _CODE128[_CODE128_START_C]
        + "".join(_CODE128[p] for p in pairs)
        + _CODE128[check]
        + _CODE128_STOP
    )

    quiet = module_w * 10
    total_w = len(bits) * module_w + quiet * 2

    # Build bar rectangles
    bar_rects = []
    in_bar = False
    bar_start = 0
    for i in range(len(bits) + 1):
        is_one = i < len(bits) and bits[i] == "1"
        if is_one and not in_bar:
            in_bar, bar_start = True, i
        elif not is_one and in_bar:
            in_bar = False
            x = quiet + bar_start * module_w
            w = (i - bar_start) * module_w
            bar_rects.append(
                f'<rect x="{x:.2f}" y="0" width="{w:.2f}" height="{height}" fill="black"/>'
            )

    # width="76mm" tells WeasyPrint the physical size; viewBox scales the coordinates.
    # No height attribute → WeasyPrint derives it from viewBox aspect ratio.
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg"'
        f' viewBox="0 0 {total_w:.2f} {height}"'
        f' width="76mm"'
        f' preserveAspectRatio="xMidYMid meet">'
        + "".join(bar_rects)
        + "</svg>"
    )


def _render_label(product, variant) -> str:
    """
    One label = one PDF page.
    No text inside the SVG — avoids double-printing the barcode number.
    Simple block layout (no flexbox) for reliable WeasyPrint rendering.
    """
    svg = _barcode_svg(variant.barcode, height=80, module_w=2.5)
    brand_part = f" · {product.brand}" if product.brand else ""
    return (
        f'<div class="label">'
        f'<p class="name">{product.name}{brand_part}</p>'
        f'<p class="info">EU {variant.size_eu} · {variant.colour}</p>'
        f'<div class="bc">{svg}</div>'
        f'<p class="code">{variant.barcode}</p>'
        f'</div>'
    )


def _barcode_page(title: str, labels_html: str) -> str:
    """
    HTML string optimised for WeasyPrint PDF output.
    Each @page is 82 mm × 40 mm — a standard small barcode label.
    Every .label div triggers a new page; the last one avoids a trailing blank.
    No JavaScript: WeasyPrint ignores it anyway.
    """
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  @page {{
    /* Each label is exactly one page — no leftover blank space */
    size: 82mm 46mm;
    margin: 2mm 3mm;
  }}

  * {{ box-sizing: border-box; margin: 0; padding: 0; }}

  body {{
    font-family: Helvetica, Arial, sans-serif;
    background: white;
    color: black;
  }}

  /* ── One label per page ── */
  .label {{
    page-break-after: always;
    width: 100%;
    text-align: center;
  }}
  .label:last-child {{ page-break-after: avoid; }}

  .name {{
    font-size: 8pt;
    font-weight: bold;
    margin-bottom: 1mm;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}

  .info {{
    font-size: 7pt;
    color: #555;
    margin-bottom: 2mm;
  }}

  /* Wrapper centres the fixed-width SVG */
  .bc {{
    display: block;
    text-align: center;
    line-height: 0;   /* collapse inline gap below SVG */
  }}

  .bc svg {{
    /* width is already "76mm" in the SVG attribute; no override needed */
    display: inline-block;
  }}

  .code {{
    font-size: 7pt;
    font-family: monospace;
    letter-spacing: 0.06em;
    margin-top: 1mm;
  }}
</style>
</head>
<body>
{labels_html}
</body>
</html>"""


class VariantViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Variant.objects.select_related("product")
    serializer_class = VariantSerializer
    filterset_fields = ["product", "size_eu", "colour", "is_active"]
    search_fields = ["barcode", "colour", "product__name", "product__brand"]

    def get_queryset(self):
        from django.db.models import IntegerField, OuterRef, Subquery, Sum, Value
        from django.db.models.functions import Coalesce

        qs = super().get_queryset()

        barcode = self.request.query_params.get("barcode")
        if barcode:
            qs = qs.filter(barcode=barcode)

        branch_id = self.request.query_params.get("branch_id")
        if branch_id:
            branch_stock_subq = (
                StockMovement.objects
                .filter(variant_id=OuterRef("pk"), branch_id=branch_id)
                .order_by()
                .values("variant_id")
                .annotate(total=Sum("quantity_delta"))
                .values("total")
            )
            qs = qs.annotate(branch_stock_qty=Coalesce(
                Subquery(branch_stock_subq, output_field=IntegerField()),
                Value(0),
            ))

        return qs

    @action(detail=True, methods=["get"], url_path="barcode-label")
    def barcode_label(self, request, pk=None):
        """
        Return a PDF of barcode labels for a single variant.

        Query params:
          copies=N  (int, default 1) — repeat the label N times in the PDF.
                    Use this to print exactly as many stickers as items received.
        """
        variant = self.get_object()
        if not variant.barcode:
            return HttpResponse(
                "Cette variante n'a pas encore de code-barres.",
                content_type="text/plain",
                status=400,
            )

        copies = max(1, min(int(request.query_params.get("copies", 1) or 1), 200))

        product = variant.product
        single_label = _render_label(product, variant)
        labels_html = "\n".join([single_label] * copies)

        html_string = _barcode_page(
            title=f"{product.name} EU{variant.size_eu} {variant.colour} — étiquettes",
            labels_html=labels_html,
        )

        try:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html_string, base_url=".").write_pdf()
        except Exception as exc:
            return HttpResponse(
                f"PDF generation failed: {exc}",
                content_type="text/plain",
                status=500,
            )

        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in f"{product.name}_EU{variant.size_eu}_{variant.colour}")
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="{safe}.pdf"'
        return response


class StockMovementViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only view of all stock movements. Adjustments go via /adjust endpoint."""
    queryset = StockMovement.objects.select_related("variant__product", "branch", "user")
    serializer_class = StockMovementSerializer
    filterset_fields = ["variant", "branch", "reason"]
    ordering_fields = ["timestamp"]
    ordering = ["-timestamp"]

    @action(detail=False, methods=["post"], url_path="adjust")
    def adjust(self, request):
        """Manual stock adjustment (manager+ only)."""
        self.require_manager()

        serializer = StockAdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        variant = data["variant"]

        # Ensure variant belongs to this tenant
        if variant.tenant != request.tenant:
            return Response(
                {"error": {"code": "permission_denied", "message": "Variant not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        movement = StockMovement.objects.create(
            tenant=request.tenant,
            variant=variant,
            branch=data.get("branch"),
            quantity_delta=data["quantity_delta"],
            reason=data["reason"],
            notes=data.get("notes", ""),
            user=request.user,
        )

        return Response(StockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="bulk-adjust")
    def bulk_adjust(self, request):
        """
        Bulk stock adjustment — adjust multiple variants in one request.
        POST /inventory/movements/bulk-adjust/
        Body: {
            "adjustments": [{"variant": <id>, "quantity_delta": <int>}, ...],
            "reason": "reception",
            "branch": <branch_id|null>,
            "notes": "optional note"
        }
        """
        self.require_manager()

        serializer = BulkStockAdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        reason = data["reason"]
        branch = data.get("branch")
        notes = data.get("notes", "")
        adjustments = data["adjustments"]

        created = []
        with transaction.atomic():
            for adj in adjustments:
                variant = adj["variant"]
                delta = adj["quantity_delta"]

                if delta == 0:
                    continue

                # Ensure variant belongs to this tenant
                if variant.tenant != request.tenant:
                    continue

                movement = StockMovement.objects.create(
                    tenant=request.tenant,
                    variant=variant,
                    branch=branch,
                    quantity_delta=delta,
                    reason=reason,
                    notes=notes,
                    user=request.user,
                )
                created.append({
                    "variant_id": variant.pk,
                    "quantity_delta": delta,
                    "movement_id": movement.pk,
                })

        return Response(
            {"created_count": len(created), "movements": created},
            status=status.HTTP_201_CREATED,
        )


class StockTransferViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = StockTransfer.objects.select_related(
        "from_branch", "to_branch", "variant__product", "created_by", "received_by"
    )
    serializer_class = StockTransferSerializer
    filterset_fields = ["status", "from_branch", "to_branch"]
    search_fields = ["variant__product__name", "from_branch__name", "to_branch__name"]

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant, created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_transfer(self, request, pk=None):
        """Mark a pending transfer as in_transit (goods have left the source branch)."""
        self.require_manager()
        transfer = self.get_object()
        if transfer.status != "pending":
            return Response(
                {"detail": "Seul un transfert en attente peut être expédié."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transfer.status = "in_transit"
        transfer.save(update_fields=["status"])
        return Response(StockTransferSerializer(transfer).data)

    @action(detail=True, methods=["post"], url_path="receive")
    def receive(self, request, pk=None):
        """Confirm receipt: create stock movements and mark transfer as received."""
        self.require_manager()
        transfer = self.get_object()
        if transfer.status not in ("pending", "in_transit"):
            return Response(
                {"detail": "Seul un transfert en attente ou en transit peut être réceptionné."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transfer.mark_received(request.user)
        return Response(StockTransferSerializer(transfer).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        """Cancel a transfer that hasn't been received yet."""
        self.require_manager()
        transfer = self.get_object()
        if transfer.status in ("received", "cancelled"):
            return Response(
                {"detail": "Ce transfert ne peut plus être annulé."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transfer.status = "cancelled"
        transfer.save(update_fields=["status"])
        return Response(StockTransferSerializer(transfer).data)


class LowStockViewSet(TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Variants currently below alert threshold."""
    serializer_class = VariantSerializer

    def get_queryset(self):
        from django.db.models import F
        return Variant.objects.filter(
            tenant=self.request.tenant,
            is_active=True,
            alert_threshold__gt=0,
            stock_qty__lte=F("alert_threshold"),
        ).select_related("product")
