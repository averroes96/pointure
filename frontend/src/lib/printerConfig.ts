/**
 * Printer configuration management and dispatch for ShoeDZ.
 *
 * Supports assigning distinct printers for:
 * 1. Tickets de caisse / Ventes & Versements (ESC/POS 80mm / 58mm thermal printers, e.g. Xprinter, Epson, Bixolon)
 * 2. Factures & Documents A4 (LaserJet / DeskJet office printers)
 * 3. Étiquettes Code-barres (Zebra, Xprinter 365B)
 *
 * Persisted locally in localStorage so each POS workstation / cashier PC can
 * be tied to its locally connected USB/network printers.
 */
import { openPrintPopup } from "./printPopup";

export interface TicketPrinterConfig {
  printerName: string; // "" means default system printer
  paperWidth: "80mm" | "58mm";
  silent: boolean; // Direct print without Windows print preview dialog
  autoPrint: boolean; // Automatically print ticket on sale confirmation
  copies: number;
}

export interface InvoicePrinterConfig {
  printerName: string;
  paperSize: "A4" | "Letter";
  silent: boolean;
  copies: number;
}

export interface LabelsPrinterConfig {
  printerName: string;
  labelSize: "82x40" | "50x30" | "38x25" | "custom";
  silent: boolean;
}

export interface PrinterConfig {
  ticket: TicketPrinterConfig;
  invoice: InvoicePrinterConfig;
  labels: LabelsPrinterConfig;
}

const STORAGE_KEY = "shodz_printer_config";

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  ticket: {
    printerName: "",
    paperWidth: "80mm",
    silent: true, // Default to direct print in desktop mode (Algerian caisse standard)
    autoPrint: false,
    copies: 1,
  },
  invoice: {
    printerName: "",
    paperSize: "A4",
    silent: false,
    copies: 1,
  },
  labels: {
    printerName: "",
    labelSize: "82x40",
    silent: false,
  },
};

export function getPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ticket: { ...DEFAULT_PRINTER_CONFIG.ticket, ...(parsed.ticket || {}) },
      invoice: { ...DEFAULT_PRINTER_CONFIG.invoice, ...(parsed.invoice || {}) },
      labels: { ...DEFAULT_PRINTER_CONFIG.labels, ...(parsed.labels || {}) },
    };
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
}

export function savePrinterConfig(config: PrinterConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent("shodz-printer-config-changed", { detail: config }));
  } catch (err) {
    console.warn("Failed to persist printer configuration:", err);
  }
}

/**
 * Print a ticket / receipt HTML.
 * Uses native desktop silent printing if available and configured,
 * otherwise falls back to the print popup window.
 */
export async function printTicket(
  html: string,
  overrideOptions?: Partial<TicketPrinterConfig>
): Promise<{ success: boolean; failureReason?: string }> {
  const config = getPrinterConfig();
  const ticketCfg = { ...config.ticket, ...(overrideOptions || {}) };

  // If running in Desktop app with Electron native printing available:
  if (window.electronAPI?.isDesktop && typeof window.electronAPI?.printHtml === "function") {
    try {
      const res = await window.electronAPI.printHtml({
        html,
        deviceName: ticketCfg.printerName || undefined,
        silent: ticketCfg.silent,
        copies: ticketCfg.copies || 1,
      });
      if (res && res.success) {
        return { success: true };
      }
      console.warn("Native printHtml failed or cancelled:", res?.failureReason);
      // If silent print failed (e.g. printer offline), fall back to popup so user isn't stuck
      if (res?.failureReason) {
        openPrintPopup(html, ticketCfg.paperWidth);
        return { success: false, failureReason: res.failureReason };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error executing native printHtml:", err);
      openPrintPopup(html, ticketCfg.paperWidth);
      return { success: false, failureReason: err?.message };
    }
  }

  // Web fallback: standard print popup
  openPrintPopup(html, ticketCfg.paperWidth);
  return { success: true };
}

/**
 * Print a standard A4 document HTML (Facture, Bon de livraison, Rapport).
 */
export async function printDocumentA4(
  html: string,
  overrideOptions?: Partial<InvoicePrinterConfig>
): Promise<{ success: boolean; failureReason?: string }> {
  const config = getPrinterConfig();
  const invCfg = { ...config.invoice, ...(overrideOptions || {}) };

  if (window.electronAPI?.isDesktop && typeof window.electronAPI?.printHtml === "function") {
    try {
      const res = await window.electronAPI.printHtml({
        html,
        deviceName: invCfg.printerName || undefined,
        silent: invCfg.silent,
        pageSize: invCfg.paperSize || "A4",
        copies: invCfg.copies || 1,
      });
      if (res?.success) return { success: true };
      openPrintPopup(html, "210mm");
      return res || { success: true };
    } catch {
      openPrintPopup(html, "210mm");
      return { success: true };
    }
  }

  openPrintPopup(html, "210mm");
  return { success: true };
}

/**
 * Generates and prints a sample test receipt to verify ticket printer setup.
 */
export async function testPrintTicket(
  printerName: string,
  paperWidth: "80mm" | "58mm" = "80mm"
): Promise<{ success: boolean; failureReason?: string }> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-DZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeStr = now.toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const is58mm = paperWidth === "58mm";
  const bodyWidth = is58mm ? "54mm" : "74mm";

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Test Impression ShoeDZ</title>
  <style>
    @media print {
      @page { size: ${paperWidth} auto; margin: 0; }
      body { margin: 0; padding: 2mm 3mm; }
    }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${is58mm ? "10px" : "12px"};
      width: ${bodyWidth};
      color: #000;
      margin: 0 auto;
      padding: 4mm 2mm;
      text-align: center;
      line-height: 1.35;
    }
    .header { font-weight: bold; font-size: ${is58mm ? "13px" : "16px"}; margin-bottom: 2px; }
    .subtitle { font-size: 10px; margin-bottom: 6px; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
    .barcode { font-size: 14px; letter-spacing: 3px; font-family: monospace; font-weight: bold; margin: 8px 0 4px; }
    .footer { font-size: 9px; margin-top: 8px; color: #333; }
  </style>
</head>
<body>
  <div class="header">★ ShoeDZ ★</div>
  <div class="subtitle">TEST D'IMPRESSION TICKET</div>
  <div>Imprimante : ${printerName || "Par défaut Windows"}</div>
  <div>Format : ${paperWidth}</div>
  <div>Date : ${dateStr} ${timeStr}</div>
  <div class="divider"></div>
  <div class="row">
    <span>Article Test T.42</span>
    <span>1 × 4 500 DZD</span>
  </div>
  <div class="row">
    <span>Remise (0%)</span>
    <span>0 DZD</span>
  </div>
  <div class="divider"></div>
  <div class="row" style="font-weight: bold; font-size: 13px;">
    <span>TOTAL TEST</span>
    <span>4 500 DZD</span>
  </div>
  <div class="divider"></div>
  <div class="barcode">|||| | | ||| |||| |</div>
  <div style="font-size: 10px;">TEST-OK-8745</div>
  <div class="footer">
    Configuration réussie avec succès !<br>
    ShoeDZ Desktop POS Edition
  </div>
</body>
</html>`;

  return printTicket(html, { printerName, paperWidth, silent: true });
}
