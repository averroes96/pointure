from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CashReconciliationViewSet, SaleViewSet

router = DefaultRouter()
router.register("reconciliations", CashReconciliationViewSet, basename="reconciliation")
router.register("", SaleViewSet, basename="sale")

urlpatterns = [path("", include(router.urls))]
