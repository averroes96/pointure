"""URLs for apps.closing."""
from rest_framework.routers import DefaultRouter

from apps.closing.views import FiscalYearViewSet

router = DefaultRouter()
router.register(r"years", FiscalYearViewSet, basename="closing-fiscal-year")

urlpatterns = router.urls

