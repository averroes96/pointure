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

    sales_qs = session.sales.filter(status__in=["completed", "partially_paid"])
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
    <title>{report_type} — {z_number}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Courier New", monospace;
            width: 76mm;
            margin: 0 auto;
            padding: 4mm 2mm;
            color: #000;
            background: #fff;
            font-size: 11px;
            line-height: 1.35;
        }}
        @page {{ size: 80mm auto; margin: 0mm; }}
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
