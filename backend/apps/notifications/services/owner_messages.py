"""
Read-only Telegram texts for the owner.

The project has no compiled gettext catalogs, so French, Arabic and English
live in this table. Builders are pure: they only format the dict they receive.
"""
from decimal import Decimal

CATALOG = {
    "fr": {
        "shift_title": "Clôture de caisse",
        "cashier": "Caissier : %(name)s",
        "branch": "Agence : %(name)s",
        "sales": "Ventes : %(count)s · %(total)s",
        "payments": "Paiements : %(methods)s",
        "expected": "Espèces attendues : %(amount)s",
        "counted": "Espèces comptées : %(amount)s",
        "gap": "Écart : %(amount)s",
        "refunds": "Retours : %(count)s · %(amount)s",
        "overrides": "Remises approuvées : %(lines)s",
        "no_overrides": "Aucune remise approuvée par PIN.",
        "gap_alert": "Alerte écart de caisse : %(amount)s (seuil %(threshold)s). Caissier %(cashier)s.",
        "cancel_alert": "Vente annulée %(receipt)s · %(amount)s.",
        "refund_alert": "Remboursement %(receipt)s · %(amount)s.",
        "discount_alert": "Remise %(pct)s%% approuvée par %(approver)s sur %(receipt)s.",
        "digest_title": "Résumé du %(day)s",
        "today": "Aujourd'hui : %(count)s ventes · %(total)s",
        "last_week": "Même jour la semaine dernière : %(count)s ventes · %(total)s",
        "top": "Top modèles : %(lines)s",
        "low_stock": "Stock bas : %(count)s articles",
        "cheques": "Chèques à encaisser demain : %(count)s",
        "overdue": "Créances en retard : %(amount)s",
        "layaways": "Mises de côté qui expirent : %(count)s",
        "year_alert": "L'exercice %(year)s n'est pas clôturé.",
        "backup_alert": "La sauvegarde externe a plus de 3 jours.",
        "none": "aucun",
    },
    "ar": {
        "shift_title": "إغلاق الصندوق",
        "cashier": "أمين الصندوق : %(name)s",
        "branch": "الفرع : %(name)s",
        "sales": "المبيعات : %(count)s · %(total)s",
        "payments": "المدفوعات : %(methods)s",
        "expected": "النقد المتوقع : %(amount)s",
        "counted": "النقد المعدود : %(amount)s",
        "gap": "الفارق : %(amount)s",
        "refunds": "المرتجعات : %(count)s · %(amount)s",
        "overrides": "خصومات بموافقة : %(lines)s",
        "no_overrides": "لا توجد خصومات وافق عليها رمز المدير.",
        "gap_alert": "تنبيه فارق الصندوق : %(amount)s (الحد %(threshold)s). أمين الصندوق %(cashier)s.",
        "cancel_alert": "أُلغيت البيعة %(receipt)s · %(amount)s.",
        "refund_alert": "استرجاع %(receipt)s · %(amount)s.",
        "discount_alert": "خصم %(pct)s%% وافق عليه %(approver)s على %(receipt)s.",
        "digest_title": "ملخص %(day)s",
        "today": "اليوم : %(count)s مبيعات · %(total)s",
        "last_week": "نفس اليوم من الأسبوع الماضي : %(count)s مبيعات · %(total)s",
        "top": "أكثر الموديلات : %(lines)s",
        "low_stock": "مخزون منخفض : %(count)s",
        "cheques": "شيكات تستحق غداً : %(count)s",
        "overdue": "ديون متأخرة : %(amount)s",
        "layaways": "حجوزات تنتهي : %(count)s",
        "year_alert": "السنة المالية %(year)s غير مغلقة.",
        "backup_alert": "النسخة الخارجية أقدم من 3 أيام.",
        "none": "لا شيء",
    },
    "en": {
        "shift_title": "Shift closed",
        "cashier": "Cashier: %(name)s",
        "branch": "Branch: %(name)s",
        "sales": "Sales: %(count)s · %(total)s",
        "payments": "Payments: %(methods)s",
        "expected": "Expected cash: %(amount)s",
        "counted": "Counted cash: %(amount)s",
        "gap": "Gap: %(amount)s",
        "refunds": "Returns: %(count)s · %(amount)s",
        "overrides": "PIN-approved discounts: %(lines)s",
        "no_overrides": "No PIN-approved discounts.",
        "gap_alert": "Cash gap alert: %(amount)s (threshold %(threshold)s). Cashier %(cashier)s.",
        "cancel_alert": "Sale cancelled %(receipt)s · %(amount)s.",
        "refund_alert": "Refund %(receipt)s · %(amount)s.",
        "discount_alert": "Discount %(pct)s%% approved by %(approver)s on %(receipt)s.",
        "digest_title": "Digest for %(day)s",
        "today": "Today: %(count)s sales · %(total)s",
        "last_week": "Same weekday last week: %(count)s sales · %(total)s",
        "top": "Top models: %(lines)s",
        "low_stock": "Low stock: %(count)s items",
        "cheques": "Cheques due tomorrow: %(count)s",
        "overdue": "Overdue client balance: %(amount)s",
        "layaways": "Layaways expiring: %(count)s",
        "year_alert": "Fiscal year %(year)s is not closed.",
        "backup_alert": "The external backup is older than 3 days.",
        "none": "none",
    },
}

