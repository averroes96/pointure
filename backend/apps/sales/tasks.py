"""Background and scheduled tasks for sales."""
import logging
from datetime import timedelta
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(queue="default")
def cleanup_held_sales():
    """
    Delete parked/held sales older than 24 hours.
    """
    from apps.sales.models import HeldSale
    cutoff = timezone.now() - timedelta(hours=24)
    deleted, _ = HeldSale.objects.filter(created_at__lt=cutoff).delete()
    if deleted:
        logger.info("Cleaned up %d held sales older than 24 hours.", deleted)
    return deleted

