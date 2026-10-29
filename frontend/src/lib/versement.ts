/**
 * Bon de Versement & Bon de Réservation printer — 80mm thermal receipt format.
 * Supports FR / AR (RTL) / EN / Bilingual FR+AR based on active UI or printer config.
 */
import type { Sale } from "@/types";
import { printTicket, getPrinterConfig } from "@/lib/printerConfig";
import { getEffectivePrintLang, formatPaymentMethodLabel } from "@/lib/enumLabels";
import { formatDate } from "@/lib/api";

const VERSEMENT_TEXT = {
  fr: {
    versementTitle: "BON DE VERSEMENT",
    reservationTitle: "BON DE RÉSERVATION",
    reservationBadge: "MISE DE CÔTÉ EN MAGASIN",
    receiptNo: "Reçu N°",
    refNo: "Réf N°",
    date: "Date",
    cashier: "Caissier",
    client: "Client",
    note: "Note",
    item: "Article",
    consignedItem: "Article Consigné",
    qty: "Qté",
    price: "Prix",
    total: "TOTAL",
    totalOrder: "TOTAL COMMANDE",
    paymentHeader: "── RÈGLEMENT ──",
    depositHeader: "── ACOMPTE VERSÉ ──",
    amountPaid: "Acompte versé",
    remainingBalance: "Solde restant",
    pickupBalance: "Solde au retrait",
    dueDate: "Date d'échéance",
    pickupDeadline: "DATE LIMITE DE RETRAIT",
    versementNotice: "Ce bon atteste le paiement partiel et la réservation des articles ci-dessus.",
    reservationNotice:
      "Les articles sont réservés en magasin. Passé ce délai, la réservation est susceptible d'être libérée.",
    mandatorySlip: "Présenter obligatoirement ce bon lors du retrait.",
    cashierSign: "Signature caissier",
    clientSign: "Signature client",
  },
  ar: {
    versementTitle: "وصل تسبيق (دفع جزئي)",
    reservationTitle: "وصل حجز سلع",
    reservationBadge: "محجوز في المحل",
    receiptNo: "وصل رقم",
    refNo: "مرجع رقم",
    date: "التاريخ",
    cashier: "البائع",
    client: "الزبون",
    note: "ملاحظة",
    item: "المقال",
    consignedItem: "المقال المحجوز",
    qty: "الكمية",
    price: "السعر",
    total: "المجموع",
    totalOrder: "مجموع الطلبية",
    paymentHeader: "── التسديد ──",
    depositHeader: "── العربون المدفوع ──",
    amountPaid: "المبلغ المدفوع",
    remainingBalance: "الباقي للدفع",
    pickupBalance: "الباقي عند الاستلام",
    dueDate: "تاريخ الاستحقاق",
    pickupDeadline: "آخر أجل للاستلام",
    versementNotice: "يثبت هذا الوصل الدفع الجزئي وحجز السلع المذكورة أعلاه.",
    reservationNotice: "السلع محجوزة في المحل. بعد انتهاء المهلة يمكن إلغاء الحجز.",
    mandatorySlip: "يرجى إحضار هذا الوصل عند استلام السلعة.",
    cashierSign: "توقيع البائع",
    clientSign: "توقيع الزبون",
  },
  en: {
    versementTitle: "PARTIAL PAYMENT SLIP",
    reservationTitle: "LAYAWAY / RESERVATION SLIP",
    reservationBadge: "RESERVED IN STORE",
    receiptNo: "Receipt No.",
    refNo: "Ref No.",
    date: "Date",
    cashier: "Cashier",
    client: "Customer",
    note: "Note",
    item: "Item",
    consignedItem: "Reserved Item",
    qty: "Qty",
    price: "Price",
    total: "TOTAL",
    totalOrder: "ORDER TOTAL",
    paymentHeader: "── PAYMENTS ──",
    depositHeader: "── DEPOSIT PAID ──",
    amountPaid: "Amount Paid",
    remainingBalance: "Remaining Balance",
    pickupBalance: "Balance on Pickup",
    dueDate: "Due Date",
    pickupDeadline: "PICKUP DEADLINE",
    versementNotice: "This slip confirms partial payment for the items listed above.",
    reservationNotice: "Items are reserved in store until the deadline above.",
    mandatorySlip: "Please present this slip upon pickup.",
    cashierSign: "Cashier signature",
    clientSign: "Customer signature",
  },
  bilingual: {
    versementTitle: "BON DE VERSEMENT / وصل تسبيق",
    reservationTitle: "BON DE RÉSERVATION / وصل حجز",
    reservationBadge: "MISE DE CÔTÉ / محجوز في المحل",
    receiptNo: "Reçu N° / رقم",
    refNo: "Réf N° / مرجع",
    date: "Date / التاريخ",
    cashier: "Caissier / البائع",
    client: "Client / الزبون",
    note: "Note / ملاحظة",
    item: "Article / المقال",
    consignedItem: "Article / المقال المحجوز",
    qty: "Qté",
    price: "Prix / السعر",
    total: "TOTAL / المجموع",
    totalOrder: "TOTAL / مجموع الطلبية",
    paymentHeader: "── RÈGLEMENT / التسديد ──",
    depositHeader: "── ACOMPTE / العربون ──",
    amountPaid: "Acompte / المدفوع",
    remainingBalance: "Solde restant / الباقي",
    pickupBalance: "Solde / الباقي عند الاستلام",
    dueDate: "Échéance / تاريخ الاستحقاق",
    pickupDeadline: "DATE LIMITE / آخر أجل للاستلام",
    versementNotice:
      "Ce bon atteste le paiement partiel / يثبت هذا الوصل الدفع الجزئي للسلع أعلاه.",
    reservationNotice:
      "Articles réservés en magasin jusqu'à la date limite / السلع محجوزة حتى التاريخ المحدد.",
    mandatorySlip: "Présenter ce bon au retrait / يرجى إحضار هذا الوصل عند الاستلام.",
    cashierSign: "Caissier / البائع",
    clientSign: "Client / الزبون",
  },
} as const;

