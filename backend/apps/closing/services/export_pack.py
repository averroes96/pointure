"""
Accountant export pack service for Fiscal Year Management Closing (Task 6.4).
Generates:
1. Multi-sheet Excel workbook (.xlsx) via openpyxl with all accounting journals,
   snapshots, and totals rows.
2. Single-page PDF summary via render_to_pdf and fiscal_year_summary.html template.
"""
import datetime
import io
from decimal import Decimal
from zoneinfo import ZoneInfo

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from django.db.models import Sum
from django.utils import timezone, translation
from django.utils.translation import gettext as _

from apps.clients.models import Cheque, ChequeStatusChoices
from apps.closing.models import BalanceKindChoices, FiscalYear
from apps.closing.services.snapshot import build_snapshot
from apps.invoicing.models import CreditNote, Invoice, InvoiceStatusChoices
from apps.invoicing.pdf import render_to_pdf
from apps.sales.models import Payment, PaymentMethodChoices, Sale
from apps.suppliers.models import SupplierInvoice, SupplierPayment


def _get_styles():
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1A4A8A", end_color="1A4A8A", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    title_font = Font(name="Calibri", size=14, bold=True, color="1A4A8A")
    subtitle_font = Font(name="Calibri", size=10, italic=True, color="64748B")

    section_font = Font(name="Calibri", size=11, bold=True, color="1A4A8A")
    section_fill = PatternFill(start_color="EEF2F6", end_color="EEF2F6", fill_type="solid")

    total_font = Font(name="Calibri", size=11, bold=True, color="000000")
    total_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
    total_border = Border(
        top=Side(style="thin", color="000000"),
        bottom=Side(style="double", color="000000"),
    )

    cell_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    return {
        "header_font": header_font,
        "header_fill": header_fill,
        "header_alignment": header_alignment,
        "title_font": title_font,
        "subtitle_font": subtitle_font,
        "section_font": section_font,
        "section_fill": section_fill,
        "total_font": total_font,
        "total_fill": total_fill,
        "total_border": total_border,
        "cell_border": cell_border,
    }


def _auto_fit_columns(ws, max_cols=None):
    cols_to_check = ws.columns
    for idx, col in enumerate(cols_to_check, start=1):
        if max_cols and idx > max_cols:
            break
        max_len = 0
        for cell in col:
            val = cell.value
            if val is not None:
                length = len(str(val))
                if length > max_len:
                    max_len = length
        col_letter = get_column_letter(idx)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)


def generate_fiscal_year_export_workbook(fiscal_year: FiscalYear, language: str = "fr") -> openpyxl.Workbook:
    """
    Generate the 9-sheet accountant export pack Excel workbook for a fiscal year.
    Sheets:
    1. Synthèse
    2. Journal des ventes (caisse)
    3. Factures
    4. Avoirs
    5. Achats
    6. Valorisation stock
    7. Soldes clients
    8. Soldes fournisseurs
    9. Chèques en circulation
    """
    # Ensure snapshots and totals are built
    if not fiscal_year.totals and fiscal_year.is_open:
        build_snapshot(fiscal_year)
        fiscal_year.refresh_from_db()

    with translation.override(language):
        wb = openpyxl.Workbook()
        styles = _get_styles()

        # ── 1. Synthèse ──────────────────────────────────────────────────────
        ws_synth = wb.active
        ws_synth.title = _("Synthèse")[:31]
        _populate_synthese_sheet(ws_synth, fiscal_year, styles)

        # ── 2. Journal des ventes (caisse) ───────────────────────────────────
        ws_sales = wb.create_sheet(title=_("Journal des ventes")[:31])
        _populate_sales_journal_sheet(ws_sales, fiscal_year, styles)

        # ── 3. Factures ──────────────────────────────────────────────────────
        ws_inv = wb.create_sheet(title=_("Factures")[:31])
        _populate_invoices_sheet(ws_inv, fiscal_year, styles)

        # ── 4. Avoirs ────────────────────────────────────────────────────────
        ws_cn = wb.create_sheet(title=_("Avoirs")[:31])
        _populate_credit_notes_sheet(ws_cn, fiscal_year, styles)

        # ── 5. Achats ────────────────────────────────────────────────────────
        ws_purchases = wb.create_sheet(title=_("Achats")[:31])
        _populate_purchases_sheet(ws_purchases, fiscal_year, styles)

        # ── 6. Valorisation stock ────────────────────────────────────────────
        ws_stock = wb.create_sheet(title=_("Valorisation stock")[:31])
        _populate_stock_valuation_sheet(ws_stock, fiscal_year, styles)

        # ── 7. Soldes clients ────────────────────────────────────────────────
        ws_clients = wb.create_sheet(title=_("Soldes clients")[:31])
        _populate_client_balances_sheet(ws_clients, fiscal_year, styles)

        # ── 8. Soldes fournisseurs ───────────────────────────────────────────
        ws_suppliers = wb.create_sheet(title=_("Soldes fournisseurs")[:31])
        _populate_supplier_balances_sheet(ws_suppliers, fiscal_year, styles)

        # ── 9. Chèques en circulation ────────────────────────────────────────
        ws_cheques = wb.create_sheet(title=_("Chèques en circulation")[:31])
        _populate_cheques_sheet(ws_cheques, fiscal_year, styles)

        return wb


