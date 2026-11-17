import logging
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from rest_framework import serializers, viewsets, views, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.throttling import UserRateThrottle
from django.db import transaction
from django.http import Http404
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.core.models import Commune, StoreSettings, Tenant
from apps.core.permissions import RolePermission
from apps.core.plan_permissions import PlanRequired
from .models import (
    ProviderConfig, CustomerOrder, CustomerOrderStatusChoices, Shipment,
)
from .serializers import (
    ProviderConfigSerializer, CustomerOrderSerializer,
    CustomerOrderDispatchSerializer, ShipmentDetailSerializer,
    ShipmentQuerySerializer, ShipmentSerializer,
    CourierPayoutCreateSerializer, CourierPayoutDetailSerializer, CourierPayoutPreviewSerializer,
    CourierPayoutSerializer, ConfirmCourierPayoutsSerializer,
)
from .models import CourierPayout
from .services import catalogue, communes, couriers, dispatch, geo, payouts, sync
from .services.dzship_client import DzshipClient, DzshipError

from apps.core.mixins import TenantScopedViewSetMixin

logger = logging.getLogger(__name__)


class CourierUnavailable(APIException):
    """The courier (through dzship) did not confirm the parcel."""
    status_code = status.HTTP_502_BAD_GATEWAY
    default_code = "courier_refused"
    default_detail = _("Le transporteur a refusé la commande. Vérifiez les informations du client puis réessayez.")


class CourierUnreachable(CourierUnavailable):
    """No answer from the courier: the parcel may or may not exist on its side."""
    default_code = "courier_unreachable"
    default_detail = _(
        "Le transporteur n'a pas répondu. Vérifiez dans l'application du "
        "transporteur si le colis a été créé avant de renvoyer la commande."
    )


class DeliveryIntegrationsGuardMixin:
    """
    Enforces that StoreSettings.enable_delivery_integrations is True.
    Returns 404 whenever the feature is disabled (D5).
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        user = getattr(request, "user", None)
        tenant = getattr(request, "tenant", None) or (
            getattr(user, "tenant", None) if user and user.is_authenticated else None
        )
        if tenant:
            settings = StoreSettings.objects.filter(tenant=tenant).first()
            if not settings or not settings.enable_delivery_integrations:
                raise Http404("Delivery integrations are disabled for this store.")
        else:
            if not StoreSettings.objects.filter(enable_delivery_integrations=True).exists():
                raise Http404("Delivery integrations are disabled.")


class CourierTestThrottle(UserRateThrottle):
    """Each test calls the courier's API: 10 per minute per user is plenty."""
    scope = "courier_test"
    rate = "10/min"


class CourierGeoThrottle(UserRateThrottle):
    """Desk lists and fee quotes call dzship (cached): 30 per minute per user."""
    scope = "courier_geo"
    rate = "30/min"


class CourierReadUnavailable(APIException):
    """dzship or the courier could not answer a read (desks, fees)."""
    status_code = status.HTTP_502_BAD_GATEWAY
    default_code = "courier_unavailable"
    default_detail = _("Le transporteur ne répond pas pour le moment. Réessayez dans un instant.")


class CourierFeatureNotSupported(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "not_supported"
    default_detail = _("Ce transporteur ne propose pas cette information.")


class DesksQuerySerializer(serializers.Serializer):
    wilaya = serializers.IntegerField(min_value=1, max_value=58)


class RatesQuerySerializer(serializers.Serializer):
    to_wilaya = serializers.IntegerField(min_value=1, max_value=58)
    delivery_type = serializers.ChoiceField(choices=["home", "stopdesk"])
    to_commune = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    cod_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False)


def _courier_read(call):
    """Run a dzship read; map its errors to clean API errors (never the raw message)."""
    try:
        return call()
    except DzshipError as exc:
        if exc.not_supported:
            raise CourierFeatureNotSupported()
        raise CourierReadUnavailable()


class CourierCatalogueQuerySerializer(serializers.Serializer):
    refresh = serializers.BooleanField(required=False, default=False)


