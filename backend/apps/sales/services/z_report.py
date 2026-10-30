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


Z_REPORT_TRANSLATIONS = {
    "fr": {
        "report_z": "RAPPORT Z (CLÔTURE CAISSE)",
        "report_x": "RAPPORT X (LECTURE FLASH)",
        "session_no": "N° Session :",
        "branch": "Agence / Caisse :",
        "default_branch": "Caisse Principale",
        "all_branches": "Toutes les agences",
        "cashier": "Caissier :",
        "opened_at": "Ouverture :",
        "closed_at": "Clôture :",
        "in_progress": "En cours",
        "opening_float": "Fond de caisse :",
        "sec1_sales": "1. VENTES PAR MODE DE RÈGLEMENT",
        "tickets_count": "Tickets émis :",
        "method_cash": "Espèces (Cash) :",
        "method_tpe": "TPE (CIB / Edahabia) :",
        "method_baridimob": "BaridiMob :",
        "method_cheque": "Chèques :",
        "method_transfer": "Virement / CCP :",
        "method_account": "À Crédit (Compte) :",
        "total_sales": "TOTAL VENTES :",
        "sec2_returns": "2. RETOURS & REMBOURSEMENTS",
        "returns_count": "Nombre de retours :",
        "total_refunded": "Total remboursé :",
        "no_returns": "Aucun retour sur cette journée",
        "sec3_movements": "3. ENTRÉES & DÉPENSES CAISSE",
        "no_movements": "Aucun mouvement de caisse",
        "total_cash_in": "Total Apports (+) :",
        "total_cash_out": "Total Dépenses (-) :",
        "sec4_drawer": "4. SITUATION DU TIROIR-CAISSE",
        "theoretical_cash": "Caisse théorique :",
        "sec5_closing": "5. COMPTAGE & ÉCART DU TIROIR",
        "initial_float": "Fond initial :",
        "plus_cash_sales": "+ Ventes espèces :",
        "plus_cash_in": "+ Apports caisse :",
        "minus_cash_out": "- Dépenses caisse :",
        "minus_refunds": "- Remboursements :",
        "theoretical_cash_bold": "CAISSE THÉORIQUE :",
        "counted_cash": "ESPÈCES COMPTÉES :",
        "discrepancy": "ÉCART",
        "gap_surplus": "EXCÉDENT",
        "gap_deficit": "DÉFICIT",
        "gap_exact": "CONFORME (0)",
        "cashier_signature": "Signature Caissier",
        "manager_signature": "Signature Gérant",
        "footer": "Pointure / ShoeDZ POS • Logiciel de Gestion Commerciale",
        # Daily detailed report
        "daily_title": "RAPPORT DÉTAILLÉ DU JOUR",
        "report_date": "Date du rapport :",
        "edited_by": "Édité par :",
        "edited_at": "Heure d'édition :",
        "daily_sec1": "1. SYNTHÈSE DES VENTES & RÈGLEMENTS",
        "active_tickets": "Tickets actifs (Complétés : {completed}) :",
        "layaways_partial": "Versements / Réservations :",
        "cancelled_tickets": "Tickets annulés :",
        "pairs_sold": "Articles vendus (paires) :",
        "turnover": "CHIFFRE D'AFFAIRES :",
        "total_collected": "Total encaissé :",
        "balance_due": "Reste à encaisser (crédits) :",
        "daily_sec2": "2. DÉTAIL DES VENTES ({count})",
        "no_sales": "Aucune vente enregistrée sur cette journée.",
        "client_counter": "Comptoir",
        "ticket_total": "TOTAL TICKET :",
        "paid_label": "Payé :",
        "rest_label": "Reste :",
        "daily_sec3": "3. RETOURS & REMBOURSEMENTS ({count})",
        "daily_sec4": "4. MOUVEMENTS DE CAISSE ({count})",
        "daily_sec5": "5. MOUVEMENTS DE STOCK HORS VENTES",
        "no_stock_mov": "Aucun mouvement de stock hors ventes",
        "daily_sec6": "6. BILAN NET ESPÈCES JOURNÉE",
        "plus_cash_collected": "+ Encaissements espèces :",
        "minus_cash_refunds": "- Remboursements espèces :",
        "net_cash_day": "NET ESPÈCES DU JOUR :",
        "daily_footer": "Pointure / ShoeDZ POS • Rapport Journalier Détaillé",
        "currency": "DZD",
    },
    "ar": {
        "report_z": "تقرير Z (إغلاق الصندوق)",
        "report_x": "تقرير X (قراءة فورية)",
        "session_no": "رقم الجلسة :",
        "branch": "الفرع / نقطة البيع :",
        "default_branch": "الصندوق الرئيسي",
        "all_branches": "جميع الفروع",
        "cashier": "أمين الصندوق :",
        "opened_at": "وقت الفتح :",
        "closed_at": "وقت الإغلاق :",
        "in_progress": "جارية",
        "opening_float": "رصيد الافتتاح :",
        "sec1_sales": "1. المبيعات حسب طريقة الدفع",
        "tickets_count": "عدد الوصلات :",
        "method_cash": "نقداً (كاش) :",
        "method_tpe": "الدفع الإلكتروني (CIB / الذهبية) :",
        "method_baridimob": "بريدي موب :",
        "method_cheque": "شيكات :",
        "method_transfer": "تحويل بنكي / بريدي :",
        "method_account": "بالأجل (على الحساب) :",
        "total_sales": "إجمالي المبيعات :",
        "sec2_returns": "2. المرتجعات واسترداد الأموال",
        "returns_count": "عدد المرتجعات :",
        "total_refunded": "إجمالي المبالغ المستردة :",
        "no_returns": "لا توجد أي مرتجعات لهذا اليوم",
        "sec3_movements": "3. مقبوضات ومصروفات الصندوق",
        "no_movements": "لا توجد حركات في الصندوق",
        "total_cash_in": "إجمالي المقبوضات (+) :",
        "total_cash_out": "إجمالي المصروفات (-) :",
        "sec4_drawer": "4. وضعية درج الصندوق",
        "theoretical_cash": "الرصيد النظري المتوقع :",
        "sec5_closing": "5. الجرد وفارق الصندوق",
        "initial_float": "رصيد الافتتاح :",
        "plus_cash_sales": "+ مبيعات نقداً :",
        "plus_cash_in": "+ مقبوضات إضافية :",
        "minus_cash_out": "- مصروفات نقدية :",
        "minus_refunds": "- مبالغ مستردة :",
        "theoretical_cash_bold": "الرصيد النظري في الدرج :",
        "counted_cash": "المبلغ الفعلي المحسوب :",
        "discrepancy": "الفارق",
        "gap_surplus": "فائض",
        "gap_deficit": "عجز",
        "gap_exact": "مطابق (0)",
        "cashier_signature": "توقيع أمين الصندوق",
        "manager_signature": "توقيع المدير",
        "footer": "ShoeDZ POS • برنامج إدارة مبيعات الأحذية ونقاط البيع",
        # Daily detailed report
        "daily_title": "التقرير اليومي المفصل",
        "report_date": "تاريخ التقرير :",
        "edited_by": "طُبع بواسطة :",
        "edited_at": "وقت الطباعة :",
        "daily_sec1": "1. ملخص المبيعات والمقبوضات",
        "active_tickets": "الوصلات النشطة (المكتملة : {completed}) :",
        "layaways_partial": "أقساط / حجوزات :",
        "cancelled_tickets": "وصلات ملغاة :",
        "pairs_sold": "الأحذية المباعة (أزواج) :",
        "turnover": "إجمالي المبيعات :",
        "total_collected": "إجمالي المقبوض :",
        "balance_due": "المتبقي بالأجل :",
        "daily_sec2": "2. تفاصيل الوصلات ({count})",
        "no_sales": "لا توجد مبيعات مسجلة في هذا اليوم.",
        "client_counter": "زبون عادي (شباك)",
        "ticket_total": "مجموع الوصل :",
        "paid_label": "المدفوع :",
        "rest_label": "المتبقي :",
        "daily_sec3": "3. المرتجعات واسترداد الأموال ({count})",
        "daily_sec4": "4. حركات الصندوق ({count})",
        "daily_sec5": "5. حركات المخزون غير البيعية",
        "no_stock_mov": "لا توجد حركات مخزون إضافية",
        "daily_sec6": "6. صافي الكاش النقدي لليوم",
        "plus_cash_collected": "+ المقبوضات النقدية :",
        "minus_cash_refunds": "- المرتجعات النقدية :",
        "net_cash_day": "صافي النقد المحقق لليوم :",
        "daily_footer": "ShoeDZ POS • التقرير اليومي المفصل",
        "currency": "د.ج",
    },
    "en": {
        "report_z": "Z-REPORT (DRAWER CLOSE)",
        "report_x": "X-REPORT (FLASH AUDIT)",
        "session_no": "Session No.:",
        "branch": "Branch / POS:",
        "default_branch": "Main Cashier",
        "all_branches": "All Branches",
        "cashier": "Cashier:",
        "opened_at": "Opened At:",
        "closed_at": "Closed At:",
        "in_progress": "In Progress",
        "opening_float": "Opening Float:",
        "sec1_sales": "1. SALES BY PAYMENT METHOD",
        "tickets_count": "Issued Receipts:",
        "method_cash": "Cash:",
        "method_tpe": "Card POS (CIB / Edahabia):",
        "method_baridimob": "BaridiMob:",
        "method_cheque": "Checks:",
        "method_transfer": "Bank / CCP Transfer:",
        "method_account": "On Credit (Account):",
        "total_sales": "TOTAL SALES:",
        "sec2_returns": "2. RETURNS & REFUNDS",
        "returns_count": "Return Count:",
        "total_refunded": "Total Refunded:",
        "no_returns": "No returns on this day",
        "sec3_movements": "3. CASH MOVEMENTS",
        "no_movements": "No cash movements",
        "total_cash_in": "Total Cash In (+):",
        "total_cash_out": "Total Cash Out (-):",
        "sec4_drawer": "4. CASH DRAWER STATUS",
        "theoretical_cash": "Theoretical Cash:",
        "sec5_closing": "5. COUNT & DISCREPANCY",
        "initial_float": "Initial Float:",
        "plus_cash_sales": "+ Cash Sales:",
        "plus_cash_in": "+ Cash In:",
        "minus_cash_out": "- Cash Out:",
        "minus_refunds": "- Refunds:",
        "theoretical_cash_bold": "THEORETICAL CASH:",
        "counted_cash": "COUNTED CASH:",
        "discrepancy": "DISCREPANCY",
        "gap_surplus": "SURPLUS",
        "gap_deficit": "DEFICIT",
        "gap_exact": "EXACT (0)",
        "cashier_signature": "Cashier Signature",
        "manager_signature": "Manager Signature",
        "footer": "Pointure / ShoeDZ POS • Retail Management System",
        # Daily detailed report
        "daily_title": "DETAILED DAILY REPORT",
        "report_date": "Report Date:",
        "edited_by": "Generated By:",
        "edited_at": "Generation Time:",
        "daily_sec1": "1. SALES & PAYMENTS SUMMARY",
        "active_tickets": "Active Receipts (Completed: {completed}):",
        "layaways_partial": "Installments / Layaways:",
        "cancelled_tickets": "Cancelled Receipts:",
        "pairs_sold": "Items Sold (pairs):",
        "turnover": "TOTAL REVENUE:",
        "total_collected": "Total Collected:",
        "balance_due": "Balance Due (Credit):",
        "daily_sec2": "2. SALES BREAKDOWN ({count})",
        "no_sales": "No sales recorded for this date.",
        "client_counter": "Counter Customer",
        "ticket_total": "RECEIPT TOTAL:",
        "paid_label": "Paid:",
        "rest_label": "Balance:",
        "daily_sec3": "3. RETURNS & REFUNDS ({count})",
        "daily_sec4": "4. CASH MOVEMENTS ({count})",
        "daily_sec5": "5. NON-SALE STOCK MOVEMENTS",
        "no_stock_mov": "No non-sale stock movements",
        "daily_sec6": "6. NET CASH SUMMARY",
        "plus_cash_collected": "+ Cash Receipts:",
        "minus_cash_refunds": "- Cash Refunds:",
        "net_cash_day": "NET CASH FOR THE DAY:",
        "daily_footer": "Pointure / ShoeDZ POS • Detailed Daily Report",
        "currency": "DZD",
    },
}


