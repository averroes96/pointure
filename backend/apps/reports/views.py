"""Reports API views."""
from decimal import Decimal
from django.db.models import Sum, Count, Avg
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.plan_permissions import PlanRequired


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
        today = timezone.localdate()
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

        # Low stock Product count
        from apps.inventory.models import Product
        from django.db.models import F
        from django.db.models.functions import Coalesce
        low_stock_count = Product.objects.filter(
            tenant=tenant, is_active=True, alert_threshold__gt=0
        ).annotate(
            computed_total_stock=Coalesce(Sum('variants__stock_qty'), 0)
        ).filter(
            computed_total_stock__lte=F("alert_threshold")
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
        """
        Revenue, units sold, avg basket, and top products for a period.

        Query params:
          period   — "7" | "30" | "90" (days) or "day" | "week" | "month"
          from, to — ISO date strings (used when period is not a preset)
          branch   — branch ID (optional, filters by branch)

        Response:
          { rows, top_products, total_revenue, total_sales, growth_pct }
        """
        from apps.sales.models import Sale, SaleItem
        from django.db.models.functions import TruncDay, TruncMonth, TruncWeek
        from django.db.models import F
        import datetime

        tenant = request.tenant
        period_param = request.query_params.get("period", "30")
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        branch_id = request.query_params.get("branch")
        today = timezone.now().date()

        # Numeric presets: last N days, grouped by day
        if period_param in ("7", "30", "90"):
            days = int(period_param)
            from_date = str(today - datetime.timedelta(days=days - 1))
            to_date = str(today)
            trunc_fn = TruncDay
        else:
            trunc_map = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth}
            trunc_fn = trunc_map.get(period_param, TruncDay)

        qs = Sale.objects.filter(tenant=tenant, status="completed")
        if from_date:
            qs = qs.filter(created_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(created_at__date__lte=to_date)
        if branch_id:
            qs = qs.filter(branch_id=branch_id)

        # Period rows
        period_rows = (
            qs.annotate(p=trunc_fn("created_at"))
            .values("p")
            .annotate(revenue=Sum("total_amount"), sale_count=Count("id"))
            .order_by("p")
        )

        rows = []
        total_revenue = Decimal("0")
        total_sales = 0
        for row in period_rows:
            rev = row["revenue"] or Decimal("0")
            cnt = row["sale_count"] or 0
            avg_basket = (rev / cnt).quantize(Decimal("0.01")) if cnt > 0 else Decimal("0")
            total_revenue += rev
            total_sales += cnt
            # Normalise period to a date string regardless of truncation type
            p_val = row["p"]
            p_str = p_val.date().isoformat() if hasattr(p_val, "date") else str(p_val)
            rows.append({
                "period": p_str,
                "revenue": rev,
                "sale_count": cnt,
                "avg_basket": avg_basket,
            })

        # Top products for the same window
        top_products = list(
            SaleItem.objects.filter(sale__in=qs)
            .values(
                product_id=F("variant__product__id"),
                product_name=F("variant__product__name"),
                brand=F("variant__product__brand"),
            )
            .annotate(units_sold=Sum("quantity"), revenue=Sum("unit_price"))
            .order_by("-units_sold")[:10]
        )

        # Growth vs the same-length preceding period
        growth_pct = None
        if from_date and to_date:
            try:
                from_dt = datetime.date.fromisoformat(from_date)
                to_dt = datetime.date.fromisoformat(to_date)
                delta = (to_dt - from_dt).days + 1
                prev_from = str(from_dt - datetime.timedelta(days=delta))
                prev_to = str(from_dt - datetime.timedelta(days=1))
                prev_qs = Sale.objects.filter(
                    tenant=tenant, status="completed",
                    created_at__date__gte=prev_from,
                    created_at__date__lte=prev_to,
                )
                if branch_id:
                    prev_qs = prev_qs.filter(branch_id=branch_id)
                prev_total = prev_qs.aggregate(t=Sum("total_amount"))["t"] or Decimal("0")
                if prev_total > 0:
                    growth_pct = float(
                        ((total_revenue - prev_total) / prev_total * 100)
                        .quantize(Decimal("0.1"))
                    )
            except (ValueError, Exception):
                pass

        return Response({
            "rows": rows,
            "top_products": top_products,
            "total_revenue": total_revenue,
            "total_sales": total_sales,
            "growth_pct": growth_pct,
        })

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
            total_revenue=Sum("total_amount"), 
            items_sold=Sum("items__quantity"),
            total_discounts=Sum("discount_amount"),
            total_stamps=Sum("timbre_fiscal")
        )
        sale_count = sales_qs.count()

        from apps.sales.models import Return
        returns_qs = Return.objects.filter(tenant=tenant, created_at__date=target_date)
        total_refunds = returns_qs.aggregate(t=Sum("refund_amount"))["t"] or Decimal("0")

        total_revenue = totals["total_revenue"] or Decimal("0")
        net_revenue = total_revenue - total_refunds

        # Payment breakdown by method
        from apps.sales.models import Payment
        from django.db.models import Count
        payments_qs = Payment.objects.filter(sale__in=sales_qs)
        by_method = {
            item["method"]: {"total": item["total"], "count": item["count"]}
            for item in payments_qs.values("method").annotate(total=Sum("amount"), count=Count("id"))
        }
        payment_breakdown = [
            {
                "method": method, 
                "amount": by_method.get(method, {}).get("total", Decimal("0")), 
                "count": by_method.get(method, {}).get("count", 0)
            }
            for method in ["cash", "ccp", "virement", "cheque", "account"]
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
            "total_revenue": total_revenue,
            "total_refunds": total_refunds,
            "net_revenue": net_revenue,
            "total_discounts": totals["total_discounts"] or Decimal("0"),
            "total_stamps": totals["total_stamps"] or Decimal("0"),
            "sale_count": sale_count,
            "cash_total": by_method.get("cash", {}).get("total", Decimal("0")),
            "ccp_total": by_method.get("ccp", {}).get("total", Decimal("0")),
            "virement_total": by_method.get("virement", {}).get("total", Decimal("0")),
            "cheque_total": by_method.get("cheque", {}).get("total", Decimal("0")),
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

        import datetime as _dt
        branch_id = request.query_params.get("branch")
        today_date = timezone.now().date()

        # Numeric presets → same logic as sales_by_period
        if period in ("7", "30", "90"):
            days = int(period)
            from_date = str(today_date - _dt.timedelta(days=days - 1))
            to_date = str(today_date)
            period = "day"  # group by day for numeric presets

        sale_qs = Sale.objects.filter(tenant=request.tenant, status="completed")
        if from_date:
            sale_qs = sale_qs.filter(created_at__date__gte=from_date)
        if to_date:
            sale_qs = sale_qs.filter(created_at__date__lte=to_date)
        if branch_id:
            sale_qs = sale_qs.filter(branch_id=branch_id)

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
        low_stock_count = Product.objects.filter(
            tenant=tenant, is_active=True, alert_threshold__gt=0
        ).annotate(
            computed_total_stock=Coalesce(Sum("variants__stock_qty"), 0)
        ).filter(
            computed_total_stock__lte=F("alert_threshold"), computed_total_stock__gt=0
        ).count()
        out_of_stock_count = Product.objects.filter(
            tenant=tenant, is_active=True
        ).annotate(
            computed_total_stock=Coalesce(Sum("variants__stock_qty"), 0)
        ).filter(
            computed_total_stock=0
        ).count()

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
            
        # Retail value (sale_price * qty) — available to report viewers
        val_retail = variants.annotate(
            line_retail=ExpressionWrapper(
                F("stock_qty") * Coalesce(F("product__sale_price"), Decimal("0")),
                output_field=DjDecimalField(max_digits=14, decimal_places=2),
            )
        ).aggregate(t=Sum("line_retail"))["t"]
        total_retail_value = val_retail or Decimal("0")

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
            "total_retail_value": total_retail_value,
            "low_stock_count": low_stock_count,
            "out_of_stock_count": out_of_stock_count,
            "by_category": by_category,
            "by_brand": by_brand,
        })

    @action(detail=False, methods=["get"], url_path="stock/pdf")
    def stock_pdf(self, request):
        """
        Generate a printable PDF for the stock report.
        Authenticated via standard JWT Bearer header — the frontend should
        fetch this with axios (responseType: 'blob') then open a blob URL,
        not via window.open with a ?token= param.
        """
        from apps.inventory.models import Variant, Product
        from django.db.models import F, ExpressionWrapper, DecimalField as DjDecimalField
        from django.db.models.functions import Coalesce
        from django.http import HttpResponse
        from django.utils import timezone as tz

        tenant = request.tenant
        variants = Variant.objects.filter(tenant=tenant, is_active=True)
        total_sku = variants.count()
        total_units = variants.aggregate(t=Sum("stock_qty"))["t"] or 0
        low_stock_count = Product.objects.filter(
            tenant=tenant, is_active=True, alert_threshold__gt=0
        ).annotate(
            computed_total_stock=Coalesce(Sum("variants__stock_qty"), 0)
        ).filter(
            computed_total_stock__lte=F("alert_threshold"), computed_total_stock__gt=0
        ).count()
        out_of_stock_count = Product.objects.filter(
            tenant=tenant, is_active=True
        ).annotate(
            computed_total_stock=Coalesce(Sum("variants__stock_qty"), 0)
        ).filter(
            computed_total_stock=0
        ).count()

        total_stock_value = Decimal("0")
        if request.user.can_see_costs:
            val = variants.annotate(
                lv=ExpressionWrapper(
                    F("stock_qty") * Coalesce(F("product__purchase_price"), Decimal("0")),
                    output_field=DjDecimalField(max_digits=14, decimal_places=2),
                )
            ).aggregate(t=Sum("lv"))["t"]
            total_stock_value = val or Decimal("0")
            
        val_retail = variants.annotate(
            lr=ExpressionWrapper(
                F("stock_qty") * Coalesce(F("product__sale_price"), Decimal("0")),
                output_field=DjDecimalField(max_digits=14, decimal_places=2),
            )
        ).aggregate(t=Sum("lr"))["t"]
        total_retail_value = val_retail or Decimal("0")

        by_category = list(
            Product.objects.filter(tenant=tenant, is_active=True)
            .values("category")
            .annotate(count=Count("id"), units=Sum("variants__stock_qty"))
            .order_by("-units")
        )

        by_brand = list(
            Product.objects.filter(tenant=tenant, is_active=True)
            .values("brand")
            .annotate(count=Count("id"), units=Sum("variants__stock_qty"))
            .order_by("-units")[:20]
        )

        generated_at = tz.now().strftime("%d/%m/%Y à %H:%M")

        def cat_rows():
            rows = ""
            for r in by_category:
                rows += (
                    f"<tr><td>{r['category'] or '—'}</td>"
                    f"<td class='n'>{r['count']}</td>"
                    f"<td class='n'><b>{r['units'] or 0}</b></td></tr>"
                )
            return rows or "<tr><td colspan='3' class='empty'>Aucune donnée</td></tr>"

        def brand_rows():
            rows = ""
            for r in by_brand:
                rows += (
                    f"<tr><td>{r['brand'] or '—'}</td>"
                    f"<td class='n'>{r['count']}</td>"
                    f"<td class='n'><b>{r['units'] or 0}</b></td></tr>"
                )
            return rows or "<tr><td colspan='3' class='empty'>Aucune donnée</td></tr>"

        html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport de stock — {tenant.name}</title>
