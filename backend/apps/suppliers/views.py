from rest_framework import viewsets
from apps.core.mixins import TenantScopedViewSetMixin
from .models import PurchaseOrder, Supplier, SupplierInvoice, SupplierPayment
from .serializers import (
    PurchaseOrderSerializer, SupplierInvoiceSerializer,
    SupplierPaymentSerializer, SupplierSerializer,
)


class SupplierViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    search_fields = ["name", "contact_name"]
    filterset_fields = ["is_active"]
    ordering = ["name"]

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.tenant)


class PurchaseOrderViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = PurchaseOrder.objects.prefetch_related("lines")
    serializer_class = PurchaseOrderSerializer
    filterset_fields = ["status", "supplier"]

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant, created_by=self.request.user)


class SupplierInvoiceViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierInvoice.objects.all()
    serializer_class = SupplierInvoiceSerializer
    filterset_fields = ["supplier"]

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant)


class SupplierPaymentViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    queryset = SupplierPayment.objects.all()
    serializer_class = SupplierPaymentSerializer

    def perform_create(self, serializer):
        self.require_manager()
        serializer.save(tenant=self.request.tenant, recorded_by=self.request.user)
