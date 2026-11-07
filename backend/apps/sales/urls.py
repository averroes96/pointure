from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CashReconciliationViewSet, CashSessionViewSet, HeldSaleViewSet, SaleViewSet,
)

router = DefaultRouter()
router.register("sessions", CashSessionViewSet, basename="session")
router.register("reconciliations", CashReconciliationViewSet, basename="reconciliation")
router.register("held", HeldSaleViewSet, basename="held-sale")
router.register("", SaleViewSet, basename="sale")

urlpatterns = [path("", include(router.urls))]
