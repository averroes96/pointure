import uuid
"""
Inventory models: Product, Variant (SKU), StockMovement, StockTransfer.

Key invariant: Variant.stock_qty is ALWAYS computed from StockMovement records.
Direct mutation of stock_qty is forbidden — use StockMovement exclusively.
"""
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Sum
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.core.models import Branch, TenantScopedModel


# ─────────────────────────────────────────────
# Choices
# ─────────────────────────────────────────────

class GenderChoices(models.TextChoices):
    MEN = "M", _("Men")
    WOMEN = "F", _("Women")
    KIDS = "K", _("Kids")
    UNISEX = "U", _("Unisex")


class CategoryChoices(models.TextChoices):
    SNEAKERS = "sneakers", _("Sneakers")
    BOOTS = "boots", _("Boots")
    SANDALS = "sandals", _("Sandals")
    FORMAL = "formal", _("Formal")
    SPORT = "sport", _("Sport")
    KIDS_SHOES = "kids", _("Kids Shoes")
    SLIPPERS = "slippers", _("Slippers")
    OTHER = "other", _("Other")


class SeasonChoices(models.TextChoices):
    ALL_YEAR = "all", _("All Year")
    SUMMER = "summer", _("Summer")
    WINTER = "winter", _("Winter")
    SPRING_FALL = "spring_fall", _("Spring / Fall")


class MovementReasonChoices(models.TextChoices):
    SALE = "sale", _("Sale")
    RECEPTION = "reception", _("Stock Reception")
    ADJUSTMENT = "adjustment", _("Manual Adjustment")
    RETURN = "return", _("Customer Return")
    TRANSFER_OUT = "transfer_out", _("Transfer Out")
    TRANSFER_IN = "transfer_in", _("Transfer In")
    DAMAGED = "damaged", _("Damaged / Written Off")
    INITIAL = "initial", _("Initial Stock Entry")
    LAYAWAY_LOCK = "layaway_lock", _("Mise de côté (Réservation)")
    LAYAWAY_RELEASE = "layaway_release", _("Annulation réservation (Libération stock)")
    STOCKTAKE = "stocktake", _("Ajustement inventaire")


class TransferStatusChoices(models.TextChoices):
    PENDING = "pending", _("Pending")
    IN_TRANSIT = "in_transit", _("In Transit")
    RECEIVED = "received", _("Received")
    CANCELLED = "cancelled", _("Cancelled")


# ─────────────────────────────────────────────
# Product (Article)
# ─────────────────────────────────────────────

