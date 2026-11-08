"""
Client account statement ("relevé de compte") service.

Calculates:
- Opening balance at `from_date` (sum of debits - sum of credits before `from_date`)
- Ledger entries in the date range with running balance
- Closing balance (`opening_balance + period_debits - period_credits`)
- Open invoices with ageing breakdown

Renders:
- Structured dictionary for JSON response
- PDF document via WeasyPrint / Desktop bridge (templates/pdf/client_statement.html)
- Excel workbook (.xlsx) via openpyxl
- Bulk ZIP bundle for clients with positive outstanding balance
"""
import io
import re
import zipfile
from datetime import date, datetime
from decimal import Decimal

from django.db import models
from django.http import HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from django.utils.translation import gettext as _

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from apps.core.models import StoreSettings
from apps.invoicing.models import Invoice
from apps.invoicing.pdf import render_to_pdf
from apps.clients.models import Client, ClientLedger


def parse_date(date_val):
    if not date_val:
        return None
    if isinstance(date_val, (date, datetime)):
        return date_val if isinstance(date_val, date) else date_val.date()
    try:
        return datetime.strptime(str(date_val).strip()[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def get_client_statement_data(client: Client, from_date=None, to_date=None) -> dict:
    """
    Compute client statement data for the requested date window.
    Invariant: opening_balance + period_debits - period_credits == closing_balance.
    """
    from_d = parse_date(from_date)
    to_d = parse_date(to_date) or timezone.localdate()

    # Opening balance: debits - credits for dates strictly before from_d
    if from_d:
        prev_entries = client.ledger_entries.filter(date__lt=from_d)
        prev_debits = (
            prev_entries.filter(entry_type="debit").aggregate(s=models.Sum("amount"))["s"]
            or Decimal("0.00")
        )
        prev_credits = (
            prev_entries.filter(entry_type="credit").aggregate(s=models.Sum("amount"))["s"]
            or Decimal("0.00")
        )
        opening_balance = prev_debits - prev_credits
    else:
        opening_balance = Decimal("0.00")

    # Entries in period
    qs = client.ledger_entries.all()
    if from_d:
        qs = qs.filter(date__gte=from_d)
    if to_d:
        qs = qs.filter(date__lte=to_d)
    qs = qs.order_by("date", "created_at")

    running_balance = opening_balance
    period_debits = Decimal("0.00")
    period_credits = Decimal("0.00")
    entries_list = []

    for entry in qs:
        if entry.entry_type == "debit":
            debit = entry.amount
            credit = Decimal("0.00")
            running_balance += debit
            period_debits += debit
        else:
            debit = Decimal("0.00")
            credit = entry.amount
            running_balance -= credit
            period_credits += credit

        entries_list.append({
            "id": str(entry.id),
            "date": entry.date,
            "description": entry.description,
            "reference_type": entry.reference_type,
            "reference_id": entry.reference_id,
            "entry_type": entry.entry_type,
            "debit": debit,
            "credit": credit,
            "running_balance": running_balance,
        })

    closing_balance = opening_balance + period_debits - period_credits

    # Open invoices with ageing
    open_inv_qs = Invoice.objects.filter(
        tenant=client.tenant,
        client=client,
        status__in=["sent", "partial", "overdue"],
    ).order_by("date")

    open_invoices = []
    total_overdue = Decimal("0.00")
    ref_date = to_d

    for inv in open_inv_qs:
        rem = inv.balance_due
        if rem <= Decimal("0.00"):
            continue
        days_old = (ref_date - inv.date).days if inv.date else 0
        if days_old <= 30:
            bucket = "0-30j"
        elif days_old <= 60:
            bucket = "31-60j"
        elif days_old <= 90:
            bucket = "61-90j"
        else:
            bucket = "+90j"

        is_overdue = False
        if inv.due_date and inv.due_date < ref_date:
            is_overdue = True
            total_overdue += rem

        open_invoices.append({
            "id": str(inv.id),
            "number": inv.number,
            "date": inv.date,
            "due_date": inv.due_date,
            "total_ttc": inv.total_ttc,
            "total_paid": inv.total_paid,
            "balance_due": rem,
            "days_old": max(0, days_old),
            "bucket": bucket,
            "is_overdue": is_overdue,
        })

    store_settings = StoreSettings.objects.filter(tenant=client.tenant).first()

    return {
        "client": client,
        "store_settings": store_settings,
        "tenant": client.tenant,
        "from_date": from_d,
        "to_date": to_d,
        "generated_at": timezone.now(),
        "opening_balance": opening_balance,
        "period_debits": period_debits,
        "period_credits": period_credits,
        "closing_balance": closing_balance,
        "entries": entries_list,
        "open_invoices": open_invoices,
        "total_overdue": total_overdue,
    }


def render_client_statement_pdf(statement_data: dict, language: str = "fr") -> bytes:
    """
    Renders statement to PDF bytes via render_to_pdf.
    """
    context = {
        "data": statement_data,
        "client": statement_data["client"],
        "tenant": statement_data["tenant"],
        "store_settings": statement_data["store_settings"],
        "from_date": statement_data["from_date"],
        "to_date": statement_data["to_date"],
        "generated_at": statement_data["generated_at"],
        "opening_balance": statement_data["opening_balance"],
        "period_debits": statement_data["period_debits"],
        "period_credits": statement_data["period_credits"],
        "closing_balance": statement_data["closing_balance"],
        "entries": statement_data["entries"],
        "open_invoices": statement_data["open_invoices"],
        "total_overdue": statement_data["total_overdue"],
    }
    return render_to_pdf("pdf/client_statement.html", context, language=language)


def render_client_statement_xlsx(statement_data: dict, language: str = "fr") -> bytes:
    """
    Generate an Excel workbook (.xlsx) for the client statement.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = _("Relevé de compte")[:31]

    # Styles
    font_title = Font(name="Calibri", size=15, bold=True, color="1E3A8A")
    font_section = Font(name="Calibri", size=11, bold=True, color="1E293B")
    font_header = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    font_bold = Font(name="Calibri", size=10, bold=True)
    font_regular = Font(name="Calibri", size=10)
    font_muted = Font(name="Calibri", size=9, color="64748B")

    fill_primary = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    fill_subhead = PatternFill(start_color="3B82F6", end_color="3B82F6", fill_type="solid")
    fill_summary = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    fill_highlight = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )
    double_bottom_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="double", color="1E293B"),
    )

    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")

    num_fmt = "#,##0.00"

    client = statement_data["client"]
    tenant = statement_data["tenant"]
    from_d = statement_data["from_date"]
    to_d = statement_data["to_date"]

    # ── Title block ──
    ws.merge_cells("A1:F1")
    ws["A1"] = f"{tenant.name.upper()} — RELEVÉ DE COMPTE CLIENT"
    ws["A1"].font = font_title
    ws["A1"].alignment = align_left

    period_text = (
        f"Période : Du {from_d.strftime('%d/%m/%Y')} au {to_d.strftime('%d/%m/%Y')}"
        if from_d
        else f"Période : Au {to_d.strftime('%d/%m/%Y')}"
    )
    ws.merge_cells("A2:F2")
    ws["A2"] = period_text
    ws["A2"].font = font_muted
    ws["A2"].alignment = align_left

    # ── Client info ──
    ws["A4"] = "Client :"
    ws["A4"].font = font_bold
    ws["B4"] = client.name
    ws["B4"].font = font_bold

    ws["A5"] = "Téléphone :"
    ws["A5"].font = font_regular
    ws["B5"] = client.phone or "—"

    ws["D4"] = "Solde initial :"
    ws["D4"].font = font_regular
    ws["E4"] = float(statement_data["opening_balance"])
    ws["E4"].number_format = num_fmt
    ws["E4"].font = font_bold

    ws["D5"] = "Solde restant dû :"
    ws["D5"].font = font_bold
    ws["E5"] = float(statement_data["closing_balance"])
    ws["E5"].number_format = num_fmt
    ws["E5"].font = font_bold
    ws["E5"].fill = fill_highlight

    row_idx = 7

    # ── Operations Table Header ──
    headers = ["Date", "Description", "Référence", "Débit (DZD)", "Crédit (DZD)", "Solde (DZD)"]
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=h)
        cell.font = font_header
        cell.fill = fill_primary
        cell.alignment = align_center if col_idx == 1 else (align_right if col_idx >= 4 else align_left)
        cell.border = thin_border

    row_idx += 1

    # Opening balance row
    ws.cell(row=row_idx, column=1, value=from_d.strftime("%d/%m/%Y") if from_d else "—").alignment = align_center
    ws.cell(row=row_idx, column=2, value="SOLDE INITIAL").font = font_bold
    ws.cell(row=row_idx, column=3, value="")
    ws.cell(row=row_idx, column=4, value="")
    ws.cell(row=row_idx, column=5, value="")
    c_bal = ws.cell(row=row_idx, column=6, value=float(statement_data["opening_balance"]))
    c_bal.number_format = num_fmt
    c_bal.font = font_bold
    c_bal.alignment = align_right

    for c in range(1, 7):
        cell = ws.cell(row=row_idx, column=c)
        cell.border = thin_border
        cell.fill = fill_summary

    row_idx += 1

    # Entries rows
    for entry in statement_data["entries"]:
        ws.cell(row=row_idx, column=1, value=entry["date"].strftime("%d/%m/%Y")).alignment = align_center
        ws.cell(row=row_idx, column=2, value=entry["description"]).alignment = align_left
        ref = f"{entry['reference_type']} {entry['reference_id']}".strip()
        ws.cell(row=row_idx, column=3, value=ref).alignment = align_left

        d_cell = ws.cell(row=row_idx, column=4, value=float(entry["debit"]) if entry["debit"] else None)
        d_cell.number_format = num_fmt
        d_cell.alignment = align_right

        cr_cell = ws.cell(row=row_idx, column=5, value=float(entry["credit"]) if entry["credit"] else None)
        cr_cell.number_format = num_fmt
        cr_cell.alignment = align_right

        b_cell = ws.cell(row=row_idx, column=6, value=float(entry["running_balance"]))
        b_cell.number_format = num_fmt
        b_cell.alignment = align_right

        for c in range(1, 7):
            ws.cell(row=row_idx, column=c).border = thin_border
            ws.cell(row=row_idx, column=c).font = font_regular

        row_idx += 1

    # Summary Totals Row
    ws.cell(row=row_idx, column=1, value="").alignment = align_center
    tot_label = ws.cell(row=row_idx, column=2, value="TOTAUX PÉRIODE / SOLDE FINAL")
    tot_label.font = font_bold
    ws.cell(row=row_idx, column=3, value="")

    tot_d = ws.cell(row=row_idx, column=4, value=float(statement_data["period_debits"]))
    tot_d.number_format = num_fmt
    tot_d.font = font_bold
    tot_d.alignment = align_right

    tot_cr = ws.cell(row=row_idx, column=5, value=float(statement_data["period_credits"]))
    tot_cr.number_format = num_fmt
    tot_cr.font = font_bold
    tot_cr.alignment = align_right

    fin_bal = ws.cell(row=row_idx, column=6, value=float(statement_data["closing_balance"]))
    fin_bal.number_format = num_fmt
    fin_bal.font = font_bold
    fin_bal.alignment = align_right

    for c in range(1, 7):
        cell = ws.cell(row=row_idx, column=c)
        cell.border = double_bottom_border
        cell.fill = fill_summary

    row_idx += 3

    # ── Open Invoices Table if any ──
    if statement_data["open_invoices"]:
        ws.cell(row=row_idx, column=1, value="FACTURES NON SOLDÉES (ANCIENNETÉ)").font = font_section
        row_idx += 1

        inv_headers = ["N° Facture", "Date", "Échéance", "Total TTC", "Reste dû", "Tranche"]
        for col_idx, h in enumerate(inv_headers, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=h)
            cell.font = font_header
            cell.fill = fill_subhead
            cell.alignment = align_center if col_idx in (1, 2, 3, 6) else align_right
            cell.border = thin_border

        row_idx += 1
        for inv in statement_data["open_invoices"]:
            ws.cell(row=row_idx, column=1, value=inv["number"]).alignment = align_center
            ws.cell(row=row_idx, column=2, value=inv["date"].strftime("%d/%m/%Y") if inv["date"] else "").alignment = align_center
            ws.cell(row=row_idx, column=3, value=inv["due_date"].strftime("%d/%m/%Y") if inv["due_date"] else "").alignment = align_center

            ttc = ws.cell(row=row_idx, column=4, value=float(inv["total_ttc"]))
            ttc.number_format = num_fmt
            ttc.alignment = align_right

            rem = ws.cell(row=row_idx, column=5, value=float(inv["balance_due"]))
            rem.number_format = num_fmt
            rem.font = font_bold
            rem.alignment = align_right

            ws.cell(row=row_idx, column=6, value=inv["bucket"]).alignment = align_center

            for c in range(1, 7):
                ws.cell(row=row_idx, column=c).border = thin_border
                ws.cell(row=row_idx, column=c).font = font_regular

            row_idx += 1

    # Adjust column widths
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            val_str = str(cell.value or "")
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def render_bulk_statements_zip(tenant, from_date=None, to_date=None, language: str = "fr") -> bytes:
    """
    Generate a ZIP archive containing statement PDFs for all clients with cached_balance > 0.
    """
    clients = Client.objects.filter(tenant=tenant, cached_balance__gt=0).order_by("name")

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for client in clients:
            st_data = get_client_statement_data(client, from_date=from_date, to_date=to_date)
            pdf_bytes = render_client_statement_pdf(st_data, language=language)

            safe_name = slugify(client.name) or f"client-{client.id}"
            file_name = f"releve_{client.pk}_{safe_name}.pdf"
            zf.writestr(file_name, pdf_bytes)

    return zip_buf.getvalue()