class CourierCatalogueView(DeliveryIntegrationsGuardMixin, views.APIView):
    """
    GET /api/v1/deliveries/couriers/[?refresh=true]

    The couriers dzship supports, from the saved snapshot. Answers at once; a missing
    or stale snapshot (or ?refresh=true) is refreshed in the background, and the
    page reads again when `refreshing` turns false (docs/plans/delivery-v1-plan.md P1.3).
    No tenant data: the catalogue is the same for every store.
    """
    # Managers and owners only (no role_permissions map → RolePermission default).
    permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]

    def get(self, request):
        query = CourierCatalogueQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(catalogue.get_catalogue(force_refresh=query.validated_data["refresh"]))


class CommuneQuerySerializer(serializers.Serializer):
    wilaya = serializers.IntegerField(min_value=1, max_value=69)
    name = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")


def _pointure_communes():
    # Loaded by core migration 0004 from apps/core/fixtures/communes.json.
    return Commune.objects.order_by("wilaya__code", "name")


class CommuneMatchView(DeliveryIntegrationsGuardMixin, views.APIView):
    """
    GET /api/v1/deliveries/communes/?wilaya=62[&name=Bir El Ater]

    The wilaya's Pointure communes with the courier spelling dzship expects (or none),
    the courier's own list for a manual pick, and, with `name`, the match for one
    typed commune. Reference data only (no tenant rows); no network: the dzship
    list comes from its snapshot (P2.1), refreshed in the background (P2.2).
    """
    permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]

    def get(self, request):
        query = CommuneQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        code, name = query.validated_data["wilaya"], query.validated_data["name"].strip()
        index, meta = communes.load_index()
        rows = []
        for c in _pointure_communes().filter(wilaya__code=f"{code:02d}").values("id", "name", "ar_name"):
            match = index.match(code, c["name"], c["ar_name"])
            rows.append({**c, "courier": communes.courier_name(match), "matched": match is not None})
        return Response({
            "wilaya": code,
            "ship_wilaya": communes.ship_wilaya(code),
            "available": bool(index.by_wilaya),
            "communes": rows,
            "courier_communes": [communes.courier_name(r) for r in index.communes(code)],
            "match": communes.courier_name(index.match(code, name, name)) if name else None,
            **meta,
        })


class UnmatchedCommunesView(DeliveryIntegrationsGuardMixin, views.APIView):
    """
    GET /api/v1/deliveries/communes/unmatched/

    Pointure communes with no courier spelling, for the owner to review (never guessed).
    Empty with `available: false` while the dzship list has not been fetched yet.
    """
    permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]

    def get(self, request):
        index, meta = communes.load_index()
        rows = []
        if index.by_wilaya:
            for c in _pointure_communes().values("id", "name", "ar_name", "wilaya__code"):
                code = int(c["wilaya__code"])
                if index.match(code, c["name"], c["ar_name"]) is None:
                    rows.append({"id": c["id"], "name": c["name"], "ar_name": c["ar_name"],
                                 "wilaya": code, "ship_wilaya": communes.ship_wilaya(code)})
        return Response({"available": bool(index.by_wilaya), "count": len(rows), "communes": rows, **meta})


