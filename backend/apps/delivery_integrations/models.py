import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel

from .services.couriers.vocabulary import TERMINAL_STATUSES, CashStatus, ShipmentStatus


class ProviderChoices(models.TextChoices):
    YALIDINE = "yalidine", _("Yalidine")
    ZR_EXPRESS = "zr_express", _("ZR Express")
    MAYSTRO = "maystro", _("Maystro Delivery")
    NOEST = "noest", _("NOEST")


class CustomerOrderStatusChoices(models.TextChoices):
    DRAFT = "draft", _("Draft")
    CONFIRMED = "confirmed", _("Confirmed / Ready to Ship")
    DISPATCHED = "dispatched", _("Dispatched / In Transit")
    DELIVERED = "delivered", _("Delivered")
    RETURNED = "returned", _("Returned")
    REJECTED = "rejected", _("Rejected / Cancelled")
    FAILED = "failed", _("Failed")


class DeliveryTypeChoices(models.TextChoices):
    HOME = "home", _("Home delivery")
    STOPDESK = "stopdesk", _("Stop desk")


class CustomerOrderSourceChoices(models.TextChoices):
    WHATSAPP = "whatsapp", _("WhatsApp")
    MESSENGER = "messenger", _("Messenger")
    INSTAGRAM = "instagram", _("Instagram")
    WEBSITE = "website", _("Website")
    OUEDKNISS = "ouedkniss", _("Ouedkniss")
    TIKTOK = "tiktok", _("TikTok")
    PHONE = "phone", _("Phone Call")
    MANUAL = "manual", _("Manual")


class ProviderConfig(TenantScopedModel):
    """
    One courier account of a store: the dzship courier key and the credentials that
    courier needs (names from the dzship catalogue, e.g. {"apiKey": "..."}).
    The same credentials serve dzship (writes) and Pointure's read connectors
    (docs/plans/delivery-v1-plan.md §1, P1.4).
    """
    # Fields never copied into SyncOutbox payloads (apps.core.signals.serialize_model).
    SYNC_EXCLUDED_FIELDS = ("credentials", "api_id", "api_secret")

    courier = models.CharField(
        _("Courier"), max_length=50, blank=True, default="",
        help_text=_("dzship courier key, e.g. maystro, yalidine, dhd."),
    )
    credentials = models.JSONField(_("Credentials"), default=dict, blank=True)
    base_url = models.CharField(
        _("Courier API address"), max_length=255, blank=True, default="",
        help_text=_("Only for the generic Ecotrack courier (*.ecotrack.dz)."),
    )
    is_active = models.BooleanField(_("Active"), default=True)

    # Sync bookkeeping (P1.9), written with queryset.update() so no SyncOutbox row per sync.
    sync_cursor = models.DateTimeField(_("Latest courier change read"), null=True, blank=True)
    payout_cursor = models.DateField(_("Latest courier payout read"), null=True, blank=True)
    last_synced_at = models.DateTimeField(_("Last sync"), null=True, blank=True)
    last_sync_error = models.CharField(_("Last sync error"), max_length=50, blank=True, default="")

    # Legacy columns (before P1.4). Read once by migration 0007, removed in a later release.
    provider = models.CharField(
        _("Provider (legacy)"), max_length=20, choices=ProviderChoices.choices, blank=True, default=""
    )
    api_id = models.CharField(_("API ID / Token (legacy)"), max_length=255, blank=True)
    api_secret = models.CharField(_("API Secret / Key (legacy)"), max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Delivery Provider Config")
        verbose_name_plural = _("Delivery Provider Configs")
        ordering = ["courier"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "courier"],
                condition=~models.Q(courier=""),
                name="deliv_providerconfig_tenant_courier_uniq",
            ),
        ]

    def __str__(self):
        return f"{self.courier or self.provider} ({self.tenant.name})"


