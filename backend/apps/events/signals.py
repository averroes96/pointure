"""
Signal handlers that publish real-time events to Redis.

Only fires for enterprise tenants (checked in the SSE view, not here —
we publish regardless and let subscribers filter by their plan).
"""
import logging

from django.db.models import Sum
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.inventory.models import StockMovement
from apps.sales.models import Sale

from .publisher import publish

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Sale)
def on_sale_created(sender, instance: Sale, created: bool, **kwargs):
    if not created or not instance.tenant_id:
        return
    try:
        branch_name = instance.branch.name if instance.branch_id else "Siège"
    except Exception:
        branch_name = "Siège"
    try:
        publish(
            instance.tenant_id,
            "sale_created",
            {
                "sale_id": instance.pk,
                "total_amount": str(instance.total_amount),
                "branch_id": instance.branch_id,
                "branch_name": branch_name,
                "receipt_number": instance.receipt_number,
            },
        )
    except Exception:
        logger.debug("on_sale_created publish failed", exc_info=True)


@receiver(post_save, sender=StockMovement)
def on_stock_movement(sender, instance: StockMovement, created: bool, **kwargs):
    """Emit a stock_alert when any variant crosses its alert threshold."""
    if not created or not instance.tenant_id or instance.quantity_delta >= 0:
        return  # skip restocking movements — only care about drawdowns
    try:
        variant = instance.variant
        # Compute global stock from the ledger (single aggregate query)
        total_stock = (
            StockMovement.objects.filter(
                variant=variant,
                tenant_id=instance.tenant_id,
            ).aggregate(t=Sum("quantity_delta"))["t"]
            or 0
        )
        if total_stock > variant.alert_threshold:
            return  # still healthy — nothing to broadcast
        try:
            branch_name = instance.branch.name if instance.branch_id else "Siège"
        except Exception:
            branch_name = "Siège"
        try:
            product_name = variant.product.name
        except Exception:
            product_name = ""
        publish(
            instance.tenant_id,
            "stock_alert",
            {
                "variant_id": variant.pk,
                "product_name": product_name,
                "size_eu": variant.size_eu,
                "colour": variant.colour or "",
                "stock_qty": total_stock,
                "branch_id": instance.branch_id,
                "branch_name": branch_name,
                "is_out_of_stock": total_stock <= 0,
            },
        )
    except Exception:
        logger.debug("on_stock_movement publish failed", exc_info=True)