class ProviderConfigViewSet(DeliveryIntegrationsGuardMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Manage the store's courier accounts (courier key + credentials, P1.4)."""
    serializer_class = ProviderConfigSerializer
    ordering = ["courier"]
    # PATCH merges credentials (replace one field at a time); no PUT.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def perform_destroy(self, instance):
        # Shipments keep their courier account (on_delete=PROTECT): their history must stay readable.
        if instance.shipments.exists():
            raise ValidationError(_(
                "Ce transporteur a des expéditions enregistrées : désactivez-le au lieu de le supprimer."
            ))
        instance.delete()

    def _usable_config(self):
        config = self.get_object()
        if not config.is_active:
            raise ValidationError(_("Ce transporteur est désactivé."))
        if not dispatch.credentials_complete(config):
            raise ValidationError(_("Les identifiants de ce transporteur sont incomplets."))
        return config

    @action(detail=True, methods=["get"], throttle_classes=[CourierGeoThrottle])
    def desks(self, request, pk=None):
        """GET …/provider-configs/{id}/desks/?wilaya=16 — the courier's stop desks in one wilaya (P2.1)."""
        config = self._usable_config()
        query = DesksQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        desks = _courier_read(lambda: geo.desks_for(config, query.validated_data["wilaya"]))
        return Response({"desks": desks})

    @action(detail=True, methods=["get"], throttle_classes=[CourierGeoThrottle])
    def rates(self, request, pk=None):
        """GET …/provider-configs/{id}/rates/?to_wilaya=&delivery_type=&to_commune=&cod_amount= (P2.1)."""
        config = self._usable_config()
        query = RatesQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        q = query.validated_data
        quote = _courier_read(lambda: geo.quote_for(
            config, to_wilaya=q["to_wilaya"], delivery_type=q["delivery_type"],
            to_commune=q["to_commune"], cod_amount=q.get("cod_amount"),
        ))
        return Response({k: (str(v) if isinstance(v, Decimal) else v) for k, v in quote.items()})

    @action(detail=True, methods=["post"], throttle_classes=[CourierTestThrottle])
    def test(self, request, pk=None):
        """
        POST /deliveries/provider-configs/{id}/test/ — check the saved credentials with the
        courier's own API (read connector, P1.7). Always 200 with a `result`:
        ok | refused | forbidden | rate_limited | unreachable | not_supported | error.
        No database write; the courier call is outside any transaction.
        """
        config = self.get_object()
        try:
            connector = couriers.get_connector(config)
            connector.test_credentials()
        except couriers.ConnectorNotSupported as exc:
            return Response({"result": "not_supported", "reason": exc.reason})
        except couriers.ConnectorAuthError:
            return Response({"result": "refused"})
        except couriers.ConnectorForbidden:
            return Response({"result": "forbidden"})
        except couriers.ConnectorRateLimited as exc:
            return Response({"result": "rate_limited", "retry_after": exc.retry_after})
        except couriers.ConnectorUnavailable:
            return Response({"result": "unreachable"})
        except couriers.ConnectorError:
            return Response({"result": "error"})
        except Exception:
            logger.exception("Courier test failed unexpectedly (config %s)", config.pk)
            return Response({"result": "error"})
        return Response({
            "result": "ok",
            "capabilities": sorted(connector.capabilities),
            # e.g. a Maystro ak_ key: valid, but cannot read orders or payouts.
            "limited": not connector.supports(couriers.Capability.LIST),
        })
    # Managers and owners only (no role_permissions map → RolePermission default).
    permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]

    def get_queryset(self):
        return ProviderConfig.objects.filter(tenant=self.request.user.tenant)


