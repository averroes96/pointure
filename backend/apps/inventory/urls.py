from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    DefectItemViewSet,
    LowStockViewSet,
    ProductViewSet,
    StockMovementViewSet,
    StockTransferViewSet,
    VariantViewSet,
)

router = DefaultRouter()
router.register(r"products", ProductViewSet, basename="product")
router.register(r"variants", VariantViewSet, basename="variant")
router.register(r"movements", StockMovementViewSet, basename="stock-movement")
router.register(r"transfers", StockTransferViewSet, basename="stock-transfer")
router.register(r"low-stock", LowStockViewSet, basename="low-stock")
router.register(r"defects", DefectItemViewSet, basename="defect")

urlpatterns = [path(r"", include(router.urls))]
