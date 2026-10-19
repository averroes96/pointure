/**
 * Bon de Versement printer — 80mm thermal receipt format.
 * Printed when a sale is created with partial payment (versement/lay-away).
 */
import type { Sale } from "@/types";
import { printTicket, getPrinterConfig } from "@/lib/printerConfig";
import { formatDate } from "@/lib/api";

const METHOD_LABELS: Record<string, string> = {
  cash: "Especes",
  ccp: "CCP",
  virement: "Virement",
  cheque: "Cheque",
  account: "Compte client",
};

export function printBonVersement(sale: Sale, storeName: string): void {
  const amountPaid = Number(sale.amount_paid);
  const balanceDue = Number(sale.balance_due);
  const totalAmount = Number(sale.total_amount);

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

  const dueDateStr = sale.due_date ? sale.due_date : "—";

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Bon de Versement ${sale.receipt_number}</title>
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

  <h2>BON DE VERSEMENT</h2>

  <div class="divider"></div>

  <p class="center" style="font-size:10px;">
    Recu N&deg; <strong>${sale.receipt_number || `#${sale.id}`}</strong>
  </p>
  <p class="center" style="font-size:10px;">${formatDate(sale.created_at)}</p>
  <p class="center" style="font-size:10px;">Caissier&nbsp;: ${sale.cashier_name || "—"}</p>
  ${sale.client_name ? `<p class="center" style="font-size:10px;">Client&nbsp;: <strong>${sale.client_name}</strong></p>` : ""}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;font-size:10px;">Article</th>
        <th style="text-align:center;font-size:10px;">Qte</th>
        <th style="text-align:right;font-size:10px;">Prix</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td>TOTAL</td>
      <td style="text-align:right;">${totalAmount.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <p style="font-size:10px;font-weight:bold;letter-spacing:1px;">── REGLEMENT ──</p>
  <table style="margin-top:3px;">${paymentsHtml}</table>

  <div class="divider"></div>

  <table>
    <tr class="paid-row">
      <td>Acompte verse&nbsp;:</td>
      <td style="text-align:right;">${amountPaid.toLocaleString("fr-DZ")} DZD</td>
    </tr>
    <tr class="balance-row">
      <td>Solde restant&nbsp;:</td>
      <td style="text-align:right;">${balanceDue.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <p style="font-size:11px;">
    Date d&apos;echeance&nbsp;: <strong>${dueDateStr}</strong>
  </p>

  <div class="divider"></div>

  <p style="font-size:10px;font-style:italic;text-align:center;margin:4px 0;">
    Ce bon atteste le paiement partiel et la reservation<br/>des articles ci-dessus.
  </p>

  <div class="divider"></div>

  <table style="margin-top:6px;">
    <tr>
      <td style="width:50%;font-size:10px;vertical-align:top;">
        Signature caissier&nbsp;:<br/>
        <div class="signature-box"></div>
      </td>
      <td style="width:50%;font-size:10px;vertical-align:top;padding-left:4px;">
        Signature client&nbsp;:<br/>
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
  const amountPaid = Number(sale.amount_paid);
  const balanceDue = Number(sale.balance_due);
  const totalAmount = Number(sale.total_amount);

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

  const expiryDateStr = sale.layaway_expires_at ? sale.layaway_expires_at : (sale.due_date ? sale.due_date : "—");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Bon de Réservation ${sale.receipt_number}</title>
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

  <h2>BON DE RÉSERVATION</h2>
  <div class="center"><span class="badge">MISE DE CÔTÉ EN MAGASIN</span></div>

  <div class="divider"></div>

  <p class="center" style="font-size:10px;">
    Réf N&deg; <strong>${sale.receipt_number || `#${sale.id}`}</strong>
  </p>
  <p class="center" style="font-size:10px;">Date : ${formatDate(sale.created_at)}</p>
  <p class="center" style="font-size:10px;">Caissier : ${sale.cashier_name || "—"}</p>
  ${sale.client_name ? `<p class="center" style="font-size:10px;">Client : <strong>${sale.client_name}</strong></p>` : ""}
  ${sale.notes ? `<p class="center" style="font-size:10px;">Note : <em>${sale.notes}</em></p>` : ""}

  <div class="divider"></div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;font-size:10px;">Article Consigné</th>
        <th style="text-align:center;font-size:10px;">Qte</th>
        <th style="text-align:right;font-size:10px;">Prix</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td>TOTAL COMMANDE</td>
      <td style="text-align:right;">${totalAmount.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <p style="font-size:10px;font-weight:bold;letter-spacing:1px;">── ACOMPTE VERSÉ ──</p>
  <table style="margin-top:3px;">${paymentsHtml}</table>

  <div class="divider"></div>

  <table>
    <tr class="paid-row">
      <td>Acompte réglé :</td>
      <td style="text-align:right;">${amountPaid.toLocaleString("fr-DZ")} DZD</td>
    </tr>
    <tr class="balance-row">
      <td>Solde au retrait :</td>
      <td style="text-align:right;">${balanceDue.toLocaleString("fr-DZ")} DZD</td>
    </tr>
  </table>

  <div class="divider"></div>

  <div class="warning-box">
    <strong>DATE LIMITE DE RETRAIT :</strong><br/>
    <span style="font-size:12px;font-weight:bold;">${expiryDateStr}</span><br/>
    <span style="font-size:9px;">Les articles sont réservés en magasin. Passé ce délai, la réservation est susceptible d'être libérée.</span>
  </div>

  <div class="divider"></div>

  <table style="margin-top:6px;">
    <tr>
      <td style="width:50%;font-size:10px;vertical-align:top;">
        Signature caissier :<br/>
        <div class="signature-box"></div>
      </td>
      <td style="width:50%;font-size:10px;vertical-align:top;padding-left:4px;">
        Signature client :<br/>
        <div class="signature-box"></div>
      </td>
    </tr>
  </table>

  <p class="center" style="font-size:9px;color:#555;margin-top:6px;">
    Présenter obligatoirement ce bon lors du retrait.
  </p>
</body>
</html>`;

  const cfg = getPrinterConfig();
  printTicket(html, { paperWidth: cfg.ticket.paperWidth });
}

