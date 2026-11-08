from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CreditNoteViewSet, DeliveryNoteViewSet, InvoiceViewSet, QuoteViewSet

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("quotes", QuoteViewSet, basename="quote")
router.register("delivery-notes", DeliveryNoteViewSet, basename="delivery-note")
router.register("credit-notes", CreditNoteViewSet, basename="credit-note")

urlpatterns = [path("", include(router.urls))]
