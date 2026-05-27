from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ChequeViewSet, ClientViewSet

router = DefaultRouter()
router.register(r"cheques", ChequeViewSet, basename="cheque")
router.register(r"", ClientViewSet, basename="client")


urlpatterns = [path("", include(router.urls))]
