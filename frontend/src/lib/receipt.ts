/**
 * Thermal receipt printer — shared utility used by SalesPage and SalesHistoryPage.
 *
 * Opens a lightweight popup window containing only the 80 mm / 58 mm receipt HTML
 * and triggers window.print() (or native desktop silent print) in the active
 * UI or configured print language (FR / AR / EN / Bilingual FR+AR).
 */
import { formatDate } from "@/lib/api";
import { printTicket, getPrinterConfig } from "@/lib/printerConfig";
import {
  getEffectivePrintLang,
  formatPaymentMethodLabel,
  formatLoyaltyTierLabel,
} from "@/lib/enumLabels";
import type { Sale } from "@/types";

const TIER_SYMBOLS: Record<string, string> = {
  bronze: "🥉",
  silver: "🥈",
  gold: "🥇",
};

const RECEIPT_TEXT = {
  fr: {
    formalTitle: "FACTURE SIMPLIFIÉE",
    ticketTitle: "TICKET DE CAISSE",
    receiptNo: "N°",
    cashier: "Caissier",
    client: "Client",
    item: "Article",
    qty: "Qté",
    price: "Prix",
    timbreFiscal: "Timbre Fiscal",
    discount: "Remise",
    total: "TOTAL",
    balanceDue: "Reste à payer",
    loyaltyHeader: "── FIDÉLITÉ ──",
    loyaltyStatus: "Statut",
    pointsEarned: "Points gagnés",
    pointsRedeemed: "Points rachetés",
    pointsBalance: "Solde de points",
    thankYou: "Merci de votre confiance !",
  },
  ar: {
    formalTitle: "فاتورة مبسطة",
    ticketTitle: "وصل الدفع",
    receiptNo: "رقم",
    cashier: "البائع",
    client: "الزبون",
    item: "المقال",
    qty: "الكمية",
    price: "السعر",
    timbreFiscal: "الطابع الجبائي",
    discount: "تخفيض",
    total: "المجموع",
    balanceDue: "الباقي للدفع",
    loyaltyHeader: "── برنامج الولاء ──",
    loyaltyStatus: "المستوى",
    pointsEarned: "نقاط مكتسبة",
    pointsRedeemed: "نقاط مستعملة",
    pointsBalance: "رصيد النقاط",
    thankYou: "شكراً لثقتكم وزيارتكم !",
  },
  en: {
    formalTitle: "SIMPLIFIED INVOICE",
    ticketTitle: "SALES RECEIPT",
    receiptNo: "No.",
    cashier: "Cashier",
    client: "Customer",
    item: "Item",
    qty: "Qty",
    price: "Price",
    timbreFiscal: "Stamp Duty",
    discount: "Discount",
    total: "TOTAL",
    balanceDue: "Balance Due",
    loyaltyHeader: "── LOYALTY ──",
    loyaltyStatus: "Tier",
    pointsEarned: "Points Earned",
    pointsRedeemed: "Points Redeemed",
    pointsBalance: "Points Balance",
    thankYou: "Thank you for your business!",
  },
  bilingual: {
    formalTitle: "FACTURE SIMPLIFIÉE / فاتورة مبسطة",
    ticketTitle: "TICKET DE CAISSE / وصل الدفع",
    receiptNo: "N° / رقم",
    cashier: "Caissier / البائع",
    client: "Client / الزبون",
    item: "Article / المقال",
    qty: "Qté",
    price: "Prix / السعر",
    timbreFiscal: "Timbre Fiscal / الطابع",
    discount: "Remise / تخفيض",
    total: "TOTAL / المجموع",
    balanceDue: "Reste à payer / الباقي",
    loyaltyHeader: "── FIDÉLITÉ / الولاء ──",
    loyaltyStatus: "Statut / المستوى",
    pointsEarned: "Points gagnés / مكتسبة",
    pointsRedeemed: "Points rachetés / مستعملة",
    pointsBalance: "Solde points / الرصيد",
    thankYou: "Merci de votre confiance ! / شكراً لثقتكم !",
  },
} as const;

type ReceiptSale = Sale & { points_earned?: number; points_redeemed?: number };