def render_thermal_z_report(session, is_x_report=False, stats=None, store_name="ShoeDZ", lang="fr"):
    """
    Renders an 80mm thermal receipt formatted Rapport Z (or Rapport X) in French, Arabic, or English.
    """
    norm_lang = (lang or "fr").lower()[:2]
    if norm_lang not in Z_REPORT_TRANSLATIONS:
        norm_lang = "fr"
    L = Z_REPORT_TRANSLATIONS[norm_lang]
    is_rtl = (norm_lang == "ar")

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

    report_type = L["report_x"] if is_x_report else L["report_z"]
    z_number = f"Z-{session.session_number:04d}"
    opened_str = session.opened_at.strftime("%d/%m/%Y %H:%M") if session.opened_at else "—"
    closed_str = session.closed_at.strftime("%d/%m/%Y %H:%M") if session.closed_at else L["in_progress"]
    cashier_name = session.cashier.get_full_name() or session.cashier.username if session.cashier else "—"
    branch_name = session.branch.name if session.branch else L["default_branch"]

    # Format helpers
    def dzd(val):
        num_str = f"{Decimal(val or 0):,.2f}".replace(",", " ").replace(".", ",")
        return f"{num_str} {L['currency']}"

    # Discrepancy calculation
    actual_cash = session.actual_cash if session.status == "closed" else Decimal("0.00")
    expected_cash = stats["expected_cash"]
    cash_gap = session.cash_gap if session.status == "closed" else Decimal("0.00")
    gap_label = L["gap_surplus"] if cash_gap > 0 else L["gap_deficit"] if cash_gap < 0 else L["gap_exact"]

    # Movements rows
    movements_rows = ""
    for m in stats.get("movements", []):
        sign = "+" if m["type"] == "in" else "-"
        color = "#16a34a" if m["type"] == "in" else "#dc2626"
        time_str = m["created_at"].strftime("%H:%M") if hasattr(m["created_at"], "strftime") else ""
        movements_rows += f"""
        <tr>
            <td style="font-size:10px;">{time_str} {m['category']}</td>
            <td style="text-align:end;font-size:10px;font-family:monospace;font-weight:bold;color:{color};">{sign} {dzd(m['amount'])}</td>
        </tr>
        """
    if not movements_rows:
        movements_rows = f'<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">{L["no_movements"]}</td></tr>'

    closing_details = ""
    if not is_x_report and session.status == "closed":
        closing_details = f"""
        <div class="divider"></div>
        <div class="section-title">{L["sec5_closing"]}</div>
        <table class="data-table">
            <tr>
                <td>{L["initial_float"]}</td>
                <td class="text-right">{dzd(session.opening_float)}</td>
            </tr>
            <tr>
                <td>{L["plus_cash_sales"]}</td>
                <td class="text-right">{dzd(stats['cash_sales'])}</td>
            </tr>
            <tr>
                <td>{L["plus_cash_in"]}</td>
                <td class="text-right">{dzd(stats['total_cash_in'])}</td>
            </tr>
            <tr>
                <td>{L["minus_cash_out"]}</td>
                <td class="text-right">- {dzd(stats['total_cash_out'])}</td>
            </tr>
            <tr>
                <td>{L["minus_refunds"]}</td>
                <td class="text-right">- {dzd(stats['refunds_cash'])}</td>
            </tr>
            <tr class="highlight-row">
                <td><strong>{L["theoretical_cash_bold"]}</strong></td>
                <td class="text-right font-bold">{dzd(expected_cash)}</td>
            </tr>
            <tr class="highlight-row">
                <td><strong>{L["counted_cash"]}</strong></td>
                <td class="text-right font-bold">{dzd(actual_cash)}</td>
            </tr>
            <tr style="border-top: 1.5pt solid #000; font-size:12px;">
                <td><strong>{L["discrepancy"]} ({gap_label}) :</strong></td>
                <td class="text-right font-bold" style="color: {'#dc2626' if cash_gap < 0 else '#16a34a' if cash_gap > 0 else '#000'};">
                    {('+' if cash_gap > 0 else '') + dzd(cash_gap)}
                </td>
            </tr>
        </table>
        """

    signatures_block = ""
    if not is_x_report:
        signatures_block = f"""
        <div style="margin-top:25px;display:flex;justify-content:space-between;font-size:10px;">
            <div style="border-top:1px solid #000;width:45%;padding-top:4px;text-align:center;">{L["cashier_signature"]}</div>
            <div style="border-top:1px solid #000;width:45%;padding-top:4px;text-align:center;">{L["manager_signature"]}</div>
        </div>
        """

    return f"""<!DOCTYPE html>
<html lang="{norm_lang}" dir="{'rtl' if is_rtl else 'ltr'}">
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
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Tahoma", "Courier New", monospace;
            width: 72mm;
            max-width: 80mm;
            margin: 0;
            padding: 3mm 2mm;
            color: #000;
            font-size: 11px;
            line-height: 1.35;
            direction: {'rtl' if is_rtl else 'ltr'};
            text-align: {'right' if is_rtl else 'left'};
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
        .text-right {{ text-align: end; }}
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
        <div class="info-row"><span>{L['session_no']}</span><strong>{z_number}</strong></div>
        <div class="info-row"><span>{L['branch']}</span><span>{branch_name}</span></div>
        <div class="info-row"><span>{L['cashier']}</span><span>{cashier_name}</span></div>
        <div class="info-row"><span>{L['opened_at']}</span><span>{opened_str}</span></div>
        <div class="info-row"><span>{L['closed_at']}</span><span>{closed_str}</span></div>
        <div class="info-row"><span>{L['opening_float']}</span><strong>{dzd(session.opening_float)}</strong></div>
    </div>

    <div class="double-divider"></div>
    <div class="section-title">{L['sec1_sales']}</div>
    <table class="data-table">
        <tr>
            <td>{L['tickets_count']}</td>
            <td class="text-right font-bold">{stats['sales_count']}</td>
        </tr>
        <tr>
            <td>{L['method_cash']}</td>
            <td class="text-right font-mono font-bold">{dzd(stats['cash_sales'])}</td>
        </tr>
        <tr>
            <td>{L['method_tpe']}</td>
            <td class="text-right font-mono">{dzd(stats['tpe_sales'])}</td>
        </tr>
        <tr>
            <td>{L['method_baridimob']}</td>
            <td class="text-right font-mono">{dzd(stats['baridimob_sales'])}</td>
        </tr>
        <tr>
            <td>{L['method_cheque']}</td>
            <td class="text-right font-mono">{dzd(stats['cheque_sales'])}</td>
        </tr>
        <tr>
            <td>{L['method_transfer']}</td>
            <td class="text-right font-mono">{dzd(stats['virement_sales'] + stats['ccp_sales'])}</td>
        </tr>
        <tr>
            <td>{L['method_account']}</td>
            <td class="text-right font-mono">{dzd(stats['account_sales'])}</td>
        </tr>
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td><strong>{L['total_sales']}</strong></td>
            <td class="text-right font-mono font-bold">{dzd(stats['total_sales'])}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">{L['sec2_returns']}</div>
    <table class="data-table">
        <tr>
            <td>{L['returns_count']}</td>
            <td class="text-right">{stats['refunds_count']}</td>
        </tr>
        <tr>
            <td>{L['total_refunded']}</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(stats['refunds_amount'])}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">{L['sec3_movements']}</div>
    <table class="data-table">
        {movements_rows}
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td>{L['total_cash_in']}</td>
            <td class="text-right font-mono" style="color:#16a34a;">+ {dzd(stats['total_cash_in'])}</td>
        </tr>
        <tr class="highlight-row">
            <td>{L['total_cash_out']}</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(stats['total_cash_out'])}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">{L['sec4_drawer']}</div>
    <table class="data-table">
        <tr>
            <td>{L['theoretical_cash']}</td>
            <td class="text-right font-mono font-bold">{dzd(expected_cash)}</td>
        </tr>
    </table>

    {closing_details}

    {signatures_block}

    <div class="footer">
        {L['footer']}
    </div>
</body>
</html>"""


