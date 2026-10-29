from decimal import Decimal
from django.db.models import Sum
from django.utils import timezone


def compute_session_stats(session):
    """
    Computes real-time totals for a CashSession:
    - sales count & total
    - payment breakdown by method (cash, tpe, baridimob, cheque, ccp, virement, account)
    - returns / refunds
    - petty cash movements (total_cash_in, total_cash_out, and list)
    - theoretical cash in drawer
    """
    from apps.sales.models import Payment, Return

    sales_qs = session.sales.filter(status__in=["completed", "partially_paid", "layaway"])
    sales_count = sales_qs.count()
    total_sales = sales_qs.aggregate(total=Sum("total_amount"))["total"] or Decimal("0.00")

    payments_qs = Payment.objects.filter(sale__in=sales_qs)
    method_aggregates = payments_qs.values("method").annotate(total=Sum("amount"))
    methods_dict = {row["method"]: row["total"] or Decimal("0.00") for row in method_aggregates}

    cash_sales = methods_dict.get("cash", Decimal("0.00"))
    tpe_sales = methods_dict.get("tpe", Decimal("0.00"))
    baridimob_sales = methods_dict.get("baridimob", Decimal("0.00"))
    cheque_sales = methods_dict.get("cheque", Decimal("0.00"))
    ccp_sales = methods_dict.get("ccp", Decimal("0.00"))
    virement_sales = methods_dict.get("virement", Decimal("0.00"))
    account_sales = methods_dict.get("account", Decimal("0.00"))

    # Returns
    returns_qs = session.returns.all()
    if not returns_qs.exists() and session.opened_at:
        end_time = session.closed_at or timezone.now()
        returns_qs = Return.objects.filter(
            tenant=session.tenant,
            created_at__gte=session.opened_at,
            created_at__lte=end_time,
        )
        if session.branch:
            returns_qs = returns_qs.filter(original_sale__branch=session.branch)

    refunds_count = returns_qs.count()
    refunds_amount = returns_qs.aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")
    refunds_cash = returns_qs.filter(refund_method="cash").aggregate(total=Sum("refund_amount"))["total"] or Decimal("0.00")

    # Petty cash movements
    movements_qs = session.movements.all().order_by("created_at")
    total_cash_in = movements_qs.filter(type="in").aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
    total_cash_out = movements_qs.filter(type="out").aggregate(total=Sum("amount"))["total"] or Decimal("0.00")

    # Theoretical cash: opening + cash_sales + cash_in - cash_out - refunds_cash
    expected_cash = session.opening_float + cash_sales + total_cash_in - total_cash_out - refunds_cash

    return {
        "sales_count": sales_count,
        "total_sales": total_sales,
        "cash_sales": cash_sales,
        "tpe_sales": tpe_sales,
        "baridimob_sales": baridimob_sales,
        "cheque_sales": cheque_sales,
        "ccp_sales": ccp_sales,
        "virement_sales": virement_sales,
        "account_sales": account_sales,
        "refunds_count": refunds_count,
        "refunds_amount": refunds_amount,
        "refunds_cash": refunds_cash,
        "total_cash_in": total_cash_in,
        "total_cash_out": total_cash_out,
        "expected_cash": expected_cash,
        "movements": list(movements_qs.values("type", "amount", "category", "notes", "created_at")),
    }


