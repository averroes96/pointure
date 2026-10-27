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

export type LabelSizePreset = "45x35" | "50x30" | "82x40" | "38x25" | "custom";

export interface LabelsPrinterConfig {
  printerName: string;
  labelSize: LabelSizePreset;
  customWidth: number; // mm, used when labelSize === "custom"
  customHeight: number; // mm
  offsetX: number; // mm calibration shift (+ = right)
  offsetY: number; // mm calibration shift (+ = down)
  landscape: boolean; // rotate page 90° for drivers that expect it
  silent: boolean; // Print instantly, without the integrated preview dialog
}

export const LABEL_SIZE_PRESETS: { value: LabelSizePreset; label: string; w: number; h: number }[] = [
  { value: "45x35", label: "45 × 35 mm (Gprinter GP-3150TN — recommandé)", w: 45, h: 35 },
  { value: "50x30", label: "50 × 30 mm (Compact)", w: 50, h: 30 },
  { value: "82x40", label: "82 × 40 mm (Grande boîte)", w: 82, h: 40 },
  { value: "38x25", label: "38 × 25 mm (Mini)", w: 38, h: 25 },
];

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
    labelSize: "45x35",
    customWidth: 45,
    customHeight: 35,
    offsetX: 0,
    offsetY: 0,
    landscape: false,
    silent: false,
  },
};

export function getPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_CONFIG;
    const parsed = JSON.parse(raw);
    const labels = { ...DEFAULT_PRINTER_CONFIG.labels, ...(parsed.labels || {}) };
    // Configs saved before label calibration existed used the old 82×40 default,
    // which does not match the 45×35 rolls actually loaded → migrate once.
    if (parsed.labels && parsed.labels.customWidth === undefined) {
      labels.labelSize = "45x35";
    }
    return {
      ticket: { ...DEFAULT_PRINTER_CONFIG.ticket, ...(parsed.ticket || {}) },
      invoice: { ...DEFAULT_PRINTER_CONFIG.invoice, ...(parsed.invoice || {}) },
      labels,
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

/** Physical label size (mm) for a label printer configuration. */
export function getLabelDimensions(cfg: LabelsPrinterConfig): { w: number; h: number } {
  if (cfg.labelSize === "custom") {
    const w = Number(cfg.customWidth) || 45;
    const h = Number(cfg.customHeight) || 35;
    return { w: Math.min(Math.max(w, 15), 150), h: Math.min(Math.max(h, 15), 150) };
  }
  const preset = LABEL_SIZE_PRESETS.find((p) => p.value === cfg.labelSize);
  return preset ? { w: preset.w, h: preset.h } : { w: 45, h: 35 };
}

/**
 * Inject the calibration offsets into a label HTML document.
 * Backend label templates translate every label by the CSS vars --ox / --oy.
 */
export function applyLabelOffsets(html: string, offsetX: number, offsetY: number): string {
  const ox = Number(offsetX) || 0;
  const oy = Number(offsetY) || 0;
  if (!ox && !oy) return html;
  const style = `<style id="label-offsets">:root{--ox:${ox}mm !important;--oy:${oy}mm !important;}</style>`;
  if (html.includes('id="label-offsets"')) {
    return html.replace(/<style id="label-offsets">.*?<\/style>/, style);
  }
  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : style + html;
}

/**
 * Print a label HTML document natively at its exact physical size.
 *
 * Desktop: Electron prints with a custom micron page size, zero margins and
 * 100% scale — no PDF viewer, no Windows dialog, no rescaling → no shift.
 * Web: falls back to a hidden iframe + browser print (page size comes from
 * the document's @page rule).
 */
export async function printLabelHtml(
  html: string,
  overrideOptions?: Partial<LabelsPrinterConfig> & { copies?: number }
): Promise<{ success: boolean; failureReason?: string }> {
  const config = getPrinterConfig();
  const cfg = { ...config.labels, ...(overrideOptions || {}) };
  const { w, h } = getLabelDimensions(cfg);
  const finalHtml = applyLabelOffsets(html, cfg.offsetX, cfg.offsetY);
  const copies = Math.max(1, Math.min(Number(overrideOptions?.copies) || 1, 500));

  if (window.electronAPI?.isDesktop && typeof window.electronAPI?.printHtml === "function") {
    try {
      const res = await window.electronAPI.printHtml({
        html: finalHtml,
        deviceName: cfg.printerName || undefined,
        // The integrated dialog already collected the user's choices, so the
        // native print is always silent (no Windows dialog in between).
        silent: true,
        pageSize: { width: Math.round(w * 1000), height: Math.round(h * 1000) },
        margins: { marginType: "none" },
        landscape: !!cfg.landscape,
        scaleFactor: 100,
        copies,
      });
      if (res?.success) return { success: true };
      return { success: false, failureReason: res?.failureReason || "Échec d'impression" };
    } catch (err: any) {
      return { success: false, failureReason: err?.message || String(err) };
    }
  }

  // Web fallback: print through a hidden iframe
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc || !iframe.contentWindow) {
      iframe.remove();
      resolve({ success: false, failureReason: "Impossible d'ouvrir l'aperçu d'impression" });
      return;
    }
    doc.open();
    doc.write(finalHtml);
    doc.close();
    setTimeout(() => {
      try {
        iframe.contentWindow!.focus();
        iframe.contentWindow!.print();
        resolve({ success: true });
      } catch (err: any) {
        resolve({ success: false, failureReason: err?.message });
      } finally {
        setTimeout(() => iframe.remove(), 2000);
      }
    }, 300);
  });
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

/**
 * Generates and prints a sample test label to verify label printer setup and alignment.
 */
export async function testPrintLabel(
  overrideOptions?: Partial<LabelsPrinterConfig>
): Promise<{ success: boolean; failureReason?: string }> {
  const config = getPrinterConfig();
  const cfg = { ...config.labels, ...(overrideOptions || {}) };
  const { w, h } = getLabelDimensions(cfg);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Test Étiquette ShoeDZ</title>
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  :root { --ox: 0mm; --oy: 0mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${w}mm;
    background: white;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .page {
    width: ${w}mm;
    height: ${h - 0.3}mm;
    padding: 1.2mm;
    overflow: hidden;
  }
  .page > * {
    transform: translate(var(--ox), var(--oy));
  }
  .shelf-label {
    width: 100%;
    height: 100%;
    border: 1.2pt solid #000;
    border-radius: 2.5mm;
    padding: 0.8mm 1.5mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    text-align: center;
    overflow: hidden;
  }
  .ref, .loc, .price {
    white-space: nowrap;
    overflow: hidden;
    line-height: 1.05;
    color: #000;
  }
  .ref {
    font-size: 13pt;
    font-weight: 800;
    letter-spacing: 0.02em;
    border-bottom: 0.8pt solid #000;
    padding-bottom: 0.6mm;
  }
  .loc {
    font-size: 26pt;
    font-weight: 900;
    letter-spacing: 0.03em;
  }
  .price {
    font-size: 22pt;
    font-weight: 900;
    letter-spacing: -0.01em;
    border-top: 0.8pt solid #000;
    padding-top: 0.6mm;
  }
  .dzd {
    font-size: 10pt;
    font-weight: 800;
    margin-left: 1mm;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="shelf-label">
      <div class="ref">TEST 0049-44</div>
      <div class="loc">C10.</div>
      <div class="price">3 900<span class="dzd">DZD</span></div>
    </div>
  </div>
</body>
</html>`;

  return printLabelHtml(html, { ...cfg, copies: 1 });
}