class Product(TenantScopedModel):
    """Base article — no sizes or colours here. Those are on Variant."""
    name = models.CharField(_("Name"), max_length=200)
    brand = models.CharField(_("Brand"), max_length=100, blank=True)
    reference = models.CharField(_("Internal Reference"), max_length=50, blank=True)
    category = models.CharField(
        _("Category"), max_length=20, choices=CategoryChoices.choices, default=CategoryChoices.OTHER
    )
    gender = models.CharField(
        _("Gender"), max_length=1, choices=GenderChoices.choices, default=GenderChoices.UNISEX
    )
    season = models.CharField(
        _("Season"), max_length=12, choices=SeasonChoices.choices, default=SeasonChoices.ALL_YEAR
    )
    purchase_price = models.DecimalField(
        _("Purchase Price (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    pamp = models.DecimalField(
        _("PAMP (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    sale_price = models.DecimalField(
        _("Sale Price (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    wholesale_price = models.DecimalField(
        _("Wholesale Price (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    image = models.ImageField(_("Photo"), upload_to="products/", blank=True, null=True)
    description = models.TextField(_("Description"), blank=True)
    pairs_per_carton = models.PositiveIntegerField(_("Pairs per Carton"), default=10)
    alert_threshold = models.IntegerField(_("Low Stock Alert Threshold"), default=10)
    is_active = models.BooleanField(_("Active"), default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Product")
        verbose_name_plural = _("Products")
        ordering = ["name"]

    def __str__(self):
        return f"{self.brand} {self.name}".strip()

    def save(self, *args, **kwargs):
        try:
            pp = Decimal(str(self.purchase_price)) if self.purchase_price is not None else Decimal("0.00")
        except Exception:
            pp = Decimal("0.00")
        try:
            pamp_val = Decimal(str(self.pamp)) if self.pamp is not None else Decimal("0.00")
        except Exception:
            pamp_val = Decimal("0.00")

        if pamp_val == Decimal("0.00") and pp > Decimal("0.00"):
            self.pamp = pp
        super().save(*args, **kwargs)

    @property
    def margin_pct(self):
        cost_basis = self.pamp if self.pamp > 0 else self.purchase_price
        if cost_basis > 0:
            return round((self.sale_price - cost_basis) / cost_basis * 100, 2)
        return None

    @property
    def total_stock(self):
        """Sum of stock across all variants and branches."""
        return self.variants.aggregate(total=Sum("stock_qty"))["total"] or 0

    @property
    def has_low_stock(self):
        return self.variants.filter(
            stock_qty__lte=models.F("alert_threshold"), alert_threshold__gt=0
        ).exists()

    @property
    def is_total_low_stock(self):
        return self.total_stock <= self.alert_threshold and self.alert_threshold > 0

    @property
    def default_variant(self):
        """Return the primary/default variant (used in simple mode)."""
        return self.variants.filter(is_active=True).first()

class ProductLocation(TenantScopedModel):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="product_locations")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="branch_locations")
    location = models.CharField(_("Location / Shelving"), max_length=255, blank=True)

    class Meta:
        verbose_name = _("Product Location")
        verbose_name_plural = _("Product Locations")
        unique_together = [["branch", "product"]]

    def __str__(self):
        return f"{self.product.name} @ {self.branch.name}: {self.location}"


# ─────────────────────────────────────────────
# Variant (SKU)
# ─────────────────────────────────────────────

def generate_barcode(variant):
    """
    Generate a 14-digit numeric string barcode for CODE-128C / EAN rendering.
    Format: 213 + tenant_num(3) + product_num(4) + variant_num(3) + check(1)
    Handles UUID primary keys safely without TypeError.
    """
    def _to_num(val):
        if not val:
            return 0
        s = str(val).replace("-", "")
        try:
            return int(s[:8], 16)
        except ValueError:
            return abs(hash(s))

    t_val = _to_num(getattr(variant.product, "tenant_id", None))
    p_val = _to_num(variant.product_id)
    v_val = _to_num(variant.pk)

    tenant_num = str(t_val % 1000).zfill(3)
    product_num = str(p_val % 10000).zfill(4)
    variant_num = str(v_val % 1000).zfill(3)

    base = f"213{tenant_num}{product_num}{variant_num}"  # 13 digits
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(base))
    check = (10 - (total % 10)) % 10
    return base + str(check)  # 14 digits


class Variant(TenantScopedModel):
    """
    One row per size×colour combination for a product.
    IMPORTANT: stock_qty is a cached value. Never update it directly.
    Always create a StockMovement record which triggers stock_qty refresh.
    """
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    size_eu = models.IntegerField(
        _("EU Size"),
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(60)],
    )
    colour = models.CharField(_("Colour"), max_length=50, blank=True, default="Standard")
    barcode = models.CharField(_("Barcode"), max_length=64, blank=True, db_index=True)
    stock_qty = models.IntegerField(_("Stock Qty"), default=0)
    alert_threshold = models.IntegerField(_("Low Stock Alert Threshold"), default=3)
    is_active = models.BooleanField(_("Active"), default=True)

    class Meta:
        verbose_name = _("Variant (SKU)")
        verbose_name_plural = _("Variants (SKUs)")
        unique_together = [["product", "size_eu", "colour"]]
        ordering = ["product", "size_eu", "colour"]

    def __str__(self):
        parts = [str(self.product)]
        if self.size_eu and self.size_eu > 0:
            parts.append(f"EU{self.size_eu}")
        if self.colour and self.colour not in ("N/A", "Standard", "Unique", ""):
            parts.append(self.colour)
        return " | ".join(parts)

    def save(self, *args, **kwargs):
        # Auto-generate barcode if not set (can only be done after pk is assigned)
        is_new = not self.pk
        super().save(*args, **kwargs)
        if (is_new or not self.barcode) and self.pk:
            self.barcode = generate_barcode(self)
            Variant.objects.filter(pk=self.pk).update(barcode=self.barcode)

    def refresh_stock(self, branch=None):
        """
        Recompute stock_qty from StockMovement ledger.
        If branch is provided, computes for that branch only.
        Updates the cached stock_qty field.
        """
        qs = self.movements.all()
        if branch:
            qs = qs.filter(branch=branch)
        total = qs.aggregate(total=Sum("quantity_delta"))["total"] or 0
        # For branch-specific, we don't update the variant-level cache
        if not branch:
            Variant.objects.filter(pk=self.pk).update(stock_qty=total)
            self.stock_qty = total
        return total

    @property
    def is_low_stock(self):
        return self.stock_qty <= self.alert_threshold and self.alert_threshold > 0

    @property
    def is_out_of_stock(self):
        return self.stock_qty <= 0


# ─────────────────────────────────────────────
# StockMovement (append-only ledger)
# ─────────────────────────────────────────────

class StockMovement(TenantScopedModel):
    """
    Immutable ledger of all stock changes.
    Positive quantity_delta = stock in.
    Negative quantity_delta = stock out.
    """
    variant = models.ForeignKey(Variant, on_delete=models.PROTECT, related_name="movements")
    branch = models.ForeignKey(
        Branch, on_delete=models.PROTECT, related_name="stock_movements", null=True, blank=True
    )
    quantity_delta = models.IntegerField(_("Quantity Change"))
    reason = models.CharField(
        _("Reason"), max_length=15, choices=MovementReasonChoices.choices
    )
    reference_id = models.CharField(_("Reference ID"), max_length=50, blank=True)
    reference_type = models.CharField(_("Reference Type"), max_length=50, blank=True)
    bl_reference = models.CharField(_("BL Reference"), max_length=100, blank=True)
    notes = models.TextField(_("Notes"), blank=True)
    user = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="stock_movements"
    )
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = _("Stock Movement")
        verbose_name_plural = _("Stock Movements")
        ordering = ["-timestamp"]
        # Prevent any UPDATE on this table after insert
        default_permissions = ("add", "view")

    def __str__(self):
        sign = "+" if self.quantity_delta > 0 else ""
        return f"{self.variant} {sign}{self.quantity_delta} ({self.reason})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Refresh the cached stock_qty on the variant after every movement
        self.variant.refresh_stock()
        # If stock is now healthy, immediately resolve any active low-stock notifications
        if self.variant.stock_qty > self.variant.alert_threshold or self.variant.alert_threshold == 0:
            try:
                from apps.notifications.models import Notification
                Notification.objects.filter(
                    type="low_stock",
                    related_object_type="Variant",
                    related_object_id=str(self.variant_id),
                ).delete()
            except Exception:
                pass


# ─────────────────────────────────────────────
# StockTransfer
# ─────────────────────────────────────────────

class StockTransfer(TenantScopedModel):
    """Inter-branch stock transfer. Creates two StockMovements when received."""
    from_branch = models.ForeignKey(
        Branch, on_delete=models.PROTECT, related_name="transfers_out"
    )
    to_branch = models.ForeignKey(
        Branch, on_delete=models.PROTECT, related_name="transfers_in"
    )
    variant = models.ForeignKey(Variant, on_delete=models.PROTECT, related_name="transfers")
    quantity = models.PositiveIntegerField(_("Quantity"))
    status = models.CharField(
        _("Status"), max_length=12, choices=TransferStatusChoices.choices,
        default=TransferStatusChoices.PENDING,
    )
    notes = models.TextField(_("Notes"), blank=True)
    created_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="transfers_created"
    )
    received_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="transfers_received"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _("Stock Transfer")
        verbose_name_plural = _("Stock Transfers")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Transfer {self.variant} × {self.quantity}: {self.from_branch} → {self.to_branch}"

    def mark_received(self, received_by_user):
        """
        Confirm receipt: create StockMovements for both branches and update status.
        This is an atomic operation.
        """
        from django.db import transaction
        from django.utils import timezone

        with transaction.atomic():
            # Deduct from source branch
            StockMovement.objects.create(
                tenant=self.tenant,
                variant=self.variant,
                branch=self.from_branch,
                quantity_delta=-self.quantity,
                reason=MovementReasonChoices.TRANSFER_OUT,
                reference_id=str(self.pk),
                reference_type="StockTransfer",
                user=received_by_user,
            )
            # Add to destination branch
            StockMovement.objects.create(
                tenant=self.tenant,
                variant=self.variant,
                branch=self.to_branch,
                quantity_delta=self.quantity,
                reason=MovementReasonChoices.TRANSFER_IN,
                reference_id=str(self.pk),
                reference_type="StockTransfer",
                user=received_by_user,
            )
            self.status = TransferStatusChoices.RECEIVED
            self.received_by = received_by_user
            self.received_at = timezone.now()
            self.save(update_fields=["status", "received_by", "received_at"])


