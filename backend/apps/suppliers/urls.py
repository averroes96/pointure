from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import PurchaseOrderViewSet, SupplierInvoiceViewSet, SupplierPaymentViewSet, SupplierViewSet

router = DefaultRouter()
router.register("", SupplierViewSet, basename="supplier")
router.register("purchase-orders", PurchaseOrderViewSet, basename="po")
router.register("invoices", SupplierInvoiceViewSet, basename="supplier-invoice")
router.register("payments", SupplierPaymentViewSet, basename="supplier-payment")

urlpatterns = [path("", include(router.urls))]
