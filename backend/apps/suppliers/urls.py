from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import PurchaseOrderViewSet, SupplierInvoiceViewSet, SupplierPaymentViewSet, SupplierViewSet

router = DefaultRouter()
router.register(r"purchase-orders", PurchaseOrderViewSet, basename="po")
router.register(r"invoices", SupplierInvoiceViewSet, basename="supplier-invoice")
router.register(r"payments", SupplierPaymentViewSet, basename="supplier-payment")
router.register(r"", SupplierViewSet, basename="supplier")

urlpatterns = [path("", include(router.urls))]
