"""
Service for computing point-in-time snapshots and year-end summaries
for fiscal year management closing.
"""
import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Case, DecimalField, ExpressionWrapper, F, Q, Sum, When
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.clients.models import Cheque, ChequeStatusChoices, Client, ClientLedger
from apps.closing.models import BalanceKindChoices, BalanceSnapshotLine, FiscalYear, FiscalYearStatusChoices, StockSnapshotLine
from apps.inventory.models import MovementReasonChoices, StockMovement, Variant
from apps.inventory.services.costing import current_unit_cost
from apps.invoicing.models import CreditNote, Invoice, InvoiceLine, InvoiceStatusChoices
from apps.sales.models import Sale, SaleItem
from apps.suppliers.models import Supplier, SupplierInvoice, SupplierPayment


def build_snapshot(fiscal_year: FiscalYear) -> FiscalYear:
    """
    Compute point-in-time snapshot and year-end totals as of fiscal_year.end_date
    at 23:59:59 (Africa/Algiers).
    Snapshots are recomputable while status=open and frozen once closed.
    """
    if fiscal_year.status == FiscalYearStatusChoices.CLOSED:
        raise ValidationError(_("Impossible de recalculer l'instantané d'un exercice fiscal clôturé."))

    tenant = fiscal_year.tenant
    algiers_tz = ZoneInfo("Africa/Algiers")
    start_dt = datetime.datetime.combine(fiscal_year.start_date, datetime.time(0, 0, 0), tzinfo=algiers_tz)
    end_dt = datetime.datetime.combine(fiscal_year.end_date, datetime.time(23, 59, 59, 999999), tzinfo=algiers_tz)

    # ── 1. Stock Snapshot Lines ──────────────────────────────────────────────
    # Base condition: timestamp <= end_dt
    base_movements = StockMovement.objects.filter(tenant=tenant)
    time_q = Q(timestamp__lte=end_dt)
    if fiscal_year.stocktake_session_id:
        # Include the linked year-end stocktake session's movements even if dated after end_dt
        time_q |= Q(
            reason=MovementReasonChoices.STOCKTAKE,
            reference_id=str(fiscal_year.stocktake_session_id),
        )

    stock_aggs = (
        base_movements.filter(time_q)
        .values("variant_id", "branch_id")
        .annotate(total_qty=Sum("quantity_delta"))
        .exclude(total_qty=0)
    )

    variant_ids = [item["variant_id"] for item in stock_aggs]
    variants_map = {
        v.id: v
        for v in Variant.objects.filter(id__in=variant_ids).select_related("product")
    }

    stock_lines = []
    total_stock_units = 0
    total_cost_value = Decimal("0.00")
    total_retail_value = Decimal("0.00")

    for item in stock_aggs:
        variant = variants_map.get(item["variant_id"])
        if not variant:
            continue
        qty = item["total_qty"]
        cost = current_unit_cost(variant)
        sale_price = variant.product.sale_price if variant.product else Decimal("0.00")
        cost_val = (Decimal(qty) * cost).quantize(Decimal("0.01"))
        retail_val = (Decimal(qty) * sale_price).quantize(Decimal("0.01"))

        total_stock_units += qty
        total_cost_value += cost_val
        total_retail_value += retail_val

        stock_lines.append(
            StockSnapshotLine(
                fiscal_year=fiscal_year,
                variant=variant,
                branch_id=item["branch_id"],
                quantity=qty,
                unit_cost=cost,
                cost_value=cost_val,
                unit_price=sale_price,
                retail_value=retail_val,
            )
        )

    # ── 2. Client Balance Snapshot Lines ─────────────────────────────────────
    client_ledgers = (
        ClientLedger.objects.filter(
            client__tenant=tenant,
            date__lte=fiscal_year.end_date,
        )
        .values("client_id", "client__name")
        .annotate(
            debits=Coalesce(Sum("amount", filter=Q(entry_type="debit")), Decimal("0.00")),
            credits=Coalesce(Sum("amount", filter=Q(entry_type="credit")), Decimal("0.00")),
        )
    )

    balance_lines = []
    total_client_debt = Decimal("0.00")
    total_client_credit = Decimal("0.00")

    for row in client_ledgers:
        bal = (row["debits"] - row["credits"]).quantize(Decimal("0.01"))
        if bal != Decimal("0.00"):
            if bal > Decimal("0.00"):
                total_client_debt += bal
            else:
                total_client_credit += abs(bal)
            balance_lines.append(
                BalanceSnapshotLine(
                    fiscal_year=fiscal_year,
                    kind=BalanceKindChoices.CLIENT,
                    party_id=row["client_id"],
                    party_name=row["client__name"],
                    balance=bal,
                )
            )

    # ── 3. Supplier Balance Snapshot Lines ───────────────────────────────────
    suppliers = Supplier.objects.filter(tenant=tenant)
    invoiced_by_supplier = {
        row["supplier_id"]: row["total"]
        for row in SupplierInvoice.objects.filter(
            tenant=tenant,
            date__lte=fiscal_year.end_date,
        )
        .values("supplier_id")
        .annotate(total=Coalesce(Sum("total_amount"), Decimal("0.00")))
    }
    paid_by_supplier = {
        row["supplier_id"]: row["total"]
        for row in SupplierPayment.objects.filter(
            tenant=tenant,
            date__lte=fiscal_year.end_date,
        )
        .values("supplier_id")
        .annotate(total=Coalesce(Sum("amount"), Decimal("0.00")))
    }

    total_supplier_debt = Decimal("0.00")
    for sup in suppliers:
        inv = invoiced_by_supplier.get(sup.id, Decimal("0.00"))
        pd = paid_by_supplier.get(sup.id, Decimal("0.00"))
        sup_bal = (inv - pd).quantize(Decimal("0.01"))
        if sup_bal != Decimal("0.00"):
            total_supplier_debt += sup_bal
            balance_lines.append(
                BalanceSnapshotLine(
                    fiscal_year=fiscal_year,
                    kind=BalanceKindChoices.SUPPLIER,
                    party_id=sup.id,
                    party_name=sup.name,
                    balance=sup_bal,
                )
            )

    # ── 4. Pending Cheques ───────────────────────────────────────────────────
    pending_cheques_qs = Cheque.objects.filter(
        tenant=tenant,
        status=ChequeStatusChoices.PENDING,
    ).select_related("client", "supplier")

    cheques_items = []
    total_cheques_receivable = Decimal("0.00")
    total_cheques_payable = Decimal("0.00")

    for chq in pending_cheques_qs:
        party_name = chq.client.name if chq.client else (chq.supplier.name if chq.supplier else "")
        if chq.direction == "receivable":
            total_cheques_receivable += chq.amount
        else:
            total_cheques_payable += chq.amount
        cheques_items.append({
            "id": str(chq.id),
            "number": chq.number,
            "amount": str(chq.amount),
            "direction": chq.direction,
            "due_date": str(chq.due_date) if chq.due_date else None,
            "bank": chq.bank,
            "party_name": party_name,
        })

    # ── 5. Revenue, Stamp Duty, TVA, and COGS Totals ─────────────────────────
    fallback_cost_expr = Case(
        When(variant__product__pamp__gt=0, then=F("variant__product__pamp")),
        default=Coalesce(F("variant__product__purchase_price"), Decimal("0.00")),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )
    item_cost_expr = Coalesce(F("unit_cost"), fallback_cost_expr)

    # Sales
    sales_qs = Sale.objects.filter(
        tenant=tenant,
        status="completed",
        created_at__gte=start_dt,
        created_at__lte=end_dt,
    )
    sales_aggs = sales_qs.aggregate(
        total_amount=Coalesce(Sum("total_amount"), Decimal("0.00")),
        timbre_fiscal=Coalesce(Sum("timbre_fiscal"), Decimal("0.00")),
    )
    sales_revenue = (sales_aggs["total_amount"] - sales_aggs["timbre_fiscal"]).quantize(Decimal("0.01"))
    sales_stamp = sales_aggs["timbre_fiscal"].quantize(Decimal("0.01"))

    sales_cogs = (
        SaleItem.objects.filter(sale__in=sales_qs)
        .annotate(
            line_cogs=ExpressionWrapper(
                F("quantity") * item_cost_expr,
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )
        .aggregate(t=Coalesce(Sum("line_cogs"), Decimal("0.00")))["t"]
    ).quantize(Decimal("0.01"))

    # Invoices (wholesale)
    invoices_qs = Invoice.objects.filter(
        tenant=tenant,
        status__in=[
            InvoiceStatusChoices.SENT,
            InvoiceStatusChoices.PAID,
            InvoiceStatusChoices.PARTIAL,
            InvoiceStatusChoices.OVERDUE,
        ],
        date__gte=fiscal_year.start_date,
        date__lte=fiscal_year.end_date,
    )
    inv_aggs = invoices_qs.aggregate(
        total_ht=Coalesce(Sum("total_ht"), Decimal("0.00")),
        tva_amount=Coalesce(Sum("tva_amount"), Decimal("0.00")),
        timbre_fiscal=Coalesce(Sum("timbre_fiscal"), Decimal("0.00")),
        total_ttc=Coalesce(Sum("total_ttc"), Decimal("0.00")),
    )
    invoices_total_ht = inv_aggs["total_ht"].quantize(Decimal("0.01"))
    invoices_tva_amount = inv_aggs["tva_amount"].quantize(Decimal("0.01"))
    invoices_stamp = inv_aggs["timbre_fiscal"].quantize(Decimal("0.01"))
    invoices_total_ttc = inv_aggs["total_ttc"].quantize(Decimal("0.01"))

    invoices_cogs = (
        InvoiceLine.objects.filter(invoice__in=invoices_qs)
        .annotate(
            line_cogs=ExpressionWrapper(
                F("quantity") * item_cost_expr,
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )
        .aggregate(t=Coalesce(Sum("line_cogs"), Decimal("0.00")))["t"]
    ).quantize(Decimal("0.01"))

    # Credit Notes (Avoirs)
    credit_notes_qs = CreditNote.objects.filter(
        tenant=tenant,
        date__gte=fiscal_year.start_date,
        date__lte=fiscal_year.end_date,
    )
    cn_aggs = credit_notes_qs.aggregate(
        total_ht=Coalesce(Sum("total_ht"), Decimal("0.00")),
        tva_amount=Coalesce(Sum("tva_amount"), Decimal("0.00")),
        total_ttc=Coalesce(Sum("total_ttc"), Decimal("0.00")),
    )
    cn_total_ht = cn_aggs["total_ht"].quantize(Decimal("0.01"))
    cn_tva_amount = cn_aggs["tva_amount"].quantize(Decimal("0.01"))
    cn_total_ttc = cn_aggs["total_ttc"].quantize(Decimal("0.01"))

    # Combined Financials
    net_revenue_ht = (sales_revenue + invoices_total_ht - cn_total_ht).quantize(Decimal("0.01"))
    net_tva_amount = (invoices_tva_amount - cn_tva_amount).quantize(Decimal("0.01"))
    total_stamp_duty = (sales_stamp + invoices_stamp).quantize(Decimal("0.01"))
    total_cogs = (sales_cogs + invoices_cogs).quantize(Decimal("0.01"))
    gross_margin = (net_revenue_ht - total_cogs).quantize(Decimal("0.01"))
    gross_margin_pct = (
        ((gross_margin / net_revenue_ht) * 100).quantize(Decimal("0.1"))
        if net_revenue_ht > Decimal("0.00")
        else Decimal("0.0")
    )

    totals = {
        "cost_basis_note": "current PAMP at closing time",
        "sales": {
            "count": sales_qs.count(),
            "revenue": str(sales_revenue),
            "timbre_fiscal": str(sales_stamp),
            "cogs": str(sales_cogs),
        },
        "invoices": {
            "count": invoices_qs.count(),
            "total_ht": str(invoices_total_ht),
            "tva_amount": str(invoices_tva_amount),
            "timbre_fiscal": str(invoices_stamp),
            "total_ttc": str(invoices_total_ttc),
            "cogs": str(invoices_cogs),
        },
        "credit_notes": {
            "count": credit_notes_qs.count(),
            "total_ht": str(cn_total_ht),
            "tva_amount": str(cn_tva_amount),
            "total_ttc": str(cn_total_ttc),
        },
        "financial_summary": {
            "net_revenue_ht": str(net_revenue_ht),
            "tva_amount": str(net_tva_amount),
            "timbre_fiscal": str(total_stamp_duty),
            "cogs": str(total_cogs),
            "gross_margin": str(gross_margin),
            "gross_margin_pct": str(gross_margin_pct),
        },
        "stock_summary": {
            "sku_count": len(stock_lines),
            "total_units": total_stock_units,
            "total_cost_value": str(total_cost_value),
            "total_retail_value": str(total_retail_value),
        },
        "balance_summary": {
            "client_debt_total": str(total_client_debt),
            "client_credit_total": str(total_client_credit),
            "supplier_debt_total": str(total_supplier_debt),
        },
        "pending_cheques": {
            "count": len(cheques_items),
            "receivable_total": str(total_cheques_receivable),
            "payable_total": str(total_cheques_payable),
            "items": cheques_items,
        },
        "computed_at": timezone.now().isoformat(),
    }

    # ── 6. Persist Atomically ────────────────────────────────────────────────
    with transaction.atomic():
        fiscal_year.stock_lines.all().delete()
        fiscal_year.balance_lines.all().delete()
        if stock_lines:
            StockSnapshotLine.objects.bulk_create(stock_lines, batch_size=500)
        if balance_lines:
            BalanceSnapshotLine.objects.bulk_create(balance_lines, batch_size=500)
        fiscal_year.totals = totals
        fiscal_year.save(update_fields=["totals"])

    return fiscal_year