# ─────────────────────────────────────────────
# DefectItem (Quarantined Damaged Pairs)
# ─────────────────────────────────────────────

class DefectReasonChoices(models.TextChoices):
    SOLE_UNGLUED = "sole_unglued", _("Semelle décollée")
    UNSTITCHED_SOLE = "unstitched_sole", _("Semelle décollée / décousue")
    BROKEN_STRAP = "broken_strap", _("Bride / Lanière cassée")
    MISMATCHED_PAIR = "mismatched_pair", _("Paire dépareillée")
    MISMATCHED_SIZE = "mismatched_size", _("Pointure dépareillée")
    TORN_LEATHER = "torn_leather", _("Cuir / Tissu déchiré")
    LEATHER_TEAR = "leather_tear", _("Déchirure cuir / tissu")
    DISCOLORATION = "discoloration", _("Décoloration / Teinte")
    STAIN_DISCOLOR = "stain_discolor", _("Tache / Décoloration")
    BROKEN_HEEL = "broken_heel", _("Talon cassé / défectueux")
    MISSING_INSOLE = "missing_insole", _("Semelle intérieure manquante")
    STITCHING = "stitching", _("Couture défectueuse")
    MISSING_ACCESSORY = "missing_accessory", _("Accessoire / Lacet manquant")
    OTHER = "other", _("Autre anomalie")


