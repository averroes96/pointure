"""
Auto-enroll new clients into the loyalty programme.

Fires after a Client is created. If the tenant has an active LoyaltyProgram,
a LoyaltyAccount is created immediately so the client earns points on their
very first purchase.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender="clients.Client")
def auto_enroll_client(sender, instance, created, **kwargs):
    if not created:
        return
    # Loyalty is a retail-only benefit — wholesale clients are excluded
    if getattr(instance, "client_type", "retail") != "retail":
        return

    tenant = getattr(instance, "tenant", None)
    if not tenant:
        return

    try:
        from apps.loyalty.models import LoyaltyAccount, LoyaltyProgram

        if not LoyaltyProgram.objects.filter(tenant=tenant, is_active=True).exists():
            return

        LoyaltyAccount.objects.get_or_create(
            tenant=tenant,
            client=instance,
            defaults={"tier": "bronze"},
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "Failed to auto-enroll client %s in loyalty programme.", instance.pk
        )
