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
  testPrintLabel,
  printDocumentA4,
  LABEL_SIZE_PRESETS,
  type LabelSizePreset,
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
  <title>${t("printers.test_doc_title")}</title>
  <style>
    @media print { @page { size: A4 portrait; margin: 15mm; } }
    body { font-family: Arial, sans-serif; color: #1e293b; padding: 20px; line-height: 1.6; }
    h1 { color: #0284c7; border-bottom: 2px solid #0284c7; padding-bottom: 8px; font-size: 22px; }
    .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin: 20px 0; background: #f8fafc; }
  </style>
</head>
<body>
  <h1>${t("printers.test_doc_title")}</h1>
  <p>${t("printers.test_doc_desc")}</p>
  <div class="box">
    <strong>${t("printers.test_details")}</strong><br/>
    ${t("printers.assigned_printer")} : ${config.invoice.printerName || t("printers.default_os_printer")}<br/>
    ${t("printers.format_a4_portrait")}<br/>
    ${t("printers.date_label")} : ${new Date().toLocaleString("fr-DZ")}
  </div>
  <p style="color: #16a34a; font-weight: bold;">${t("printers.a4_operational")}</p>
</body>
</html>`;
      await printDocumentA4(html, { printerName: config.invoice.printerName, silent: config.invoice.silent });
      showToast(t("printers.test_a4_sent"));
    } catch (err: any) {
      showToast(err?.message || "Erreur test A4", "error");
    } finally {
      setTestingA4(false);
    }
  };

  const [testingLabel, setTestingLabel] = useState(false);
  const handleTestLabel = async () => {
    setTestingLabel(true);
    try {
      const res = await testPrintLabel({
        printerName: config.labels.printerName,
        labelSize: config.labels.labelSize,
        customWidth: config.labels.customWidth,
        customHeight: config.labels.customHeight,
        offsetX: config.labels.offsetX,
        offsetY: config.labels.offsetY,
        landscape: config.labels.landscape,
      });
      if (res.success) {
        showToast("Test d'étiquette 45×35 mm envoyé à l'imprimante !");
      } else {
        showToast(
          res.failureReason
            ? `Erreur d'impression : ${res.failureReason}`
            : "Impossible d'imprimer l'étiquette test. Vérifiez que l'imprimante est allumée.",
          "error"
        );
      }
    } catch (err: any) {
      showToast(err?.message || "Erreur lors du test d'impression.", "error");
    } finally {
      setTestingLabel(false);
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
      <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 flex items-center justify-center shadow-2xs">
              <Receipt size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Tickets de Caisse & Bons de Versement
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
            <Zap size={13} className="text-amber-600 dark:text-amber-400" />
            <span>{testingTicket ? "Impression..." : "Tester le ticket"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Printer Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
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
              className="input w-full text-xs font-medium rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="">{t("printers.default_os_printer")}</option>
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
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
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
                    ? "border-primary-600 bg-primary-50 dark:bg-primary-950/40 text-primary-800 dark:text-primary-300 ring-1 ring-primary-600 shadow-2xs"
                    : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
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
                    ? "border-primary-600 bg-primary-50 dark:bg-primary-950/40 text-primary-800 dark:text-primary-300 ring-1 ring-primary-600 shadow-2xs"
                    : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
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
            <label className="block text-xs font-semibold text-slate-700 mb-2">{t("printers.ticket_print_mode")}</label>
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
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("printers.ticket_copies_label")}</label>
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
                <option value={1}>{t("printers.copy_1_client")}</option>
                <option value={2}>{t("printers.copy_2_client_store")}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("v14.print_language", "Langue des tickets & reçus imprimés")}
              </label>
              <select
                value={config.ticket.printLanguage || "ui"}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    ticket: {
                      ...config.ticket,
                      printLanguage: e.target.value as any,
                    },
                  })
                }
                className="input w-full text-xs font-medium rounded-xl border-slate-200"
              >
                <option value="ui">{t("v14.print_lang_ui", "Automatique (suivre la langue de l'interface)")}</option>
                <option value="fr">{t("v14.print_lang_fr", "Français uniquement")}</option>
                <option value="ar">{t("v14.print_lang_ar", "Arabe uniquement (RTL)")}</option>
                <option value="bilingual">{t("v14.print_lang_bilingual", "Bilingue (Français / Arabe)")}</option>
                <option value="en">{t("v14.print_lang_en", "Anglais uniquement")}</option>
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
      <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/50 text-sky-800 dark:text-sky-300 flex items-center justify-center shadow-2xs">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Factures, Bons de Livraison & Documents A4
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
            <Zap size={13} className="text-sky-600 dark:text-sky-400" />
            <span>{testingA4 ? "Impression..." : "Tester A4"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
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
              className="input w-full text-xs font-medium rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="">{t("printers.default_os_printer")}</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name} {p.isDefault ? "★ (Défaut)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("printers.doc_format_label")}</label>
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
              className="input w-full text-xs font-medium rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="A4">{t("printers.a4_standard")}</option>
              <option value="Letter">{t("printers.us_letter")}</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Section 3: Étiquettes Rayon & Code-barres ─────────────────────────── */}
      <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 flex items-center justify-center shadow-2xs">
              <Tag size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Étiquettes Rayon & Code-barres
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Imprimante thermique d'étiquettes adhésives pour rayons et boîtes (ex: Gprinter GP-3150TN, Xprinter, Zebra).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestLabel}
            disabled={testingLabel}
            className="btn-secondary text-xs font-semibold py-1.5 px-3 rounded-xl flex items-center gap-1.5 hover:border-emerald-400"
          >
            <Zap size={13} className="text-emerald-600 dark:text-emerald-400" />
            <span>{testingLabel ? "Impression..." : "Tester l'étiquette (45×35 mm)"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
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
              className="input w-full text-xs font-medium rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="">{t("printers.default_os_printer")}</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name} {p.isDefault ? "★ (Défaut)" : ""}
                </option>
              ))}
            </select>
            <p className="text-2xs text-slate-400 mt-1">
              Sélectionnez votre imprimante thermique à étiquettes (ex: Gprinter GP-3150TN).
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("printers.label_roll_format")}</label>
            <select
              value={config.labels.labelSize}
              onChange={(e) =>
                setConfig({
                  ...config,
                  labels: {
                    ...config.labels,
                    labelSize: e.target.value as LabelSizePreset,
                  },
                })
              }
              className="input w-full text-xs font-medium rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {LABEL_SIZE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              <option value="custom">{t("printers.custom_format_mm")}</option>
            </select>

            {config.labels.labelSize === "custom" && (
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100">
                <div>
                  <span className="text-2xs text-slate-500 block mb-1">{t("printers.width_mm")}</span>
                  <input
                    type="number"
                    min={15}
                    max={150}
                    value={config.labels.customWidth}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        labels: {
                          ...config.labels,
                          customWidth: Number(e.target.value) || 45,
                        },
                      })
                    }
                    className="input w-full text-xs"
                  />
                </div>
                <div>
                  <span className="text-2xs text-slate-500 block mb-1">{t("printers.height_mm")}</span>
                  <input
                    type="number"
                    min={15}
                    max={150}
                    value={config.labels.customHeight}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        labels: {
                          ...config.labels,
                          customHeight: Number(e.target.value) || 35,
                        },
                      })
                    }
                    className="input w-full text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mode d'impression étiquettes & Calibrage */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">{t("printers.labels_print_mode")}</label>
            <div className="space-y-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="labels_silent"
                  checked={config.labels.silent}
                  onChange={() =>
                    setConfig({
                      ...config,
                      labels: { ...config.labels, silent: true },
                    })
                  }
                  className="mt-0.5 text-primary-600 focus:ring-primary-500/20"
                />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Impression directe instantanée (Silencieuse)
                  </div>
                  <div className="text-2xs text-slate-400 mt-0.5">
                    L'étiquette s'imprime immédiatement sans ouvrir de boîte de dialogue (comme les tickets de caisse).
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="labels_silent"
                  checked={!config.labels.silent}
                  onChange={() =>
                    setConfig({
                      ...config,
                      labels: { ...config.labels, silent: false },
                    })
                  }
                  className="mt-0.5 text-primary-600 focus:ring-primary-500/20"
                />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Boîte de dialogue intégrée ShoeDZ
                  </div>
                  <div className="text-2xs text-slate-400 mt-0.5">
                    Affiche la prévisualisation de l'étiquette et permet de choisir l'imprimante ou le nombre d'exemplaires.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Calibrage d'alignement (Tête d'impression)
            </label>
            <p className="text-2xs text-slate-400 mb-2">
              Si le papier physique est légèrement décalé vers la gauche ou le haut, ajustez en millimètres :
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-2xs text-slate-600 block mb-1 font-medium">{t("printers.offset_horizontal")}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.5"
                    min="-10"
                    max="10"
                    value={config.labels.offsetX}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        labels: {
                          ...config.labels,
                          offsetX: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                    className="input w-full text-xs"
                    placeholder="0"
                  />
                  <span className="text-2xs text-slate-400">mm</span>
                </div>
                <span className="text-3xs text-slate-400 mt-0.5 block">{t("printers.offset_h_hint")}</span>
              </div>

              <div>
                <span className="text-2xs text-slate-600 block mb-1 font-medium">{t("printers.offset_vertical")}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.5"
                    min="-10"
                    max="10"
                    value={config.labels.offsetY}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        labels: {
                          ...config.labels,
                          offsetY: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                    className="input w-full text-xs"
                    placeholder="0"
                  />
                  <span className="text-2xs text-slate-400">mm</span>
                </div>
                <span className="text-3xs text-slate-400 mt-0.5 block">{t("printers.offset_y_hint")}</span>
              </div>
            </div>
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
          <span>{t("printers.save_preferences")}</span>
        </button>
      </div>
    </div>
  );
}
