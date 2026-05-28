from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import SupplierInvoice, SupplierPayment


@receiver(post_save, sender=SupplierInvoice)
@receiver(post_delete, sender=SupplierInvoice)
def update_balance_on_invoice(sender, instance, **kwargs):
    instance.supplier.recompute_balance()


@receiver(post_save, sender=SupplierPayment)
@receiver(post_delete, sender=SupplierPayment)
def update_balance_on_payment(sender, instance, **kwargs):
    instance.supplier.recompute_balance()