def _populate_synthese_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    totals = fiscal_year.totals or {}
    tenant = fiscal_year.tenant

    # Title & Subtitle
    ws.merge_cells("A1:E1")
    title_cell = ws["A1"]
    title_cell.value = f"{tenant.name} — {_('SYNTHÈSE DE CLÔTURE D’EXERCICE FISCAL')} {fiscal_year.year}"
    title_cell.font = styles["title_font"]

    ws.merge_cells("A2:E2")
    sub_cell = ws["A2"]
    status_label = fiscal_year.get_status_display()
    sub_cell.value = (
        f"{_('Période du')} {fiscal_year.start_date} {_('au')} {fiscal_year.end_date} | "
        f"{_('Statut')}: {status_label} | {_('Généré le')}: {timezone.now().strftime('%Y-%m-%d %H:%M')}"
    )
    sub_cell.font = styles["subtitle_font"]

    row = 4

    def add_section(header_text):
        nonlocal row
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
        c = ws.cell(row=row, column=1, value=header_text)
        c.font = styles["section_font"]
        c.fill = styles["section_fill"]
        row += 1

    def add_kpi(label, value, is_currency=True):
        nonlocal row
        c_lbl = ws.cell(row=row, column=1, value=label)
        c_lbl.font = Font(name="Calibri", size=10, bold=False)
        c_val = ws.cell(row=row, column=2, value=value)
        c_val.font = Font(name="Calibri", size=10, bold=True)
        if is_currency and isinstance(value, (int, float, Decimal)):
            c_val.number_format = '#,##0.00'
            ws.cell(row=row, column=3, value="DZD")
        row += 1

    fin = totals.get("financial_summary", {})
    sales = totals.get("sales", {})
    invoices = totals.get("invoices", {})
    credit_notes = totals.get("credit_notes", {})
    stock = totals.get("stock_summary", {})
    balances = totals.get("balance_summary", {})
    cheques = totals.get("pending_cheques", {})

    add_section(_("1. RÉSUMÉ COMMERCIAL & FINANCIER"))
    add_kpi(_("Chiffre d'Affaires Net Consolidé (HT)"), Decimal(fin.get("net_revenue_ht", "0.00")))
    add_kpi(_("TVA Nette Facturée"), Decimal(fin.get("tva_amount", "0.00")))
    add_kpi(_("Timbre Fiscal Total Perçu"), Decimal(fin.get("timbre_fiscal", "0.00")))
    add_kpi(_("Coût Global des Marchandises Vendues (COGS)"), Decimal(fin.get("cogs", "0.00")))
    add_kpi(_("Marge Brute Globale"), Decimal(fin.get("gross_margin", "0.00")))
    add_kpi(_("Taux de Marge Brute"), f"{fin.get('gross_margin_pct', '0.0')}%", is_currency=False)
    row += 1

    add_section(_("2. VENTES EN MAGASIN (CAISSE)"))
    add_kpi(_("Nombre de tickets"), sales.get("count", 0), is_currency=False)
    add_kpi(_("Total Chiffre d'Affaires (Net HT)"), Decimal(sales.get("revenue", "0.00")))
    add_kpi(_("Timbre Fiscal Caisse"), Decimal(sales.get("timbre_fiscal", "0.00")))
    add_kpi(_("Coût d'Achat Caisse (COGS)"), Decimal(sales.get("cogs", "0.00")))
    row += 1

    add_section(_("3. VENTES EN GROS (FACTURES)"))
    add_kpi(_("Nombre de factures"), invoices.get("count", 0), is_currency=False)
    add_kpi(_("Total Facturé HT"), Decimal(invoices.get("total_ht", "0.00")))
    add_kpi(_("TVA Facturée"), Decimal(invoices.get("tva_amount", "0.00")))
    add_kpi(_("Timbre Fiscal Factures"), Decimal(invoices.get("timbre_fiscal", "0.00")))
    add_kpi(_("Total Facturé TTC"), Decimal(invoices.get("total_ttc", "0.00")))
    add_kpi(_("Coût d'Achat Factures (COGS)"), Decimal(invoices.get("cogs", "0.00")))
    row += 1

    add_section(_("4. AVOIRS CLIENTS"))
    add_kpi(_("Nombre d'avoirs"), credit_notes.get("count", 0), is_currency=False)
    add_kpi(_("Total Avoirs HT"), Decimal(credit_notes.get("total_ht", "0.00")))
    add_kpi(_("TVA sur avoirs"), Decimal(credit_notes.get("tva_amount", "0.00")))
    add_kpi(_("Total Avoirs TTC"), Decimal(credit_notes.get("total_ttc", "0.00")))
    row += 1

    add_section(_("5. VALORISATION DU STOCK EN FIN D'EXERCICE"))
    add_kpi(_("Nombre de références distinctes (SKU)"), stock.get("sku_count", 0), is_currency=False)
    add_kpi(_("Unités totales en stock"), stock.get("total_units", 0), is_currency=False)
    add_kpi(_("Valeur d'achat totale au coût (PAMP)"), Decimal(stock.get("total_cost_value", "0.00")))
    add_kpi(_("Valeur marchande au prix de détail"), Decimal(stock.get("total_retail_value", "0.00")))
    row += 1

    add_section(_("6. CRÉANCES, DETTES ET CHÈQUES"))
    add_kpi(_("Créances Clients"), Decimal(balances.get("client_debt_total", "0.00")))
    add_kpi(_("Avances Clients (Crédits)"), Decimal(balances.get("client_credit_total", "0.00")))
    add_kpi(_("Dettes Fournisseurs"), Decimal(balances.get("supplier_debt_total", "0.00")))
    add_kpi(_("Chèques Clients à Encaisser"), Decimal(cheques.get("receivable_total", "0.00")))
    add_kpi(_("Chèques Fournisseurs Émis"), Decimal(cheques.get("payable_total", "0.00")))

    _auto_fit_columns(ws, max_cols=3)


