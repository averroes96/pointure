"""Reports API views."""
from decimal import Decimal
from django.db.models import Sum, Count, Avg
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.core.mixins import TenantScopedViewSetMixin


class ReportsViewSet(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    """Dashboard and report endpoints."""
    permission_classes = [IsAuthenticated]
    queryset_class = None  # No model queryset; tenant resolved via initial()

    def get_queryset_class(self):
        return None  # Reports don't have a direct model queryset

    def get_queryset(self):
        return None  # Override to skip queryset logic from mixin

    @action(detail=False, methods=["get"], url_path="dashboard")
    def dashboard(self, request):
        """KPI cards for the home dashboard."""
        tenant = request.tenant
        today = timezone.now().date()
        from_day = timezone.now().replace(hour=0, minute=0, second=0)

        # Today's revenue
        from apps.sales.models import Sale
        today_sales = Sale.objects.filter(
            tenant=tenant, created_at__date=today, status="completed"
        ).aggregate(total=Sum("total_amount"))["total"] or Decimal("0")

        # Total outstanding debt
        from apps.clients.models import Client
        total_debt = Client.objects.filter(
            tenant=tenant, cached_balance__gt=0
        ).aggregate(total=Sum("cached_balance"))["total"] or Decimal("0")

        # Low stock SKU count
        from apps.inventory.models import Variant
        from django.db.models import F
        low_stock_count = Variant.objects.filter(
            tenant=tenant, is_active=True,
            alert_threshold__gt=0,
            stock_qty__lte=F("alert_threshold"),
        ).count()

        # Cheques due this week
        from apps.clients.models import Cheque
        week_end = today + timezone.timedelta(days=7)
        cheques_due = Cheque.objects.filter(
            tenant=tenant, status="pending",
            due_date__gte=today, due_date__lte=week_end,
        ).count()

        return Response({
            "today_revenue": today_sales,
            "total_outstanding_debt": total_debt,
            "low_stock_sku_count": low_stock_count,
            "cheques_due_this_week": cheques_due,
            "as_of": str(today),
        })

    @action(detail=False, methods=["get"], url_path="sales-by-period")
    def sales_by_period(self, request):
        """Revenue, units sold, and margin by period."""
        from apps.sales.models import Sale, SaleItem
        from django.db.models.functions import TruncDay, TruncMonth, TruncWeek
        import datetime

        period = request.query_params.get("period", "day")  # day, week, month
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")

        qs = Sale.objects.filter(tenant=request.tenant, status="completed")
        if from_date:
            qs = qs.filter(created_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(created_at__date__lte=to_date)

        trunc_map = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth}
        trunc_fn = trunc_map.get(period, TruncDay)

        data = (
            qs.annotate(period=trunc_fn("created_at"))
            .values("period")
            .annotate(revenue=Sum("total_amount"), sale_count=Count("id"))
            .order_by("period")
        )

        return Response(list(data))

    @action(detail=False, methods=["get"], url_path="best-sellers")
    def best_sellers(self, request):
        from apps.sales.models import SaleItem
        from django.db.models import F

        qs = SaleItem.objects.filter(sale__tenant=request.tenant, sale__status="completed")
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        if from_date:
            qs = qs.filter(sale__created_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(sale__created_at__date__lte=to_date)

        data = (
            qs.values(
                product_id=F("variant__product__id"),
                product_name=F("variant__product__name"),
                brand=F("variant__product__brand"),
            )
            .annotate(units_sold=Sum("quantity"), revenue=Sum("unit_price"))
            .order_by("-units_sold")[:20]
        )

        return Response(list(data))

    @action(detail=False, methods=["get"], url_path="stock-valuation")
    def stock_valuation(self, request):
        from apps.inventory.models import Variant
        from django.db.models import F, ExpressionWrapper, DecimalField

        qs = Variant.objects.filter(
            tenant=request.tenant, is_active=True, stock_qty__gt=0
        ).annotate(
            cost_value=ExpressionWrapper(
                F("stock_qty") * F("product__purchase_price"),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            ),
            sale_value=ExpressionWrapper(
                F("stock_qty") * F("product__sale_price"),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            ),
        )

        totals = qs.aggregate(
            total_cost=Sum("cost_value"),
            total_sale=Sum("sale_value"),
            total_units=Sum("stock_qty"),
        )

        if not request.user.can_see_costs:
            totals.pop("total_cost", None)

        return Response(totals)

    @action(detail=False, methods=["get"], url_path="daily")
    def daily(self, request):
        """
        Daily sales report — matches DailyReportPage.tsx expectations.
        Query param: ?date=YYYY-MM-DD  (defaults to today)
        """
        import datetime
        from apps.sales.models import Sale, SaleItem, Payment

        date_str = request.query_params.get("date")
        if date_str:
            try:
                target_date = datetime.date.fromisoformat(date_str)
            except ValueError:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"date": "Format attendu: YYYY-MM-DD"})
        else:
            target_date = timezone.now().date()

        tenant = request.tenant
        sales_qs = Sale.objects.filter(
            tenant=tenant, created_at__date=target_date, status="completed"
        )
        totals = sales_qs.aggregate(
            total_revenue=Sum("total_amount"), items_sold=Sum("items__quantity")
        )
        sale_count = sales_qs.count()

        # Payment breakdown by method
        from apps.sales.models import Payment
        payments_qs = Payment.objects.filter(sale__in=sales_qs)
        by_method = {
            item["method"]: item["total"]
            for item in payments_qs.values("method").annotate(total=Sum("amount"))
        }
        payment_breakdown = [
            {"method": method, "amount": by_method.get(method, Decimal("0")), "count": 0}
            for method in ["cash", "ccp", "virement", "cheque"]
        ]

        # Top 5 products
        from django.db.models import F
        top_products = list(
            SaleItem.objects.filter(sale__in=sales_qs)
            .values(
                name=F("variant__product__name"),
                brand=F("variant__product__brand"),
            )
            .annotate(units=Sum("quantity"), revenue=Sum("unit_price"))
            .order_by("-units")[:5]
        )

        return Response({
            "date": str(target_date),
            "total_revenue": totals["total_revenue"] or Decimal("0"),
            "sale_count": sale_count,
            "cash_total": by_method.get("cash", Decimal("0")),
            "ccp_total": by_method.get("ccp", Decimal("0")),
            "virement_total": by_method.get("virement", Decimal("0")),
            "cheque_total": by_method.get("cheque", Decimal("0")),
            "items_sold": totals["items_sold"] or 0,
            "top_products": top_products,
            "payment_breakdown": payment_breakdown,
        })

    @action(detail=False, methods=["get"], url_path="profit-loss")
    def profit_loss(self, request):
        """
        Gross margin report by period.
        Returns: { rows: [{period, revenue, cogs, gross_margin, gross_margin_pct, sale_count}], totals: {...} }
        Query params: period (day/week/month), from, to
        RBAC: cashiers get rows but without cogs/margin (can_see_costs check)
        """
        from apps.core.plan_permissions import PlanRequired
        from rest_framework.exceptions import PermissionDenied as DRFPermissionDenied
        from apps.sales.models import Sale, SaleItem
        from django.db.models import Sum, Count, F, ExpressionWrapper, DecimalField
        from django.db.models.functions import TruncDay, TruncMonth, TruncWeek, Coalesce

        # PlanRequired() returns a class; instantiate it to get a permission instance
        perm_class = PlanRequired("pro_retail")
        perm = perm_class()
        if not perm.has_permission(request, self):
            raise DRFPermissionDenied(perm.message)

        period = request.query_params.get("period", "month")
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")

        can_see_costs = getattr(request.user, "can_see_costs", False)

        sale_qs = Sale.objects.filter(tenant=request.tenant, status="completed")
        if from_date:
            sale_qs = sale_qs.filter(created_at__date__gte=from_date)
        if to_date:
            sale_qs = sale_qs.filter(created_at__date__lte=to_date)

        trunc_map = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth}
        trunc_fn = trunc_map.get(period, TruncMonth)

        # Revenue by period
        revenue_rows = (
            sale_qs.annotate(p=trunc_fn("created_at"))
            .values("p")
            .annotate(revenue=Sum("total_amount"), sale_count=Count("id"))
            .order_by("p")
        )

        # COGS by period (via SaleItems -> Variant -> Product.purchase_price)
        cogs_by_period = {}
        if can_see_costs:
            cogs_rows = (
                SaleItem.objects.filter(sale__in=sale_qs)
                .annotate(p=trunc_fn("sale__created_at"))
                .annotate(
                    line_cost=ExpressionWrapper(
                        F("quantity") * Coalesce(F("variant__product__purchase_price"), Decimal("0")),
                        output_field=DecimalField(max_digits=14, decimal_places=2),
                    )
                )
                .values("p")
                .annotate(cogs=Sum("line_cost"))
            )
            cogs_by_period = {str(row["p"]): row["cogs"] for row in cogs_rows}

        rows = []
        total_revenue = Decimal("0")
        total_cogs = Decimal("0")
        total_sales = 0

        for row in revenue_rows:
            rev = row["revenue"] or Decimal("0")
            period_key = str(row["p"])
            cogs = cogs_by_period.get(period_key, Decimal("0")) if can_see_costs else None
            margin = (rev - cogs) if cogs is not None else None
            margin_pct = (margin / rev * 100).quantize(Decimal("0.1")) if (margin is not None and rev > 0) else None

            total_revenue += rev
            if cogs is not None:
                total_cogs += cogs
            total_sales += row["sale_count"]

            entry = {
                "period": period_key,
                "revenue": rev,
                "sale_count": row["sale_count"],
            }
            if can_see_costs:
                entry["cogs"] = cogs
                entry["gross_margin"] = margin
                entry["gross_margin_pct"] = margin_pct
            rows.append(entry)

        totals = {
            "revenue": total_revenue,
            "sale_count": total_sales,
        }
        if can_see_costs:
            totals["cogs"] = total_cogs
            totals["gross_margin"] = total_revenue - total_cogs
            totals["gross_margin_pct"] = (
                ((total_revenue - total_cogs) / total_revenue * 100).quantize(Decimal("0.1"))
                if total_revenue > 0 else Decimal("0")
            )

        return Response({"rows": rows, "totals": totals})

    @action(detail=False, methods=["get"], url_path="stock")
    def stock(self, request):
        """
        Full stock report — matches StockReportPage.tsx expectations.
        """
        from apps.inventory.models import Variant, Product
        from django.db.models import F, ExpressionWrapper, DecimalField as DjDecimalField
        from django.db.models.functions import Coalesce

        tenant = request.tenant
        variants = Variant.objects.filter(tenant=tenant, is_active=True)

        total_sku = variants.count()
        total_units = variants.aggregate(t=Sum("stock_qty"))["t"] or 0
        low_stock_count = variants.filter(
            alert_threshold__gt=0, stock_qty__lte=F("alert_threshold"), stock_qty__gt=0
        ).count()
        out_of_stock_count = variants.filter(stock_qty=0).count()

        # Stock value (purchase_price * qty) — only for users who can see costs
        total_stock_value = Decimal("0")
        if request.user.can_see_costs:
            val = variants.annotate(
                line_value=ExpressionWrapper(
                    F("stock_qty") * Coalesce(F("product__purchase_price"), Decimal("0")),
                    output_field=DjDecimalField(max_digits=14, decimal_places=2),
                )
            ).aggregate(t=Sum("line_value"))["t"]
            total_stock_value = val or Decimal("0")

        # By category
        by_category = list(
            Product.objects.filter(tenant=tenant, is_active=True)
            .values("category")
            .annotate(count=Count("id"), units=Sum("variants__stock_qty"))
            .order_by("-units")
        )

        # By brand
        by_brand = list(
            Product.objects.filter(tenant=tenant, is_active=True)
            .values("brand")
            .annotate(count=Count("id"), units=Sum("variants__stock_qty"))
            .order_by("-units")[:15]
        )

        return Response({
            "total_sku_count": total_sku,
            "total_units": total_units,
            "total_stock_value": total_stock_value,
            "low_stock_count": low_stock_count,
            "out_of_stock_count": out_of_stock_count,
            "by_category": by_category,
            "by_brand": by_brand,
        })