class DefectStatusChoices(models.TextChoices):
    QUARANTINED = "quarantined", _("En Quarantaine")
    CLAIM_PENDING = "claim_pending", _("Réclamation Fournisseur en cours")
    RETURNED = "returned", _("Retourné au Fournisseur")
    SOLD_DISCOUNT = "sold_discount", _("Vendu Déclassé (2ème choix)")
    WRITTEN_OFF = "written_off", _("Rebuté / Perte")


class DefectItem(TenantScopedModel):
    """
    Quarantined defective shoe pair(s) isolated from available sellable stock.
    """
    variant = models.ForeignKey(Variant, on_delete=models.PROTECT, related_name="defects")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="defects")
    supplier = models.ForeignKey("suppliers.Supplier", on_delete=models.SET_NULL, null=True, blank=True, related_name="defects")
    purchase_order = models.ForeignKey("suppliers.PurchaseOrder", on_delete=models.SET_NULL, null=True, blank=True, related_name="defects")
    sale_return = models.ForeignKey("sales.Return", on_delete=models.SET_NULL, null=True, blank=True, related_name="defects")
    sale_exchange = models.ForeignKey("sales.Exchange", on_delete=models.SET_NULL, null=True, blank=True, related_name="defects")
    return_claim = models.ForeignKey("suppliers.SupplierReturnClaim", on_delete=models.SET_NULL, null=True, blank=True, related_name="items")

    quantity = models.PositiveIntegerField(_("Quantity of Pairs"), default=1)
    cost_price = models.DecimalField(_("Unit Cost Price (DZD)"), max_digits=12, decimal_places=2, default=Decimal("0.00"))
    defect_reason = models.CharField(
        _("Defect Reason"), max_length=30, choices=DefectReasonChoices.choices, default=DefectReasonChoices.OTHER
    )
    photo = models.ImageField(_("Photo"), upload_to="defects/", blank=True, null=True)
    status = models.CharField(
        _("Status"), max_length=20, choices=DefectStatusChoices.choices, default=DefectStatusChoices.QUARANTINED
    )
    notes = models.TextField(_("Notes"), blank=True)
    logged_by = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="defects_logged")
    resolved_by = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="defects_resolved")
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Defect Item")
        verbose_name_plural = _("Defect Items")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.variant} × {self.quantity} ({self.get_defect_reason_display()}) [{self.get_status_display()}]"