export function printReceipt(sale: ReceiptSale, storeName: string): void {
  const printLang = getEffectivePrintLang();
  const L = RECEIPT_TEXT[printLang];
  const isRtl = printLang === "ar";
  const alignStart = isRtl ? "right" : "left";
  const alignEnd = isRtl ? "left" : "right";

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

  let timbreRow = "";
  if (sale.timbre_fiscal && Number(sale.timbre_fiscal) > 0) {
    timbreRow = `
         <div class="divider"></div>
         <table>
           <tr>
             <td style="font-size:11px;text-align:${alignStart};">${L.timbreFiscal}&nbsp;:</td>
             <td style="text-align:${alignEnd};font-size:11px;color:#b45309;">
               + ${Number(sale.timbre_fiscal).toLocaleString("fr-DZ")} DZD
             </td>
           </tr>
         </table>`;
  }

  const discountRow =
    Number(sale.discount_amount) > 0
      ? `<div class="divider"></div>
         <table>
           <tr>
             <td style="font-size:11px;text-align:${alignStart};">${L.discount}&nbsp;:</td>
             <td style="text-align:${alignEnd};font-size:11px;">
               - ${Number(sale.discount_amount).toLocaleString("fr-DZ")} DZD
             </td>
           </tr>
         </table>`
      : "";

  const balanceRow =
    Number(sale.balance_due) > 0
      ? `<div class="divider"></div>
         <p style="font-size:11px;font-weight:bold;color:#c0392b;text-align:${alignStart};">
           ${L.balanceDue}&nbsp;: ${Number(sale.balance_due).toLocaleString("fr-DZ")} DZD
         </p>`
      : "";

  const clientRow = sale.client_name
    ? `<p class="center" style="font-size:10px;">${L.client}&nbsp;: <strong>${sale.client_name}</strong></p>`
    : "";

  // Loyalty section — only when the client has an account
  let loyaltyHtml = "";
  if (sale.loyalty_tier && sale.loyalty_points != null) {
    const tierSymbol = TIER_SYMBOLS[sale.loyalty_tier] ?? "";
    const tierLabel = formatLoyaltyTierLabel(sale.loyalty_tier, printLang);
    const earned = sale.points_earned ?? 0;
    const redeemed = sale.points_redeemed ?? 0;

    const earnedRow =
      earned > 0
        ? `<tr>
             <td style="font-size:11px;text-align:${alignStart};">${L.pointsEarned}&nbsp;:</td>
             <td style="text-align:${alignEnd};font-size:11px;font-weight:bold;color:#27ae60;">+${earned.toLocaleString("fr-DZ")} pts</td>
           </tr>`
        : "";

    const redeemedRow =
      redeemed > 0
        ? `<tr>
             <td style="font-size:11px;text-align:${alignStart};">${L.pointsRedeemed}&nbsp;:</td>
             <td style="text-align:${alignEnd};font-size:11px;color:#c0392b;">-${redeemed.toLocaleString("fr-DZ")} pts</td>
           </tr>`
        : "";

    loyaltyHtml = `
      <div class="divider"></div>
      <p class="center" style="font-size:10px;font-weight:bold;letter-spacing:1px;">${L.loyaltyHeader}</p>
      <table style="margin-top:3px;">
        <tr>
          <td style="font-size:11px;text-align:${alignStart};">${L.loyaltyStatus}&nbsp;:</td>
          <td style="text-align:${alignEnd};font-size:11px;font-weight:bold;">${tierSymbol} ${tierLabel}</td>
        </tr>
        ${earnedRow}
        ${redeemedRow}
        <tr>
          <td style="font-size:11px;text-align:${alignStart};">${L.pointsBalance}&nbsp;:</td>
          <td style="text-align:${alignEnd};font-size:12px;font-weight:bold;">${sale.loyalty_points.toLocaleString("fr-DZ")} pts</td>
        </tr>
      </table>`;
  }

  const html = `<!DOCTYPE html>
<html lang="${isRtl ? "ar" : printLang === "en" ? "en" : "fr"}" dir="${isRtl ? "rtl" : "ltr"}">
<head>
  <meta charset="UTF-8"/>
  <title>Reçu ${sale.receipt_number}</title>
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
    .center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-weight: bold; font-size: 13px; padding-top: 4px; }
    @media print {
      @page { margin: 0; }
      body { padding: 2mm; }
    }
  </style>
</head>
<body>
  <h1>${storeName}</h1>
  ${
    sale.is_formal
      ? `
  <p class="center" style="font-size:10px;">RC: 1234567A00 - NIF: 0987654321</p>
  `
      : ""
  }
  <div class="divider"></div>

  <p class="center" style="font-size:10px;font-weight:bold;margin-bottom:4px;">
    ${sale.is_formal ? L.formalTitle : L.ticketTitle}
  </p>
  <p class="center" style="font-size:10px;">
    ${L.receiptNo} <strong>${sale.receipt_number || `#${sale.id}`}</strong>
  </p>
  <p class="center" style="font-size:10px;">${formatDate(sale.created_at)}</p>
  <p class="center" style="font-size:10px;">${L.cashier}&nbsp;: ${sale.cashier_name || "—"}</p>
  ${clientRow}

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

  ${timbreRow}
  ${discountRow}

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td style="text-align:${alignStart};">${L.total}</td>
      <td style="text-align:${alignEnd};">${Number(sale.total_amount).toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>
  <table>${paymentsHtml}</table>

  ${balanceRow}
  ${loyaltyHtml}

  <div class="divider"></div>
  <p class="center" style="font-size:10px;margin-top:4px;">${L.thankYou}</p>
</body>
</html>`;

  const cfg = getPrinterConfig();
  printTicket(html, { paperWidth: cfg.ticket.paperWidth });
}
