from django.contrib import admin
from .models import PurchaseOrder, Supplier, SupplierInvoice, SupplierPayment

admin.site.register(Supplier)
admin.site.register(PurchaseOrder)
admin.site.register(SupplierInvoice)
admin.site.register(SupplierPayment)
