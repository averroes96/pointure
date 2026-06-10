/**
 * Thermal receipt printer — shared utility used by SalesPage and SalesHistoryPage.
 *
 * Opens a lightweight popup window containing only the 80 mm receipt HTML
 * and triggers window.print() on that popup so the browser's print dialog
 * targets the receipt alone — not the full SPA layout.
 */
import { formatDate } from "@/lib/api";
import { openPrintPopup } from "@/lib/printPopup";
import type { Sale } from "@/types";

const METHOD_LABELS: Record<string, string> = {
  cash: "Espèces",
  ccp: "CCP",
  virement: "Virement",
  cheque: "Chèque",
  account: "Compte client",
};

const TIER_LABELS: Record<string, string> = {
  bronze: "Bronze",
  silver: "Argent",
  gold: "Or",
};

const TIER_SYMBOLS: Record<string, string> = {
  bronze: "🥉",
  silver: "🥈",
  gold: "🥇",
};

type ReceiptSale = Sale & { points_earned?: number; points_redeemed?: number };

export function printReceipt(sale: ReceiptSale, storeName: string): void {
  /* ── Build receipt HTML ─────────────────────────────────────────────── */

  const itemsHtml = (sale.items ?? [])
    .map(
      (item) => `
      <tr>
        <td style="padding:2px 0;font-size:11px;">${item.variant_str}</td>
        <td style="text-align:center;padding:2px 4px;font-size:11px;">${item.quantity}</td>
        <td style="text-align:right;padding:2px 0;font-size:11px;">
          ${Number(item.unit_price).toLocaleString("fr-DZ")} DZD
        </td>
      </tr>`
    )
    .join("");

  const paymentsHtml = (sale.payments ?? [])
    .map(
      (p) => `
      <tr>
        <td style="font-size:11px;">${METHOD_LABELS[p.method] ?? p.method}</td>
        <td style="text-align:right;font-size:11px;">
          ${Number(p.amount).toLocaleString("fr-DZ")} DZD
        </td>
      </tr>`
    )
    .join("");

  const discountRow =
    Number(sale.discount_amount) > 0
      ? `<div class="divider"></div>
         <table>
           <tr>
             <td style="font-size:11px;">Remise&nbsp;:</td>
             <td style="text-align:right;font-size:11px;">
               - ${Number(sale.discount_amount).toLocaleString("fr-DZ")} DZD
             </td>
           </tr>
         </table>`
      : "";

  const balanceRow =
    Number(sale.balance_due) > 0
      ? `<div class="divider"></div>
         <p style="font-size:11px;font-weight:bold;color:#c0392b;">
           Reste à payer&nbsp;: ${Number(sale.balance_due).toLocaleString("fr-DZ")} DZD
         </p>`
      : "";

  const clientRow = sale.client_name
    ? `<p class="center" style="font-size:10px;">Client&nbsp;: <strong>${sale.client_name}</strong></p>`
    : "";

  // Loyalty section — only when the client has an account
  let loyaltyHtml = "";
  if (sale.loyalty_tier && sale.loyalty_points != null) {
    const tierSymbol = TIER_SYMBOLS[sale.loyalty_tier] ?? "";
    const tierLabel  = TIER_LABELS[sale.loyalty_tier]  ?? sale.loyalty_tier;
    const earned   = sale.points_earned   ?? 0;
    const redeemed = sale.points_redeemed ?? 0;

    const earnedRow = earned > 0
      ? `<tr>
           <td style="font-size:11px;">Points gagnés&nbsp;:</td>
           <td style="text-align:right;font-size:11px;font-weight:bold;color:#27ae60;">+${earned.toLocaleString("fr-DZ")} pts</td>
         </tr>`
      : "";

    const redeemedRow = redeemed > 0
      ? `<tr>
           <td style="font-size:11px;">Points rachetés&nbsp;:</td>
           <td style="text-align:right;font-size:11px;color:#c0392b;">-${redeemed.toLocaleString("fr-DZ")} pts</td>
         </tr>`
      : "";

    loyaltyHtml = `
      <div class="divider"></div>
      <p class="center" style="font-size:10px;font-weight:bold;letter-spacing:1px;">── FIDÉLITÉ ──</p>
      <table style="margin-top:3px;">
        <tr>
          <td style="font-size:11px;">Statut&nbsp;:</td>
          <td style="text-align:right;font-size:11px;font-weight:bold;">${tierSymbol} ${tierLabel}</td>
        </tr>
        ${earnedRow}
        ${redeemedRow}
        <tr>
          <td style="font-size:11px;">Solde de points&nbsp;:</td>
          <td style="text-align:right;font-size:12px;font-weight:bold;">${sale.loyalty_points.toLocaleString("fr-DZ")} pts</td>
        </tr>
      </table>`;
  }

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Reçu ${sale.receipt_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
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
      /* @page size injected dynamically after content height is measured */
      @page { margin: 0; }
      body { padding: 2mm; }
    }
  </style>
</head>
<body>
  <h1>${storeName}</h1>
  <div class="divider"></div>

  <p class="center" style="font-size:10px;">
    Reçu N° <strong>${sale.receipt_number || `#${sale.id}`}</strong>
  </p>
  <p class="center" style="font-size:10px;">${formatDate(sale.created_at)}</p>
  <p class="center" style="font-size:10px;">Caissier&nbsp;: ${sale.cashier_name || "—"}</p>
  ${clientRow}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;font-size:10px;">Article</th>
        <th style="text-align:center;font-size:10px;">Qté</th>
        <th style="text-align:right;font-size:10px;">Prix</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  ${discountRow}

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td>TOTAL</td>
      <td style="text-align:right;">${Number(sale.total_amount).toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>
  <table>${paymentsHtml}</table>

  ${balanceRow}
  ${loyaltyHtml}

  <div class="divider"></div>
  <p class="center" style="font-size:10px;margin-top:4px;">Merci de votre confiance&nbsp;!</p>
</body>
</html>`;

  openPrintPopup(html, "80mm");
}
