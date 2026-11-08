"""Views and ViewSets for Fiscal Year Closing (Tasks 6.1 - 6.5)."""
import io
import logging

from zoneinfo import ZoneInfo
from django.http import HttpResponse
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.closing.models import FiscalYear
from apps.closing.serializers import FiscalYearSerializer
from apps.closing.services.export_pack import (
    generate_fiscal_year_export_workbook,
    render_fiscal_year_summary_pdf,
)
from apps.closing.services.snapshot import build_snapshot
from apps.core.models import RoleChoices
from apps.core.permissions import IsManagerOrOwner
from apps.core.mixins import TenantScopedViewSetMixin
from apps.inventory.models import StocktakeSession, StocktakeStatusChoices
from apps.invoicing.models import Invoice, InvoiceStatusChoices
from apps.sales.models import CashSession, CashSessionStatus, Sale
from apps.suppliers.models import POStatusChoices, PurchaseOrder

logger = logging.getLogger(__name__)


class IgnoreFormatContentNegotiation(DefaultContentNegotiation):
    """
    Allow custom binary downloads (?format=pdf, ?format=xlsx) without
    DRF's DefaultContentNegotiation trying to find a non-existent JSON renderer format.
    """
    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class FiscalYearViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """
    Management closing viewset for fiscal years.
    Restricted to store owners and managers.
    Provides accountant export pack (.xlsx), printable PDF summary,
    checklist inspection, snapshot generation, and closing/reopening workflows.
    """
    queryset = FiscalYear.objects.all()
    serializer_class = FiscalYearSerializer
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    content_negotiation_class = IgnoreFormatContentNegotiation

    @action(detail=True, methods=["get"], url_path="checklist")
    def checklist(self, request, pk=None):
        """
        Checklist of pre-closing warnings & blocking conditions.
        Open cash sessions starting on or before end_date block closing.
        """
        fiscal_year = self.get_object()
        tenant = request.tenant
        algiers_tz = ZoneInfo("Africa/Algiers")

        # 1. Open cash sessions
        open_sessions = CashSession.objects.filter(
            tenant=tenant,
            status=CashSessionStatus.OPEN,
        ).select_related("cashier", "branch")

        blocking_sessions = []
        warning_sessions = []
        for s in open_sessions:
            local_opened = timezone.localtime(s.opened_at, algiers_tz).date()
            info = {
                "id": str(s.id),
                "session_number": s.session_number,
                "opened_at": s.opened_at.isoformat(),
                "cashier_name": s.cashier.get_full_name() or s.cashier.email,
                "branch_name": s.branch.name if s.branch else _("Principal"),
            }
            if local_opened <= fiscal_year.end_date:
                blocking_sessions.append(info)
            else:
                warning_sessions.append(info)

        # 2. Draft invoices
        draft_invoices = Invoice.objects.filter(
            tenant=tenant,
            status=InvoiceStatusChoices.DRAFT,
            date__gte=fiscal_year.start_date,
            date__lte=fiscal_year.end_date,
        )
        draft_invoices_count = draft_invoices.count()

        # 3. Unreceived purchase orders
        unreceived_pos = PurchaseOrder.objects.filter(
            tenant=tenant,
            status__in=[POStatusChoices.DRAFT, POStatusChoices.SENT, POStatusChoices.PARTIAL],
            created_at__date__lte=fiscal_year.end_date,
        )
        unreceived_pos_count = unreceived_pos.count()

        # 4. Unfinished stocktakes
        unfinished_stocktakes = StocktakeSession.objects.filter(
            tenant=tenant,
            status=StocktakeStatusChoices.IN_PROGRESS,
        )
        unfinished_stocktakes_count = unfinished_stocktakes.count()

        # 5. Active layaways
        active_layaways = Sale.objects.filter(
            tenant=tenant,
            is_layaway=True,
            status="completed",
            layaway_collected_at__isnull=True,
            created_at__date__lte=fiscal_year.end_date,
        )
        active_layaways_count = active_layaways.count()

        items = [
            {
                "key": "open_cash_sessions",
                "label": _("Sessions de caisse ouvertes"),
                "count": len(blocking_sessions) + len(warning_sessions),
                "is_blocking": len(blocking_sessions) > 0,
                "details": blocking_sessions or warning_sessions,
                "message": (
                    _("Des sessions de caisse ouvertes ont commencé avant ou pendant l'exercice. Elles doivent être fermées avant la clôture.")
                    if blocking_sessions
                    else (
                        _("Des sessions de caisse sont actuellement ouvertes pour la période suivante.")
                        if warning_sessions
                        else _("Toutes les sessions de caisse de la période sont fermées.")
                    )
                ),
            },
            {
                "key": "draft_invoices",
                "label": _("Factures en brouillon"),
                "count": draft_invoices_count,
                "is_blocking": False,
                "details": [],
                "message": (
                    _("%(count)d facture(s) en brouillon datée(s) dans cet exercice.") % {"count": draft_invoices_count}
                    if draft_invoices_count
                    else _("Aucune facture en brouillon dans cet exercice.")
                ),
            },
            {
                "key": "unreceived_purchase_orders",
                "label": _("Bons de commande non réceptionnés"),
                "count": unreceived_pos_count,
                "is_blocking": False,
                "details": [],
                "message": (
                    _("%(count)d commande(s) fournisseur en attente de réception.") % {"count": unreceived_pos_count}
                    if unreceived_pos_count
                    else _("Aucune commande fournisseur en attente.")
                ),
            },
            {
                "key": "unfinished_stocktakes",
                "label": _("Sessions d'inventaire en cours"),
                "count": unfinished_stocktakes_count,
                "is_blocking": False,
                "details": [],
                "message": (
                    _("%(count)d session(s) d'inventaire encore en cours.") % {"count": unfinished_stocktakes_count}
                    if unfinished_stocktakes_count
                    else _("Aucun inventaire en cours.")
                ),
            },
            {
                "key": "active_layaways",
                "label": _("Mises de côté (réservations) actives"),
                "count": active_layaways_count,
                "is_blocking": False,
                "details": [],
                "message": (
                    _("%(count)d article(s) mis de côté non encore retirés.") % {"count": active_layaways_count}
                    if active_layaways_count
                    else _("Aucune mise de côté en attente.")
                ),
            },
        ]

        has_blocking = len(blocking_sessions) > 0
        return Response({
            "can_close": not has_blocking,
            "has_blocking": has_blocking,
            "items": items,
        })

    @action(detail=True, methods=["post"], url_path="build-snapshot")
    def build_snapshot_action(self, request, pk=None):
        """Build or refresh management closing stock & financial snapshot."""
        fiscal_year = self.get_object()
        if fiscal_year.is_closed:
            return Response(
                {"error": {"code": "year_closed", "message": _("Impossible de recalculer l'instantané d'un exercice clôturé.")}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        stocktake_id = request.data.get("stocktake_session_id")
        if stocktake_id:
            try:
                session = StocktakeSession.objects.get(pk=stocktake_id, tenant=request.tenant)
                fiscal_year.stocktake_session = session
                fiscal_year.save(update_fields=["stocktake_session"])
            except StocktakeSession.DoesNotExist:
                return Response(
                    {"error": {"code": "not_found", "message": _("Session d'inventaire introuvable.")}},
                    status=status.HTTP_404_NOT_FOUND,
                )

        build_snapshot(fiscal_year)
        fiscal_year.refresh_from_db()
        serializer = self.get_serializer(fiscal_year)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="close")
    def close_year(self, request, pk=None):
        """Close fiscal year (owner only). Requires typing the year to confirm."""
        if request.user.role != RoleChoices.OWNER:
            return Response(
                {"error": {"code": "permission_denied", "message": _("Seul le propriétaire peut clôturer un exercice fiscal.")}},
                status=status.HTTP_403_FORBIDDEN,
            )

        fiscal_year = self.get_object()
        if fiscal_year.is_closed:
            return Response(
                {"error": {"code": "already_closed", "message": _("Cet exercice est déjà clôturé.")}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        confirm_year = request.data.get("confirm_year")
        if str(confirm_year).strip() != str(fiscal_year.year):
            return Response(
                {
                    "error": {
                        "code": "invalid_confirmation",
                        "message": _("Veuillez saisir l'année exacte %(year)d pour confirmer la clôture.") % {"year": fiscal_year.year},
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check blocking items
        algiers_tz = ZoneInfo("Africa/Algiers")
        blocking_open_sessions = CashSession.objects.filter(
            tenant=request.tenant,
            status=CashSessionStatus.OPEN,
            opened_at__date__lte=fiscal_year.end_date,
        ).exists()
        if blocking_open_sessions:
            return Response(
                {
                    "error": {
                        "code": "blocking_sessions",
                        "message": _("Des sessions de caisse ouvertes de cette période doivent être fermées avant la clôture."),
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not fiscal_year.totals:
            build_snapshot(fiscal_year)
            fiscal_year.refresh_from_db()

        fiscal_year.close(request.user)
        serializer = self.get_serializer(fiscal_year)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="reopen")
    def reopen_year(self, request, pk=None):
        """Reopen a closed fiscal year (owner only). Requires mandatory audit reason."""
        if request.user.role != RoleChoices.OWNER:
            return Response(
                {"error": {"code": "permission_denied", "message": _("Seul le propriétaire peut réouvrir un exercice fiscal.")}},
                status=status.HTTP_403_FORBIDDEN,
            )

        fiscal_year = self.get_object()
        if fiscal_year.is_open:
            return Response(
                {"error": {"code": "already_open", "message": _("Cet exercice est déjà ouvert.")}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = str(request.data.get("reason", "")).strip()
        if not reason:
            return Response(
                {"error": {"code": "reason_required", "message": _("Un motif de réouverture est obligatoire.")}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        fiscal_year.reopen(request.user, reason)
        serializer = self.get_serializer(fiscal_year)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="stocktake-options")
    def stocktake_options(self, request):
        """List completed stocktake sessions to link to a fiscal closing."""
        sessions = (
            StocktakeSession.objects.filter(
                tenant=request.tenant,
                status=StocktakeStatusChoices.COMPLETED,
            )
            .select_related("branch")
            .order_by("-completed_at")[:20]
        )
        data = [
            {
                "id": str(s.id),
                "branch_name": s.branch.name if s.branch else _("Principal"),
                "total_items": s.total_items,
                "adjusted_items": s.adjusted_items,
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                "created_at": s.created_at.isoformat(),
            }
            for s in sessions
        ]
        return Response(data)

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        """
        Export accountant pack: returns .xlsx workbook by default,
        or PDF summary if ?format=pdf is passed.
        """
        fiscal_year = self.get_object()
        fmt = request.query_params.get("format", "xlsx").lower()
        language = request.query_params.get("lang") or getattr(request, "LANGUAGE_CODE", "fr")
        if language not in ("fr", "ar", "en"):
            language = "fr"

        if fmt == "pdf":
            try:
                pdf_bytes = render_fiscal_year_summary_pdf(fiscal_year, language=language)
            except Exception as e:
                logger.exception("Failed to render fiscal year summary PDF: %s", e)
                return Response(
                    {"error": {"code": "pdf_render_failed", "message": str(e)}},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            response = HttpResponse(pdf_bytes, content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="synthese_exercice_{fiscal_year.year}.pdf"'
            return response

        # Default to Excel (.xlsx)
        try:
            wb = generate_fiscal_year_export_workbook(fiscal_year, language=language)
            bio = io.BytesIO()
            wb.save(bio)
            bio.seek(0)
            xlsx_bytes = bio.getvalue()
        except Exception as e:
            logger.exception("Failed to generate fiscal year export workbook: %s", e)
            return Response(
                {"error": {"code": "export_failed", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response = HttpResponse(
            xlsx_bytes,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="export_exercice_{fiscal_year.year}.xlsx"'
        return response

    @action(detail=True, methods=["get"], url_path="summary-pdf")
    def summary_pdf(self, request, pk=None):
        """
        Return printable 1-page PDF summary for the fiscal year.
        """
        fiscal_year = self.get_object()
        language = request.query_params.get("lang") or getattr(request, "LANGUAGE_CODE", "fr")
        if language not in ("fr", "ar", "en"):
            language = "fr"

        try:
            pdf_bytes = render_fiscal_year_summary_pdf(fiscal_year, language=language)
        except Exception as e:
            logger.exception("Failed to render fiscal year summary PDF: %s", e)
            return Response(
                {"error": {"code": "pdf_render_failed", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="synthese_exercice_{fiscal_year.year}.pdf"'
        return response