class CustomerOrder(TenantScopedModel):
    """
    An incoming order from external channels (WhatsApp, Web) that acts as a draft.
    Once validated and dispatched, it links to a Sale and a Delivery tracking number.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    source = models.CharField(
        _("Order Source"), max_length=20, choices=CustomerOrderSourceChoices.choices, default=CustomerOrderSourceChoices.WHATSAPP
    )
    
    # Customer Details
    customer_name = models.CharField(_("Customer Name"), max_length=200)
    customer_phone = models.CharField(_("Customer Phone"), max_length=20)
    wilaya = models.CharField(_("Wilaya"), max_length=50, blank=True)
    commune = models.CharField(_("Commune"), max_length=100, blank=True)
    address = models.TextField(_("Detailed Address"), blank=True)
    
    # What they ordered (raw text)
    customer_notes = models.TextField(_("Customer Notes / Requested Items"), blank=True)
    
    # Status and Financials
    status = models.CharField(
        _("Status"), max_length=20, choices=CustomerOrderStatusChoices.choices, default=CustomerOrderStatusChoices.DRAFT
    )
    # What the customer pays for delivery (added to the COD unless free_shipping).
    shipping_fee = models.DecimalField(_("Shipping Fee"), max_digits=10, decimal_places=2, default=0.00)

    # Delivery order (docs/plans/delivery-v1-plan.md P2.3)
    customer_phone2 = models.CharField(_("Second phone"), max_length=20, blank=True, default="")
    delivery_type = models.CharField(
        _("Delivery type"), max_length=10, choices=DeliveryTypeChoices.choices, default=DeliveryTypeChoices.HOME
    )
    # The courier's own desk id and name (from GET …/provider-configs/{id}/desks/).
    stop_desk_id = models.CharField(_("Stop desk ID"), max_length=64, blank=True, default="")
    stop_desk_name = models.CharField(_("Stop desk"), max_length=200, blank=True, default="")
    # Cash the courier collects; checked against the lines by check_cod(). Null = expected_cod().
    cod_amount = models.DecimalField(
        _("Cash on delivery"), max_digits=12, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0"))],
    )
    # The courier's quote when the order was prepared (information only; not revenue, DL.9).
    quoted_fee = models.DecimalField(_("Quoted delivery fee"), max_digits=10, decimal_places=2, null=True, blank=True)
    free_shipping = models.BooleanField(_("Free shipping"), default=False)
    open_package = models.BooleanField(_("Customer may open the package"), default=False)
    note_to_driver = models.CharField(_("Note to the driver"), max_length=255, blank=True, default="")

    # Set by the dispatch and the shipment lifecycle only (P2.4, P2.5), never from request data.
    dispatched_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        verbose_name=_("Dispatched by"),
    )
    dispatched_at = models.DateTimeField(_("Dispatched at"), null=True, blank=True)
    stock_returned_at = models.DateTimeField(_("Stock returned at"), null=True, blank=True)
    
    # Integration tracking
    # dzship courier key of the ProviderConfig used to dispatch (e.g. "maystro").
    provider = models.CharField(_("Delivery Provider"), max_length=50, blank=True, null=True)
    tracking_number = models.CharField(_("Tracking Number"), max_length=100, blank=True, null=True)
    
    # Session tracking — ties messages from the same social user to one draft
    sender_id = models.CharField(
        _("Sender ID"), max_length=100, blank=True, null=True, db_index=True,
        help_text=_("The external user ID from Meta (Messenger/Instagram) used to merge multi-message orders.")
    )
    
    # Link to the official financial record (Sale)
    sale = models.OneToOneField(
        "sales.Sale", on_delete=models.SET_NULL, null=True, blank=True, related_name="customer_order"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Customer Order")
        verbose_name_plural = _("Customer Orders")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Order from {self.customer_name} via {self.get_source_display()}"

    # ── amounts: the single backend source (DL2.6) ───────────────────────────
    def goods_total(self):
        """Sum of the lines (unit price × quantity − line discount): the future sale amount."""
        return lines_total(self.lines.all())

    def expected_cod(self):
        """Goods plus the delivery fee the customer pays, unless shipping is free."""
        return expected_cod(self.goods_total(), self.shipping_fee, self.free_shipping)

    def cod_to_collect(self):
        """What the courier collects: the stored amount, or the expected one when none was set."""
        return self.cod_amount if self.cod_amount is not None else self.expected_cod()


CENT = Decimal("0.01")


def line_subtotal(unit_price, quantity, discount_amount):
    return (Decimal(unit_price) * int(quantity) - Decimal(discount_amount or 0)).quantize(CENT)


def lines_total(lines):
    """Lines are CustomerOrderLine rows or dicts with unit_price, quantity, discount_amount."""
    def field(line, name):
        return line.get(name) if isinstance(line, dict) else getattr(line, name)

    total = sum(
        (line_subtotal(field(l, "unit_price"), field(l, "quantity"), field(l, "discount_amount")) for l in lines),
        Decimal("0"),
    )
    return total.quantize(CENT)


def expected_cod(goods, shipping_fee, free_shipping):
    fee = Decimal("0") if free_shipping else Decimal(shipping_fee or 0)
    return (Decimal(goods) + fee).quantize(CENT)


def check_cod(cod_amount, expected):
    """
    Error message for a COD the store typed, or None when it is acceptable: couriers take
    whole dinars, and the courier never collects more than the goods plus the delivery fee
    (a smaller amount covers a deposit already paid).
    """
    if cod_amount is None:
        return None
    if cod_amount < 0:
        return _("Le montant à encaisser ne peut pas être négatif.")
    if cod_amount != cod_amount.to_integral_value():
        return _("Le montant à encaisser doit être en dinars entiers.")
    if cod_amount > expected:
        return _("Le montant à encaisser dépasse le total des articles et de la livraison.")
    return None


class CustomerOrderLine(models.Model):
    """
    One article of a delivery order (P2.3). Not tenant-scoped: scope through
    `order__tenant`. Mirrors SaleItem so the sale created at delivery (P2.5) copies it.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(CustomerOrder, on_delete=models.CASCADE, related_name="lines")
    variant = models.ForeignKey("inventory.Variant", on_delete=models.PROTECT, related_name="customer_order_lines")
    quantity = models.PositiveIntegerField(_("Quantity"), validators=[MinValueValidator(1)])
    unit_price = models.DecimalField(_("Unit Price (DZD)"), max_digits=12, decimal_places=2)
    discount_amount = models.DecimalField(
        _("Line Discount"), max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = _("Customer Order Line")
        verbose_name_plural = _("Customer Order Lines")
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(check=models.Q(quantity__gte=1), name="deliv_line_quantity_gte_1"),
            models.CheckConstraint(check=models.Q(unit_price__gte=0), name="deliv_line_unit_price_gte_0"),
            models.CheckConstraint(check=models.Q(discount_amount__gte=0), name="deliv_line_discount_gte_0"),
        ]

    def __str__(self):
        return f"{self.variant} × {self.quantity}"

    @property
    def subtotal(self):
        return line_subtotal(self.unit_price, self.quantity, self.discount_amount)


