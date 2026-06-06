from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import LoyaltyAccountViewSet, LoyaltyProgramViewSet

router = DefaultRouter()
router.register("programs", LoyaltyProgramViewSet, basename="loyalty-program")
router.register("accounts", LoyaltyAccountViewSet, basename="loyalty-account")

urlpatterns = [
    path("", include(router.urls)),
]