METHOD_LABELS = {
    "fr": {
        "cash": "espèces", "tpe": "TPE", "baridimob": "BaridiMob",
        "cheque": "chèque", "ccp": "CCP", "virement": "virement", "account": "compte",
    },
    "ar": {
        "cash": "نقداً", "tpe": "بطاقة", "baridimob": "بريدي موب",
        "cheque": "شيك", "ccp": "CCP", "virement": "تحويل", "account": "حساب",
    },
    "en": {
        "cash": "cash", "tpe": "card", "baridimob": "BaridiMob",
        "cheque": "cheque", "ccp": "CCP", "virement": "transfer", "account": "account",
    },
}


def _lang(lang: str) -> str:
    if lang in CATALOG:
        return lang
    return "fr"


def _line(lang: str, key: str, **values) -> str:
    return CATALOG[_lang(lang)][key] % values


def money(value) -> str:
    amount = Decimal(value or 0).quantize(Decimal("0.01"))
    return f"{amount} DZD"


def build_shift_close_message(data: dict, lang: str) -> str:
    methods = METHOD_LABELS[_lang(lang)]
    parts = []
    for key in ("cash", "tpe", "baridimob", "cheque", "ccp", "virement", "account"):
        amount = Decimal(data.get("payments", {}).get(key) or 0)
        if amount:
            parts.append(f"{methods[key]} {money(amount)}")
    payment_text = ", ".join(parts) if parts else CATALOG[_lang(lang)]["none"]
    overrides = data.get("overrides") or []
    if overrides:
        rendered = "; ".join(
            f"{row['receipt']} {money(row['discount'])} ({row['approver']})"
            for row in overrides
        )
        override_line = _line(lang, "overrides", lines=rendered)
    else:
        override_line = CATALOG[_lang(lang)]["no_overrides"]
    return "\n".join([
        CATALOG[_lang(lang)]["shift_title"],
        _line(lang, "cashier", name=data.get("cashier") or "—"),
        _line(lang, "branch", name=data.get("branch") or "—"),
        _line(lang, "sales", count=data.get("sales_count") or 0, total=money(data.get("total_sales"))),
        _line(lang, "payments", methods=payment_text),
        _line(lang, "expected", amount=money(data.get("expected_cash"))),
        _line(lang, "counted", amount=money(data.get("counted_cash"))),
        _line(lang, "gap", amount=money(data.get("gap"))),
        _line(lang, "refunds", count=data.get("refunds_count") or 0, amount=money(data.get("refunds_amount"))),
        override_line,
    ])


def build_gap_alert(data: dict, lang: str) -> str:
    return _line(
        lang, "gap_alert",
        amount=money(data["gap"]),
        threshold=money(data["threshold"]),
        cashier=data.get("cashier") or "—",
    )


def build_cancel_alert(data: dict, lang: str) -> str:
    return _line(lang, "cancel_alert", receipt=data.get("receipt") or "—", amount=money(data.get("amount")))


def build_refund_alert(data: dict, lang: str) -> str:
    return _line(lang, "refund_alert", receipt=data.get("receipt") or "—", amount=money(data.get("amount")))


def build_discount_alert(data: dict, lang: str) -> str:
    return _line(
        lang, "discount_alert",
        pct=data.get("pct") or "0",
        approver=data.get("approver") or "—",
        receipt=data.get("receipt") or "—",
    )


def build_digest_message(data: dict, lang: str) -> str:
    top = data.get("top_models") or []
    top_text = ", ".join(f"{row['name']} ({row['qty']})" for row in top) or CATALOG[_lang(lang)]["none"]
    return "\n".join([
        _line(lang, "digest_title", day=data.get("day") or ""),
        _line(lang, "today", count=data.get("sales_count") or 0, total=money(data.get("total"))),
        _line(lang, "last_week", count=data.get("last_week_count") or 0, total=money(data.get("last_week_total"))),
        _line(lang, "top", lines=top_text),
        _line(lang, "low_stock", count=data.get("low_stock") or 0),
        _line(lang, "cheques", count=data.get("cheques_due") or 0),
        _line(lang, "overdue", amount=money(data.get("overdue"))),
        _line(lang, "layaways", count=data.get("layaways") or 0),
    ])


def build_year_alert(year: int, lang: str) -> str:
    return _line(lang, "year_alert", year=year)


def build_backup_alert(lang: str) -> str:
    return CATALOG[_lang(lang)]["backup_alert"]
