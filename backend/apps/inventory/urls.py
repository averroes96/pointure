from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    LowStockViewSet,
    ProductViewSet,
    StockMovementViewSet,
    StockTransferViewSet,
    VariantViewSet,
)

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("variants", VariantViewSet, basename="variant")
router.register("movements", StockMovementViewSet, basename="stock-movement")
router.register("transfers", StockTransferViewSet, basename="stock-transfer")
router.register("low-stock", LowStockViewSet, basename="low-stock")

urlpatterns = [path("", include(router.urls))]
