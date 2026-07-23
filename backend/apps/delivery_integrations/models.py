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
    """Stores API credentials for delivery agencies (via dzship)."""
    provider = models.CharField(
        _("Provider"), max_length=20, choices=ProviderChoices.choices
    )
    api_id = models.CharField(_("API ID / Token"), max_length=255, blank=True)
    api_secret = models.CharField(_("API Secret / Key"), max_length=255, blank=True)
    is_active = models.BooleanField(_("Active"), default=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Delivery Provider Config")
        verbose_name_plural = _("Delivery Provider Configs")
        unique_together = [["tenant", "provider"]]

    def __str__(self):
        return f"{self.get_provider_display()} ({self.tenant.name})"


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
    provider = models.CharField(
        _("Delivery Provider"), max_length=20, choices=ProviderChoices.choices, blank=True, null=True
    )
    tracking_number = models.CharField(_("Tracking Number"), max_length=100, blank=True, null=True)
    
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
