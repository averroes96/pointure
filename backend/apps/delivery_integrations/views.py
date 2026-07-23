import logging
from decimal import Decimal
from rest_framework import viewsets, views, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.db import transaction

from apps.core.models import Tenant
from apps.inventory.models import Variant
from apps.sales.models import Sale, SaleItem, SaleStatusChoices
from .models import ProviderConfig, CustomerOrder, CustomerOrderStatusChoices
from .serializers import (
    ProviderConfigSerializer, CustomerOrderSerializer, CustomerOrderDispatchSerializer
)
from .services.dzship_client import DzshipClient

logger = logging.getLogger(__name__)


class ProviderConfigViewSet(viewsets.ModelViewSet):
    """Manage delivery API credentials (dzship configs)."""
    serializer_class = ProviderConfigSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ProviderConfig.objects.filter(tenant=self.request.user.tenant)

    def perform_create(self, serializer):
        serializer.save(tenant=self.request.user.tenant)


class CustomerOrderViewSet(viewsets.ModelViewSet):
    """Manage Draft/External Orders and Dispatch them."""
    serializer_class = CustomerOrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CustomerOrder.objects.filter(tenant=self.request.user.tenant)

    @action(detail=True, methods=["post"])
    def dispatch_order(self, request, pk=None):
        """Validates a draft order, links inventory variants, creates Sale, calls dzship."""
        customer_order = self.get_object()
        if customer_order.status != CustomerOrderStatusChoices.DRAFT:
            return Response({"detail": "Order is not in draft status."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = CustomerOrderDispatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        provider_name = serializer.validated_data["provider"]
        shipping_fee = serializer.validated_data["shipping_fee"]
        variant_ids = serializer.validated_data["variant_ids"]
        quantities = serializer.validated_data["quantities"]

        # 1. Verify Provider Config
        provider_config = ProviderConfig.objects.filter(tenant=request.user.tenant, provider=provider_name, is_active=True).first()
        if not provider_config:
            return Response({"detail": f"{provider_name} config not found or inactive."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                # 2. Fetch variants and calculate total
                variants = Variant.objects.filter(id__in=variant_ids).select_for_update()
                variant_map = {str(v.id): v for v in variants}
                
                total_amount = Decimal("0.00")
                sale_items = []
                for v_id, qty in zip(variant_ids, quantities):
                    str_v_id = str(v_id)
                    if str_v_id not in variant_map:
                        raise ValueError(f"Variant {str_v_id} not found.")
                    variant = variant_map[str_v_id]
                    # Note: We aren't doing strict stock enforcement here as per Pointure standard, 
                    # but Sale creation will trigger signals to create StockMovements.
                    price = variant.price_retail
                    total_amount += (price * qty)
                    sale_items.append((variant, qty, price))
                
                # 3. Create Sale
                sale = Sale.objects.create(
                    tenant=request.user.tenant,
                    cashier=request.user,
                    status=SaleStatusChoices.COMPLETED,  # Or a new custom status
                    total_amount=total_amount + shipping_fee,
                    notes=f"Delivery Order: {customer_order.id}",
                )
                
                for variant, qty, price in sale_items:
                    SaleItem.objects.create(
                        sale=sale,
                        variant=variant,
                        quantity=qty,
                        unit_price=price
                    )

                # 4. Prepare dzship payload
                credentials = {
                    "apiId": provider_config.api_id,
                    "apiToken": provider_config.api_secret
                }
                
                order_data = {
                    "recipient": {
                        "fullName": customer_order.customer_name,
                        "phone": customer_order.customer_phone,
                        "wilayaCode": customer_order.wilaya, # Note: Needs exact mapping depending on UI
                        "communeName": customer_order.commune
                    },
                    "deliveryType": "home", # Default to home
                    "productList": " / ".join([f"{v.product.name} x{qty}" for v, qty, _ in sale_items]),
                    "codAmount": float(total_amount + shipping_fee)
                }

                # 5. Call dzship API
                dzship_response = DzshipClient.create_order(provider_name, credentials, order_data)
                
                # 6. Update CustomerOrder
                customer_order.sale = sale
                customer_order.provider = provider_name
                customer_order.shipping_fee = shipping_fee
                customer_order.status = CustomerOrderStatusChoices.DISPATCHED
                customer_order.tracking_number = dzship_response.get("trackingNumber")
                customer_order.save()

            return Response({"detail": "Dispatched successfully", "trackingNumber": customer_order.tracking_number})

        except Exception as e:
            logger.exception("Dispatch failed")
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ExternalOrderIngestionView(views.APIView):
    """
    Publicly accessible endpoint for WhatsApp chatbots / landing pages.
    Requires Tenant API Key in headers: X-API-KEY.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        api_key = request.headers.get("X-API-KEY")
        if not api_key:
            return Response({"detail": "Missing API Key"}, status=status.HTTP_401_UNAUTHORIZED)
        
        tenant = Tenant.objects.filter(api_key=api_key).first()
        if not tenant:
            return Response({"detail": "Invalid API Key"}, status=status.HTTP_401_UNAUTHORIZED)

        # Basic manual serialization (you could use a Serializer for strict validation)
        data = request.data
        try:
            order = CustomerOrder.objects.create(
                tenant=tenant,
                source=data.get("source", "whatsapp"),
                customer_name=data.get("customer_name"),
                customer_phone=data.get("phone"),
                wilaya=data.get("wilaya", ""),
                commune=data.get("commune", ""),
                address=data.get("address", ""),
                customer_notes=data.get("notes", "")
            )
            return Response({"detail": "Draft order created", "order_id": order.id}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class WebhookReceiverView(views.APIView):
    """
    Receives Webhooks from dzship about status changes.
    URL should be registered in dzship / merchant portal.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        payload = request.data
        tracking_number = payload.get("trackingNumber")
        new_status = payload.get("status") # normalized by dzship: 'delivered', 'returned', etc.
        
        if not tracking_number or not new_status:
            return Response({"detail": "Invalid payload"}, status=status.HTTP_400_BAD_REQUEST)

        order = CustomerOrder.objects.filter(tracking_number=tracking_number).first()
        if not order:
            # We don't track this
            return Response({"detail": "Tracking number not found"}, status=status.HTTP_404_NOT_FOUND)

        if new_status == "delivered":
            order.status = CustomerOrderStatusChoices.DELIVERED
            # If sale exists, we should probably mark it as paid, 
            # but currently we assume it's completed on dispatch.
            # In a full system, you might create a Payment object here.
            
        elif new_status == "returned":
            order.status = CustomerOrderStatusChoices.RETURNED
            if order.sale:
                # Cancel the sale to restock inventory
                order.sale.status = SaleStatusChoices.CANCELLED
                order.sale.save(update_fields=["status"])
                # Note: Cancelling a sale does not automatically restock in all architectures. 
                # Pointure's Sale signals should handle `StockMovement` reversal.
        else:
            # e.g. in_transit, failed
            # Map standard dzship statuses to ours if they differ
            order.status = new_status 

        order.save()
        return Response({"detail": "Webhook processed"})