<style>
  @page {{ margin: 18mm 15mm; size: A4; }}
  body {{ font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; margin: 0; }}
  h1 {{ font-size: 16pt; margin: 0 0 2mm; }}
  .sub {{ color: #666; font-size: 9pt; margin-bottom: 6mm; }}
  .kpis {{ display: table; width: 100%; border-collapse: collapse; margin-bottom: 6mm; }}
  .kpi {{ display: table-cell; width: 20%; border: 1px solid #e2e8f0;
          padding: 3mm; text-align: center; }}
  .kpi .val {{ font-size: 18pt; font-weight: bold; color: #1e40af; }}
  .kpi .lbl {{ font-size: 8pt; color: #666; margin-top: 1mm; }}
  .kpi.warn .val {{ color: #d97706; }}
  .kpi.danger .val {{ color: #dc2626; }}
  h2 {{ font-size: 11pt; margin: 5mm 0 2mm; border-bottom: 1px solid #e2e8f0; padding-bottom: 1mm; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 9.5pt; }}
  th {{ background: #f8fafc; text-align: left; padding: 1.5mm 2mm;
        border-bottom: 2px solid #e2e8f0; font-weight: 600; }}
  td {{ padding: 1.5mm 2mm; border-bottom: 1px solid #f1f5f9; }}
  td.n {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .empty {{ color: #999; text-align: center; padding: 4mm; }}
  .two-col {{ display: table; width: 100%; border-collapse: collapse; margin-top: 3mm; }}
  .col {{ display: table-cell; width: 49%; vertical-align: top; }}
  .col + .col {{ padding-left: 4mm; }}
  .footer {{ margin-top: 8mm; font-size: 8pt; color: #999; text-align: center; }}
</style>
</head>
<body>
<h1>Rapport de stock</h1>
<p class="sub">{tenant.name} &mdash; Généré le {generated_at}</p>

<div class="kpis">
  <div class="kpi"><div class="val">{total_sku}</div><div class="lbl">Références (SKU)</div></div>
  <div class="kpi"><div class="val">{total_units}</div><div class="lbl">Unités en stock</div></div>
  <div class="kpi"><div class="val">{total_stock_value:,.0f}</div><div class="lbl">Valeur Achat (DZD)</div></div>
  <div class="kpi"><div class="val">{total_retail_value:,.0f}</div><div class="lbl">Valeur Revente (DZD)</div></div>
  <div class="kpi warn"><div class="val">{low_stock_count}</div><div class="lbl">Stock bas</div></div>
  <div class="kpi danger"><div class="val">{out_of_stock_count}</div><div class="lbl">Ruptures</div></div>
</div>

<div class="two-col">
  <div class="col">
    <h2>Par catégorie</h2>
    <table>
      <thead><tr><th>Catégorie</th><th>Réf.</th><th>Unités</th></tr></thead>
      <tbody>{cat_rows()}</tbody>
    </table>
  </div>
  <div class="col">
    <h2>Par marque (top 20)</h2>
    <table>
      <thead><tr><th>Marque</th><th>Réf.</th><th>Unités</th></tr></thead>
      <tbody>{brand_rows()}</tbody>
    </table>
  </div>
</div>

<p class="footer">ShoeDZ — Rapport confidentiel — {generated_at}</p>
</body>
</html>"""

        try:
            from weasyprint import HTML as WeasyHTML
            pdf_bytes = WeasyHTML(string=html, base_url=".").write_pdf()
        except Exception as exc:
            return HttpResponse(
                f"PDF generation failed: {exc}",
                content_type="text/plain",
                status=500,
            )

        today_str = tz.now().strftime("%Y-%m-%d")
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="rapport-stock-{today_str}.pdf"'
        )
        return response

    # ── Report Builder (enterprise only) ─────────────────────────────────────

    @action(
        detail=False, methods=["get"], url_path="builder/fields",
        permission_classes=[IsAuthenticated, PlanRequired("enterprise")],
    )
    def builder_fields(self, request):
        """Return available fields per source for the report builder UI."""
        from .field_registry import FIELD_REGISTRY, OPERATOR_LABELS
        result = {}
        for source, registry in FIELD_REGISTRY.items():
            result[source] = [
                {
                    "id": fid,
                    "label": fd["label"],
                    "type": fd["type"],
                    "operators": [
                        {"value": op, "label": OPERATOR_LABELS.get(op, op)}
                        for op in fd.get("operators", [])
                    ],
                    "choices": fd.get("choices", []),
                    "sortable": fd.get("sortable", False),
                }
                for fid, fd in registry.items()
            ]
        return Response(result)

    @action(
        detail=False, methods=["post"], url_path="builder/preview",
        permission_classes=[IsAuthenticated, PlanRequired("enterprise")],
    )
    def builder_preview(self, request):
        """Run a report config and return up to 200 rows."""
        from .query_engine import run_report
        config = dict(request.data)
        config["source"] = config.get("source", "")
        try:
            rows, column_labels = run_report(request.tenant, config)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"rows": rows, "column_labels": column_labels, "count": len(rows)})

    @action(
        detail=False, methods=["get"], url_path="builder/export",
        permission_classes=[IsAuthenticated, PlanRequired("enterprise")],
    )
    def builder_export(self, request):
        """Export a report as CSV (full dataset, no row limit)."""
        import csv
        import io
        from django.http import HttpResponse
        from .query_engine import run_report, MAX_PREVIEW_ROWS

        config_param = request.GET.get("config", "{}")
        try:
            import json
            config = json.loads(config_param)
        except Exception:
            return Response({"detail": "Config JSON invalide."}, status=400)

        try:
            rows, column_labels = run_report(request.tenant, config, row_limit=10_000)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        buf = io.StringIO()
        if rows:
            writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
            # Write header using human-readable labels
            writer.writerow({k: column_labels.get(k, k) for k in rows[0].keys()})
            for row in rows:
                writer.writerow({k: ("" if v is None else str(v)) for k, v in row.items()})

        response = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="rapport.csv"'
        return response

    @action(
        detail=False, methods=["get", "post"], url_path="templates",
        permission_classes=[IsAuthenticated, PlanRequired("enterprise")],
    )
    def templates_list(self, request):
        """List or create saved report templates (max 15 per tenant)."""
        from .serializers import ReportTemplateSerializer
        from .models import ReportTemplate
        from .query_engine import MAX_TEMPLATES

        if request.method == "GET":
            qs = ReportTemplate.objects.filter(tenant=request.tenant).select_related("created_by")
            return Response(ReportTemplateSerializer(qs, many=True).data)

        # POST — create
        count = ReportTemplate.objects.filter(tenant=request.tenant).count()
        if count >= MAX_TEMPLATES:
            return Response(
                {"detail": f"Maximum {MAX_TEMPLATES} modèles par tenant. Supprimez-en un avant d'en créer un nouveau."},
                status=400,
            )
        ser = ReportTemplateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save(tenant=request.tenant, created_by=request.user)
        return Response(ser.data, status=201)

    @action(
        detail=False, methods=["get", "patch", "delete"],
        url_path=r"templates/(?P<tpl_id>\d+)",
        permission_classes=[IsAuthenticated, PlanRequired("enterprise")],
    )
    def template_detail(self, request, tpl_id=None):
        """Retrieve, update, or delete a single saved template."""
        from .serializers import ReportTemplateSerializer
        from .models import ReportTemplate

        try:
            tpl = ReportTemplate.objects.get(pk=tpl_id, tenant=request.tenant)
        except ReportTemplate.DoesNotExist:
            return Response({"detail": "Introuvable."}, status=404)

        if request.method == "GET":
            return Response(ReportTemplateSerializer(tpl).data)
        if request.method == "DELETE":
            tpl.delete()
            return Response(status=204)
        # PATCH
        ser = ReportTemplateSerializer(tpl, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