export function printBonVersement(sale: Sale, storeName: string): void {
  const printLang = getEffectivePrintLang();
  const L = VERSEMENT_TEXT[printLang];
  const isRtl = printLang === "ar";
  const alignStart = isRtl ? "right" : "left";
  const alignEnd = isRtl ? "left" : "right";

  const amountPaid = Number(sale.amount_paid);
  const balanceDue = Number(sale.balance_due);
  const totalAmount = Number(sale.total_amount);

  const itemsHtml = (sale.items ?? [])
    .map(
      (item) => `
      <tr>
        <td style="padding:2px 0;font-size:11px;text-align:${alignStart};">${item.variant_str}</td>
        <td style="text-align:center;padding:2px 4px;font-size:11px;">${item.quantity}</td>
        <td style="text-align:${alignEnd};padding:2px 0;font-size:11px;">
          ${Number(item.unit_price).toLocaleString("fr-DZ")} DZD
        </td>
      </tr>`
    )
    .join("");

  const paymentsHtml = (sale.payments ?? [])
    .map(
      (p) => `
      <tr>
        <td style="font-size:11px;text-align:${alignStart};">${formatPaymentMethodLabel(p.method, printLang)}</td>
        <td style="text-align:${alignEnd};font-size:11px;">
          ${Number(p.amount).toLocaleString("fr-DZ")} DZD
        </td>
      </tr>`
    )
    .join("");

  const dueDateStr = sale.due_date ? sale.due_date : "—";

  const html = `<!DOCTYPE html>
<html lang="${isRtl ? "ar" : printLang === "en" ? "en" : "fr"}" dir="${isRtl ? "rtl" : "ltr"}">
<head>
  <meta charset="UTF-8"/>
  <title>${L.versementTitle} ${sale.receipt_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${isRtl ? "'Segoe UI', Tahoma, Arial, sans-serif" : "'Courier New', monospace"};
      width: 80mm;
      font-size: 12px;
      color: #000;
      padding: 4mm;
    }
    h1  { font-size: 15px; text-align: center; font-weight: bold; margin-bottom: 2px; }
    h2  { font-size: 13px; text-align: center; font-weight: bold; letter-spacing: 1px; margin: 4px 0; }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-weight: bold; font-size: 13px; padding-top: 4px; }
    .balance-row td { font-weight: bold; font-size: 13px; color: #c0392b; padding-top: 2px; }
    .paid-row td { font-size: 12px; padding-top: 2px; }
    .signature-box {
      border: 1px solid #000;
      height: 30px;
      margin-top: 3px;
      border-radius: 2px;
    }
    @media print {
      @page { margin: 0; }
      body { padding: 2mm; }
    }
  </style>
</head>
<body>
  <h1>${storeName}</h1>
  <div class="divider"></div>

  <h2>${L.versementTitle}</h2>

  <div class="divider"></div>

  <p class="center" style="font-size:10px;">
    ${L.receiptNo} <strong>${sale.receipt_number || `#${sale.id}`}</strong>
  </p>
  <p class="center" style="font-size:10px;">${formatDate(sale.created_at)}</p>
  <p class="center" style="font-size:10px;">${L.cashier}&nbsp;: ${sale.cashier_name || "—"}</p>
  ${sale.client_name ? `<p class="center" style="font-size:10px;">${L.client}&nbsp;: <strong>${sale.client_name}</strong></p>` : ""}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:${alignStart};font-size:10px;">${L.item}</th>
        <th style="text-align:center;font-size:10px;">${L.qty}</th>
        <th style="text-align:${alignEnd};font-size:10px;">${L.price}</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td style="text-align:${alignStart};">${L.total}</td>
      <td style="text-align:${alignEnd};">${totalAmount.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <p class="center" style="font-size:10px;font-weight:bold;letter-spacing:1px;">${L.paymentHeader}</p>
  <table style="margin-top:3px;">${paymentsHtml}</table>

  <div class="divider"></div>

  <table>
    <tr class="paid-row">
      <td style="text-align:${alignStart};">${L.amountPaid}&nbsp;:</td>
      <td style="text-align:${alignEnd};">${amountPaid.toLocaleString("fr-DZ")} DZD</td>
    </tr>
    <tr class="balance-row">
      <td style="text-align:${alignStart};">${L.remainingBalance}&nbsp;:</td>
      <td style="text-align:${alignEnd};">${balanceDue.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <p style="font-size:11px;text-align:${alignStart};">
    ${L.dueDate}&nbsp;: <strong>${dueDateStr}</strong>
  </p>

  <div class="divider"></div>

  <p style="font-size:10px;font-style:italic;text-align:center;margin:4px 0;">
    ${L.versementNotice}
  </p>

  <div class="divider"></div>

  <table style="margin-top:6px;">
    <tr>
      <td style="width:50%;font-size:10px;vertical-align:top;">
        ${L.cashierSign}&nbsp;:<br/>
        <div class="signature-box"></div>
      </td>
      <td style="width:50%;font-size:10px;vertical-align:top;padding-left:4px;">
        ${L.clientSign}&nbsp;:<br/>
        <div class="signature-box"></div>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const cfg = getPrinterConfig();
  printTicket(html, { paperWidth: cfg.ticket.paperWidth });
}

export function printBonReservation(sale: Sale, storeName: string): void {
  const printLang = getEffectivePrintLang();
  const L = VERSEMENT_TEXT[printLang];
  const isRtl = printLang === "ar";
  const alignStart = isRtl ? "right" : "left";
  const alignEnd = isRtl ? "left" : "right";

  const amountPaid = Number(sale.amount_paid);
  const balanceDue = Number(sale.balance_due);
  const totalAmount = Number(sale.total_amount);

  const itemsHtml = (sale.items ?? [])
    .map(
      (item) => `
      <tr>
        <td style="padding:2px 0;font-size:11px;text-align:${alignStart};">${item.variant_str}</td>
        <td style="text-align:center;padding:2px 4px;font-size:11px;">${item.quantity}</td>
        <td style="text-align:${alignEnd};padding:2px 0;font-size:11px;">
          ${Number(item.unit_price).toLocaleString("fr-DZ")} DZD
        </td>
      </tr>`
    )
    .join("");

  const paymentsHtml = (sale.payments ?? [])
    .map(
      (p) => `
      <tr>
        <td style="font-size:11px;text-align:${alignStart};">${formatPaymentMethodLabel(p.method, printLang)}</td>
        <td style="text-align:${alignEnd};font-size:11px;">
          ${Number(p.amount).toLocaleString("fr-DZ")} DZD
        </td>
      </tr>`
    )
    .join("");

  const expiryDateStr = sale.layaway_expires_at
    ? sale.layaway_expires_at
    : sale.due_date
      ? sale.due_date
      : "—";

  const html = `<!DOCTYPE html>
<html lang="${isRtl ? "ar" : printLang === "en" ? "en" : "fr"}" dir="${isRtl ? "rtl" : "ltr"}">
<head>
  <meta charset="UTF-8"/>
  <title>${L.reservationTitle} ${sale.receipt_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${isRtl ? "'Segoe UI', Tahoma, Arial, sans-serif" : "'Courier New', monospace"};
      width: 80mm;
      font-size: 12px;
      color: #000;
      padding: 4mm;
    }
    h1  { font-size: 15px; text-align: center; font-weight: bold; margin-bottom: 2px; }
    h2  { font-size: 13px; text-align: center; font-weight: bold; letter-spacing: 1px; margin: 4px 0; }
    .badge {
      display: inline-block;
      border: 1px solid #000;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: bold;
      text-align: center;
      margin: 2px auto;
    }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-weight: bold; font-size: 13px; padding-top: 4px; }
    .balance-row td { font-weight: bold; font-size: 13px; color: #c0392b; padding-top: 2px; }
    .paid-row td { font-size: 12px; padding-top: 2px; }
    .warning-box {
      border: 1px dashed #333;
      padding: 4px;
      margin: 6px 0;
      font-size: 10px;
      text-align: center;
    }
    .signature-box {
      border: 1px solid #000;
      height: 30px;
      margin-top: 3px;
      border-radius: 2px;
    }
    @media print {
      @page { margin: 0; }
      body { padding: 2mm; }
    }
  </style>
</head>
<body>
  <h1>${storeName}</h1>
  <div class="divider"></div>

  <h2>${L.reservationTitle}</h2>
  <div class="center"><span class="badge">${L.reservationBadge}</span></div>

  <div class="divider"></div>

  <p class="center" style="font-size:10px;">
    ${L.refNo} <strong>${sale.receipt_number || `#${sale.id}`}</strong>
  </p>
  <p class="center" style="font-size:10px;">${L.date} : ${formatDate(sale.created_at)}</p>
  <p class="center" style="font-size:10px;">${L.cashier} : ${sale.cashier_name || "—"}</p>
  ${sale.client_name ? `<p class="center" style="font-size:10px;">${L.client} : <strong>${sale.client_name}</strong></p>` : ""}
  ${sale.notes ? `<p class="center" style="font-size:10px;">${L.note} : <em>${sale.notes}</em></p>` : ""}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:${alignStart};font-size:10px;">${L.consignedItem}</th>
        <th style="text-align:center;font-size:10px;">${L.qty}</th>
        <th style="text-align:${alignEnd};font-size:10px;">${L.price}</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td style="text-align:${alignStart};">${L.totalOrder}</td>
      <td style="text-align:${alignEnd};">${totalAmount.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <p class="center" style="font-size:10px;font-weight:bold;letter-spacing:1px;">${L.depositHeader}</p>
  <table style="margin-top:3px;">${paymentsHtml}</table>

  <div class="divider"></div>

  <table>
    <tr class="paid-row">
      <td style="text-align:${alignStart};">${L.amountPaid} :</td>
      <td style="text-align:${alignEnd};">${amountPaid.toLocaleString("fr-DZ")} DZD</td>
    </tr>
    <tr class="balance-row">
      <td style="text-align:${alignStart};">${L.pickupBalance} :</td>
      <td style="text-align:${alignEnd};">${balanceDue.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <div class="warning-box">
    <strong>${L.pickupDeadline} :</strong><br/>
    <span style="font-size:12px;font-weight:bold;">${expiryDateStr}</span><br/>
    <span style="font-size:9px;">${L.reservationNotice}</span>
  </div>

  <div class="divider"></div>

  <table style="margin-top:6px;">
    <tr>
      <td style="width:50%;font-size:10px;vertical-align:top;">
        ${L.cashierSign} :<br/>
        <div class="signature-box"></div>
      </td>
      <td style="width:50%;font-size:10px;vertical-align:top;padding-left:4px;">
        ${L.clientSign} :<br/>
        <div class="signature-box"></div>
      </td>
    </tr>
  </table>

  <p class="center" style="font-size:9px;color:#555;margin-top:6px;">
    ${L.mandatorySlip}
  </p>
</body>
</html>`;

  const cfg = getPrinterConfig();
  printTicket(html, { paperWidth: cfg.ticket.paperWidth });
}
