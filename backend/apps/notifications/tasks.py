"""Celery beat tasks for notifications."""
import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(queue="notifications")
def check_cheque_due_dates():
    """
    Run daily at 08:00 Africa/Algiers.
    Send email + create in-app notification for cheques due within 3 days.
    """
    from django.utils import timezone
    from apps.clients.models import Cheque
    from apps.notifications.models import Notification

    today = timezone.now().date()
    cutoff = today + timezone.timedelta(days=3)

    cheques = Cheque.objects.filter(
        status="pending",
        due_date__gte=today,
        due_date__lte=cutoff,
        notified_at__isnull=True,
    ).select_related("tenant", "client", "supplier")

    for cheque in cheques:
        # Find owners of this tenant
        from apps.core.models import User, RoleChoices
        owners = User.objects.filter(tenant=cheque.tenant, role=RoleChoices.OWNER, is_active=True)
        party = cheque.client or cheque.supplier
        for owner in owners:
            Notification.objects.create(
                tenant=cheque.tenant,
                user=owner,
                type="cheque_due",
                title=f"Cheque due in {cheque.days_until_due} days",
                body=f"Cheque #{cheque.number} from {party} for {cheque.amount} DZD matures on {cheque.due_date}.",
                related_object_type="Cheque",
                related_object_id=str(cheque.pk),
            )
        cheque.notified_at = timezone.now()
        cheque.save(update_fields=["notified_at"])

    logger.info(f"Processed {cheques.count()} cheque due-date notifications.")


@shared_task(queue="notifications")
def flag_overdue_invoices():
    """
    Run daily. Update Invoice.status = 'overdue' where due_date < today AND status != 'paid'.
    """
    from django.utils import timezone
    from apps.invoicing.models import Invoice, InvoiceStatusChoices

    today = timezone.now().date()
    updated = Invoice.objects.filter(
        due_date__lt=today,
        status__in=[InvoiceStatusChoices.SENT, InvoiceStatusChoices.PARTIAL],
    ).update(status=InvoiceStatusChoices.OVERDUE)
    logger.info(f"Flagged {updated} invoices as overdue.")


@shared_task(queue="notifications")
def check_low_stock():
    """
    Run periodically (Celery every 6h, or Desktop scheduler daily).
    Stateful low stock check: creates exactly one notification per low-stock
    variant until replenished. Automatically resolves/clears notifications when
    stock is replenished above threshold.
    """
    from django.db.models import F, Q
    from apps.inventory.models import Variant
    from apps.notifications.models import Notification
    from apps.core.models import User, RoleChoices

    # 1. Auto-resolve/remove low stock notifications for variants that are NO LONGER low stock
    # (i.e. restocked above alert_threshold or alert_threshold set to 0)
    healthy_variant_ids = Variant.objects.filter(
        is_active=True,
    ).filter(
        Q(alert_threshold=0) | Q(stock_qty__gt=F("alert_threshold"))
    ).values_list("id", flat=True)

    Notification.objects.filter(
        type="low_stock",
        related_object_type="Variant",
        related_object_id__in=[str(vid) for vid in healthy_variant_ids],
    ).delete()

    # Clean up any legacy product-level notifications to eliminate double-alerting
    Notification.objects.filter(
        type="low_stock",
        related_object_type="Product",
    ).delete()

    # 2. Variant level alerts: exactly one notification per low-stock variant until replenished
    low_variants = Variant.objects.filter(
        is_active=True,
        alert_threshold__gt=0,
        stock_qty__lte=F("alert_threshold"),
    ).select_related("product__tenant")

    created_count = 0
    for variant in low_variants:
        tenant = variant.product.tenant
        owners = User.objects.filter(tenant=tenant, role=RoleChoices.OWNER, is_active=True)
        for owner in owners:
            # Check if an alert already exists for this owner and variant
            # (regardless of read status - we do NOT spam daily if already notified)
            already_notified = Notification.objects.filter(
                user=owner,
                type="low_stock",
                related_object_type="Variant",
                related_object_id=str(variant.pk),
            ).exists()

            if not already_notified:
                Notification.objects.create(
                    tenant=tenant,
                    user=owner,
                    type="low_stock",
                    title=f"Stock faible: {variant.product.name} ({variant.colour} EU{variant.size_eu})",
                    body=f"{variant} n'a plus que {variant.stock_qty} unité(s) en stock (seuil d'alerte: {variant.alert_threshold}).",
                    related_object_type="Variant",
                    related_object_id=str(variant.pk),
                )
                created_count += 1

    logger.info(f"Low stock check complete. {created_count} new notifications created.")
