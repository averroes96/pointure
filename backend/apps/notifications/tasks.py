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
    """Run every 6 hours. Create notifications for products and variants below alert threshold."""
    from django.db.models import F
    from apps.inventory.models import Variant, Product
    from apps.notifications.models import Notification
    from apps.core.models import User, RoleChoices
    from django.utils import timezone

    # 1. Product level alerts
    for product in Product.objects.filter(is_active=True, alert_threshold__gt=0):
        if product.is_total_low_stock:
            owners = User.objects.filter(tenant=product.tenant, role=RoleChoices.OWNER, is_active=True)
            for owner in owners:
                cutoff = timezone.now() - timezone.timedelta(hours=24)
                if not Notification.objects.filter(
                    user=owner,
                    type="low_stock",
                    related_object_type="Product",
                    related_object_id=str(product.pk),
                    created_at__gte=cutoff,
                ).exists():
                    Notification.objects.create(
                        tenant=product.tenant,
                        user=owner,
                        type="low_stock",
                        title=f"Global Low stock: {product.name}",
                        body=f"{product.name} has only {product.total_stock} unit(s) left globally (threshold: {product.alert_threshold}).",
                        related_object_type="Product",
                        related_object_id=str(product.pk),
                    )

    # 2. Variant level alerts
    low_variants = Variant.objects.filter(
        is_active=True,
        alert_threshold__gt=0,
        stock_qty__lte=F("alert_threshold"),
    ).select_related("product__tenant")

    for variant in low_variants:
        tenant = variant.product.tenant
        owners = User.objects.filter(tenant=tenant, role=RoleChoices.OWNER, is_active=True)
        for owner in owners:
            cutoff = timezone.now() - timezone.timedelta(hours=24)
            if not Notification.objects.filter(
                user=owner,
                type="low_stock",
                related_object_type="Variant",
                related_object_id=str(variant.pk),
                created_at__gte=cutoff,
            ).exists():
                Notification.objects.create(
                    tenant=tenant,
                    user=owner,
                    type="low_stock",
                    title=f"Low stock: {variant.product.name} ({variant.colour} EU{variant.size_eu})",
                    body=f"{variant} has only {variant.stock_qty} unit(s) left (threshold: {variant.alert_threshold}).",
                    related_object_type="Variant",
                    related_object_id=str(variant.pk),
                )
    logger.info("Low stock check complete.")