def render_thermal_z_report(session, is_x_report=False, stats=None, store_name="ShoeDZ"):
    """
    Renders an 80mm thermal receipt formatted Rapport Z (or Rapport X).
    """
    if stats is None:
        if session.status == "closed":
            stats = {
                "sales_count": session.system_sales_count,
                "total_sales": session.system_total_sales,
                "cash_sales": session.system_cash_sales,
                "tpe_sales": session.system_tpe_sales,
                "baridimob_sales": session.system_baridimob_sales,
                "cheque_sales": session.system_cheque_sales,
                "ccp_sales": session.system_ccp_sales,
                "virement_sales": session.system_virement_sales,
                "account_sales": session.system_account_sales,
                "refunds_count": session.system_refunds_count,
                "refunds_amount": session.system_refunds_amount,
                "refunds_cash": session.system_refunds_amount,
                "total_cash_in": session.total_cash_in,
                "total_cash_out": session.total_cash_out,
                "expected_cash": session.expected_cash,
                "movements": list(session.movements.all().values("type", "amount", "category", "notes", "created_at")),
            }
        else:
            stats = compute_session_stats(session)

    report_type = "RAPPORT X (LECTURE FLASH)" if is_x_report else "RAPPORT Z (CLÔTURE CAISSE)"
    z_number = f"Z-{session.session_number:04d}"
    opened_str = session.opened_at.strftime("%d/%m/%Y %H:%M") if session.opened_at else "—"
    closed_str = session.closed_at.strftime("%d/%m/%Y %H:%M") if session.closed_at else "En cours"
    cashier_name = session.cashier.get_full_name() or session.cashier.username if session.cashier else "—"
    branch_name = session.branch.name if session.branch else "Caisse Principale"

    # Format helpers
    def dzd(val):
        return f"{Decimal(val or 0):,.2f}".replace(",", " ").replace(".", ",") + " DZD"

    # Discrepancy calculation
    actual_cash = session.actual_cash if session.status == "closed" else Decimal("0.00")
    expected_cash = stats["expected_cash"]
    cash_gap = session.cash_gap if session.status == "closed" else Decimal("0.00")
    gap_label = "EXCÉDENT" if cash_gap > 0 else "DÉFICIT" if cash_gap < 0 else "CONFORME (0)"

    # Movements rows
    movements_rows = ""
    for m in stats.get("movements", []):
        sign = "+" if m["type"] == "in" else "-"
        color = "#16a34a" if m["type"] == "in" else "#dc2626"
        time_str = m["created_at"].strftime("%H:%M") if hasattr(m["created_at"], "strftime") else ""
        movements_rows += f"""
        <tr>
            <td style="font-size:10px;">{time_str} {m['category']}</td>
            <td style="text-align:right;font-size:10px;font-family:monospace;font-weight:bold;color:{color};">{sign} {dzd(m['amount'])}</td>
        </tr>
        """
    if not movements_rows:
        movements_rows = '<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">Aucun mouvement de caisse</td></tr>'

    closing_details = ""
    if not is_x_report and session.status == "closed":
        closing_details = f"""
        <div class="divider"></div>
        <div class="section-title">5. COMPTAGE & ÉCART DU TIROIR</div>
        <table class="data-table">
            <tr>
                <td>Fond initial :</td>
                <td class="text-right">{dzd(session.opening_float)}</td>
            </tr>
            <tr>
                <td>+ Ventes espèces :</td>
                <td class="text-right">{dzd(stats['cash_sales'])}</td>
            </tr>
            <tr>
                <td>+ Apports caisse :</td>
                <td class="text-right">{dzd(stats['total_cash_in'])}</td>
            </tr>
            <tr>
                <td>- Dépenses caisse :</td>
                <td class="text-right">- {dzd(stats['total_cash_out'])}</td>
            </tr>
            <tr>
                <td>- Remboursements :</td>
                <td class="text-right">- {dzd(stats['refunds_cash'])}</td>
            </tr>
            <tr class="highlight-row">
                <td><strong>CAISSE THÉORIQUE :</strong></td>
                <td class="text-right font-bold">{dzd(expected_cash)}</td>
            </tr>
            <tr class="highlight-row">
                <td><strong>ESPÈCES COMPTÉES :</strong></td>
                <td class="text-right font-bold">{dzd(actual_cash)}</td>
            </tr>
            <tr style="border-top: 1.5pt solid #000; font-size:12px;">
                <td><strong>ÉCART ({gap_label}) :</strong></td>
                <td class="text-right font-bold" style="color: {'#dc2626' if cash_gap < 0 else '#16a34a' if cash_gap > 0 else '#000'};">
                    {('+' if cash_gap > 0 else '') + dzd(cash_gap)}
                </td>
            </tr>
        </table>
        """

    signatures_block = ""
    if not is_x_report:
        signatures_block = """
        <div style="margin-top:25px;display:flex;justify-content:space-between;font-size:10px;">
            <div style="border-top:1px solid #000;width:45%;padding-top:4px;text-align:center;">Signature Caissier</div>
            <div style="border-top:1px solid #000;width:45%;padding-top:4px;text-align:center;">Signature Gérant</div>
        </div>
        """

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="color-scheme" content="light">
    <title>{report_type} — {z_number}</title>
    <style>
        :root {{ color-scheme: light !important; }}
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        html, body {{
            margin: 0;
            padding: 0;
            background: #ffffff !important;
            color: #000000 !important;
            color-scheme: light !important;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Courier New", monospace;
            width: 72mm;
            max-width: 80mm;
            margin: 0;
            padding: 3mm 2mm;
            color: #000;
            font-size: 11px;
            line-height: 1.35;
        }}
        @page {{
            margin: 0;
        }}
        @media print {{
            @page {{ margin: 0; }}
            body {{
                margin: 0;
                padding: 2mm 1mm;
                width: 72mm;
                max-width: 80mm;
            }}
        }}
        .header {{ text-align: center; margin-bottom: 8px; }}
        .store-name {{ font-size: 16px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; }}
        .report-badge {{
            display: inline-block;
            margin-top: 4px;
            padding: 2px 6px;
            font-size: 12px;
            font-weight: 800;
            border: 1.5pt solid #000;
            border-radius: 3px;
            letter-spacing: 0.5px;
        }}
        .divider {{ border-top: 1px dashed #000; margin: 6px 0; }}
        .double-divider {{ border-top: 2px solid #000; margin: 8px 0; }}
        .info-grid {{ font-size: 10.5px; margin-bottom: 6px; }}
        .info-row {{ display: flex; justify-content: space-between; margin-bottom: 2px; }}
        .section-title {{
            font-size: 10.5px;
            font-weight: 800;
            text-transform: uppercase;
            margin: 6px 0 3px 0;
            background: #f0f0f0;
            padding: 2px 4px;
        }}
        .data-table {{ width: 100%; border-collapse: collapse; font-size: 10.5px; }}
        .data-table td {{ padding: 2px 0; }}
        .text-right {{ text-align: right; }}
        .font-bold {{ font-weight: 700; }}
        .font-mono {{ font-family: monospace; }}
        .highlight-row td {{ font-weight: 700; padding-top: 3px; padding-bottom: 3px; }}
        .footer {{ text-align: center; font-size: 9px; margin-top: 15px; color: #555; }}
    </style>
</head>
<body>
    <div class="header">
        <div class="store-name">{store_name}</div>
        <div class="report-badge">{report_type}</div>
    </div>

    <div class="info-grid">
        <div class="info-row"><span>N° Session :</span><strong>{z_number}</strong></div>
        <div class="info-row"><span>Agence / Caisse :</span><span>{branch_name}</span></div>
        <div class="info-row"><span>Caissier :</span><span>{cashier_name}</span></div>
        <div class="info-row"><span>Ouverture :</span><span>{opened_str}</span></div>
        <div class="info-row"><span>Clôture :</span><span>{closed_str}</span></div>
        <div class="info-row"><span>Fond de caisse :</span><strong>{dzd(session.opening_float)}</strong></div>
    </div>

    <div class="double-divider"></div>
    <div class="section-title">1. VENTES PAR MODE DE RÈGLEMENT</div>
    <table class="data-table">
        <tr>
            <td>Tickets émis :</td>
            <td class="text-right font-bold">{stats['sales_count']}</td>
        </tr>
        <tr>
            <td>Espèces (Cash) :</td>
            <td class="text-right font-mono font-bold">{dzd(stats['cash_sales'])}</td>
        </tr>
        <tr>
            <td>TPE (CIB / Edahabia) :</td>
            <td class="text-right font-mono">{dzd(stats['tpe_sales'])}</td>
        </tr>
        <tr>
            <td>BaridiMob :</td>
            <td class="text-right font-mono">{dzd(stats['baridimob_sales'])}</td>
        </tr>
        <tr>
            <td>Chèques :</td>
            <td class="text-right font-mono">{dzd(stats['cheque_sales'])}</td>
        </tr>
        <tr>
            <td>Virement / CCP :</td>
            <td class="text-right font-mono">{dzd(stats['virement_sales'] + stats['ccp_sales'])}</td>
        </tr>
        <tr>
            <td>À Crédit (Compte) :</td>
            <td class="text-right font-mono">{dzd(stats['account_sales'])}</td>
        </tr>
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td><strong>TOTAL VENTES :</strong></td>
            <td class="text-right font-mono font-bold">{dzd(stats['total_sales'])}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">2. RETOURS & REMBOURSEMENTS</div>
    <table class="data-table">
        <tr>
            <td>Nombre de retours :</td>
            <td class="text-right">{stats['refunds_count']}</td>
        </tr>
        <tr>
            <td>Total remboursé :</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(stats['refunds_amount'])}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">3. ENTRÉES & DÉPENSES CAISSE</div>
    <table class="data-table">
        {movements_rows}
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td>Total Apports (+) :</td>
            <td class="text-right font-mono" style="color:#16a34a;">+ {dzd(stats['total_cash_in'])}</td>
        </tr>
        <tr class="highlight-row">
            <td>Total Dépenses (-) :</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(stats['total_cash_out'])}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">4. SITUATION DU TIROIR-CAISSE</div>
    <table class="data-table">
        <tr>
            <td>Caisse théorique :</td>
            <td class="text-right font-mono font-bold">{dzd(expected_cash)}</td>
        </tr>
    </table>

    {closing_details}

    {signatures_block}

    <div class="footer">
        Pointure / ShoeDZ POS &bull; Logiciel de Gestion Commerciale
    </div>
</body>
</html>"""


def render_daily_detailed_report(tenant, target_date, branch=None, user=None):
    """
    Renders an 80mm thermal receipt formatted Detailed Daily Sales & Movements Report
    (Rapport Détaillé du Jour) including:
    1. Global summary & payment method breakdown
    2. Every sale of the day with time, receipt #, cashier, client, payment methods, and items
    3. Returns & refunds of the day
    4. Petty cash movements (apports / dépenses) of the day
    5. Stock movements (receptions, adjustments, etc.) of the day
    6. Net cash summary
    """
    from html import escape
    from apps.sales.models import Sale, Payment, Return, CashMovement
    from apps.inventory.models import StockMovement, MovementReasonChoices

    store_name = getattr(tenant, "name", None) or "ShoeDZ"
    branch_name = branch.name if branch else "Toutes les agences"
    editor_name = (user.get_full_name() or user.email) if user and getattr(user, "is_authenticated", False) else "—"
    now_local = timezone.localtime(timezone.now())
    date_str = target_date.strftime("%d/%m/%Y")

    def dzd(val):
        return f"{Decimal(val or 0):,.2f}".replace(",", " ").replace(".", ",") + " DZD"

    # 1. Sales of the day
    sales_qs = (
        Sale.objects.filter(tenant=tenant, created_at__date=target_date)
        .select_related("cashier", "client", "branch")
        .prefetch_related("items__variant__product", "payments")
        .order_by("created_at")
    )
    if branch:
        sales_qs = sales_qs.filter(branch=branch)

    sales_list = list(sales_qs)
    active_sales = [s for s in sales_list if s.status in ("completed", "partially_paid", "layaway")]
    completed_count = sum(1 for s in sales_list if s.status == "completed")
    partial_count = sum(1 for s in sales_list if s.status == "partially_paid")
    layaway_count = sum(1 for s in sales_list if s.status == "layaway")
    cancelled_count = sum(1 for s in sales_list if s.status == "cancelled")

    total_sales_amount = sum((s.total_amount or Decimal("0.00")) for s in active_sales)
    total_items_sold = sum(
        sum(it.quantity for it in s.items.all())
        for s in active_sales
    )

    # Payments breakdown on active sales created on target_date
    payments_qs = Payment.objects.filter(sale__in=active_sales)
    method_aggregates = payments_qs.values("method").annotate(total=Sum("amount"))
    methods_dict = {row["method"]: row["total"] or Decimal("0.00") for row in method_aggregates}

    cash_sales = methods_dict.get("cash", Decimal("0.00"))
    tpe_sales = methods_dict.get("tpe", Decimal("0.00"))
    baridimob_sales = methods_dict.get("baridimob", Decimal("0.00"))
    cheque_sales = methods_dict.get("cheque", Decimal("0.00"))
    ccp_sales = methods_dict.get("ccp", Decimal("0.00"))
    virement_sales = methods_dict.get("virement", Decimal("0.00"))
    account_sales = methods_dict.get("account", Decimal("0.00"))
    total_collected = sum(methods_dict.values(), Decimal("0.00"))
    total_balance_due = max(Decimal("0.00"), total_sales_amount - total_collected)

    method_labels = {
        "cash": "Espèces",
        "tpe": "TPE",
        "baridimob": "BaridiMob",
        "cheque": "Chèque",
        "ccp": "CCP",
        "virement": "Virement",
        "account": "Crédit",
    }
    status_labels = {
        "completed": "Complétée",
        "partially_paid": "Versement",
        "layaway": "Réservation",
        "cancelled": "Annulée",
        "refunded": "Remboursée",
    }

    # Build individual sale blocks
    sales_blocks_html = ""
    for s in sales_list:
        local_dt = timezone.localtime(s.created_at) if s.created_at else None
        time_str = local_dt.strftime("%H:%M") if local_dt else "—"
        c_name = (
            (s.cashier.get_full_name() or s.cashier.email.split("@")[0])
            if s.cashier
            else "—"
        )
        cl_name = s.client.name if s.client else "Comptoir"
        methods_str = ", ".join(
            method_labels.get(p.method, p.method) for p in s.payments.all()
        ) or "—"
        st_label = status_labels.get(s.status, s.status)

        items_rows = ""
        for it in s.items.all():
            v = it.variant
            p_obj = v.product if v else None
            ref_str = p_obj.reference if (p_obj and p_obj.reference) else ""
            prod_label = p_obj.name if p_obj else str(v or "Article")
            if ref_str and ref_str.lower() not in prod_label.lower():
                prod_label = f"{ref_str} · {prod_label}"
            if v and v.size_eu and v.size_eu > 0:
                prod_label += f" (EU{v.size_eu})"
            items_rows += f"""
            <tr>
                <td style="padding:1px 0;font-size:9.5px;color:#222;">&bull; {escape(prod_label)} <span style="font-family:monospace;font-weight:700;">&times;{it.quantity}</span></td>
                <td style="padding:1px 0;text-align:right;font-size:9.5px;font-family:monospace;">{dzd(it.subtotal)}</td>
            </tr>
            """

        paid_amt = sum((p.amount for p in s.payments.all()), Decimal("0.00"))
        rem_amt = max(Decimal("0.00"), (s.total_amount or Decimal("0.00")) - paid_amt)
        balance_line = ""
        if s.status in ("partially_paid", "layaway") and rem_amt > Decimal("0.00"):
            balance_line = f"""
            <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#b45309;">
                <span>Payé: {dzd(paid_amt)}</span>
                <span><strong>Reste: {dzd(rem_amt)}</strong></span>
            </div>
            """

        strike_style = "text-decoration:line-through;opacity:0.65;" if s.status == "cancelled" else ""
        sales_blocks_html += f"""
        <div style="border-bottom:1px dashed #bbb;padding:4px 0;{strike_style}">
            <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:800;">
                <span>{time_str} &bull; {escape(s.receipt_number or f'#{s.id}')}</span>
                <span>{escape(st_label)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#444;margin-bottom:2px;">
                <span>Caissier: {escape(c_name)} | Client: {escape(cl_name)}</span>
                <span>{escape(methods_str)}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
                {items_rows}
            </table>
            <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:800;margin-top:2px;">
                <span>TOTAL TICKET :</span>
                <span style="font-family:monospace;">{dzd(s.total_amount)}</span>
            </div>
            {balance_line}
        </div>
        """

    if not sales_blocks_html:
        sales_blocks_html = '<div style="font-size:10px;color:#777;font-style:italic;padding:4px 0;">Aucune vente enregistrée sur cette journée.</div>'

    # 2. Returns of the day
    returns_qs = (
        Return.objects.filter(tenant=tenant, created_at__date=target_date)
        .select_related("original_sale", "processed_by")
        .order_by("created_at")
    )
    if branch:
        returns_qs = returns_qs.filter(original_sale__branch=branch)

    returns_list = list(returns_qs)
    refunds_count = len(returns_list)
    refunds_amount = sum((r.refund_amount or Decimal("0.00")) for r in returns_list)
    refunds_cash = sum(
        (r.refund_amount or Decimal("0.00"))
        for r in returns_list
        if r.refund_method == "cash"
    )

    returns_rows_html = ""
    for r in returns_list:
        r_dt = timezone.localtime(r.created_at) if r.created_at else None
        r_time = r_dt.strftime("%H:%M") if r_dt else ""
        orig_rec = r.original_sale.receipt_number if r.original_sale else f"#{r.original_sale_id}"
        returns_rows_html += f"""
        <tr>
            <td style="font-size:9.5px;padding:1.5px 0;">{r_time} {escape(orig_rec)} ({escape(r.reason or 'Retour')})</td>
            <td style="text-align:right;font-size:9.5px;font-family:monospace;font-weight:bold;color:#dc2626;">- {dzd(r.refund_amount)}</td>
        </tr>
        """
    if not returns_rows_html:
        returns_rows_html = '<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">Aucun retour sur cette journée</td></tr>'

    # 3. Petty Cash Movements of the day
    cash_mov_qs = (
        CashMovement.objects.filter(session__tenant=tenant, created_at__date=target_date)
        .select_related("session", "created_by")
        .order_by("created_at")
    )
    if branch:
        cash_mov_qs = cash_mov_qs.filter(session__branch=branch)

    cash_mov_list = list(cash_mov_qs)
    total_cash_in = sum((m.amount for m in cash_mov_list if m.type == "in"), Decimal("0.00"))
    total_cash_out = sum((m.amount for m in cash_mov_list if m.type == "out"), Decimal("0.00"))

    cash_mov_rows_html = ""
    for m in cash_mov_list:
        sign = "+" if m.type == "in" else "-"
        color = "#16a34a" if m.type == "in" else "#dc2626"
        m_dt = timezone.localtime(m.created_at) if m.created_at else None
        m_time = m_dt.strftime("%H:%M") if m_dt else ""
        note_suffix = f" ({escape(m.notes)})" if m.notes else ""
        cash_mov_rows_html += f"""
        <tr>
            <td style="font-size:9.5px;padding:1.5px 0;">{m_time} {escape(m.category)}{note_suffix}</td>
            <td style="text-align:right;font-size:9.5px;font-family:monospace;font-weight:bold;color:{color};">{sign} {dzd(m.amount)}</td>
        </tr>
        """
    if not cash_mov_rows_html:
        cash_mov_rows_html = '<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">Aucun mouvement de caisse</td></tr>'

    # 4. Stock Movements of the day (excluding standard sale deductions which are already listed in Section 2)
    stock_mov_qs = (
        StockMovement.objects.filter(tenant=tenant, timestamp__date=target_date)
        .exclude(reason=MovementReasonChoices.SALE)
        .select_related("variant__product", "branch")
        .order_by("timestamp")
    )
    if branch:
        stock_mov_qs = stock_mov_qs.filter(branch=branch)

    stock_mov_list = list(stock_mov_qs[:60])
    reason_labels = dict(MovementReasonChoices.choices)
    stock_mov_rows_html = ""
    for sm in stock_mov_list:
        sm_dt = timezone.localtime(sm.timestamp) if sm.timestamp else None
        sm_time = sm_dt.strftime("%H:%M") if sm_dt else ""
        v = sm.variant
        p_name = v.product.name if (v and v.product) else "Article"
        if v and v.size_eu and v.size_eu > 0:
            p_name += f" EU{v.size_eu}"
        sign = "+" if sm.quantity_delta > 0 else ""
        r_label = str(reason_labels.get(sm.reason, sm.reason))
        stock_mov_rows_html += f"""
        <tr>
            <td style="font-size:9.5px;padding:1.5px 0;">{sm_time} {escape(p_name)} <span style="color:#555;">({escape(r_label)})</span></td>
            <td style="text-align:right;font-size:9.5px;font-family:monospace;font-weight:bold;">{sign}{sm.quantity_delta}</td>
        </tr>
        """
    if not stock_mov_rows_html:
        stock_mov_rows_html = '<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">Aucun mouvement de stock hors ventes</td></tr>'

    net_cash_day = cash_sales + total_cash_in - total_cash_out - refunds_cash

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="color-scheme" content="light">
    <title>Rapport Détaillé du Jour — {date_str}</title>
    <style>
        :root {{ color-scheme: light !important; }}
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        html, body {{
            margin: 0;
            padding: 0;
            background: #ffffff !important;
            color: #000000 !important;
            color-scheme: light !important;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Courier New", monospace;
            width: 72mm;
            max-width: 80mm;
            margin: 0;
            padding: 3mm 2mm;
            color: #000;
            font-size: 11px;
            line-height: 1.35;
        }}
        @page {{
            margin: 0;
        }}
        @media print {{
            @page {{ margin: 0; }}
            body {{
                margin: 0;
                padding: 2mm 1mm;
                width: 72mm;
                max-width: 80mm;
            }}
        }}
        .header {{ text-align: center; margin-bottom: 8px; }}
        .store-name {{ font-size: 16px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; }}
        .report-badge {{
            display: inline-block;
            margin-top: 4px;
            padding: 2px 6px;
            font-size: 11.5px;
            font-weight: 800;
            border: 1.5pt solid #000;
            border-radius: 3px;
            letter-spacing: 0.4px;
        }}
        .divider {{ border-top: 1px dashed #000; margin: 6px 0; }}
        .double-divider {{ border-top: 2px solid #000; margin: 8px 0; }}
        .info-grid {{ font-size: 10.5px; margin-bottom: 6px; }}
        .info-row {{ display: flex; justify-content: space-between; margin-bottom: 2px; }}
        .section-title {{
            font-size: 10.5px;
            font-weight: 800;
            text-transform: uppercase;
            margin: 6px 0 3px 0;
            background: #f0f0f0;
            padding: 2px 4px;
        }}
        .data-table {{ width: 100%; border-collapse: collapse; font-size: 10.5px; }}
        .data-table td {{ padding: 2px 0; }}
        .text-right {{ text-align: right; }}
        .font-bold {{ font-weight: 700; }}
        .font-mono {{ font-family: monospace; }}
        .highlight-row td {{ font-weight: 700; padding-top: 3px; padding-bottom: 3px; }}
        .footer {{ text-align: center; font-size: 9px; margin-top: 15px; color: #555; }}
    </style>
</head>
<body>
    <div class="header">
        <div class="store-name">{escape(store_name)}</div>
        <div class="report-badge">RAPPORT DÉTAILLÉ DU JOUR</div>
    </div>

    <div class="info-grid">
        <div class="info-row"><span>Date du rapport :</span><strong>{date_str}</strong></div>
        <div class="info-row"><span>Agence / Caisse :</span><span>{escape(branch_name)}</span></div>
        <div class="info-row"><span>Édité par :</span><span>{escape(editor_name)}</span></div>
        <div class="info-row"><span>Heure d'édition :</span><span>{now_local.strftime("%d/%m/%Y %H:%M")}</span></div>
    </div>

    <div class="double-divider"></div>
    <div class="section-title">1. SYNTHÈSE DES VENTES & RÈGLEMENTS</div>
    <table class="data-table">
        <tr>
            <td>Tickets actifs (Complétés: {completed_count}) :</td>
            <td class="text-right font-bold">{len(active_sales)}</td>
        </tr>
        {f'<tr><td>Versements / Réservations :</td><td class="text-right">{partial_count} / {layaway_count}</td></tr>' if (partial_count or layaway_count) else ''}
        {f'<tr><td>Tickets annulés :</td><td class="text-right">{cancelled_count}</td></tr>' if cancelled_count else ''}
        <tr>
            <td>Articles vendus (paires) :</td>
            <td class="text-right font-bold">{total_items_sold}</td>
        </tr>
        <tr>
            <td>Espèces (Cash) :</td>
            <td class="text-right font-mono font-bold">{dzd(cash_sales)}</td>
        </tr>
        <tr>
            <td>TPE (CIB / Edahabia) :</td>
            <td class="text-right font-mono">{dzd(tpe_sales)}</td>
        </tr>
        <tr>
            <td>BaridiMob :</td>
            <td class="text-right font-mono">{dzd(baridimob_sales)}</td>
        </tr>
        <tr>
            <td>Chèques :</td>
            <td class="text-right font-mono">{dzd(cheque_sales)}</td>
        </tr>
        <tr>
            <td>Virement / CCP :</td>
            <td class="text-right font-mono">{dzd(virement_sales + ccp_sales)}</td>
        </tr>
        <tr>
            <td>À Crédit (Compte) :</td>
            <td class="text-right font-mono">{dzd(account_sales)}</td>
        </tr>
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td><strong>CHIFFRE D'AFFAIRES :</strong></td>
            <td class="text-right font-mono font-bold">{dzd(total_sales_amount)}</td>
        </tr>
        <tr>
            <td>Total encaissé :</td>
            <td class="text-right font-mono font-bold">{dzd(total_collected)}</td>
        </tr>
        {f'<tr><td>Reste à encaisser (crédits) :</td><td class="text-right font-mono">{dzd(total_balance_due)}</td></tr>' if total_balance_due > Decimal("0.00") else ''}
    </table>

    <div class="divider"></div>
    <div class="section-title">2. DÉTAIL DES VENTES ({len(sales_list)})</div>
    {sales_blocks_html}

    <div class="divider"></div>
    <div class="section-title">3. RETOURS & REMBOURSEMENTS ({refunds_count})</div>
    <table class="data-table">
        {returns_rows_html}
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td>Total remboursé :</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(refunds_amount)}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">4. MOUVEMENTS DE CAISSE ({len(cash_mov_list)})</div>
    <table class="data-table">
        {cash_mov_rows_html}
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td>Total Apports (+) :</td>
            <td class="text-right font-mono" style="color:#16a34a;">+ {dzd(total_cash_in)}</td>
        </tr>
        <tr class="highlight-row">
            <td>Total Dépenses (-) :</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(total_cash_out)}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">5. MOUVEMENTS DE STOCK HORS VENTES</div>
    <table class="data-table">
        {stock_mov_rows_html}
    </table>

    <div class="double-divider"></div>
    <div class="section-title">6. BILAN NET ESPÈCES JOURNÉE</div>
    <table class="data-table">
        <tr>
            <td>+ Encaissements espèces :</td>
            <td class="text-right font-mono">{dzd(cash_sales)}</td>
        </tr>
        <tr>
            <td>+ Apports caisse :</td>
            <td class="text-right font-mono">+ {dzd(total_cash_in)}</td>
        </tr>
        <tr>
            <td>- Dépenses caisse :</td>
            <td class="text-right font-mono">- {dzd(total_cash_out)}</td>
        </tr>
        <tr>
            <td>- Remboursements espèces :</td>
            <td class="text-right font-mono">- {dzd(refunds_cash)}</td>
        </tr>
        <tr class="highlight-row" style="border-top:1.5pt solid #000;font-size:11.5px;">
            <td><strong>NET ESPÈCES DU JOUR :</strong></td>
            <td class="text-right font-mono font-bold">{dzd(net_cash_day)}</td>
        </tr>
    </table>

    <div class="footer">
        Pointure / ShoeDZ POS &bull; Rapport Journalier Détaillé
    </div>
</body>
</html>"""
