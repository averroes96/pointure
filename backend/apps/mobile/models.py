import uuid
from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.models import TenantScopedModel


class DeviceToken(TenantScopedModel):
    """FCM / APNs push token for a user's mobile device."""

    PLATFORM_ANDROID = "android"
    PLATFORM_IOS = "ios"
    PLATFORM_CHOICES = [
        (PLATFORM_ANDROID, "Android"),
        (PLATFORM_IOS, "iOS"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="device_tokens",
    )
    token = models.TextField(_("FCM / APNs Token"))
    platform = models.CharField(
        _("Platform"), max_length=10, choices=PLATFORM_CHOICES
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # One token can only be registered once per user (re-registering is a no-op)
        unique_together = [("user", "token")]
        verbose_name = _("Device Token")
        verbose_name_plural = _("Device Tokens")

    def __str__(self):
        return f"{self.user} [{self.platform}] …{self.token[-8:]}"