class Shipment(TenantScopedModel):
    """
    One parcel at a courier, as last read by a read connector
    (docs/plans/delivery-v1-plan.md P1.8). Read-only mirror: it never writes
    sales, stock, ledger or cash-session data (DL.3).

    Every save writes a SyncOutbox row (TenantScopedModel), so callers apply a
    snapshot with `apply_snapshot()` and save only when it reports changes.
    """
    provider_config = models.ForeignKey(
        ProviderConfig, on_delete=models.PROTECT, related_name="shipments",
        verbose_name=_("Courier account"),
    )
    customer_order = models.ForeignKey(
        CustomerOrder, on_delete=models.SET_NULL, null=True, blank=True, related_name="shipments",
        verbose_name=_("Pointure order"),
    )

    courier = models.CharField(_("Courier"), max_length=50)
    external_id = models.CharField(_("Courier parcel id"), max_length=64)
    tracking_number = models.CharField(_("Tracking number"), max_length=64, blank=True, db_index=True)
    reference = models.CharField(_("Our reference"), max_length=100, blank=True)

    recipient_name = models.CharField(_("Recipient"), max_length=200, blank=True)
    recipient_phone = models.CharField(_("Recipient phone"), max_length=20, blank=True)
    wilaya_code = models.CharField(_("Wilaya code"), max_length=10, blank=True)
    commune = models.CharField(_("Commune"), max_length=100, blank=True)

    cod_amount = models.DecimalField(_("Amount to collect"), max_digits=12, decimal_places=2, null=True, blank=True)
    delivery_fee = models.DecimalField(_("Delivery fee"), max_digits=12, decimal_places=2, null=True, blank=True)
    store_amount = models.DecimalField(_("Amount owed to the store"), max_digits=12, decimal_places=2, null=True, blank=True)

    status = models.CharField(
        _("Status"), max_length=30, choices=ShipmentStatus.choices, default=ShipmentStatus.UNKNOWN,
    )
    raw_status = models.CharField(_("Courier status"), max_length=100, blank=True)
    status_at = models.DateTimeField(_("Status time"), null=True, blank=True)
    is_terminal = models.BooleanField(_("Final status"), default=False)

    cash_status = models.CharField(
        _("Cash status"), max_length=30, choices=CashStatus.choices, default=CashStatus.AWAITING_DELIVERY,
    )
    cash_raw = models.CharField(_("Courier cash status"), max_length=100, blank=True)
    # Set when the courier itself reports the parcel as paid (e.g. a Maystro payout statement).
    courier_payout_ref = models.CharField(_("Courier payout id"), max_length=64, blank=True)
    courier_paid_on = models.DateField(_("Paid by courier on"), null=True, blank=True)
    # Set when a manager records the cash picked up at the agency (P1.12).
    payout = models.ForeignKey(
        "CourierPayout", on_delete=models.PROTECT, null=True, blank=True, related_name="shipments",
        verbose_name=_("Recorded payout"),
    )
    # Cash status before the payout, restored if the payout is voided.
    payout_previous_cash = models.CharField(max_length=30, blank=True, default="")

    courier_updated_at = models.DateTimeField(_("Changed at courier"), null=True, blank=True)
    last_synced_at = models.DateTimeField(_("Last read"), null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Shipment")
        verbose_name_plural = _("Shipments")
        ordering = ["-courier_updated_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "courier", "external_id"], name="deliv_shipment_tenant_courier_ext_uniq",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status"], name="deliv_ship_tenant_status_idx"),
            models.Index(fields=["tenant", "cash_status"], name="deliv_ship_tenant_cash_idx"),
            models.Index(fields=["tenant", "-courier_updated_at"], name="deliv_ship_tenant_upd_idx"),
        ]

    def __str__(self):
        return f"{self.courier} {self.tracking_number or self.external_id}"

    def apply_snapshot(self, snapshot) -> list:
        """
        Copy a connector ParcelSnapshot onto this shipment and return the names of the
        fields that changed (empty list = nothing to save). Does not save.

        Cash rule: an order snapshot cannot know about payouts, so it never moves a
        parcel back from `paid` or `ready` to `held_by_courier`; those two stages are
        set from payout data by the sync (P1.9).
        """
        values = {
            "tracking_number": (snapshot.tracking or "")[:64],
            "reference": (snapshot.reference or "")[:100],
            "recipient_name": (snapshot.recipient_name or "")[:200],
            "recipient_phone": (snapshot.recipient_phone or "")[:20],
            "wilaya_code": (snapshot.wilaya_code or "")[:10],
            "commune": (snapshot.commune or "")[:100],
            "cod_amount": snapshot.cod_amount,
            "delivery_fee": snapshot.delivery_fee,
            "store_amount": snapshot.store_amount,
            "status": snapshot.status,
            "raw_status": (snapshot.raw_status or "")[:100],
            "status_at": snapshot.status_at,
            "is_terminal": snapshot.status in TERMINAL_STATUSES,
            "courier_updated_at": snapshot.updated_at,
        }
        keeps_payout_stage = self.payout_id is not None or (  # cash recorded at the agency stays paid
            self.cash_status in (CashStatus.PAID, CashStatus.READY)
            and snapshot.cash_status == CashStatus.HELD_BY_COURIER
        )
        if not keeps_payout_stage:
            values["cash_status"] = snapshot.cash_status
            values["cash_raw"] = (snapshot.cash_raw or "")[:100]

        changed = []
        for name, value in values.items():
            if getattr(self, name) != value:
                setattr(self, name, value)
                changed.append(name)
        return changed

    def merge_events(self, events) -> int:
        """Insert the tracking events not stored yet; return how many were added."""
        known = set(self.events.values_list("occurred_at", "raw_status"))
        new = []
        for event in events:
            key = (event.occurred_at, (event.raw_status or "")[:100])
            if key in known:
                continue
            known.add(key)
            new.append(ShipmentEvent(
                shipment=self,
                status=event.status,
                raw_status=key[1],
                occurred_at=event.occurred_at,
                note=(event.note or "")[:255],
            ))
        if new:
            ShipmentEvent.objects.bulk_create(new)
        return len(new)


