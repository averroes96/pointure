"""Inventory API views."""
from decimal import Decimal
from django.db import transaction
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.models import Branch, RoleChoices
from apps.inventory.models import (
    DefectItem,
    DefectReasonChoices,
    DefectStatusChoices,
    MovementReasonChoices,
    Product,
    StockMovement,
    StockTransfer,
    Variant,
    StocktakeItem,
    StocktakeSession,
    StocktakeStatusChoices,
)
from apps.inventory.serializers import (
    BulkStockAdjustmentSerializer,
    DefectItemSerializer,
    GenerateVariantsSerializer,
    ProductCreateSerializer,
    ProductListSerializer,
    ProductSerializer,
    StockAdjustmentSerializer,
    StockMovementSerializer,
    StockTransferSerializer,
    VariantSerializer,
    StocktakeItemSerializer,
    StocktakeSessionListSerializer,
    StocktakeSessionDetailSerializer,
    CreateStocktakeSessionSerializer,
)


class ProductViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Product.objects.all()
    filterset_fields = ["category", "gender", "season", "is_active", "brand"]
    search_fields = []
    ordering_fields = ["name", "sale_price", "purchase_price", "created_at", "total_stock_qty"]
    ordering = ["name"]

    def get_serializer_class(self):
        if self.action in ["list", "low_stock"]:
            return ProductListSerializer
        return ProductSerializer

    def get_queryset(self):
        from decimal import Decimal
        from django.db.models import F, IntegerField, OuterRef, Prefetch, Subquery, Sum, Value, Q
        from django.db.models.functions import Coalesce
        from apps.inventory.models import ProductLocation

        qs = super().get_queryset()
        params = self.request.query_params
        branch_id = params.get("branch_id")

        # Fast non-joining search: search across Product fields AND matching variant barcodes / location
        # without doing expensive reverse-relation LEFT JOINs that force DISTINCT across all 6,800+ rows.
        search = params.get("search", "").strip()
        if search:
            tenant = self._get_tenant()
            variant_qs = Variant.objects.all()
            loc_qs = ProductLocation.objects.all()
            if tenant:
                variant_qs = variant_qs.filter(tenant=tenant)
                loc_qs = loc_qs.filter(tenant=tenant)

            matching_variant_product_ids = list(
                variant_qs
                .filter(barcode__icontains=search)
                .values_list("product_id", flat=True)[:500]
            )
            matching_loc_product_ids = list(
                loc_qs
                .filter(location__icontains=search)
                .values_list("product_id", flat=True)[:500]
            )
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(brand__icontains=search)
                | Q(reference__icontains=search)
                | Q(id__in=matching_variant_product_ids)
                | Q(id__in=matching_loc_product_ids)
            )

        # Stock status filter: in_stock | low_stock | out_of_stock
        stock_status = params.get("stock_status")
        ordering = params.get("ordering", "")
        needs_stock_annotation = bool(
            stock_status in ["in_stock", "low_stock", "out_of_stock"]
            or "total_stock_qty" in ordering
        )

        # CRITICAL OPTIMIZATION: Only annotate total_stock_qty with a correlated subquery
        # when the user specifically requests filtering or sorting by total_stock_qty.
        # ProductListSerializer already sums prefetched variants in-memory, so normal
        # product listing bypasses this expensive subquery completely, making COUNT(*)
        # and pagination instantaneous.
        if needs_stock_annotation:
            if branch_id:
                product_stock_subq = (
                    StockMovement.objects
                    .filter(variant__product_id=OuterRef("pk"), branch_id=branch_id)
                    .order_by()
                    .values("variant__product_id")
                    .annotate(total=Sum("quantity_delta"))
                    .values("total")
                )
            else:
                product_stock_subq = (
                    Variant.objects
                    .filter(product_id=OuterRef("pk"))
                    .order_by()
                    .values("product_id")
                    .annotate(total=Sum("stock_qty"))
                    .values("total")
                )

            qs = qs.annotate(
                total_stock_qty=Coalesce(
                    Subquery(product_stock_subq, output_field=IntegerField()),
                    Value(0),
                )
            )

            if stock_status == "in_stock":
                qs = qs.filter(total_stock_qty__gt=0)
            elif stock_status == "out_of_stock":
                qs = qs.filter(total_stock_qty__lte=0)
            elif stock_status == "low_stock":
                qs = qs.filter(
                    total_stock_qty__gt=0,
                    total_stock_qty__lte=F("alert_threshold"),
                    alert_threshold__gt=0,
                )

        # Price range filters
        min_price = params.get("min_price")
        if min_price:
            try:
                qs = qs.filter(sale_price__gte=Decimal(min_price))
            except Exception:
                pass

        max_price = params.get("max_price")
        if max_price:
            try:
                qs = qs.filter(sale_price__lte=Decimal(max_price))
            except Exception:
                pass

        if branch_id:
            branch_stock_subq = (
                StockMovement.objects
                .filter(variant_id=OuterRef("pk"), branch_id=branch_id)
                .order_by()
                .values("variant_id")
                .annotate(total=Sum("quantity_delta"))
                .values("total")
            )
            variant_qs = Variant.objects.all()
            tenant = self._get_tenant()
            if tenant:
                variant_qs = variant_qs.filter(tenant=tenant)
            branch_variant_qs = (
                variant_qs
                .annotate(branch_stock_qty=Coalesce(
                    Subquery(branch_stock_subq, output_field=IntegerField()),
                    Value(0),
                ))
            )
            return qs.prefetch_related(
                Prefetch("variants", queryset=branch_variant_qs),
                "branch_locations",
            )

        return qs.prefetch_related("variants", "branch_locations")

    @action(detail=False, methods=["get"], url_path="brands")
    def brands(self, request):
        """Return distinct non-empty brands for this tenant."""
        brands_list = (
            Product.objects.filter(tenant=request.tenant)
            .exclude(brand="")
            .values_list("brand", flat=True)
            .distinct()
            .order_by("brand")
        )
        return Response(list(brands_list))

    @action(detail=False, methods=["get"], url_path="locations")
    def locations(self, request):
        """Return distinct non-empty shelf/rayon locations for this tenant."""
        from apps.inventory.models import ProductLocation
        qs = ProductLocation.objects.filter(tenant=request.tenant).exclude(location="")
        branch_id = request.query_params.get("branch")
        if branch_id and branch_id != "null":
            qs = qs.filter(branch_id=branch_id)
        locs = qs.values_list("location", flat=True).distinct().order_by("location")
        return Response(list(locs))

    def perform_create(self, serializer):
        from apps.core.plan_permissions import check_quota
        check_quota(self.request, "products", Product.objects.filter(tenant=self.request.tenant).count())
        serializer.save(tenant=self.request.tenant)

    def update(self, request, *args, **kwargs):
        location = request.data.get("location")
        barcode = request.data.get("barcode")
        response = super().update(request, *args, **kwargs)
        product = self.get_object()
        branch_id = request.data.get('branch_id')
        if location is not None and getattr(request.tenant, "plan", "free") != "free" and branch_id and branch_id != "null":
            from apps.inventory.models import ProductLocation
            ProductLocation.objects.update_or_create(
                tenant=request.tenant,
                branch_id=branch_id,
                product=product,
                defaults={"location": location}
            )
        if barcode is not None and str(barcode).strip():
            variant = product.variants.first()
            if variant and variant.barcode != str(barcode).strip():
                variant.barcode = str(barcode).strip()
                variant.save(update_fields=["barcode"])
        return response

    def create(self, request, *args, **kwargs):
        """
        Override create to handle optional nested `variants` field.
        If `variants` with sizes is provided, creates the size×colour combinations.
        If not provided (Simple Mode), creates a default variant (size_eu=0, colour='Standard')
        with custom/auto-generated barcode and initial stock movement if requested.
        """
        create_serializer = ProductCreateSerializer(data=request.data)
        create_serializer.is_valid(raise_exception=True)

        variants_data = create_serializer.validated_data.pop("variants", None)
        location_data = create_serializer.validated_data.pop("location", None)
        barcode_data = create_serializer.validated_data.pop("barcode", None) or (request.data.get("barcode") or "").strip() or None
        initial_stock = create_serializer.validated_data.pop("initial_stock", 0) or 0
        try:
            initial_stock = int(request.data.get("initial_stock", initial_stock) or 0)
        except (ValueError, TypeError):
            initial_stock = 0

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
            if variants_data and variants_data.get("sizes"):
                sizes = variants_data.get("sizes", [])
                colours = variants_data.get("colours") or ["N/A"]
                threshold = variants_data.get("alert_threshold", product.alert_threshold or 3)
                for size in sizes:
                    for colour in colours:
                        Variant.objects.get_or_create(
                            tenant=request.tenant,
                            product=product,
                            size_eu=size,
                            colour=colour,
                            defaults={"alert_threshold": threshold},
                        )
            else:
                # Mode Simple / Default Variant
                variant, _ = Variant.objects.get_or_create(
                    tenant=request.tenant,
                    product=product,
                    size_eu=0,
                    colour="Standard",
                    defaults={
                        "alert_threshold": product.alert_threshold or 3,
                        "barcode": barcode_data or "",
                    },
                )
                if barcode_data and variant.barcode != barcode_data:
                    variant.barcode = barcode_data
                    variant.save(update_fields=["barcode"])

                # Handle initial stock movement if specified
                if initial_stock > 0:
                    branch = None
                    if branch_id and branch_id != "null":
                        branch = Branch.objects.filter(tenant=request.tenant, id=branch_id).first()
                    if not branch and getattr(request, "branch", None):
                        branch = request.branch
                    if not branch:
                        branch = Branch.objects.filter(tenant=request.tenant, is_active=True).first()

                    StockMovement.objects.create(
                        tenant=request.tenant,
                        variant=variant,
                        branch=branch,
                        quantity_delta=initial_stock,
                        reason=MovementReasonChoices.INITIAL,
                        user=request.user,
                        notes="Stock initial à la création du produit",
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

        REQUIRED = {"name", "sale_price"}
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

                # Optional size (default 0 for simple mode)
                size_str = str(row.get("size_eu", "") or row.get("size", "") or "").strip()
                if size_str:
                    try:
                        size_eu = int(float(size_str))
                        if not (0 <= size_eu <= 60):
                            raise ValueError
                    except (ValueError, KeyError):
                        errors.append({"row": i, "message": f"size_eu invalide (0–60) : {size_str}"})
                        continue
                else:
                    size_eu = 0

                # Optional colour (default Standard)
                colour = str(row.get("colour", "") or row.get("color", "") or "").strip() or "Standard"

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

                variant, variant_created = Variant.objects.get_or_create(
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
                    # Support initial stock on import
                    init_stock = 0
                    for stock_col in ("initial_stock", "quantity", "stock", "qte"):
                        val = row.get(stock_col)
                        if val is not None and str(val).strip():
                            try:
                                init_stock = int(float(str(val).replace(",", ".")))
                                break
                            except (ValueError, TypeError):
                                pass
                    if init_stock > 0:
                        branch = getattr(request, "branch", None) or Branch.objects.filter(tenant=tenant, is_active=True).first()
                        StockMovement.objects.create(
                            tenant=tenant,
                            variant=variant,
                            branch=branch,
                            quantity_delta=init_stock,
                            reason=MovementReasonChoices.INITIAL,
                            user=request.user,
                            notes="Import de stock initial",
                        )
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
        Return barcode labels — one label per page, page sized exactly to
        the label so the printer doesn't add blank space or scale it.

        Query params:
          w, h     label size in mm (default 45 × 35)
          output   "html" → raw HTML for the desktop native print dialog,
                   otherwise a PDF.
        """
        w_mm, h_mm = _label_dims(request)
        product = self.get_object()
        variants = list(
            product.variants
            .filter(is_active=True)
            .order_by("size_eu", "colour")
        )

        for v in variants:
            if not v.barcode:
                v.barcode = generate_barcode(v)
                Variant.objects.filter(pk=v.pk).update(barcode=v.barcode)

        labels_html = "\n".join(
            _render_label(product, v, w_mm, h_mm) for v in variants if v.barcode
        )

        if not labels_html:
            labels_html = (
                '<div class="page"><p style="font-family:sans-serif;color:#888;">'
                "Aucune variante active avec code-barres.</p></div>"
            )

        html_string = _barcode_page(
            title=f"{product.name} — Étiquettes",
            labels_html=labels_html,
            w_mm=w_mm,
            h_mm=h_mm,
        )

        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in product.name)
        return _label_response(request, html_string, filename=f"barcodes_{safe_name}.pdf")

    @action(detail=True, methods=["get"], url_path="shelf-labels")
    def shelf_labels(self, request, pk=None):
        """
        Return shelf/location labels (reference, location, sale price).
        Query params: ?copies=N (default 1), ?w=&h= (mm), ?output=html.
        """
        w_mm, h_mm = _label_dims(request)
        product = self.get_object()
        try:
            copies = max(1, min(int(request.query_params.get("copies", 1)), 200))
        except (ValueError, TypeError):
            copies = 1

        branch_id = getattr(request, "branch_id", None)
        if hasattr(request, "branch") and request.branch:
            branch_id = request.branch.id
        from apps.inventory.models import ProductLocation
        loc_obj = product.branch_locations.filter(branch_id=branch_id).first() if branch_id else product.branch_locations.first()
        location_str = loc_obj.location if loc_obj else ""

        variant = product.variants.filter(is_active=True).first()
        if variant and not variant.barcode:
            variant.barcode = generate_barcode(variant)
            Variant.objects.filter(pk=variant.pk).update(barcode=variant.barcode)

        single_html = _render_shelf_label(
            product, location=location_str, variant=variant, w_mm=w_mm, h_mm=h_mm
        )
        labels_html = "\n".join(single_html for _ in range(copies))

        html_string = _shelf_labels_page(
            title=f"{product.name} — Étiquette Rayon",
            labels_html=labels_html,
            w_mm=w_mm,
            h_mm=h_mm,
        )

        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in product.name)
        return _label_response(request, html_string, filename=f"etiquette_rayon_{safe_name}.pdf")

    @action(detail=False, methods=["get", "post"], url_path="shelf-labels")
    def bulk_shelf_labels(self, request):
        """
        Generate consolidated PDF of shelf labels for multiple products.
        Accepts:
          POST JSON: {"product_ids": [1, 2, ...], "copies": 1}
          or GET ?product_ids=1,2,3&copies=1
        Label size via ?w=&h= (mm); ?output=html returns raw HTML.
        """
        w_mm, h_mm = _label_dims(request)
        if request.method == "POST":
            product_ids = request.data.get("product_ids", [])
            copies = request.data.get("copies", 1)
        else:
            raw_ids = request.query_params.get("product_ids") or request.query_params.get("ids", "")
            product_ids = [int(x.strip()) for x in raw_ids.split(",") if x.strip().isdigit()]
            copies = request.query_params.get("copies", 1)

        try:
            copies = max(1, min(int(copies), 50))
        except (ValueError, TypeError):
            copies = 1

        if not product_ids:
            return Response({"error": "product_ids list required"}, status=status.HTTP_400_BAD_REQUEST)

        products = list(
            Product.objects.filter(tenant=request.tenant, id__in=product_ids)
            .prefetch_related("branch_locations", "variants")
        )
        if not products:
            return Response({"detail": "Aucun produit trouvé."}, status=status.HTTP_404_NOT_FOUND)

        branch_id = getattr(request, "branch_id", None)
        if hasattr(request, "branch") and request.branch:
            branch_id = request.branch.id

        labels_list = []
        for p in products:
            loc_obj = p.branch_locations.filter(branch_id=branch_id).first() if branch_id else p.branch_locations.first()
            location_str = loc_obj.location if loc_obj else ""
            variant = p.variants.filter(is_active=True).first()
            if variant and not variant.barcode:
                variant.barcode = generate_barcode(variant)
                Variant.objects.filter(pk=variant.pk).update(barcode=variant.barcode)

            single_html = _render_shelf_label(
                p, location=location_str, variant=variant, w_mm=w_mm, h_mm=h_mm
            )
            for _ in range(copies):
                labels_list.append(single_html)

        labels_html = "\n".join(labels_list)
        html_string = _shelf_labels_page(
            title=f"Étiquettes Rayon ({len(products)} produits)",
            labels_html=labels_html,
            w_mm=w_mm,
            h_mm=h_mm,
        )

        return _label_response(request, html_string, filename="etiquettes_rayon_selection.pdf")

    def destroy(self, request, *args, **kwargs):
        """
        Permanently delete a product (hard delete).
        Ensures foreign key dependencies with PROTECT are cleanly removed:
        - Variants and their StockMovements, StockTransfers, Defects, ProductLocations
        - If the product has sales/invoices, require ?force=true to prevent accidental loss
        """
        self.require_manager()
        product = self.get_object()
        variants = list(product.variants.all())

        from apps.sales.models import SaleItem, ReturnItem, ExchangeItem
        from apps.invoicing.models import InvoiceItem, DeliveryNoteItem
        from apps.suppliers.models import PurchaseOrderItem
        from apps.inventory.models import StockMovement, StockTransfer, Defect, ProductLocation

        sales_count = SaleItem.objects.filter(variant__in=variants).count()
        invoices_count = InvoiceItem.objects.filter(variant__in=variants).count()
        returns_count = ReturnItem.objects.filter(variant__in=variants).count()
        po_count = PurchaseOrderItem.objects.filter(variant__in=variants).count()
        total_transactions = sales_count + invoices_count + returns_count + po_count

        force = request.query_params.get("force", "").lower() in ("1", "true", "yes")

        if total_transactions > 0 and not force:
            details = []
            if sales_count > 0:
                details.append(f"{sales_count} vente(s)")
            if invoices_count > 0:
                details.append(f"{invoices_count} ligne(s) de facture")
            if returns_count > 0:
                details.append(f"{returns_count} retour(s)")
            if po_count > 0:
                details.append(f"{po_count} commande(s) fournisseur")

            return Response(
                {
                    "error": "has_transactions",
                    "can_force": True,
                    "total_transactions": total_transactions,
                    "message": (
                        f"Ce produit est référencé dans {' et '.join(details)}. "
                        "Confirmez la suppression forcée pour supprimer définitivement le produit "
                        "et purger ces références historiques associées."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            if total_transactions > 0 and force:
                SaleItem.objects.filter(variant__in=variants).delete()
                ReturnItem.objects.filter(variant__in=variants).delete()
                ExchangeItem.objects.filter(variant__in=variants).delete()
                InvoiceItem.objects.filter(variant__in=variants).delete()
                DeliveryNoteItem.objects.filter(variant__in=variants).delete()
                PurchaseOrderItem.objects.filter(variant__in=variants).delete()

            StockMovement.objects.filter(variant__in=variants).delete()
            StockTransfer.objects.filter(variant__in=variants).delete()
            Defect.objects.filter(variant__in=variants).delete()
            ProductLocation.objects.filter(product=product).delete()

            for v in variants:
                v.delete()
            product.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="bulk-delete")
    def bulk_delete(self, request):
        """Bulk permanently delete multiple products."""
        self.require_manager()
        product_ids = request.data.get("product_ids", [])
        force = bool(request.data.get("force", False))

        if not product_ids or not isinstance(product_ids, list):
            return Response({"error": "product_ids list required"}, status=status.HTTP_400_BAD_REQUEST)

        products = list(Product.objects.filter(tenant=request.tenant, id__in=product_ids))
        if not products:
            return Response({"detail": "Aucun produit trouvé."}, status=status.HTTP_404_NOT_FOUND)

        from apps.sales.models import SaleItem, ReturnItem, ExchangeItem
        from apps.invoicing.models import InvoiceItem, DeliveryNoteItem
        from apps.suppliers.models import PurchaseOrderItem
        from apps.inventory.models import StockMovement, StockTransfer, Defect, ProductLocation

        if not force:
            blocked = []
            for p in products:
                vars_ids = p.variants.values_list("id", flat=True)
                s_count = SaleItem.objects.filter(variant_id__in=vars_ids).count()
                if s_count > 0:
                    blocked.append({"id": p.id, "name": p.name, "sales": s_count})
            if blocked:
                return Response(
                    {
                        "error": "has_transactions",
                        "can_force": True,
                        "blocked_products": blocked,
                        "message": f"{len(blocked)} produit(s) sélectionné(s) possèdent des ventes enregistrées. Confirmez pour forcer la suppression.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        deleted_count = 0
        with transaction.atomic():
            for p in products:
                variants = list(p.variants.all())
                if force:
                    SaleItem.objects.filter(variant__in=variants).delete()
                    ReturnItem.objects.filter(variant__in=variants).delete()
                    ExchangeItem.objects.filter(variant__in=variants).delete()
                    InvoiceItem.objects.filter(variant__in=variants).delete()
                    DeliveryNoteItem.objects.filter(variant__in=variants).delete()
                    PurchaseOrderItem.objects.filter(variant__in=variants).delete()

                StockMovement.objects.filter(variant__in=variants).delete()
                StockTransfer.objects.filter(variant__in=variants).delete()
                Defect.objects.filter(variant__in=variants).delete()
                ProductLocation.objects.filter(product=p).delete()

                for v in variants:
                    v.delete()
                p.delete()
                deleted_count += 1

        return Response({"deleted": deleted_count, "detail": f"{deleted_count} produit(s) supprimé(s) définitivement."})

    @action(detail=False, methods=["post"], url_path="bulk-price-update")
    def bulk_price_update(self, request):
        """
        Mass price update for selected products.
        Supports:
        - update_type: 'percentage' (+10%, -5%), 'fixed_delta' (+500 DZD, -200 DZD), 'fixed_set' (set all to 2500 DZD)
        - target_field: 'sale_price' (default) or 'wholesale_price'
        - value: decimal/float (e.g. 10 for +10%, -500 for -500 DZD)
        - rounding: 'none', 'nearest_10', 'nearest_50', 'nearest_100', 'end_90'
        - product_ids: list of int
        """
        self.require_manager()
        product_ids = request.data.get("product_ids", [])
        if not product_ids or not isinstance(product_ids, list):
            return Response({"error": "product_ids list required"}, status=status.HTTP_400_BAD_REQUEST)

        update_type = request.data.get("update_type", "percentage")
        target_field = request.data.get("target_field", "sale_price")
        if target_field not in ("sale_price", "wholesale_price"):
            return Response({"error": "target_field must be 'sale_price' or 'wholesale_price'"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            val = Decimal(str(request.data.get("value", 0)))
        except Exception as exc:
            return Response({"error": f"Invalid numeric value provided: {exc}"}, status=status.HTTP_400_BAD_REQUEST)

        rounding = request.data.get("rounding", "none")

        products = list(Product.objects.filter(tenant=request.tenant, id__in=product_ids))
        if not products:
            return Response({"detail": "Aucun produit trouvé."}, status=status.HTTP_404_NOT_FOUND)

        updated_summary = []
        with transaction.atomic():
            for p in products:
                current_price = getattr(p, target_field) or Decimal("0.00")
                if update_type == "percentage":
                    factor = Decimal("1.00") + (val / Decimal("100.00"))
                    new_price = current_price * factor
                elif update_type == "fixed_delta":
                    new_price = current_price + val
                elif update_type == "fixed_set":
                    new_price = val
                else:
                    return Response({"error": f"Unknown update_type: {update_type}"}, status=status.HTTP_400_BAD_REQUEST)

                # Rounding logic
                if rounding == "nearest_10":
                    new_price = (new_price / Decimal("10")).quantize(Decimal("1"), rounding="ROUND_HALF_UP") * Decimal("10")
                elif rounding == "nearest_50":
                    new_price = (new_price / Decimal("50")).quantize(Decimal("1"), rounding="ROUND_HALF_UP") * Decimal("50")
                elif rounding == "nearest_100":
                    new_price = (new_price / Decimal("100")).quantize(Decimal("1"), rounding="ROUND_HALF_UP") * Decimal("100")
                elif rounding == "end_90":
                    hundreds = (new_price / Decimal("100")).quantize(Decimal("1"), rounding="ROUND_HALF_UP") * Decimal("100")
                    new_price = max(Decimal("0.00"), hundreds - Decimal("10.00"))
                else:
                    new_price = new_price.quantize(Decimal("0.01"))

                # Floor at zero
                new_price = max(Decimal("0.00"), new_price)

                setattr(p, target_field, new_price)
                p.save(update_fields=[target_field, "updated_at"])

                diff = new_price - current_price
                diff_str = f"+{diff:.2f}" if diff > 0 else f"{diff:.2f}"

                updated_summary.append({
                    "id": p.id,
                    "name": p.name,
                    "reference": p.reference,
                    "brand": p.brand,
                    "old_price": str(current_price),
                    "new_price": str(new_price),
                    "difference": diff_str,
                })

        return Response({
            "updated_count": len(updated_summary),
            "target_field": target_field,
            "product_ids": [p["id"] for p in updated_summary],
            "updated_products": updated_summary,
            "message": f"Prix mis à jour pour {len(updated_summary)} produit(s).",
        })


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


def _barcode_svg(
    value: str,
    height: int = 60,
    module_w: float = 2.0,
    width_mm: float = 76.0,
    height_mm: float | None = None,
) -> str:
    """
    Encode a numeric string of even length as a CODE-128C SVG barcode.
    Returns bare SVG bars only — no embedded text (caller adds human-readable number).
    Uses a physical width (``width_mm``) so the renderer scales it to the exact
    millimetre size regardless of pixel DPI. When ``height_mm`` is given the bars
    are stretched vertically to that exact height (bars only scale, so this is
    safe for scanners).
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

    # Physical width tells the renderer the real size; viewBox scales the coordinates.
    size_attrs = f' width="{width_mm:.2f}mm"'
    aspect = "xMidYMid meet"
    if height_mm:
        size_attrs += f' height="{height_mm:.2f}mm"'
        aspect = "none"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg"'
        f' viewBox="0 0 {total_w:.2f} {height}"'
        f'{size_attrs}'
        f' preserveAspectRatio="{aspect}">'
        + "".join(bar_rects)
        + "</svg>"
    )


# ── Label geometry helpers ──────────────────────────────────────────────────
# Default label roll: 45 mm × 35 mm (Gprinter GP-3150TN / Xprinter style rolls).
DEFAULT_LABEL_W_MM = 45.0
DEFAULT_LABEL_H_MM = 35.0
_LABEL_INSET_MM = 1.2


def _label_dims(request, default_w: float = DEFAULT_LABEL_W_MM, default_h: float = DEFAULT_LABEL_H_MM):
    """Read ``w`` / ``h`` (millimetres) from the query string, clamped to sane bounds."""
    def _read(key: str, default: float) -> float:
        try:
            val = float(request.query_params.get(key, default))
        except (TypeError, ValueError):
            val = default
        return max(15.0, min(val, 150.0))

    return _read("w", default_w), _read("h", default_h)


def _fit_pt(text: str, base_pt: float, max_chars: int) -> float:
    """Shrink a font size so that long strings still fit on a single line."""
    n = len(text or "")
    if n <= max_chars:
        return base_pt
    return max(base_pt * max_chars / n, base_pt * 0.45)


def _label_base_css(w_mm: float, h_mm: float) -> str:
    """
    Shared page CSS for all thermal labels.

    * Page is exactly the label size with zero margins → no scaling by the
      print pipeline, no shifting.
    * Each label lives in its own ``.page`` box (one label = one page).
    * ``--ox`` / ``--oy`` are calibration offsets (mm) the desktop print dialog
      can override to compensate for printer-head misalignment.
    """
    # Slightly shorter than the page to avoid Chromium emitting a blank page
    # from sub-pixel rounding.
    page_h = h_mm - 0.3
    return f"""
  @page {{
    size: {w_mm:.2f}mm {h_mm:.2f}mm;
    margin: 0;
  }}
  :root {{ --ox: 0mm; --oy: 0mm; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: {w_mm:.2f}mm;
    background: white;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}
  body {{
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }}
  .page {{
    width: {w_mm:.2f}mm;
    height: {page_h:.2f}mm;
    padding: {_LABEL_INSET_MM}mm;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }}
  .page:last-child {{
    page-break-after: auto;
    break-after: auto;
  }}
  .page > * {{
    transform: translate(var(--ox), var(--oy));
  }}
"""


def _render_label(product, variant, w_mm: float = DEFAULT_LABEL_W_MM, h_mm: float = DEFAULT_LABEL_H_MM) -> str:
    """
    One barcode label = one page.
    No text inside the SVG — avoids double-printing the barcode number.
    """
    s = min(w_mm / DEFAULT_LABEL_W_MM, h_mm / DEFAULT_LABEL_H_MM)
    inner_w = w_mm - 2 * _LABEL_INSET_MM
    inner_h = h_mm - 2 * _LABEL_INSET_MM

    name = f"{product.name}{' · ' + product.brand if product.brand else ''}"
    info = f"EU {variant.size_eu} · {variant.colour}"

    name_pt = _fit_pt(name, 8.5 * s, int(26 * w_mm / DEFAULT_LABEL_W_MM))
    info_pt = 7.5 * s
    code_pt = 7 * s

    # Remaining vertical room for the bars (1pt ≈ 0.3528 mm, ×1.2 line-height)
    text_mm = (name_pt + info_pt + code_pt) * 0.3528 * 1.2 + 2.0
    bc_h = max(6.0, min(inner_h - text_mm, 18.0 * s))
    bc_w = inner_w - 1.0

    svg = _barcode_svg(variant.barcode, height=80, module_w=2.5, width_mm=bc_w, height_mm=bc_h)
    return (
        f'<div class="page"><div class="label">'
        f'<p class="name" style="font-size:{name_pt:.2f}pt">{name}</p>'
        f'<p class="info" style="font-size:{info_pt:.2f}pt">{info}</p>'
        f'<div class="bc">{svg}</div>'
        f'<p class="code" style="font-size:{code_pt:.2f}pt">{variant.barcode}</p>'
        f'</div></div>'
    )


def _barcode_page(
    title: str,
    labels_html: str,
    w_mm: float = DEFAULT_LABEL_W_MM,
    h_mm: float = DEFAULT_LABEL_H_MM,
) -> str:
    """
    HTML document for barcode labels. Each @page is exactly ``w_mm × h_mm``
    (default 45 × 35 mm) with zero margins.
    """
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
{_label_base_css(w_mm, h_mm)}
  .label {{
    width: 100%;
    height: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }}
  .name {{
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    line-height: 1.2;
  }}
  .info {{
    font-weight: 600;
    color: #222;
    margin-bottom: 0.8mm;
    line-height: 1.2;
  }}
  .bc {{
    line-height: 0;
  }}
  .bc svg {{ display: block; }}
  .code {{
    font-family: monospace;
    letter-spacing: 0.06em;
    margin-top: 0.6mm;
    line-height: 1.2;
  }}
</style>
</head>
<body>
{labels_html}
</body>
</html>"""


def _build_pdf_response(html_string: str, filename: str) -> HttpResponse:
    try:
        from django.conf import settings
        if getattr(settings, "DESKTOP_MODE", False):
            from apps.core.desktop.pdf_client import render_html_to_pdf
            pdf_bytes = render_html_to_pdf(html_string)
        else:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html_string, base_url=".").write_pdf()
    except Exception as exc:
        return HttpResponse(
            f"PDF generation failed: {exc}",
            content_type="text/plain",
            status=500,
        )

    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="{filename}"'
    return response


def _label_response(request, html_string: str, filename: str) -> HttpResponse:
    """
    Return label output either as raw HTML (``?output=html`` — used by the
    desktop integrated print dialog, which prints the HTML natively at the
    exact label size) or as a PDF (default / web fallback).
    """
    if request.query_params.get("output") == "html":
        return HttpResponse(html_string, content_type="text/html; charset=utf-8")
    return _build_pdf_response(html_string, filename=filename)


def _render_shelf_label(
    product,
    location: str = "",
    variant=None,
    w_mm: float = DEFAULT_LABEL_W_MM,
    h_mm: float = DEFAULT_LABEL_H_MM,
) -> str:
    """
    Render a shelf / shoe-box location label (default 45 mm × 35 mm).

    Three lines only, no captions, so every millimetre goes to the text:
      1. Reference (falls back to product name) — shown once
      2. Location / emplacement — largest text
      3. Sale price in DZD
    """
    s = min(w_mm / DEFAULT_LABEL_W_MM, h_mm / DEFAULT_LABEL_H_MM)
    width_factor = w_mm / DEFAULT_LABEL_W_MM

    ref_text = (product.reference or "").strip() or (product.name or "").strip()
    loc_text = location.strip() if (location and location.strip()) else "—"
    price_text = f"{product.sale_price:,.0f}".replace(",", " ")

    ref_pt = _fit_pt(ref_text, 13 * s, int(13 * width_factor))
    loc_pt = _fit_pt(loc_text, 26 * s, int(7 * width_factor))
    price_pt = _fit_pt(price_text, 22 * s, int(7 * width_factor))
    dzd_pt = max(price_pt * 0.45, 6 * s)

    return f"""
    <div class="page">
      <div class="shelf-label">
        <div class="ref" style="font-size:{ref_pt:.2f}pt">{ref_text}</div>
        <div class="loc" style="font-size:{loc_pt:.2f}pt">{loc_text}</div>
        <div class="price" style="font-size:{price_pt:.2f}pt">{price_text}<span class="dzd" style="font-size:{dzd_pt:.2f}pt">DZD</span></div>
      </div>
    </div>
    """


def _shelf_labels_page(
    title: str,
    labels_html: str,
    w_mm: float = DEFAULT_LABEL_W_MM,
    h_mm: float = DEFAULT_LABEL_H_MM,
) -> str:
    """
    HTML document for shelf / location labels. Each @page is exactly
    ``w_mm × h_mm`` (default 45 × 35 mm) with zero margins.
    """
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
{_label_base_css(w_mm, h_mm)}
  .shelf-label {{
    width: 100%;
    height: 100%;
    border: 1.2pt solid #000;
    border-radius: 2.5mm;
    padding: 0.8mm 1.5mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    text-align: center;
    overflow: hidden;
  }}
  .ref, .loc, .price {{
    white-space: nowrap;
    overflow: hidden;
    line-height: 1.05;
    color: #000;
  }}
  .ref {{
    font-weight: 800;
    letter-spacing: 0.02em;
    border-bottom: 0.8pt solid #000;
    padding-bottom: 0.6mm;
  }}
  .loc {{
    font-weight: 900;
    letter-spacing: 0.03em;
  }}
  .price {{
    font-weight: 900;
    letter-spacing: -0.01em;
    border-top: 0.8pt solid #000;
    padding-top: 0.6mm;
  }}
  .dzd {{
    font-weight: 800;
    margin-left: 1mm;
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
    search_fields = ["barcode", "colour", "product__name", "product__brand", "product__reference"]

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
        Return barcode labels for a single variant.

        Query params:
          copies=N  (int, default 1) — repeat the label N times.
                    Use this to print exactly as many stickers as items received.
          w, h      label size in mm (default 45 × 35)
          output    "html" → raw HTML for the desktop native print dialog.
        """
        w_mm, h_mm = _label_dims(request)
        variant = self.get_object()
        if not variant.barcode:
            variant.barcode = generate_barcode(variant)
            Variant.objects.filter(pk=variant.pk).update(barcode=variant.barcode)

        try:
            copies = max(1, min(int(request.query_params.get("copies", 1) or 1), 200))
        except (TypeError, ValueError):
            copies = 1

        product = variant.product
        single_label = _render_label(product, variant, w_mm, h_mm)
        labels_html = "\n".join([single_label] * copies)

        html_string = _barcode_page(
            title=f"{product.name} EU{variant.size_eu} {variant.colour} — étiquettes",
            labels_html=labels_html,
            w_mm=w_mm,
            h_mm=h_mm,
        )

        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in f"{product.name}_EU{variant.size_eu}_{variant.colour}")
        return _label_response(request, html_string, filename=f"{safe}.pdf")

    @action(detail=False, methods=["post"], url_path="batch-barcode-labels")
    def batch_barcode_labels(self, request):
        """
        POST /inventory/variants/batch-barcode-labels/
        Body: { "items": [{ "variant_id": 12, "copies": 5 }, ...], "w": 45, "h": 35, "output": "html" }
        Generates a combined barcode label sheet for a Purchase Order reception or multi-variant batch.
        """
        w_mm = float(request.data.get("w") or request.query_params.get("w") or DEFAULT_LABEL_W_MM)
        h_mm = float(request.data.get("h") or request.query_params.get("h") or DEFAULT_LABEL_H_MM)
        w_mm = min(max(w_mm, 15.0), 150.0)
        h_mm = min(max(h_mm, 15.0), 150.0)

        raw_items = request.data.get("items") or []
        if not isinstance(raw_items, list) or not raw_items:
            return Response({"detail": "Aucun article fourni."}, status=status.HTTP_400_BAD_REQUEST)

        variant_ids = [int(it.get("variant_id")) for it in raw_items if it.get("variant_id")]
        variants_map = {
            v.id: v
            for v in Variant.objects.filter(tenant=request.tenant, id__in=variant_ids).select_related("product")
        }

        labels_chunks = []
        for it in raw_items:
            vid = it.get("variant_id")
            v = variants_map.get(int(vid)) if vid else None
            if not v:
                continue
            if not v.barcode:
                v.barcode = generate_barcode(v)
                Variant.objects.filter(pk=v.pk).update(barcode=v.barcode)
            copies = max(1, min(int(it.get("copies") or 1), 100))
            single_html = _render_label(v.product, v, w_mm, h_mm)
            labels_chunks.extend([single_html] * copies)

        if not labels_chunks:
            return Response({"detail": "Aucune variante liée à imprimer."}, status=status.HTTP_400_BAD_REQUEST)

        html_string = _barcode_page(
            title="Étiquettes Réception Commande",
            labels_html="\n".join(labels_chunks),
            w_mm=w_mm,
            h_mm=h_mm,
        )
        if request.data.get("output") == "html" or request.query_params.get("output") == "html":
            return HttpResponse(html_string, content_type="text/html; charset=utf-8")
        return _build_pdf_response(html_string, filename="etiquettes_reception.pdf")


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


class DefectItemViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = DefectItem.objects.select_related(
        "variant__product", "branch", "supplier", "purchase_order", "return_claim", "logged_by", "resolved_by"
    )
    serializer_class = DefectItemSerializer
    filterset_fields = ["status", "defect_reason", "branch", "supplier", "return_claim"]
    search_fields = ["variant__product__name", "variant__product__reference", "variant__barcode", "notes"]
    ordering_fields = ["created_at", "cost_price", "quantity", "status"]
    ordering = ["-created_at"]

    def perform_create(self, serializer):
        from decimal import Decimal

        variant = serializer.validated_data["variant"]
        quantity = serializer.validated_data.get("quantity", 1)
        branch = serializer.validated_data.get("branch") or getattr(self.request.user, "branch", None)
        if not branch:
            from apps.core.models import Branch
            branch = Branch.objects.filter(tenant=self.request.tenant, is_active=True).first()

        cost_price = serializer.validated_data.get("cost_price")
        if not cost_price or cost_price == Decimal("0.00"):
            cost_price = variant.product.purchase_price

        # Isolate from active stock by generating a negative StockMovement (DAMAGED)
        with transaction.atomic():
            defect = serializer.save(
                tenant=self.request.tenant,
                branch=branch,
                cost_price=cost_price,
                logged_by=self.request.user,
            )
            StockMovement.objects.create(
                tenant=self.request.tenant,
                variant=variant,
                branch=branch,
                quantity_delta=-quantity,
                reason=MovementReasonChoices.DAMAGED,
                reference_id=str(defect.id),
                reference_type="DefectItem",
                notes=f"Mise en quarantaine défectueux: {defect.get_defect_reason_display()}",
                user=self.request.user,
            )

    @action(detail=False, methods=["get"], url_path="metrics")
    def metrics(self, request):
        from django.db.models import DecimalField, ExpressionWrapper, F, Sum
        from django.db.models.functions import Coalesce
        from decimal import Decimal

        qs = self.get_queryset()
        branch_id = request.query_params.get("branch_id")
        if branch_id:
            qs = qs.filter(branch_id=branch_id)

        quarantined = qs.filter(status=DefectStatusChoices.QUARANTINED)
        quarantined_count = quarantined.aggregate(total=Coalesce(Sum("quantity"), 0))["total"]
        quarantined_val = quarantined.annotate(
            val=ExpressionWrapper(F("quantity") * F("cost_price"), output_field=DecimalField())
        ).aggregate(total=Coalesce(Sum("val"), Decimal("0.00")))["total"]

        pending_claims = qs.filter(status=DefectStatusChoices.CLAIM_PENDING)
        pending_count = pending_claims.aggregate(total=Coalesce(Sum("quantity"), 0))["total"]
        pending_val = pending_claims.annotate(
            val=ExpressionWrapper(F("quantity") * F("cost_price"), output_field=DecimalField())
        ).aggregate(total=Coalesce(Sum("val"), Decimal("0.00")))["total"]

        returned_count = qs.filter(status=DefectStatusChoices.RETURNED).aggregate(total=Coalesce(Sum("quantity"), 0))["total"]
        resolved_count = qs.filter(status__in=[DefectStatusChoices.RETURNED, DefectStatusChoices.SOLD_DISCOUNT, DefectStatusChoices.WRITTEN_OFF]).aggregate(total=Coalesce(Sum("quantity"), 0))["total"]

        return Response({
            "quarantined_pairs": quarantined_count,
            "quarantined_value": quarantined_val,
            "pending_claims_pairs": pending_count,
            "pending_claims_value": pending_val,
            "returned_pairs": returned_count,
            "total_resolved_pairs": resolved_count,
        })

    @action(detail=True, methods=["post"], url_path="resolve-write-off")
    def resolve_write_off(self, request, pk=None):
        """Mark quarantined defect as total written-off loss."""
        from django.utils import timezone
        defect = self.get_object()
        defect.status = DefectStatusChoices.WRITTEN_OFF
        defect.resolved_by = request.user
        defect.resolved_at = timezone.now()
        if request.data.get("notes"):
            defect.notes = f"{defect.notes}\n[Rebut] {request.data.get('notes')}".strip()
        defect.save(update_fields=["status", "resolved_by", "resolved_at", "notes"])
        return Response(DefectItemSerializer(defect).data)

    @action(detail=True, methods=["post"], url_path="resolve-discount-sale")
    def resolve_discount_sale(self, request, pk=None):
        """Mark defect as sold at discount (2ème choix)."""
        from django.utils import timezone
        defect = self.get_object()
        defect.status = DefectStatusChoices.SOLD_DISCOUNT
        defect.resolved_by = request.user
        defect.resolved_at = timezone.now()
        if request.data.get("notes"):
            defect.notes = f"{defect.notes}\n[2ème choix] {request.data.get('notes')}".strip()
        defect.save(update_fields=["status", "resolved_by", "resolved_at", "notes"])
        return Response(DefectItemSerializer(defect).data)

    @action(detail=False, methods=["post"], url_path="create-supplier-claim")
    def create_supplier_claim(self, request):
        """
        Batch-select multiple defect items to generate a SupplierReturnClaim (Bon de Retour),
        optionally automatically debiting the supplier balance with an Avoir.
        """
        from apps.suppliers.models import ClaimStatusChoices, Supplier, SupplierReturnClaim
        from django.utils import timezone

        item_ids = request.data.get("item_ids", [])
        supplier_id = request.data.get("supplier_id")
        apply_credit = request.data.get("apply_credit", True)
        notes = request.data.get("notes", "")

        if not item_ids:
            return Response({"detail": "Aucun article sélectionné."}, status=status.HTTP_400_BAD_REQUEST)

        items = DefectItem.objects.filter(tenant=request.tenant, id__in=item_ids)
        if not items.exists():
            return Response({"detail": "Articles introuvables."}, status=status.HTTP_404_NOT_FOUND)

        if not supplier_id:
            supplier = items.first().supplier
            if not supplier:
                return Response({"detail": "Veuillez spécifier le fournisseur."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            supplier = Supplier.objects.filter(tenant=request.tenant, id=supplier_id).first()
            if not supplier:
                return Response({"detail": "Fournisseur introuvable."}, status=status.HTTP_404_NOT_FOUND)

        total_amount = sum(item.cost_price * item.quantity for item in items)

        with transaction.atomic():
            claim = SupplierReturnClaim.objects.create(
                tenant=request.tenant,
                supplier=supplier,
                total_amount=total_amount,
                status=ClaimStatusChoices.ACCEPTED if apply_credit else ClaimStatusChoices.SENT,
                credit_note_applied=apply_credit,
                notes=notes,
                created_by=request.user,
            )

            # Update items
            new_status = DefectStatusChoices.RETURNED if apply_credit else DefectStatusChoices.CLAIM_PENDING
            items.update(
                supplier=supplier,
                return_claim=claim,
                status=new_status,
                resolved_by=request.user if apply_credit else None,
                resolved_at=timezone.now() if apply_credit else None,
            )

            if apply_credit:
                supplier.recompute_balance()

        from apps.suppliers.serializers import SupplierReturnClaimSerializer
        return Response({
            "claim": SupplierReturnClaimSerializer(claim).data,
            "items_updated": items.count(),
        }, status=status.HTTP_201_CREATED)


# ─────────────────────────────────────────────
# Stocktake ViewSet (Inventaire Rapide par Scan)
# ─────────────────────────────────────────────

class StocktakeViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD + Fast continuous barcode scanning and applying physical inventory audits.
    Supports full store audits, scoped zone/rayon audits, and rolling scan-only audits
    for stores with thousands of SKUs.
    """
    queryset = StocktakeSession.objects.select_related("branch", "created_by", "completed_by")
    filterset_fields = ["status", "branch"]
    search_fields = ["title", "notes"]
    ordering_fields = ["created_at", "total_variance", "total_counted"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action in ["retrieve", "apply_inventory"]:
            qs = qs.prefetch_related(
                Prefetch(
                    "items",
                    queryset=StocktakeItem.objects.select_related("variant__product").order_by(
                        "-last_scanned_at", "variant__product__name", "variant__size_eu"
                    ),
                )
            )
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return CreateStocktakeSessionSerializer
        elif self.action in ["retrieve", "scan", "update_item", "apply_inventory", "bind_barcode"]:
            return StocktakeSessionDetailSerializer
        return StocktakeSessionListSerializer

    def perform_create(self, serializer):
        auto_populate = serializer.validated_data.pop("auto_populate", True)
        scope_location = (serializer.validated_data.pop("scope_location", "") or "").strip()
        scope_reference = (serializer.validated_data.pop("scope_reference", "") or "").strip()
        only_in_stock = serializer.validated_data.pop("only_in_stock", False)
        branch = serializer.validated_data.get("branch") or getattr(self.request.user, "branch", None)

        extra_notes = []
        if not auto_populate:
            extra_notes.append("[Mode: Scan libre / Inventaire partiel]")
        if scope_location:
            extra_notes.append(f"[Rayon: {scope_location}]")
        if scope_reference:
            extra_notes.append(f"[Réf: {scope_reference}]")
        if only_in_stock:
            extra_notes.append("[En stock uniquement]")

        base_notes = (serializer.validated_data.get("notes") or "").strip()
        combined_notes = (" ".join(extra_notes) + (" — " + base_notes if base_notes else "")).strip()

        session = serializer.save(
            tenant=self.request.tenant,
            branch=branch,
            created_by=self.request.user,
            status=StocktakeStatusChoices.IN_PROGRESS,
            notes=combined_notes if extra_notes else base_notes,
        )

        if auto_populate:
            var_qs = Variant.objects.filter(
                tenant=self.request.tenant,
                is_active=True,
                product__is_active=True,
            ).select_related("product")

            if session.scope_brand:
                var_qs = var_qs.filter(product__brand__iexact=session.scope_brand)
            if session.scope_category:
                var_qs = var_qs.filter(product__category=session.scope_category)
            if scope_location:
                loc_q = Q(product__branch_locations__location__icontains=scope_location)
                if session.branch:
                    loc_q &= Q(product__branch_locations__branch=session.branch)
                var_qs = var_qs.filter(loc_q).distinct()
            if scope_reference:
                var_qs = var_qs.filter(
                    Q(product__reference__icontains=scope_reference)
                    | Q(product__name__icontains=scope_reference)
                )

            if session.branch:
                branch_stock_subq = (
                    StockMovement.objects.filter(
                        variant_id=OuterRef("pk"),
                        branch_id=session.branch_id,
                    )
                    .order_by()
                    .values("variant_id")
                    .annotate(total=Sum("quantity_delta"))
                    .values("total")
                )
                var_qs = var_qs.annotate(
                    computed_expected_qty=Coalesce(
                        Subquery(branch_stock_subq, output_field=IntegerField()),
                        Value(0),
                    )
                )
            else:
                var_qs = var_qs.annotate(computed_expected_qty=F("stock_qty"))

            if only_in_stock:
                var_qs = var_qs.filter(computed_expected_qty__gt=0)

            items_to_create = []
            for var in var_qs:
                expected = getattr(var, "computed_expected_qty", var.stock_qty) or 0
                cost = var.product.purchase_price or Decimal("0.00")
                price = var.product.sale_price or Decimal("0.00")
                items_to_create.append(
                    StocktakeItem(
                        tenant=self.request.tenant,
                        session=session,
                        variant=var,
                        expected_qty=expected,
                        counted_qty=0,
                        unit_cost=cost,
                        unit_price=price,
                    )
                )
            if items_to_create:
                StocktakeItem.objects.bulk_create(items_to_create, batch_size=500)
                session.recalculate_totals()

    @action(detail=True, methods=["post"], url_path="scan")
    def scan(self, request, pk=None):
        """
        Fast barcode scanning endpoint.
        Body: { "barcode": "<scanned_code>", "increment": 1, "set_qty": null }
        Increments (or sets) counted_qty for matching variant and recalculates session totals.
        """
        session = self.get_object()
        if session.status == StocktakeStatusChoices.COMPLETED:
            return Response(
                {"error": {"code": "session_completed", "message": "Cette session d'inventaire est déjà clôturée."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        barcode = request.data.get("barcode", "").strip()
        if not barcode:
            return Response(
                {"error": {"code": "missing_barcode", "message": "Code-barres requis."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            increment = int(request.data.get("increment", 1))
        except (ValueError, TypeError):
            increment = 1

        set_qty_raw = request.data.get("set_qty", None)
        set_qty = None
        if set_qty_raw is not None and set_qty_raw != "":
            try:
                set_qty = max(0, int(set_qty_raw))
            except (ValueError, TypeError):
                set_qty = None

        base_qs = Variant.objects.filter(
            tenant=request.tenant, is_active=True
        ).select_related("product")

        variant = base_qs.filter(barcode=barcode).first()
        if not variant:
            variant = base_qs.filter(barcode__startswith=barcode).first()
        if not variant and len(barcode) >= 13:
            variant = base_qs.filter(barcode__startswith=barcode[:13]).first()
        if not variant:
            variant = base_qs.filter(product__reference__iexact=barcode).first()
        if not variant:
            variant = base_qs.filter(product__reference__icontains=barcode).first()
        if not variant:
            variant = base_qs.filter(product__name__icontains=barcode).first()

        if not variant:
            return Response(
                {
                    "error": {
                        "code": "not_found",
                        "message": f"Aucun article trouvé pour le code « {barcode} ».",
                        "scanned": barcode,
                    }
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        item, created = StocktakeItem.objects.get_or_create(
            tenant=request.tenant,
            session=session,
            variant=variant,
            defaults={
                "expected_qty": variant.refresh_stock(branch=session.branch) if session.branch else variant.stock_qty,
                "counted_qty": 0,
                "unit_cost": variant.product.purchase_price or Decimal("0.00"),
                "unit_price": variant.product.sale_price or Decimal("0.00"),
            },
        )

        previous_qty = item.counted_qty
        if set_qty is not None:
            item.counted_qty = set_qty
        else:
            item.counted_qty = max(0, item.counted_qty + increment)
        from django.utils import timezone
        item.last_scanned_at = timezone.now()
        item.save(update_fields=["counted_qty", "last_scanned_at"])

        session.recalculate_totals()
        session.refresh_from_db()

        return Response({
            "success": True,
            "scanned": barcode,
            "increment": increment,
            "created": created,
            "previous_qty": previous_qty,
            "item": StocktakeItemSerializer(item).data,
            "session_total_counted": session.total_counted,
            "session_total_expected": session.total_expected,
            "session_total_variance": session.total_variance,
            "session_total_variance_cost": str(session.total_variance_cost),
        })

    @action(detail=True, methods=["post"], url_path="bind-barcode")
    def bind_barcode(self, request, pk=None):
        """
        Associate an unknown scanned barcode with an existing Variant and count it immediately.
        Body: { "variant_id": <id>, "barcode": "<scanned_code>", "increment": 1 }
        """
        session = self.get_object()
        if session.status == StocktakeStatusChoices.COMPLETED:
            return Response(
                {"error": {"code": "session_completed", "message": "Cette session d'inventaire est déjà clôturée."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        variant_id = request.data.get("variant_id")
        barcode = (request.data.get("barcode") or "").strip()
        try:
            increment = int(request.data.get("increment", 1))
        except (ValueError, TypeError):
            increment = 1

        if not variant_id or not barcode:
            return Response(
                {"error": {"code": "invalid_payload", "message": "Article et code-barres requis."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        variant = Variant.objects.filter(tenant=request.tenant, pk=variant_id).select_related("product").first()
        if not variant:
            return Response(
                {"error": {"code": "not_found", "message": "Variante introuvable."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        variant.barcode = barcode
        variant.save(update_fields=["barcode"])

        item, created = StocktakeItem.objects.get_or_create(
            tenant=request.tenant,
            session=session,
            variant=variant,
            defaults={
                "expected_qty": variant.refresh_stock(branch=session.branch) if session.branch else variant.stock_qty,
                "counted_qty": 0,
                "unit_cost": variant.product.purchase_price or Decimal("0.00"),
                "unit_price": variant.product.sale_price or Decimal("0.00"),
            },
        )
        from django.utils import timezone
        item.counted_qty = max(0, item.counted_qty + increment)
        item.last_scanned_at = timezone.now()
        item.save(update_fields=["counted_qty", "last_scanned_at"])

        session.recalculate_totals()
        session.refresh_from_db()

        return Response({
            "success": True,
            "scanned": barcode,
            "created": created,
            "item": StocktakeItemSerializer(item).data,
            "session_total_counted": session.total_counted,
            "session_total_expected": session.total_expected,
            "session_total_variance": session.total_variance,
            "session_total_variance_cost": str(session.total_variance_cost),
        })

    @action(detail=True, methods=["patch"], url_path="update-item")
    def update_item(self, request, pk=None):
        """
        Manually adjust counted quantity or notes for a specific item.
        Body: { "item_id": <id>, "counted_qty": <int>, "notes": "<text>" }
        """
        session = self.get_object()
        if session.status == StocktakeStatusChoices.COMPLETED:
            return Response(
                {"error": {"code": "session_completed", "message": "Cette session d'inventaire est déjà clôturée."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item_id = request.data.get("item_id")
        try:
            item = session.items.select_related("variant__product").get(pk=item_id)
        except StocktakeItem.DoesNotExist:
            return Response(
                {"error": {"code": "not_found", "message": "Article introuvable dans cette session."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        from django.utils import timezone
        if "counted_qty" in request.data:
            try:
                item.counted_qty = max(0, int(request.data["counted_qty"]))
                item.last_scanned_at = timezone.now()
            except (ValueError, TypeError):
                pass
        if "notes" in request.data:
            item.notes = str(request.data["notes"]).strip()

        item.save(update_fields=["counted_qty", "notes", "last_scanned_at"])
        session.recalculate_totals()
        session.refresh_from_db()

        return Response({
            "success": True,
            "item": StocktakeItemSerializer(item).data,
            "session_total_counted": session.total_counted,
            "session_total_expected": session.total_expected,
            "session_total_variance": session.total_variance,
            "session_total_variance_cost": str(session.total_variance_cost),
        })

    @action(detail=True, methods=["post"], url_path="apply")
    def apply_inventory(self, request, pk=None):
        """
        Finalize and apply inventory: adjusts stock via StockMovement records.
        Supports:
        - only_scanned (bool): when True, only reconciles items that were scanned or manually edited
          (last_scanned_at != None or counted_qty > 0), leaving untouched pre-populated items intact.
        - keep_open (bool): when True, applies adjustments for scanned items right now and updates their
          expected_qty = counted_qty so the session remains IN_PROGRESS for multi-day / zone-by-zone scanning.
        """
        session = self.get_object()
        if session.status == StocktakeStatusChoices.COMPLETED:
            return Response(
                {"error": {"code": "already_completed", "message": "Cet inventaire a déjà été appliqué."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check PIN if cashier and store requires manager PIN
        if request.user.role == RoleChoices.CASHIER:
            manager_pin = request.data.get("manager_pin")
            from apps.sales.serializers import verify_manager_pin_helper
            mgr = verify_manager_pin_helper(request.tenant, manager_pin)
            if not mgr:
                return Response(
                    {"error": {"code": "invalid_pin", "message": "Un code PIN manager valide est requis pour valider l'inventaire."}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        only_scanned = bool(request.data.get("only_scanned", False))
        keep_open = bool(request.data.get("keep_open", False))
        if keep_open:
            only_scanned = True

        adjusted_count = 0
        from django.utils import timezone
        with transaction.atomic():
            items_qs = session.items.select_related("variant__product").all()
            if only_scanned:
                items_qs = items_qs.filter(Q(last_scanned_at__isnull=False) | Q(counted_qty__gt=0))

            for item in items_qs:
                variance = item.counted_qty - item.expected_qty
                if variance != 0:
                    StockMovement.objects.create(
                        tenant=request.tenant,
                        variant=item.variant,
                        branch=session.branch,
                        quantity_delta=variance,
                        reason=MovementReasonChoices.STOCKTAKE,
                        reference_id=str(session.id),
                        reference_type="StocktakeSession",
                        notes=f"Inventaire physique: {session.title} (Attendu: {item.expected_qty}, Compté: {item.counted_qty})",
                        user=request.user,
                    )
                    item.variant.refresh_stock(branch=session.branch)
                    adjusted_count += 1

                if keep_open and variance != 0:
                    item.expected_qty = item.counted_qty
                    if "[Lot validé]" not in (item.notes or ""):
                        item.notes = f"{item.notes} [Lot validé]".strip()
                    item.save(update_fields=["expected_qty", "notes"])

            if keep_open:
                session.recalculate_totals()
            else:
                if only_scanned:
                    # Remove untouched pre-populated items so closed session totals reflect only the audited scope
                    session.items.filter(last_scanned_at__isnull=True, counted_qty=0).delete()
                session.status = StocktakeStatusChoices.COMPLETED
                session.completed_by = request.user
                session.completed_at = timezone.now()
                session.save(update_fields=["status", "completed_by", "completed_at", "updated_at"])
                session.recalculate_totals()

        session = self.get_queryset().get(pk=session.pk)
        return Response({
            "success": True,
            "adjusted_variants_count": adjusted_count,
            "kept_open": keep_open,
            "only_scanned": only_scanned,
            "session": StocktakeSessionDetailSerializer(session).data,
        })

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel_inventory(self, request, pk=None):
        session = self.get_object()
        if session.status == StocktakeStatusChoices.COMPLETED:
            return Response(
                {"error": {"code": "cannot_cancel", "message": "Impossible d'annuler un inventaire déjà appliqué."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        session.status = StocktakeStatusChoices.CANCELLED
        session.save(update_fields=["status", "updated_at"])
        return Response({"success": True, "status": session.status})


