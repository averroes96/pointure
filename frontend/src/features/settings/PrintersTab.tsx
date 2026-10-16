import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Printer,
  Receipt,
  FileText,
  Tag,
  CheckCircle2,
  RefreshCw,
  Zap,
  AlertCircle,
} from "lucide-react";
import {
  getPrinterConfig,
  savePrinterConfig,
  testPrintTicket,
  printDocumentA4,
  type PrinterConfig,
} from "@/lib/printerConfig";
import type { PrinterInfo } from "@/vite-env";
import { cn } from "@/lib/utils";

export default function PrintersTab() {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [config, setConfig] = useState<PrinterConfig>(getPrinterConfig());
  const [testingTicket, setTestingTicket] = useState(false);
  const [testingA4, setTestingA4] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const isDesktop = !!window.electronAPI?.isDesktop;

  const loadPrinters = async () => {
    if (!window.electronAPI?.getPrinters) return;
    setLoadingPrinters(true);
    try {
      const list = await window.electronAPI.getPrinters();
      setPrinters(list || []);
    } catch (err) {
      console.error("Failed to load printers:", err);
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    if (isDesktop) {
      loadPrinters();
    }
  }, [isDesktop]);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleSave = () => {
    savePrinterConfig(config);
    showToast("Configuration des imprimantes enregistrée avec succès !");
  };

  const handleTestTicket = async () => {
    setTestingTicket(true);
    try {
      const res = await testPrintTicket(config.ticket.printerName, config.ticket.paperWidth);
      if (res.success) {
        showToast("Test d'impression ticket envoyé à l'imprimante !");
      } else {
        showToast(
          res.failureReason
            ? `Erreur d'impression : ${res.failureReason}`
            : "Impossible d'imprimer le ticket test. Vérifiez que l'imprimante est allumée.",
          "error"
        );
      }
    } catch (err: any) {
      showToast(err?.message || "Erreur lors du test d'impression.", "error");
    } finally {
      setTestingTicket(false);
    }
  };

  const handleTestA4 = async () => {
    setTestingA4(true);
    try {
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test Impression A4</title>
  <style>
    @media print { @page { size: A4 portrait; margin: 15mm; } }
    body { font-family: Arial, sans-serif; color: #1e293b; padding: 20px; line-height: 1.6; }
    h1 { color: #0284c7; border-bottom: 2px solid #0284c7; padding-bottom: 8px; font-size: 22px; }
    .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin: 20px 0; background: #f8fafc; }
  </style>
</head>
<body>
  <h1>ShoeDZ — Test d'Impression Document A4</h1>
  <p>Ce document confirme la liaison entre ShoeDZ et votre imprimante de bureau.</p>
  <div class="box">
    <strong>Détails du test :</strong><br/>
    Imprimante assignée : ${config.invoice.printerName || "Imprimante par défaut Windows"}<br/>
    Format : A4 Portrait<br/>
    Date : ${new Date().toLocaleString("fr-DZ")}
  </div>
  <p style="color: #16a34a; font-weight: bold;">✔ Configuration A4 opérationnelle.</p>
</body>
</html>`;
      await printDocumentA4(html, { printerName: config.invoice.printerName, silent: config.invoice.silent });
      showToast("Document A4 de test envoyé !");
    } catch (err: any) {
      showToast(err?.message || "Erreur test A4", "error");
    } finally {
      setTestingA4(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Toast */}
      {toastMessage && (
        <div
          className={cn(
            "p-4 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all shadow-2xs",
            toastMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          )}
        >
          {toastMessage.type === "success" ? (
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle size={18} className="text-rose-600 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Header Info Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-primary-50 via-primary-50/30 to-white border border-primary-200/60 shadow-xs flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-primary-600 text-white flex items-center justify-center shadow-xs">
            <Printer size={22} className="stroke-[2.2]" />
          </div>
          <div>
            <h2 className="text-base font-bold font-sans tracking-tight text-slate-900">
              Configuration des Imprimantes
            </h2>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              Associez vos imprimantes matérielles selon le type d'opération (Tickets de caisse, Factures A4, Étiquettes).
            </p>
          </div>
        </div>

        {isDesktop && (
          <button
            type="button"
            onClick={loadPrinters}
            disabled={loadingPrinters}
            className="btn-secondary text-xs font-semibold py-2 px-3.5 rounded-xl flex items-center gap-2 shadow-2xs"
            title="Actualiser la liste des imprimantes Windows"
          >
            <RefreshCw size={14} className={cn(loadingPrinters && "animate-spin text-primary-600")} />
            <span>{loadingPrinters ? "Détection en cours..." : "Actualiser les imprimantes"}</span>
          </button>
        )}
      </div>

      {/* ── Section 1: Ticket de Caisse & Reçus ───────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center shadow-2xs">
              <Receipt size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">
                Tickets de Caisse & Bons de Versement
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Imprimante thermique de caisse (ESC/POS 80mm ou 58mm, ex: Xprinter, Epson, Bixolon, Rongta).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestTicket}
            disabled={testingTicket}
            className="btn-secondary text-xs font-semibold py-1.5 px-3 rounded-xl flex items-center gap-1.5 hover:border-amber-400"
          >
            <Zap size={13} className="text-amber-600" />
            <span>{testingTicket ? "Impression..." : "Tester le ticket"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Printer Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Imprimante assignée aux tickets
            </label>
            <select
              value={config.ticket.printerName}
              onChange={(e) =>
                setConfig({
                  ...config,
                  ticket: { ...config.ticket, printerName: e.target.value },
                })
              }
              className="input w-full text-xs font-medium rounded-xl border-slate-200"
            >
              <option value="">(Imprimante par défaut Windows)</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name} {p.isDefault ? "★ (Défaut)" : ""}
                </option>
              ))}
            </select>
            <p className="text-2xs text-slate-400 mt-1">
              Sélectionnez votre imprimante thermique connectée en USB ou réseau local.
            </p>
          </div>

          {/* Paper Width */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Largeur du rouleau thermique
            </label>
            <div className="grid grid-cols-2 gap-2 mt-0.5">
              <button
                type="button"
                onClick={() =>
                  setConfig({
                    ...config,
                    ticket: { ...config.ticket, paperWidth: "80mm" },
                  })
                }
                className={cn(
                  "py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-all",
                  config.ticket.paperWidth === "80mm"
                    ? "border-primary-600 bg-primary-50 text-primary-800 ring-1 ring-primary-600 shadow-2xs"
                    : "border-slate-200 hover:bg-slate-50 text-slate-700"
                )}
              >
                80 mm (Standard Caisse)
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfig({
                    ...config,
                    ticket: { ...config.ticket, paperWidth: "58mm" },
                  })
                }
                className={cn(
                  "py-2 px-3 rounded-xl border text-xs font-semibold text-center transition-all",
                  config.ticket.paperWidth === "58mm"
                    ? "border-primary-600 bg-primary-50 text-primary-800 ring-1 ring-primary-600 shadow-2xs"
                    : "border-slate-200 hover:bg-slate-50 text-slate-700"
                )}
              >
                58 mm (Étroit / Portable)
              </button>
            </div>
          </div>
        </div>

        {/* Printing Mode & Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">Mode d'impression ticket</label>
            <div className="space-y-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="ticket_silent"
                  checked={config.ticket.silent}
                  onChange={() =>
                    setConfig({
                      ...config,
                      ticket: { ...config.ticket, silent: true },
                    })
                  }
                  className="mt-0.5 text-primary-600 focus:ring-primary-500/20"
                />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Impression directe instantanée (Silencieuse)
                  </div>
                  <div className="text-2xs text-slate-400 mt-0.5">
                    Le ticket sort immédiatement sans ouvrir de fenêtre de prévisualisation Windows (recommandé en caisse).
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="ticket_silent"
                  checked={!config.ticket.silent}
                  onChange={() =>
                    setConfig({
                      ...config,
                      ticket: { ...config.ticket, silent: false },
                    })
                  }
                  className="mt-0.5 text-primary-600 focus:ring-primary-500/20"
                />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Boîte de dialogue système
                  </div>
                  <div className="text-2xs text-slate-400 mt-0.5">
                    Affiche la boîte de confirmation d'impression avant l'envoi au matériel.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Exemplaires par ticket</label>
              <select
                value={config.ticket.copies}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    ticket: { ...config.ticket, copies: Number(e.target.value) || 1 },
                  })
                }
                className="input w-full text-xs font-medium rounded-xl border-slate-200"
              >
                <option value={1}>1 exemplaire (Reçu client)</option>
                <option value={2}>2 exemplaires (1 Client + 1 Caisse magasin)</option>
              </select>
            </div>

            <div className="pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.ticket.autoPrint}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      ticket: { ...config.ticket, autoPrint: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500/20"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Imprimer automatiquement le ticket à chaque vente validée
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Factures & Documents A4 ───────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 flex items-center justify-center shadow-2xs">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">
                Factures, Bons de Livraison & Documents A4
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Imprimante bureautique standard pour les documents officiels et comptables (LaserJet, DeskJet, etc.).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestA4}
            disabled={testingA4}
            className="btn-secondary text-xs font-semibold py-1.5 px-3 rounded-xl flex items-center gap-1.5 hover:border-sky-400"
          >
            <Zap size={13} className="text-sky-600" />
            <span>{testingA4 ? "Impression..." : "Tester A4"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Imprimante assignée aux documents A4
            </label>
            <select
              value={config.invoice.printerName}
              onChange={(e) =>
                setConfig({
                  ...config,
                  invoice: { ...config.invoice, printerName: e.target.value },
                })
              }
              className="input w-full text-xs font-medium rounded-xl border-slate-200"
            >
              <option value="">(Imprimante par défaut Windows)</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name} {p.isDefault ? "★ (Défaut)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Format du document</label>
            <select
              value={config.invoice.paperSize}
              onChange={(e) =>
                setConfig({
                  ...config,
                  invoice: {
                    ...config.invoice,
                    paperSize: e.target.value as "A4" | "Letter",
                  },
                })
              }
              className="input w-full text-xs font-medium rounded-xl border-slate-200"
            >
              <option value="A4">A4 (Standard Algérie - 210 × 297 mm)</option>
              <option value="Letter">US Letter</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Section 3: Étiquettes Code-barres ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 space-y-4 shadow-xs">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-center shadow-2xs">
            <Tag size={18} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              Étiquettes Code-barres & Pointures
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Imprimante d'étiquettes adhésives pour boîtes de chaussures et articles (ex: Xprinter 365B, Zebra).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Imprimante assignée aux étiquettes
            </label>
            <select
              value={config.labels.printerName}
              onChange={(e) =>
                setConfig({
                  ...config,
                  labels: { ...config.labels, printerName: e.target.value },
                })
              }
              className="input w-full text-xs font-medium rounded-xl border-slate-200"
            >
              <option value="">(Imprimante par défaut Windows)</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name} {p.isDefault ? "★ (Défaut)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Format des étiquettes</label>
            <select
              value={config.labels.labelSize}
              onChange={(e) =>
                setConfig({
                  ...config,
                  labels: {
                    ...config.labels,
                    labelSize: e.target.value as any,
                  },
                })
              }
              className="input w-full text-xs font-medium rounded-xl border-slate-200"
            >
              <option value="82x40">82 × 40 mm (Standard boîte de chaussure)</option>
              <option value="50x30">50 × 30 mm (Compact)</option>
              <option value="38x25">38 × 25 mm (Mini)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          className="btn-primary py-2.5 px-6 rounded-xl font-semibold text-sm flex items-center gap-2 shadow-xs"
        >
          <CheckCircle2 size={16} />
          <span>Enregistrer les préférences d'impression</span>
        </button>
      </div>
    </div>
  );
}