def render_daily_detailed_report(tenant, target_date, branch=None, user=None, lang="fr"):
    """
    Renders an 80mm thermal receipt formatted Detailed Daily Sales & Movements Report
    (Rapport Détaillé du Jour) in French, Arabic, or English.
    """
    from html import escape
    from apps.sales.models import Sale, Payment, Return, CashMovement
    from apps.inventory.models import StockMovement, MovementReasonChoices

    norm_lang = (lang or "fr").lower()[:2]
    if norm_lang not in Z_REPORT_TRANSLATIONS:
        norm_lang = "fr"
    L = Z_REPORT_TRANSLATIONS[norm_lang]
    is_rtl = (norm_lang == "ar")

    store_name = getattr(tenant, "name", None) or "ShoeDZ"
    branch_name = branch.name if branch else L["all_branches"]
    editor_name = (user.get_full_name() or user.email) if user and getattr(user, "is_authenticated", False) else "—"
    now_local = timezone.localtime(timezone.now())
    date_str = target_date.strftime("%d/%m/%Y")

    def dzd(val):
        num_str = f"{Decimal(val or 0):,.2f}".replace(",", " ").replace(".", ",")
        return f"{num_str} {L['currency']}"

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

    methods_dict_lang = {
        "fr": {
            "cash": "Espèces",
            "tpe": "TPE",
            "baridimob": "BaridiMob",
            "cheque": "Chèque",
            "ccp": "CCP",
            "virement": "Virement",
            "account": "Crédit",
        },
        "ar": {
            "cash": "نقداً",
            "tpe": "الدفع الإلكتروني",
            "baridimob": "بريدي موب",
            "cheque": "شيك",
            "ccp": "حساب بريدي",
            "virement": "تحويل بنكي",
            "account": "آجل / على الحساب",
        },
        "en": {
            "cash": "Cash",
            "tpe": "Card POS",
            "baridimob": "BaridiMob",
            "cheque": "Check",
            "ccp": "CCP",
            "virement": "Bank Transfer",
            "account": "Credit",
        },
    }
    method_labels = methods_dict_lang.get(norm_lang, methods_dict_lang["fr"])

    statuses_dict_lang = {
        "fr": {
            "completed": "Complétée",
            "partially_paid": "Versement",
            "layaway": "Réservation",
            "cancelled": "Annulée",
            "refunded": "Remboursée",
        },
        "ar": {
            "completed": "مكتملة",
            "partially_paid": "دفعة جزئية",
            "layaway": "حجز بضاعة",
            "cancelled": "ملغاة",
            "refunded": "مستردة",
        },
        "en": {
            "completed": "Completed",
            "partially_paid": "Installment",
            "layaway": "Layaway",
            "cancelled": "Cancelled",
            "refunded": "Refunded",
        },
    }
    status_labels = statuses_dict_lang.get(norm_lang, statuses_dict_lang["fr"])

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
        cl_name = s.client.name if s.client else L["client_counter"]
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
                <td style="padding:1px 0;text-align:end;font-size:9.5px;font-family:monospace;">{dzd(it.subtotal)}</td>
            </tr>
            """

        paid_amt = sum((p.amount for p in s.payments.all()), Decimal("0.00"))
        rem_amt = max(Decimal("0.00"), (s.total_amount or Decimal("0.00")) - paid_amt)
        balance_line = ""
        if s.status in ("partially_paid", "layaway") and rem_amt > Decimal("0.00"):
            balance_line = f"""
            <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#b45309;">
                <span>{L['paid_label']} {dzd(paid_amt)}</span>
                <span><strong>{L['rest_label']} {dzd(rem_amt)}</strong></span>
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
                <span>{L['cashier']} {escape(c_name)} | {escape(cl_name)}</span>
                <span>{escape(methods_str)}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
                {items_rows}
            </table>
            <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:800;margin-top:2px;">
                <span>{L['ticket_total']}</span>
                <span style="font-family:monospace;">{dzd(s.total_amount)}</span>
            </div>
            {balance_line}
        </div>
        """

    if not sales_blocks_html:
        sales_blocks_html = f'<div style="font-size:10px;color:#777;font-style:italic;padding:4px 0;">{L["no_sales"]}</div>'

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
            <td style="text-align:end;font-size:9.5px;font-family:monospace;font-weight:bold;color:#dc2626;">- {dzd(r.refund_amount)}</td>
        </tr>
        """
    if not returns_rows_html:
        returns_rows_html = f'<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">{L["no_returns"]}</td></tr>'

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
            <td style="text-align:end;font-size:9.5px;font-family:monospace;font-weight:bold;color:{color};">{sign} {dzd(m.amount)}</td>
        </tr>
        """
    if not cash_mov_rows_html:
        cash_mov_rows_html = f'<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">{L["no_movements"]}</td></tr>'

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
    reason_labels_dict = {
        "fr": dict(MovementReasonChoices.choices),
        "ar": {
            "sale": "بيع",
            "purchase": "شراء",
            "reception": "استلام طلبية",
            "adjustment": "تسوية جرد",
            "defect": "منتج معيب / تالف",
            "transfer_in": "تحويل وارد",
            "transfer_out": "تحويل صادر",
            "customer_return": "إرجاع زبون",
            "supplier_return": "إرجاع للمورد",
        },
        "en": {
            "sale": "Sale",
            "purchase": "Purchase",
            "reception": "PO Reception",
            "adjustment": "Stocktake Adjustment",
            "defect": "Defective Footwear",
            "transfer_in": "Transfer In",
            "transfer_out": "Transfer Out",
            "customer_return": "Customer Return",
            "supplier_return": "Supplier Return",
        },
    }
    reason_labels = reason_labels_dict.get(norm_lang, reason_labels_dict["fr"])

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
            <td style="text-align:end;font-size:9.5px;font-family:monospace;font-weight:bold;">{sign}{sm.quantity_delta}</td>
        </tr>
        """
    if not stock_mov_rows_html:
        stock_mov_rows_html = f'<tr><td colspan="2" style="font-size:10px;color:#777;font-style:italic;">{L["no_stock_mov"]}</td></tr>'

    net_cash_day = cash_sales + total_cash_in - total_cash_out - refunds_cash

    return f"""<!DOCTYPE html>
<html lang="{norm_lang}" dir="{'rtl' if is_rtl else 'ltr'}">
<head>
    <meta charset="UTF-8">
    <meta name="color-scheme" content="light">
    <title>{L['daily_title']} — {date_str}</title>
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
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Tahoma", "Courier New", monospace;
            width: 72mm;
            max-width: 80mm;
            margin: 0;
            padding: 3mm 2mm;
            color: #000;
            font-size: 11px;
            line-height: 1.35;
            direction: {'rtl' if is_rtl else 'ltr'};
            text-align: {'right' if is_rtl else 'left'};
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
        .text-right {{ text-align: end; }}
        .font-bold {{ font-weight: 700; }}
        .font-mono {{ font-family: monospace; }}
        .highlight-row td {{ font-weight: 700; padding-top: 3px; padding-bottom: 3px; }}
        .footer {{ text-align: center; font-size: 9px; margin-top: 15px; color: #555; }}
    </style>
</head>
<body>
    <div class="header">
        <div class="store-name">{escape(store_name)}</div>
        <div class="report-badge">{L['daily_title']}</div>
    </div>

    <div class="info-grid">
        <div class="info-row"><span>{L['report_date']}</span><strong>{date_str}</strong></div>
        <div class="info-row"><span>{L['branch']}</span><span>{escape(branch_name)}</span></div>
        <div class="info-row"><span>{L['edited_by']}</span><span>{escape(editor_name)}</span></div>
        <div class="info-row"><span>{L['edited_at']}</span><span>{now_local.strftime("%d/%m/%Y %H:%M")}</span></div>
    </div>

    <div class="double-divider"></div>
    <div class="section-title">{L['daily_sec1']}</div>
    <table class="data-table">
        <tr>
            <td>{L['active_tickets'].format(completed=completed_count)}</td>
            <td class="text-right font-bold">{len(active_sales)}</td>
        </tr>
        {f'<tr><td>{L["layaways_partial"]}</td><td class="text-right">{partial_count} / {layaway_count}</td></tr>' if (partial_count or layaway_count) else ''}
        {f'<tr><td>{L["cancelled_tickets"]}</td><td class="text-right">{cancelled_count}</td></tr>' if cancelled_count else ''}
        <tr>
            <td>{L['pairs_sold']}</td>
            <td class="text-right font-bold">{total_items_sold}</td>
        </tr>
        <tr>
            <td>{L['method_cash']}</td>
            <td class="text-right font-mono font-bold">{dzd(cash_sales)}</td>
        </tr>
        <tr>
            <td>{L['method_tpe']}</td>
            <td class="text-right font-mono">{dzd(tpe_sales)}</td>
        </tr>
        <tr>
            <td>{L['method_baridimob']}</td>
            <td class="text-right font-mono">{dzd(baridimob_sales)}</td>
        </tr>
        <tr>
            <td>{L['method_cheque']}</td>
            <td class="text-right font-mono">{dzd(cheque_sales)}</td>
        </tr>
        <tr>
            <td>{L['method_transfer']}</td>
            <td class="text-right font-mono">{dzd(virement_sales + ccp_sales)}</td>
        </tr>
        <tr>
            <td>{L['method_account']}</td>
            <td class="text-right font-mono">{dzd(account_sales)}</td>
        </tr>
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td><strong>{L['turnover']}</strong></td>
            <td class="text-right font-mono font-bold">{dzd(total_sales_amount)}</td>
        </tr>
        <tr>
            <td>{L['total_collected']}</td>
            <td class="text-right font-mono font-bold">{dzd(total_collected)}</td>
        </tr>
        {f'<tr><td>{L["balance_due"]}</td><td class="text-right font-mono">{dzd(total_balance_due)}</td></tr>' if total_balance_due > Decimal("0.00") else ''}
    </table>

    <div class="divider"></div>
    <div class="section-title">{L['daily_sec2'].format(count=len(sales_list))}</div>
    {sales_blocks_html}

    <div class="divider"></div>
    <div class="section-title">{L['daily_sec3'].format(count=refunds_count)}</div>
    <table class="data-table">
        {returns_rows_html}
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td>{L['total_refunded']}</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(refunds_amount)}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">{L['daily_sec4'].format(count=len(cash_mov_list))}</div>
    <table class="data-table">
        {cash_mov_rows_html}
        <tr class="highlight-row" style="border-top:1px solid #000;">
            <td>{L['total_cash_in']}</td>
            <td class="text-right font-mono" style="color:#16a34a;">+ {dzd(total_cash_in)}</td>
        </tr>
        <tr class="highlight-row">
            <td>{L['total_cash_out']}</td>
            <td class="text-right font-mono" style="color:#dc2626;">- {dzd(total_cash_out)}</td>
        </tr>
    </table>

    <div class="divider"></div>
    <div class="section-title">{L['daily_sec5']}</div>
    <table class="data-table">
        {stock_mov_rows_html}
    </table>

    <div class="double-divider"></div>
    <div class="section-title">{L['daily_sec6']}</div>
    <table class="data-table">
        <tr>
            <td>{L['plus_cash_collected']}</td>
            <td class="text-right font-mono">{dzd(cash_sales)}</td>
        </tr>
        <tr>
            <td>{L['plus_cash_in']}</td>
            <td class="text-right font-mono">+ {dzd(total_cash_in)}</td>
        </tr>
        <tr>
            <td>{L['minus_cash_out']}</td>
            <td class="text-right font-mono">- {dzd(total_cash_out)}</td>
        </tr>
        <tr>
            <td>{L['minus_cash_refunds']}</td>
            <td class="text-right font-mono">- {dzd(refunds_cash)}</td>
        </tr>
        <tr class="highlight-row" style="border-top:1.5pt solid #000;font-size:11.5px;">
            <td><strong>{L['net_cash_day']}</strong></td>
            <td class="text-right font-mono font-bold">{dzd(net_cash_day)}</td>
        </tr>
    </table>

    <div class="footer">
        {L['daily_footer']}
    </div>
</body>
</html>"""
