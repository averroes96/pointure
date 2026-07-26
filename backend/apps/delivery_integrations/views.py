import logging
from decimal import Decimal
from rest_framework import viewsets, views, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.db import transaction
from django.http import HttpResponse
from decouple import config

from apps.core.models import Tenant
from apps.core.plan_permissions import PlanRequired
from apps.inventory.models import Variant
from apps.sales.models import Sale, SaleItem, SaleStatusChoices
from .models import (
    ProviderConfig, CustomerOrder, CustomerOrderStatusChoices,
    SocialIntegration,
)
from .serializers import (
    ProviderConfigSerializer, CustomerOrderSerializer,
    CustomerOrderDispatchSerializer, SocialIntegrationSerializer,
)
from .services.dzship_client import DzshipClient
from .services.ai_parser import parse_order_message

from apps.core.mixins import TenantScopedViewSetMixin

logger = logging.getLogger(__name__)


class ProviderConfigViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Manage delivery API credentials (dzship configs)."""
    serializer_class = ProviderConfigSerializer
    permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]

    def get_queryset(self):
        return ProviderConfig.objects.filter(tenant=self.request.user.tenant)


class CustomerOrderViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Manage Draft/External Orders and Dispatch them."""
    serializer_class = CustomerOrderSerializer
    permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]

    def get_queryset(self):
        return CustomerOrder.objects.filter(tenant=self.request.user.tenant)

    def perform_destroy(self, instance):
        if instance.status != CustomerOrderStatusChoices.DRAFT:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Only draft orders can be deleted. Once dispatched, an order cannot be deleted.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def dispatch_order(self, request, pk=None):
        """Validates a draft order, links inventory variants, creates Sale, calls dzship."""
        customer_order = self.get_object()
        if customer_order.status != CustomerOrderStatusChoices.DRAFT:
            return Response({"detail": "Order is not in draft status."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = CustomerOrderDispatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        provider_name = serializer.validated_data["provider"]
        total_price = serializer.validated_data["total_price"]  # COD amount set by the store
        variant_ids = serializer.validated_data["variant_ids"]
        quantities = serializer.validated_data["quantities"]

        # 1. Verify Provider Config
        provider_config = ProviderConfig.objects.filter(tenant=request.user.tenant, provider=provider_name, is_active=True).first()
        if not provider_config:
            return Response({"detail": f"{provider_name} config not found or inactive."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                # 2. Fetch variants and calculate product total (for the Sale record)
                variants = Variant.objects.filter(id__in=variant_ids).select_for_update()
                variant_map = {str(v.id): v for v in variants}
                
                product_total = Decimal("0.00")
                sale_items = []
                for v_id, qty in zip(variant_ids, quantities):
                    str_v_id = str(v_id)
                    if str_v_id not in variant_map:
                        raise ValueError(f"Variant {str_v_id} not found.")
                    variant = variant_map[str_v_id]
                    price = variant.product.sale_price
                    product_total += (price * qty)
                    sale_items.append((variant, qty, price))
                
                # 3. Create Sale — total is product value only, no delivery fees
                sale = Sale.objects.create(
                    tenant=request.user.tenant,
                    cashier=request.user,
                    status=SaleStatusChoices.COMPLETED,
                    total_amount=product_total,
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
                        "wilayaCode": int(customer_order.wilaya) if customer_order.wilaya.isdigit() else None,
                        "communeName": customer_order.commune
                    },
                    "deliveryType": "home",
                    "productList": " / ".join([f"{v.product.name} x{qty}" for v, qty, _ in sale_items]),
                    "codAmount": float(total_price)  # The store-set price, delivery fees handled by delivery service
                }

                # 5. Call dzship API
                dzship_response = DzshipClient.create_order(provider_name, credentials, order_data)
                
                # 6. Update CustomerOrder
                customer_order.sale = sale
                customer_order.provider = provider_name
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


# ─────────────────────────────────────────────
# Social Integrations (Facebook Messenger / Instagram)
# ─────────────────────────────────────────────

class SocialIntegrationViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Manage social media integrations (Facebook Messenger, Instagram DM)."""
    serializer_class = SocialIntegrationSerializer
    permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]

    def get_queryset(self):
        return SocialIntegration.objects.filter(tenant=self.request.user.tenant)


import urllib.parse
import requests
from django.shortcuts import redirect

class MetaOAuthURLView(views.APIView):
    """
    Returns the official Facebook OAuth URL for the store owner to log in.
    """
    permission_classes = [IsAuthenticated, PlanRequired("pro_retail")]

    def get(self, request):
        app_id = config("META_APP_ID", default="")
        if not app_id:
            return Response({"detail": "META_APP_ID is not configured."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # The redirect URI must perfectly match what is registered in the Meta App
        # Force https in case we are behind a proxy that strips the original scheme
        redirect_uri = request.build_absolute_uri('/api/v1/deliveries/meta-oauth/callback/').replace('http://', 'https://')
        
        # Pass the tenant ID in the state parameter to know who logged in upon callback
        state = str(request.user.tenant.id)

        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": "pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata,business_management",
            "response_type": "code"
        }
        
        url = "https://www.facebook.com/v19.0/dialog/oauth?" + urllib.parse.urlencode(params)
        return Response({"url": url})


class MetaOAuthCallbackView(views.APIView):
    """
    Handles the redirect from Facebook after the store owner logs in.
    Exchanges the code for a token, fetches their pages, and creates SocialIntegrations.
    """
    permission_classes = [AllowAny] # Because Facebook redirects the user directly here

    def get(self, request):
        code = request.query_params.get("code")
        state = request.query_params.get("state")
        error = request.query_params.get("error")
        
        frontend_redirect = f'{config("FRONTEND_URL", default="http://localhost:5173")}/settings'

        if error or not code or not state:
            logger.error("Meta OAuth failed: %s", error)
            return redirect(f"{frontend_redirect}?error=oauth_failed")

        tenant_id = state
        tenant = Tenant.objects.filter(id=tenant_id).first()
        if not tenant:
            return redirect(f"{frontend_redirect}?error=tenant_not_found")

        app_id = config("META_APP_ID", default="")
        app_secret = config("META_APP_SECRET", default="")
        redirect_uri = request.build_absolute_uri('/api/v1/deliveries/meta-oauth/callback/')

        # 1. Exchange code for User Access Token
        token_url = "https://graph.facebook.com/v19.0/oauth/access_token"
        token_res = requests.get(token_url, params={
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "client_secret": app_secret,
            "code": code
        })
        
        if not token_res.ok:
            logger.error("Failed to get Meta access token: %s", token_res.text)
            return redirect(f"{frontend_redirect}?error=token_exchange_failed")
            
        user_access_token = token_res.json().get("access_token")

        # 2. Fetch the Facebook Pages this user manages
        perms_res = requests.get("https://graph.facebook.com/v19.0/me/permissions", params={"access_token": user_access_token})
        if perms_res.ok:
            logger.info("Meta Token Permissions: %s", perms_res.json().get("data", []))

        pages_url = "https://graph.facebook.com/v19.0/me/accounts"
        pages_res = requests.get(pages_url, params={"access_token": user_access_token})
        
        if not pages_res.ok:
            logger.error("Failed to fetch Meta pages: %s", pages_res.text)
            return redirect(f"{frontend_redirect}?error=fetch_pages_failed")
            
        pages = pages_res.json().get("data", [])
        logger.info("Meta pages fetched: %s", pages)
        
        if not pages:
            return redirect(f"{frontend_redirect}?error=no_pages_found")

        # 3. Save each page as a SocialIntegration and subscribe the webhook
        for page in pages:
            page_id = page.get("id")
            page_token = page.get("access_token")
            page_name = page.get("name")
            
            integration, created = SocialIntegration.objects.update_or_create(
                tenant=tenant,
                platform="facebook",
                page_id=page_id,
                defaults={
                    "page_name": page_name,
                    "access_token": page_token,
                    "is_active": True,
                    "ai_enabled": True
                }
            )
            
            # Subscribe the Pointure webhook to this page's messages
            sub_url = f"https://graph.facebook.com/v19.0/{page_id}/subscribed_apps"
            sub_res = requests.post(sub_url, params={
                "access_token": page_token,
                "subscribed_fields": "messages"
            })
            if not sub_res.ok:
                logger.warning("Failed to subscribe webhook for page %s: %s", page_id, sub_res.text)

        return redirect(f"{frontend_redirect}?success=oauth_complete")


class MetaWebhookView(views.APIView):
    """
    Receives incoming messages from Meta (Facebook Messenger & Instagram DM)
    via the Meta Webhooks API.

    GET  → Webhook verification challenge (Meta sends this once during setup).
    POST → Incoming message events. Each message is parsed by AI and
           automatically converted into a CustomerOrder draft.
    """
    permission_classes = [AllowAny]

    # The verify token is configured per-deployment; Meta sends it during
    # the initial webhook subscription handshake.
    VERIFY_TOKEN = config("META_WEBHOOK_VERIFY_TOKEN", default="pointure_meta_secret")

    def get(self, request):
        """Handle Meta webhook verification challenge."""
        mode = request.query_params.get("hub.mode")
        token = request.query_params.get("hub.verify_token")
        challenge = request.query_params.get("hub.challenge")

        if mode == "subscribe" and token == self.VERIFY_TOKEN:
            logger.info("Meta webhook verified successfully.")
            return HttpResponse(challenge, content_type="text/plain", status=200)

        logger.warning("Meta webhook verification failed: token mismatch.")
        return HttpResponse("Forbidden", status=403)

    def post(self, request):
        """
        Process incoming Meta webhook events.

        Meta sends a payload like:
        {
          "object": "page" | "instagram",
          "entry": [{
            "id": "<PAGE_ID>",
            "messaging": [{
              "sender": {"id": "..."},
              "message": {"text": "..."}
            }]
          }]
        }
        """
        payload = request.data
        obj_type = payload.get("object")  # "page" for Messenger, "instagram" for IG

        entries = payload.get("entry", [])
        orders_created = 0
        orders_updated = 0

        for entry in entries:
            page_id = str(entry.get("id", ""))
            messaging_events = entry.get("messaging", [])

            # Find the SocialIntegration (and thus the Tenant) for this page
            integration = SocialIntegration.objects.filter(
                page_id=page_id, is_active=True
            ).select_related("tenant").first()

            if not integration:
                logger.warning("No active SocialIntegration for page_id=%s", page_id)
                continue

            for event in messaging_events:
                message = event.get("message", {})
                text = message.get("text", "")
                sender_id = event.get("sender", {}).get("id", "")

                if not text:
                    # Skip non-text events (images, reactions, read receipts, etc.)
                    continue

                # Determine the source channel
                source = "messenger" if obj_type == "page" else "instagram"

                # --- Session buffering: look for an existing draft from this sender ---
                existing_draft = None
                if sender_id:
                    from django.utils import timezone
                    from datetime import timedelta
                    session_window = timezone.now() - timedelta(hours=12)
                    existing_draft = CustomerOrder.objects.filter(
                        tenant=integration.tenant,
                        sender_id=sender_id,
                        status=CustomerOrderStatusChoices.DRAFT,
                        updated_at__gte=session_window,
                    ).order_by("-updated_at").first()

                if integration.ai_enabled:
                    # Build the full conversation text for AI parsing
                    if existing_draft:
                        combined_text = f"{existing_draft.customer_notes}\n{text}"
                    else:
                        combined_text = text

                    # Use Gemini to parse the combined message into structured order data
                    parsed = parse_order_message(combined_text)
                    if parsed:
                        if not parsed.get("is_order_intent") and not existing_draft:
                            # Only skip non-order messages when there is no active session
                            logger.info("Skipped non-order message: %s", text)
                            continue

                        if existing_draft:
                            # Update the existing draft with newly parsed fields
                            existing_draft.customer_name = parsed.get("customer_name") or existing_draft.customer_name
                            existing_draft.customer_phone = parsed.get("phone") or existing_draft.customer_phone
                            existing_draft.wilaya = parsed.get("wilaya") or existing_draft.wilaya
                            existing_draft.commune = parsed.get("commune") or existing_draft.commune
                            existing_draft.address = parsed.get("address") or existing_draft.address
                            existing_draft.customer_notes = combined_text
                            existing_draft.save()
                            orders_updated += 1
                            logger.info("Updated existing draft %s for sender %s", existing_draft.id, sender_id)
                        else:
                            CustomerOrder.objects.create(
                                tenant=integration.tenant,
                                source=source,
                                sender_id=sender_id,
                                customer_name=parsed.get("customer_name", ""),
                                customer_phone=parsed.get("phone", ""),
                                wilaya=parsed.get("wilaya", ""),
                                commune=parsed.get("commune", ""),
                                address=parsed.get("address", ""),
                                customer_notes=parsed.get("notes", text),
                            )
                            orders_created += 1
                    else:
                        # AI parsing failed — save or append raw message as a draft
                        if existing_draft:
                            existing_draft.customer_notes = f"{existing_draft.customer_notes}\n{text}"
                            existing_draft.save()
                            orders_updated += 1
                        else:
                            CustomerOrder.objects.create(
                                tenant=integration.tenant,
                                source=source,
                                sender_id=sender_id,
                                customer_name="",
                                customer_phone="",
                                customer_notes=text,
                            )
                            orders_created += 1
                else:
                    # AI disabled — save or append raw message
                    if existing_draft:
                        existing_draft.customer_notes = f"{existing_draft.customer_notes}\n{text}"
                        existing_draft.save()
                        orders_updated += 1
                    else:
                        CustomerOrder.objects.create(
                            tenant=integration.tenant,
                            source=source,
                            sender_id=sender_id,
                            customer_name="",
                            customer_phone="",
                            customer_notes=text,
                        )
                        orders_created += 1

        logger.info("Meta webhook processed: %d orders created, %d orders updated.", orders_created, orders_updated)
        # Meta requires a 200 OK response within 20 seconds
        return Response({"detail": "EVENT_RECEIVED"}, status=200)


