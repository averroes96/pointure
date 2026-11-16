import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel


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
    shipping_fee = models.DecimalField(_("Shipping Fee"), max_digits=10, decimal_places=2, default=0.00)
    
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
