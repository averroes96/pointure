"""
Inventory models: Product, Variant (SKU), StockMovement, StockTransfer.

Key invariant: Variant.stock_qty is ALWAYS computed from StockMovement records.
Direct mutation of stock_qty is forbidden — use StockMovement exclusively.
"""
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Sum
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
    image = models.ImageField(_("Photo"), upload_to="products/", blank=True, null=True)
    description = models.TextField(_("Description"), blank=True)
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
    Generate an EAN-13-like barcode from tenant + product + variant sequence.
    Format: 213 + tenant_seq(4) + product_id(3) + variant_seq(3)
    """
    tenant_num = str(hash(str(variant.product.tenant_id)) % 10000).zfill(4)
    product_num = str(variant.product_id % 1000).zfill(3)
    variant_num = str(variant.pk % 1000).zfill(3) if variant.pk else "000"
    base = f"213{tenant_num}{product_num}{variant_num}"
    # EAN-13 check digit
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(base))
    check = (10 - (total % 10)) % 10
    return base + str(check)


class Variant(TenantScopedModel):
    """
    One row per size×colour combination for a product.
    IMPORTANT: stock_qty is a cached value. Never update it directly.
    Always create a StockMovement record which triggers stock_qty refresh.
    """
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    size_eu = models.IntegerField(
        _("EU Size"),
        validators=[MinValueValidator(28), MaxValueValidator(47)],
    )
    colour = models.CharField(_("Colour"), max_length=50)
    barcode = models.CharField(_("Barcode"), max_length=14, blank=True, db_index=True)
    stock_qty = models.IntegerField(_("Stock Qty"), default=0)
    alert_threshold = models.IntegerField(_("Low Stock Alert Threshold"), default=3)
    is_active = models.BooleanField(_("Active"), default=True)

    class Meta:
        verbose_name = _("Variant (SKU)")
        verbose_name_plural = _("Variants (SKUs)")
        unique_together = [["product", "size_eu", "colour"]]
        ordering = ["product", "size_eu", "colour"]

    def __str__(self):
        return f"{self.product} | EU{self.size_eu} | {self.colour}"

    def save(self, *args, **kwargs):
        # Auto-generate barcode if not set (can only be done after pk is assigned)
        is_new = not self.pk
        super().save(*args, **kwargs)
        if is_new and not self.barcode:
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