def _populate_sales_journal_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("Date"),
        _("Nb Ventes"),
        _("Total Ventes TTC"),
        _("Timbre Fiscal"),
        _("Net HT"),
        _("Espèces"),
        _("Chèque"),
        _("TPE / Carte"),
        _("Virement / CCP"),
        _("Autre"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    algiers_tz = ZoneInfo("Africa/Algiers")
    start_dt = datetime.datetime.combine(fiscal_year.start_date, datetime.time(0, 0, 0), tzinfo=algiers_tz)
    end_dt = datetime.datetime.combine(fiscal_year.end_date, datetime.time(23, 59, 59, 999999), tzinfo=algiers_tz)

    sales = (
        Sale.objects.filter(
            tenant=fiscal_year.tenant,
            status="completed",
            created_at__gte=start_dt,
            created_at__lte=end_dt,
        )
        .prefetch_related("payments")
        .order_by("created_at")
    )

    daily = {}
    for s in sales:
        local_date = timezone.localtime(s.created_at, algiers_tz).date()
        if local_date not in daily:
            daily[local_date] = {
                "count": 0,
                "ttc": Decimal("0.00"),
                "timbre": Decimal("0.00"),
                "cash": Decimal("0.00"),
                "cheque": Decimal("0.00"),
                "tpe": Decimal("0.00"),
                "virement": Decimal("0.00"),
                "other": Decimal("0.00"),
            }
        item = daily[local_date]
        item["count"] += 1
        item["ttc"] += s.total_amount
        item["timbre"] += s.timbre_fiscal

        for p in s.payments.all():
            if p.recorded_at and not (start_dt <= p.recorded_at <= end_dt):
                continue
            m = p.method
            amt = p.amount
            if m == PaymentMethodChoices.CASH:
                item["cash"] += amt
            elif m == PaymentMethodChoices.CHEQUE:
                item["cheque"] += amt
            elif m == PaymentMethodChoices.TPE:
                item["tpe"] += amt
            elif m in (PaymentMethodChoices.VIREMENT, PaymentMethodChoices.CCP, PaymentMethodChoices.BARIDIMOB):
                item["virement"] += amt
            else:
                item["other"] += amt

    row_idx = 2
    sum_count = 0
    sum_ttc = Decimal("0.00")
    sum_timbre = Decimal("0.00")
    sum_ht = Decimal("0.00")
    sum_cash = Decimal("0.00")
    sum_cheque = Decimal("0.00")
    sum_tpe = Decimal("0.00")
    sum_virement = Decimal("0.00")
    sum_other = Decimal("0.00")

    for d in sorted(daily.keys()):
        item = daily[d]
        net_ht = item["ttc"] - item["timbre"]

        sum_count += item["count"]
        sum_ttc += item["ttc"]
        sum_timbre += item["timbre"]
        sum_ht += net_ht
        sum_cash += item["cash"]
        sum_cheque += item["cheque"]
        sum_tpe += item["tpe"]
        sum_virement += item["virement"]
        sum_other += item["other"]

        values = [
            str(d),
            item["count"],
            item["ttc"],
            item["timbre"],
            net_ht,
            item["cash"],
            item["cheque"],
            item["tpe"],
            item["virement"],
            item["other"],
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx == 2:
                cell.number_format = '#,##0'
            elif col_idx >= 3:
                cell.number_format = '#,##0.00'
        row_idx += 1

    # Total row
    total_values = [
        _("TOTAL"),
        sum_count,
        sum_ttc,
        sum_timbre,
        sum_ht,
        sum_cash,
        sum_cheque,
        sum_tpe,
        sum_virement,
        sum_other,
    ]
    for col_idx, val in enumerate(total_values, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx == 2:
            cell.number_format = '#,##0'
        elif col_idx >= 3:
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def _populate_invoices_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("Numéro"),
        _("Date"),
        _("Client"),
        _("NIF"),
        _("Montant HT"),
        _("Montant TVA"),
        _("Timbre Fiscal"),
        _("Montant TTC"),
        _("Statut"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    invoices = (
        Invoice.objects.filter(
            tenant=fiscal_year.tenant,
            status__in=[
                InvoiceStatusChoices.SENT,
                InvoiceStatusChoices.PAID,
                InvoiceStatusChoices.PARTIAL,
                InvoiceStatusChoices.OVERDUE,
            ],
            date__gte=fiscal_year.start_date,
            date__lte=fiscal_year.end_date,
        )
        .select_related("client")
        .order_by("date", "number")
    )

    row_idx = 2
    sum_ht = Decimal("0.00")
    sum_tva = Decimal("0.00")
    sum_timbre = Decimal("0.00")
    sum_ttc = Decimal("0.00")

    for inv in invoices:
        sum_ht += inv.total_ht
        sum_tva += inv.tva_amount
        sum_timbre += inv.timbre_fiscal
        sum_ttc += inv.total_ttc

        values = [
            inv.number,
            str(inv.date),
            inv.client.name if inv.client else "",
            inv.client.nif if inv.client and inv.client.nif else "",
            inv.total_ht,
            inv.tva_amount,
            inv.timbre_fiscal,
            inv.total_ttc,
            str(inv.get_status_display()),
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx in (5, 6, 7, 8):
                cell.number_format = '#,##0.00'
        row_idx += 1

    # Total row
    totals = [
        _("TOTAL"),
        "",
        "",
        "",
        sum_ht,
        sum_tva,
        sum_timbre,
        sum_ttc,
        "",
    ]
    for col_idx, val in enumerate(totals, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx in (5, 6, 7, 8):
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def _populate_credit_notes_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("Numéro d'Avoir"),
        _("Date"),
        _("Facture d'Origine"),
        _("Client"),
        _("Montant HT"),
        _("Montant TVA"),
        _("Montant TTC"),
        _("Motif"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    credit_notes = (
        CreditNote.objects.filter(
            tenant=fiscal_year.tenant,
            date__gte=fiscal_year.start_date,
            date__lte=fiscal_year.end_date,
        )
        .select_related("original_invoice__client", "original_invoice")
        .order_by("date", "number")
    )

    row_idx = 2
    sum_ht = Decimal("0.00")
    sum_tva = Decimal("0.00")
    sum_ttc = Decimal("0.00")

    for cn in credit_notes:
        sum_ht += cn.total_ht
        sum_tva += cn.tva_amount
        sum_ttc += cn.total_ttc

        orig_inv = cn.original_invoice
        client_name = orig_inv.client.name if (orig_inv and orig_inv.client) else ""
        inv_number = orig_inv.number if orig_inv else ""

        values = [
            cn.number,
            str(cn.date),
            inv_number,
            client_name,
            cn.total_ht,
            cn.tva_amount,
            cn.total_ttc,
            cn.reason or "",
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx in (5, 6, 7):
                cell.number_format = '#,##0.00'
        row_idx += 1

    totals = [
        _("TOTAL"),
        "",
        "",
        "",
        sum_ht,
        sum_tva,
        sum_ttc,
        "",
    ]
    for col_idx, val in enumerate(totals, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx in (5, 6, 7):
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def _populate_purchases_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("N° Facture Fournisseur"),
        _("Date"),
        _("Fournisseur"),
        _("Montant Total TTC"),
        _("Montant Payé"),
        _("Solde Restant"),
        _("Échéance"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    invoices = (
        SupplierInvoice.objects.filter(
            tenant=fiscal_year.tenant,
            date__gte=fiscal_year.start_date,
            date__lte=fiscal_year.end_date,
        )
        .select_related("supplier")
        .order_by("date", "invoice_number")
    )

    payments_map = {
        r["supplier_invoice_id"]: r["total"]
        for r in SupplierPayment.objects.filter(
            tenant=fiscal_year.tenant,
            supplier_invoice__isnull=False,
            date__lte=fiscal_year.end_date,
        )
        .values("supplier_invoice_id")
        .annotate(total=Sum("amount"))
    }

    row_idx = 2
    sum_total = Decimal("0.00")
    sum_paid = Decimal("0.00")
    sum_remaining = Decimal("0.00")

    for inv in invoices:
        paid = payments_map.get(inv.id, Decimal("0.00"))
        remaining = inv.total_amount - paid
        sum_total += inv.total_amount
        sum_paid += paid
        sum_remaining += remaining

        values = [
            inv.invoice_number,
            str(inv.date),
            inv.supplier.name if inv.supplier else "",
            inv.total_amount,
            paid,
            remaining,
            str(inv.due_date) if inv.due_date else "",
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx in (4, 5, 6):
                cell.number_format = '#,##0.00'
        row_idx += 1

    totals = [
        _("TOTAL"),
        "",
        "",
        sum_total,
        sum_paid,
        sum_remaining,
        "",
    ]
    for col_idx, val in enumerate(totals, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx in (4, 5, 6):
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def _populate_stock_valuation_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("Réf Produit"),
        _("Désignation"),
        _("Pointure"),
        _("Emplacement"),
        _("Quantité"),
        _("Coût Unitaire (PAMP)"),
        _("Valeur Coût Totale"),
        _("Prix Vente Unitaire"),
        _("Valeur Vente Totale"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    stock_lines = (
        fiscal_year.stock_lines
        .select_related("variant__product", "branch")
        .order_by("variant__product__name", "variant__size_eu")
    )

    row_idx = 2
    sum_qty = 0
    sum_cost_val = Decimal("0.00")
    sum_retail_val = Decimal("0.00")

    for line in stock_lines:
        prod = line.variant.product if line.variant else None
        sum_qty += line.quantity
        sum_cost_val += line.cost_value
        sum_retail_val += line.retail_value

        values = [
            prod.reference if prod else "",
            prod.name if prod else "",
            line.variant.size_eu if line.variant else "",
            line.branch.name if line.branch else _("Principal"),
            line.quantity,
            line.unit_cost,
            line.cost_value,
            line.unit_price,
            line.retail_value,
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx == 5:
                cell.number_format = '#,##0'
            elif col_idx in (6, 7, 8, 9):
                cell.number_format = '#,##0.00'
        row_idx += 1

    totals = [
        _("TOTAL"),
        "",
        "",
        "",
        sum_qty,
        "",
        sum_cost_val,
        "",
        sum_retail_val,
    ]
    for col_idx, val in enumerate(totals, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx == 5:
            cell.number_format = '#,##0'
        elif col_idx in (7, 9):
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def _populate_client_balances_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("Client"),
        _("Solde (DZD)"),
        _("Nature du Solde"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    lines = fiscal_year.balance_lines.filter(kind=BalanceKindChoices.CLIENT).order_by("party_name")

    row_idx = 2
    sum_bal = Decimal("0.00")

    for line in lines:
        sum_bal += line.balance
        nature = _("Débiteur (Créance)") if line.balance > 0 else _("Créditeur (Avance)")
        values = [
            line.party_name,
            line.balance,
            nature,
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx == 2:
                cell.number_format = '#,##0.00'
        row_idx += 1

    totals = [
        _("TOTAL"),
        sum_bal,
        "",
    ]
    for col_idx, val in enumerate(totals, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx == 2:
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def _populate_supplier_balances_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("Fournisseur"),
        _("Solde Dû (DZD)"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    lines = fiscal_year.balance_lines.filter(kind=BalanceKindChoices.SUPPLIER).order_by("party_name")

    row_idx = 2
    sum_bal = Decimal("0.00")

    for line in lines:
        sum_bal += line.balance
        values = [
            line.party_name,
            line.balance,
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx == 2:
                cell.number_format = '#,##0.00'
        row_idx += 1

    totals = [
        _("TOTAL"),
        sum_bal,
    ]
    for col_idx, val in enumerate(totals, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx == 2:
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def _populate_cheques_sheet(ws, fiscal_year: FiscalYear, styles: dict):
    headers = [
        _("Numéro"),
        _("Sens"),
        _("Tiers"),
        _("Banque"),
        _("Date d'Échéance"),
        _("Montant"),
    ]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = styles["header_font"]
        cell.fill = styles["header_fill"]
        cell.alignment = styles["header_alignment"]

    cheques_data = fiscal_year.totals.get("pending_cheques", {}).get("items")
    if cheques_data is None:
        qs = Cheque.objects.filter(
            tenant=fiscal_year.tenant,
            status=ChequeStatusChoices.PENDING,
        ).select_related("client", "supplier")
        items = []
        for chq in qs:
            party_name = chq.client.name if chq.client else (chq.supplier.name if chq.supplier else "")
            items.append({
                "number": chq.number,
                "direction": chq.direction,
                "party_name": party_name,
                "bank": chq.bank,
                "due_date": str(chq.due_date) if chq.due_date else "",
                "amount": str(chq.amount),
            })
    else:
        items = cheques_data

    row_idx = 2
    sum_amt = Decimal("0.00")

    for chq in items:
        amt = Decimal(str(chq.get("amount", "0.00")))
        sum_amt += amt
        direction_label = (
            _("À encaisser (Client)") if chq.get("direction") == "receivable"
            else _("Émis à payer (Fournisseur)")
        )
        values = [
            chq.get("number", ""),
            direction_label,
            chq.get("party_name", ""),
            chq.get("bank", ""),
            chq.get("due_date", ""),
            amt,
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = styles["cell_border"]
            if col_idx == 6:
                cell.number_format = '#,##0.00'
        row_idx += 1

    totals = [
        _("TOTAL"),
        "",
        "",
        "",
        "",
        sum_amt,
    ]
    for col_idx, val in enumerate(totals, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = styles["total_font"]
        cell.fill = styles["total_fill"]
        cell.border = styles["total_border"]
        if col_idx == 6:
            cell.number_format = '#,##0.00'

    _auto_fit_columns(ws, max_cols=len(headers))


def render_fiscal_year_summary_pdf(fiscal_year: FiscalYear, language: str = "fr") -> bytes:
    """
    Render a 1-page PDF summary for the fiscal year closing.
    """
    if not fiscal_year.totals and fiscal_year.is_open:
        build_snapshot(fiscal_year)
        fiscal_year.refresh_from_db()

    totals = fiscal_year.totals or {}
    context = {
        "fiscal_year": fiscal_year,
        "tenant": fiscal_year.tenant,
        "totals": totals,
        "sales": totals.get("sales", {}),
        "invoices": totals.get("invoices", {}),
        "credit_notes": totals.get("credit_notes", {}),
        "financial_summary": totals.get("financial_summary", {}),
        "stock_summary": totals.get("stock_summary", {}),
        "balance_summary": totals.get("balance_summary", {}),
        "pending_cheques": totals.get("pending_cheques", {}),
    }

    return render_to_pdf("pdf/fiscal_year_summary.html", context, language=language)