class CustomerOrderViewSet(DeliveryIntegrationsGuardMixin, TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """Manage Draft/External Orders and Dispatch them."""
    serializer_class = CustomerOrderSerializer
    # Managers and owners only (no role_permissions map → RolePermission default).
    permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]

    def get_queryset(self):
        return (
            CustomerOrder.objects.filter(tenant=self.request.user.tenant)
            .prefetch_related("lines__variant__product")
        )

    def perform_update(self, serializer):
        # Lines and amounts drive stock and the sale at delivery (P2.4, P2.5): drafts only.
        if serializer.instance.status != CustomerOrderStatusChoices.DRAFT:
            raise ValidationError(_("Seule une commande en brouillon peut être modifiée."))
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        if instance.status != CustomerOrderStatusChoices.DRAFT:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Only draft orders can be deleted. Once dispatched, an order cannot be deleted.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def dispatch_order(self, request, pk=None):
        """
        POST …/customer-orders/{id}/dispatch_order/ {"provider_config": "<uuid>"}

        Sends the saved draft to the courier through dzship (docs/plans/delivery-v1-plan.md
        P2.4; steps in services/dispatch.py). Stock leaves once the courier took the
        parcel; the sale is created at delivery (P2.5). If the courier refuses, the order
        goes back to draft and nothing is recorded.
        """
        customer_order = self.get_object()
        tenant = self._get_tenant()
        serializer = CustomerOrderDispatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        config = ProviderConfig.objects.filter(
            tenant=tenant, pk=serializer.validated_data["provider_config"]
        ).first()
        if config is None:
            raise ValidationError({"provider_config": [_("Ce transporteur n'est pas configuré.")]})

        # 1. Local checks and the payload; nothing has changed yet.
        plan = dispatch.prepare(customer_order, config, tenant)

        # 2. Claim the draft (atomic conditional UPDATE; select_for_update is a no-op on SQLite).
        if not dispatch.claim(customer_order, tenant):
            raise ValidationError({"status": [_("Cette commande n'est plus un brouillon.")]})

        # 3. Courier call, outside any transaction.
        try:
            answer = DzshipClient.create_order(
                config.courier, config.credentials or {}, plan.order_data,
                base_url=config.base_url, from_wilaya=plan.from_wilaya,
            )
        except Exception as exc:
            dispatch.release(customer_order, tenant)
            if isinstance(exc, DzshipError) and exc.outcome_uncertain:
                raise CourierUnreachable()
            if not isinstance(exc, DzshipError):
                logger.exception("Unexpected error while sending order %s to %s", customer_order.pk, config.courier)
                raise CourierUnavailable()
            raise CourierUnavailable(detail={
                "message": CourierUnavailable.default_detail,
                "courier_message": exc.courier_message,
            })

        tracking_number = str((answer or {}).get("trackingNumber") or "")[:100] or None

        # 4. Stock out and order dispatched, in one short transaction.
        try:
            order = dispatch.record_dispatch(customer_order, plan, config, tracking_number, request.user)
        except Exception:
            # The parcel exists at the courier: keep the order out of draft (no resend).
            logger.exception(
                "Order %s was accepted by %s (tracking %s) but could not be recorded",
                customer_order.pk, config.courier, tracking_number,
            )
            dispatch.keep_accepted(customer_order, tenant, config, tracking_number)
            return Response(
                {
                    "error": {
                        "code": "recorded_failed",
                        "message": str(_(
                            "Le colis a été créé chez le transporteur (suivi %(tracking)s) mais le stock "
                            "n'a pas pu être enregistré. Ne renvoyez pas la commande ; contactez le support."
                        ) % {"tracking": tracking_number or "-"}),
                        "details": {},
                        "status_code": status.HTTP_500_INTERNAL_SERVER_ERROR,
                    }
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # 5. Fetch the new parcel in the background so its Shipment appears and links back.
        transaction.on_commit(lambda: _request_sync_quietly(config.pk))
        return Response({
            "detail": _("Commande envoyée au transporteur."),
            "trackingNumber": tracking_number,
            "order": CustomerOrderSerializer(order, context=self.get_serializer_context()).data,
        })


def _request_sync_quietly(config_id):
    try:
        sync.request_sync(config_id, "dispatch")
    except Exception:
        logger.exception("Could not start the shipment sync after a dispatch")


class ShipmentRefreshThrottle(UserRateThrottle):
    """Each refresh starts courier reads in the background: 6 per minute per user."""
    scope = "shipment_refresh"
    rate = "6/min"


STALE_AFTER = timedelta(minutes=10)


class ShipmentViewSet(DeliveryIntegrationsGuardMixin, TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Shipments read from the store's couriers (docs/plans/delivery-v1-plan.md P1.10).

    GET  /deliveries/shipments/            list (filters: status, cash_status, courier,
                                           date_from, date_to on the courier's last change;
                                           search; ordering)
    GET  /deliveries/shipments/{id}/       detail with tracking history
    GET  /deliveries/shipments/summary/    counts and money per courier + sync state
    POST /deliveries/shipments/refresh/    start a background sync now

    Reading never blocks on a courier: stale data triggers a background sync and the
    response says so (`syncing` / `refreshing`), so the page can read again later.
    """
    queryset = Shipment.objects.all()
    serializer_class = ShipmentSerializer
    # Managers and owners only (no role_permissions map → RolePermission default).
    permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]
    http_method_names = ["get", "post", "head", "options"]
    search_fields = ["tracking_number", "reference", "recipient_name", "recipient_phone", "external_id"]
    ordering_fields = ["courier_updated_at", "status_at", "cod_amount", "created_at"]
    ordering = ["-courier_updated_at", "-created_at"]

    def get_serializer_class(self):
        return ShipmentDetailSerializer if self.action == "retrieve" else ShipmentSerializer

    def _filters(self):
        query = ShipmentQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        return query.validated_data

    def _apply_filters(self, qs, filters, with_states=True):
        if filters.get("courier"):
            qs = qs.filter(courier=filters["courier"])
        if filters.get("date_from"):
            qs = qs.filter(courier_updated_at__date__gte=filters["date_from"])
        if filters.get("date_to"):
            qs = qs.filter(courier_updated_at__date__lte=filters["date_to"])
        if with_states and filters.get("status"):
            qs = qs.filter(status__in=filters["status"])
        if with_states and filters.get("cash_status"):
            qs = qs.filter(cash_status__in=filters["cash_status"])
        return qs

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            qs = self._apply_filters(qs, self._filters())
        elif self.action == "retrieve":
            qs = qs.prefetch_related("events")
        return qs

    # ── background freshness ──────────────────────────────────────────────────
    def _active_configs(self):
        return ProviderConfig.objects.filter(tenant=self._get_tenant(), is_active=True)

    def _sync_stale_configs(self):
        now = timezone.now()
        for config in self._active_configs():
            stale = config.last_synced_at is None or now - config.last_synced_at > STALE_AFTER
            if stale and not sync.is_running(config.pk):
                sync.request_sync(config.pk, "page_open")

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        self._sync_stale_configs()
        return response

    def retrieve(self, request, *args, **kwargs):
        shipment = self.get_object()
        stale = (
            shipment.last_synced_at is None
            or timezone.now() - shipment.last_synced_at > STALE_AFTER
            or not shipment.events.exists()
        )
        if stale and shipment.provider_config.is_active:
            sync.request_shipment_refresh(shipment.pk)
        data = self.get_serializer(shipment).data
        data["refreshing"] = sync.shipment_refreshing(shipment.pk)
        return Response(data)

    # ── summary ───────────────────────────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Counts per status and money per cash status, per courier, for the date/courier filters."""
        filters = self._filters()
        qs = self._apply_filters(super().get_queryset(), filters, with_states=False)

        per_courier = {}

        def bucket(courier):
            return per_courier.setdefault(courier, {"courier": courier, "total": 0, "by_status": {}, "by_cash": {}})

        for row in qs.values("courier", "status").annotate(n=Count("id")).order_by():
            b = bucket(row["courier"])
            b["by_status"][row["status"]] = row["n"]
            b["total"] += row["n"]
        for row in qs.values("courier", "cash_status").annotate(
            n=Count("id"), cod=Sum("cod_amount"), store=Sum("store_amount"),
        ).order_by():
            bucket(row["courier"])["by_cash"][row["cash_status"]] = {
                "count": row["n"],
                "cod_amount": _money(row["cod"]),
                "store_amount": _money(row["store"]),
            }

        names = {}
        snapshot = catalogue.load_snapshot()
        if snapshot:
            names = {c["key"]: c["name"] for c in snapshot["couriers"]}
        accounts = []
        for config in self._active_configs():
            accounts.append({
                "courier": config.courier,
                "courier_name": names.get(config.courier, config.courier),
                "last_synced_at": config.last_synced_at,
                "last_sync_error": config.last_sync_error,
                "syncing": sync.is_running(config.pk),
            })
            bucket(config.courier)
        for courier, b in per_courier.items():
            b["courier_name"] = names.get(courier, courier)
        return Response({
            "couriers": sorted(per_courier.values(), key=lambda b: b["courier_name"]),
            "accounts": accounts,
        })

    # ── refresh ───────────────────────────────────────────────────────────────
    @action(detail=False, methods=["post"], throttle_classes=[ShipmentRefreshThrottle])
    def refresh(self, request):
        """Start a background sync of every active courier account (or one with ?courier=)."""
        filters = self._filters()
        configs = self._active_configs()
        if filters.get("courier"):
            configs = configs.filter(courier=filters["courier"])
        started = {config.courier: sync.request_sync(config.pk, "refresh") for config in configs}
        return Response({"sync": started}, status=status.HTTP_202_ACCEPTED)


def _money(value):
    return str((value or Decimal("0")).quantize(Decimal("0.01")))


class CourierPayoutViewSet(DeliveryIntegrationsGuardMixin, TenantScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Cash picked up at a courier's agency (docs/plans/delivery-v1-plan.md P1.12).

    GET  /deliveries/payouts/[?courier=&status=]   list
    GET  /deliveries/payouts/{id}/                 detail with its parcels
    POST /deliveries/payouts/                      record (courier, amount_received, parcels)
    POST /deliveries/payouts/{id}/void/            complete reversal
    GET  /deliveries/payouts/to-record/            what the courier paid or holds, not recorded yet

    Kept apart from the till: no CashSession or CashMovement is ever written (DL.3).
    """
    queryset = CourierPayout.objects.all()
    serializer_class = CourierPayoutSerializer
    # Managers and owners only (no role_permissions map → RolePermission default).
    permission_classes = [IsAuthenticated, RolePermission, PlanRequired("pro_retail")]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["courier", "status"]
    ordering = ["-picked_up_on", "-created_at"]

    def get_serializer_class(self):
        return CourierPayoutDetailSerializer if self.action == "retrieve" else CourierPayoutSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("recorded_by", "voided_by")
        if self.action == "list":
            qs = qs.annotate(
                n_shipments=Count("shipments"),
                n_unconfirmed=Count("shipments", filter=Q(shipments__courier_payout_ref="")),
            )
        elif self.action == "retrieve":
            qs = qs.prefetch_related("shipments")
        return qs

    def create(self, request, *args, **kwargs):
        data = CourierPayoutCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        payout = payouts.record_payout(tenant=self._get_tenant(), user=request.user, **data.validated_data)
        return Response(CourierPayoutDetailSerializer(payout, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        payout = payouts.void_payout(payout=self.get_object(), user=request.user)
        return Response(CourierPayoutSerializer(payout, context=self.get_serializer_context()).data)

    @action(detail=False, methods=["get"], url_path="to-record")
    def to_record(self, request):
        return Response({"couriers": payouts.to_record(self._get_tenant())})

    @action(detail=False, methods=["post"])
    def preview(self, request):
        """Same checks and expected amount as recording, without writing anything."""
        data = CourierPayoutPreviewSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return Response(payouts.preview_payout(tenant=self._get_tenant(), **data.validated_data))

    @action(detail=False, methods=["post"], url_path="confirm-courier-payouts")
    def confirm_courier_payouts(self, request):
        """Record courier-reported payouts as received for their expected amount (backlog clearing)."""
        data = ConfirmCourierPayoutsSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        result = payouts.confirm_courier_payouts(tenant=self._get_tenant(), user=request.user, **data.validated_data)
        code = status.HTTP_201_CREATED if result["created"] else status.HTTP_400_BAD_REQUEST
        return Response(result, status=code)


class ExternalOrderIngestionView(DeliveryIntegrationsGuardMixin, views.APIView):
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
        except Exception:
            # Never echo exception text to an unauthenticated caller (AGENTS.md §4.6).
            logger.exception("External order ingestion failed for tenant %s", tenant.pk)
            return Response(
                {"detail": _("Commande invalide : vérifiez le nom et le téléphone du client.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