class ShipmentEvent(models.Model):
    """One step of a shipment's tracking history. Scoped through `shipment__tenant`."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name="events")
    status = models.CharField(_("Status"), max_length=30, choices=ShipmentStatus.choices)
    raw_status = models.CharField(_("Courier status"), max_length=100, blank=True)
    occurred_at = models.DateTimeField(_("Time"))
    note = models.CharField(_("Note"), max_length=255, blank=True)

    class Meta:
        verbose_name = _("Shipment event")
        verbose_name_plural = _("Shipment events")
        ordering = ["occurred_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["shipment", "occurred_at", "raw_status"], name="deliv_shipevent_uniq",
            ),
        ]

    def __str__(self):
        return f"{self.raw_status or self.status} @ {self.occurred_at:%Y-%m-%d %H:%M}"


class CourierPayoutStatus(models.TextChoices):
    RECORDED = "recorded", _("Enregistré")
    VOIDED = "voided", _("Annulé")


class CourierPayout(TenantScopedModel):
    """
    Cash picked up at a courier's agency, recorded by a manager (P1.12, DL.8).

    Never linked to a CashSession: delivery money is kept apart from the till (DL.3).
    Totals are computed by the server from the shipments (`expected_amount`) and the
    amount typed by the manager (`amount_received`).
    """
    provider_config = models.ForeignKey(
        ProviderConfig, on_delete=models.PROTECT, related_name="payouts", verbose_name=_("Courier account"),
    )
    courier = models.CharField(_("Courier"), max_length=50)
    picked_up_on = models.DateField(_("Picked up on"))
    amount_received = models.DecimalField(_("Amount received"), max_digits=12, decimal_places=2)
    expected_amount = models.DecimalField(_("Expected amount"), max_digits=12, decimal_places=2)
    difference = models.DecimalField(_("Difference"), max_digits=12, decimal_places=2)
    courier_reference = models.CharField(_("Courier's reference"), max_length=64, blank=True)
    notes = models.CharField(_("Notes"), max_length=500, blank=True)
    status = models.CharField(
        _("Status"), max_length=10, choices=CourierPayoutStatus.choices, default=CourierPayoutStatus.RECORDED,
    )
    recorded_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, related_name="+", verbose_name=_("Recorded by"),
    )
    voided_at = models.DateTimeField(_("Voided at"), null=True, blank=True)
    voided_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name=_("Voided by"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Courier payout")
        verbose_name_plural = _("Courier payouts")
        ordering = ["-picked_up_on", "-created_at"]
        indexes = [models.Index(fields=["tenant", "-picked_up_on"], name="deliv_payout_tenant_date_idx")]

    def __str__(self):
        return f"{self.courier} {self.picked_up_on} {self.amount_received}"
