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


class SocialPlatformChoices(models.TextChoices):
    FACEBOOK = "facebook", _("Facebook Messenger")
    INSTAGRAM = "instagram", _("Instagram DM")


class SocialIntegration(TenantScopedModel):
    """
    Stores the configuration needed to receive messages from a Meta Page or
    Instagram account via the Meta Webhooks API.
    """
    platform = models.CharField(
        _("Platform"), max_length=20, choices=SocialPlatformChoices.choices
    )
    page_id = models.CharField(
        _("Page ID"), max_length=100,
        help_text=_("The Facebook Page ID or Instagram Business Account ID.")
    )
    page_name = models.CharField(
        _("Page Name"), max_length=200, blank=True,
        help_text=_("Friendly name for display purposes.")
    )
    access_token = models.CharField(
        _("Page Access Token"), max_length=512,
        help_text=_("Long-lived Page Access Token from Meta.")
    )
    is_active = models.BooleanField(_("Active"), default=True)
    ai_enabled = models.BooleanField(
        _("AI Parsing Enabled"), default=True,
        help_text=_("When enabled, incoming messages are automatically parsed by AI to extract order details.")
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Social Integration")
        verbose_name_plural = _("Social Integrations")
        unique_together = [["tenant", "platform", "page_id"]]

    def __str__(self):
        return f"{self.get_platform_display()} — {self.page_name or self.page_id} ({self.tenant.name})"