# ─────────────────────────────────────────────
# Stocktake / Inventaire Physique Rapide
# ─────────────────────────────────────────────

class StocktakeStatusChoices(models.TextChoices):
    DRAFT = "draft", _("Brouillon")
    IN_PROGRESS = "in_progress", _("En cours")
    PAUSED = "paused", _("En pause")
    COMPLETED = "completed", _("Validé & Appliqué")
    CANCELLED = "cancelled", _("Annulé")


class StocktakeSession(TenantScopedModel):
    """
    Physical inventory session (stocktake / récolement physique des stocks).
    Supports rapid continuous barcode scanning, carton multipliers,
    theoretical vs. counted variance calculation, and atomic stock reconciliation.
    """
    title = models.CharField(_("Title"), max_length=200)
    branch = models.ForeignKey(
        Branch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stocktake_sessions",
        help_text="Succursale inventoriée (laisser vide pour inventaire global)",
    )
    status = models.CharField(
        _("Status"),
        max_length=20,
        choices=StocktakeStatusChoices.choices,
        default=StocktakeStatusChoices.IN_PROGRESS,
        db_index=True,
    )
    scope_brand = models.CharField(_("Brand Scope"), max_length=100, blank=True)
    scope_category = models.CharField(_("Category Scope"), max_length=20, blank=True)
    notes = models.TextField(_("Notes"), blank=True)

    created_by = models.ForeignKey(
        "core.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stocktakes_created",
    )
    completed_by = models.ForeignKey(
        "core.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stocktakes_completed",
    )
    completed_at = models.DateTimeField(null=True, blank=True)

    total_expected = models.IntegerField(_("Total Expected Qty"), default=0)
    total_counted = models.IntegerField(_("Total Counted Qty"), default=0)
    total_variance = models.IntegerField(_("Total Variance Qty"), default=0)
    total_variance_cost = models.DecimalField(
        _("Total Variance Cost (DZD)"),
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Stocktake Session")
        verbose_name_plural = _("Stocktake Sessions")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"

    def recalculate_totals(self):
        """Aggregate totals from items in a single SQL query."""
        from django.db.models import DecimalField, ExpressionWrapper, F
        from django.db.models.functions import Coalesce

        aggs = self.items.aggregate(
            exp=Coalesce(Sum("expected_qty"), 0),
            cnt=Coalesce(Sum("counted_qty"), 0),
            var_cost=Coalesce(
                Sum(
                    ExpressionWrapper(
                        (F("counted_qty") - F("expected_qty")) * F("unit_cost"),
                        output_field=DecimalField(max_digits=14, decimal_places=2),
                    )
                ),
                Decimal("0.00"),
            ),
        )
        self.total_expected = aggs["exp"] or 0
        self.total_counted = aggs["cnt"] or 0
        self.total_variance = self.total_counted - self.total_expected
        self.total_variance_cost = aggs["var_cost"] or Decimal("0.00")
        self.save(update_fields=["total_expected", "total_counted", "total_variance", "total_variance_cost", "updated_at"])


class StocktakeItem(TenantScopedModel):
    """
    Individual SKU/variant counted inside a StocktakeSession.
    """
    session = models.ForeignKey(
        StocktakeSession,
        on_delete=models.CASCADE,
        related_name="items",
    )
    variant = models.ForeignKey(
        Variant,
        on_delete=models.CASCADE,
        related_name="stocktake_items",
    )
    expected_qty = models.IntegerField(_("Expected Qty"), default=0)
    counted_qty = models.IntegerField(_("Counted Qty"), default=0)
    unit_cost = models.DecimalField(
        _("Unit Cost Price (DZD)"),
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    unit_price = models.DecimalField(
        _("Unit Sale Price (DZD)"),
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    last_scanned_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(_("Notes"), max_length=255, blank=True)

    class Meta:
        verbose_name = _("Stocktake Item")
        verbose_name_plural = _("Stocktake Items")
        unique_together = [["session", "variant"]]
        ordering = ["variant__product__name", "variant__size_eu"]

    def __str__(self):
        return f"{self.variant} - Exp: {self.expected_qty}, Cnt: {self.counted_qty}"

    @property
    def variance_qty(self):
        return self.counted_qty - self.expected_qty

    @property
    def variance_cost(self):
        return Decimal(str(self.variance_qty)) * self.unit_cost

