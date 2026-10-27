import { useState, useEffect, useMemo, useRef } from "react";
import {
  Printer,
  X,
  Loader2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Maximize2,
  RefreshCw,
  Minus,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getPrinterConfig,
  savePrinterConfig,
  getLabelDimensions,
  applyLabelOffsets,
  printLabelHtml,
  LABEL_SIZE_PRESETS,
  type LabelSizePreset,
  type LabelsPrinterConfig,
} from "@/lib/printerConfig";
import { useLabelPrintStore } from "./labelPrintStore";
import type { PrinterInfo } from "@/vite-env";
import { cn } from "@/lib/utils";

export default function LabelPrintDialog() {
  const { isOpen, request, htmlContent, isLoadingHtml, copies, closeDialog, setCopies, refreshHtml } =
    useLabelPrintStore();

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [labelSize, setLabelSize] = useState<LabelSizePreset>("45x35");
  const [customWidth, setCustomWidth] = useState<number>(45);
  const [customHeight, setCustomHeight] = useState<number>(35);
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(0);
  const [landscape, setLandscape] = useState<boolean>(false);
  const [saveAsSilent, setSaveAsSilent] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const isDesktop = !!window.electronAPI?.isDesktop;

  // Sync state with persisted configuration on open
  useEffect(() => {
    if (!isOpen) return;

    const config = getPrinterConfig();
    const lbl = config.labels;

    setSelectedPrinter(lbl.printerName || "");
    setLabelSize(lbl.labelSize || "45x35");
    setCustomWidth(lbl.customWidth || 45);
    setCustomHeight(lbl.customHeight || 35);
    setOffsetX(lbl.offsetX || 0);
    setOffsetY(lbl.offsetY || 0);
    setLandscape(!!lbl.landscape);
    setSaveAsSilent(!!lbl.silent);
    setFeedback(null);

    // Load available hardware printers from Electron
    if (window.electronAPI?.getPrinters) {
      window.electronAPI
        .getPrinters()
        .then((list) => {
          setPrinters(list || []);
          // If no printer explicitly selected in config, check if one matches Gprinter or default
          if (!lbl.printerName && list && list.length > 0) {
            const gprinter = list.find((p) => /gprinter|gp-|label|zebra|xprinter/i.test(p.name));
            if (gprinter) {
              setSelectedPrinter(gprinter.name);
            }
          }
        })
        .catch((err) => console.error("Error querying printers:", err));
    }
  }, [isOpen]);

  // Compute active dimensions in mm
  const { w, h } = useMemo(() => {
    return getLabelDimensions({
      printerName: selectedPrinter,
      labelSize,
      customWidth,
      customHeight,
      offsetX,
      offsetY,
      landscape,
      silent: false,
    });
  }, [labelSize, customWidth, customHeight, selectedPrinter, offsetX, offsetY, landscape]);

  // Re-fetch HTML when dimensions change
  const prevDimsRef = useRef({ w: 45, h: 35 });
  useEffect(() => {
    if (!isOpen) return;
    if (prevDimsRef.current.w !== w || prevDimsRef.current.h !== h) {
      prevDimsRef.current = { w, h };
      refreshHtml({ w, h, copies });
    }
  }, [w, h, isOpen, refreshHtml, copies]);

  // Live preview HTML with calibration offset injected + preview smoothing
  const previewHtml = useMemo(() => {
    if (!htmlContent) return "";
    const htmlWithOffsets = applyLabelOffsets(htmlContent, offsetX, offsetY);
    // Inject preview helpers: eliminate scrollbars in iframe and ensure page matches h exactly
    const previewStyles = `<style id="preview-scaling-fix">
      html, body {
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        width: ${w}mm !important;
        background: white !important;
      }
      .page {
        height: ${h}mm !important;
        max-height: ${h}mm !important;
        width: ${w}mm !important;
        margin: 0 !important;
      }
      ::-webkit-scrollbar { display: none !important; }
    </style>`;
    return htmlWithOffsets.includes("</head>")
      ? htmlWithOffsets.replace("</head>", `${previewStyles}</head>`)
      : previewStyles + htmlWithOffsets;
  }, [htmlContent, offsetX, offsetY, w, h]);

  // Count pages in preview HTML (e.g. for bulk printing)
  const pageCount = useMemo(() => {
    if (!previewHtml) return 1;
    const matches = previewHtml.match(/class=["']page["']/g);
    return matches && matches.length > 0 ? matches.length : 1;
  }, [previewHtml]);

  const [currentPage, setCurrentPage] = useState<number>(0);

  // Reset/clamp current page when pageCount changes
  useEffect(() => {
    setCurrentPage((curr) => Math.min(curr, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  // Screen DPI conversion (CSS standard: 96 CSS px per 25.4 mm)
  const MM_TO_PX = 96 / 25.4; // ~3.779528 px/mm
  const baseW = w * MM_TO_PX;
  const baseH = h * MM_TO_PX;

  // Outer mockup dimensions on screen (proportional to sticker aspect ratio)
  const isWide = w >= h;
  const maxCardW = isWide ? 380 : 280;
  const maxCardH = isWide ? 300 : 380;

  let cardW = maxCardW;
  let cardH = Math.round(cardW * (h / w));
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = Math.round(cardH * (w / h));
  }

  // Exact scale factor to stretch physical mm size to fill the card
  const scale = cardW / baseW;

  if (!isOpen) return null;

  async function handlePrint() {
    if (isPrinting) return;
    setIsPrinting(true);
    setFeedback(null);

    try {
      // If user checked "Toujours imprimer directement", persist the preferences
      const config = getPrinterConfig();
      const updatedConfig = {
        ...config,
        labels: {
          ...config.labels,
          printerName: selectedPrinter,
          labelSize,
          customWidth,
          customHeight,
          offsetX,
          offsetY,
          landscape,
          silent: saveAsSilent,
        },
      };
      savePrinterConfig(updatedConfig);

      const res = await printLabelHtml(htmlContent, {
        printerName: selectedPrinter,
        labelSize,
        customWidth,
        customHeight,
        offsetX,
        offsetY,
        landscape,
        copies,
      });

      if (res.success) {
        setFeedback({ text: "Impression envoyée avec succès !", type: "success" });
        request?.onSuccess?.();
        setTimeout(() => {
          closeDialog();
        }, 600);
      } else {
        setFeedback({
          text: res.failureReason || "Erreur lors de l'impression sur l'imprimante.",
          type: "error",
        });
      }
    } catch (err: any) {
      setFeedback({ text: err?.message || "Erreur d'impression", type: "error" });
    } finally {
      setIsPrinting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] max-h-[720px] flex flex-col overflow-hidden text-slate-100">
        {/* Top Dialog Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center border border-primary-500/30">
              <Printer size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                {request?.title || "Imprimer l'étiquette"}
                <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                  {w} × {h} mm
                </span>
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            disabled={isPrinting}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Dialog Split: Settings Panel (Left) & Live Preview (Right) */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden">
          {/* ── LEFT: Settings Sidebar (5 cols) ── */}
          <div className="md:col-span-5 border-r border-slate-800/80 bg-slate-900/60 p-5 overflow-y-auto space-y-4 text-xs flex flex-col justify-between">
            <div className="space-y-4">
              {/* Feedback Alert */}
              {feedback && (
                <div
                  className={cn(
                    "p-3 rounded-xl flex items-center gap-2 text-xs font-semibold",
                    feedback.type === "success"
                      ? "bg-emerald-950/60 border border-emerald-700/80 text-emerald-300"
                      : "bg-rose-950/60 border border-rose-700/80 text-rose-300"
                  )}
                >
                  {feedback.type === "success" ? (
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle size={16} className="text-rose-400 shrink-0" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}

              {/* Destination Printer */}
              <div>
                <label className="block text-2xs uppercase tracking-wider font-bold text-slate-400 mb-1.5">
                  Destination / Imprimante
                </label>
                <select
                  value={selectedPrinter}
                  onChange={(e) => setSelectedPrinter(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-primary-500"
                >
                  <option value="">(Imprimante par défaut Windows)</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName || p.name} {p.isDefault ? "★ (Défaut)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-3xs text-slate-500 mt-1">
                  Connectée en USB (ex: Gprinter GP-3150TN, GP-80160).
                </p>
              </div>

              {/* Copies Stepper */}
              <div>
                <label className="block text-2xs uppercase tracking-wider font-bold text-slate-400 mb-1.5">
                  Nombre d'exemplaires
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setCopies(Math.max(1, copies - 1))}
                      className="px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={copies}
                      onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-14 text-center bg-transparent text-xs font-bold text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setCopies(copies + 1)}
                      className="px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="text-2xs text-slate-400">
                    {copies > 1 ? `${copies} étiquettes identiques` : "1 étiquette"}
                  </span>
                </div>
              </div>

              {/* Label Size Preset */}
              <div>
                <label className="block text-2xs uppercase tracking-wider font-bold text-slate-400 mb-1.5">
                  Format du rouleau d'étiquettes
                </label>
                <select
                  value={labelSize}
                  onChange={(e) => setLabelSize(e.target.value as LabelSizePreset)}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-primary-500"
                >
                  {LABEL_SIZE_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Format Personnalisé (mm)...</option>
                </select>

                {labelSize === "custom" && (
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800">
                    <div>
                      <span className="text-3xs text-slate-400 block mb-1">Largeur (mm)</span>
                      <input
                        type="number"
                        min={15}
                        max={150}
                        value={customWidth}
                        onChange={(e) => setCustomWidth(Number(e.target.value) || 45)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <span className="text-3xs text-slate-400 block mb-1">Hauteur (mm)</span>
                      <input
                        type="number"
                        min={15}
                        max={150}
                        value={customHeight}
                        onChange={(e) => setCustomHeight(Number(e.target.value) || 35)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Orientation toggle */}
              <div>
                <label className="block text-2xs uppercase tracking-wider font-bold text-slate-400 mb-1.5">
                  Orientation
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLandscape(false)}
                    className={cn(
                      "py-1.5 px-3 rounded-xl border text-xs font-semibold text-center transition-all",
                      !landscape
                        ? "border-primary-500 bg-primary-500/20 text-primary-300"
                        : "border-slate-800 bg-slate-800/50 text-slate-400 hover:text-white"
                    )}
                  >
                    Portrait (0°)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLandscape(true)}
                    className={cn(
                      "py-1.5 px-3 rounded-xl border text-xs font-semibold text-center transition-all",
                      landscape
                        ? "border-primary-500 bg-primary-500/20 text-primary-300"
                        : "border-slate-800 bg-slate-800/50 text-slate-400 hover:text-white"
                    )}
                  >
                    Paysage (90°)
                  </button>
                </div>
              </div>

              {/* Advanced Calibration Offsets Toggle */}
              <div className="pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-2xs font-semibold text-primary-400 hover:text-primary-300"
                >
                  <Sliders size={13} />
                  <span>
                    {showAdvanced
                      ? "Masquer le calibrage fin"
                      : "Calibrage tête d'impression (Décalage mm)..."}
                  </span>
                  {(offsetX !== 0 || offsetY !== 0) && (
                    <span className="text-3xs px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      X:{offsetX > 0 ? `+${offsetX}` : offsetX}mm
                    </span>
                  )}
                </button>

                {showAdvanced && (
                  <div className="mt-2.5 p-3 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-2.5">
                    <p className="text-3xs text-slate-400 leading-relaxed">
                      Si votre étiquette imprimée est décalée ou coupée par le bord, appliquez un décalage
                      en millimètres (l'aperçu à droite se met à jour en direct).
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-3xs text-slate-300 block mb-1">
                          Décalage X (G/D)
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.5"
                            min="-10"
                            max="10"
                            value={offsetX}
                            onChange={(e) => setOffsetX(parseFloat(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                          />
                          <span className="text-3xs text-slate-500">mm</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-3xs text-slate-300 block mb-1">
                          Décalage Y (H/B)
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.5"
                            min="-10"
                            max="10"
                            value={offsetY}
                            onChange={(e) => setOffsetY(parseFloat(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                          />
                          <span className="text-3xs text-slate-500">mm</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Direct Print Option & Action Buttons */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveAsSilent}
                  onChange={(e) => setSaveAsSilent(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 bg-slate-800 text-primary-500 focus:ring-0"
                />
                <div className="text-2xs">
                  <span className="font-semibold text-slate-200 block">
                    Toujours imprimer directement (Mode instantané)
                  </span>
                  <span className="text-slate-500 text-3xs">
                    Sortie immédiate sans afficher cette fenêtre à chaque fois (comme les tickets de caisse).
                  </span>
                </div>
              </label>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isPrinting}
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={isPrinting || isLoadingHtml}
                  className="flex-1 py-2 px-4 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors disabled:opacity-50"
                >
                  {isPrinting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Impression...</span>
                    </>
                  ) : (
                    <>
                      <Printer size={14} />
                      <span>Imprimer</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Physical Label Preview Board (7 cols) ── */}
          <div className="md:col-span-7 bg-slate-950/90 flex flex-col items-center justify-center p-6 relative overflow-hidden select-none">
            {/* Aspect Ratio Live Label Simulator */}
            <div className="flex flex-col items-center justify-center w-full h-full max-h-[520px]">
              <div className="text-2xs text-slate-400 font-mono mb-3 flex items-center gap-2">
                <span>Aperçu physique réel :</span>
                <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                  {w} mm (L) × {h} mm (H)
                </span>
                {copies > 1 && (
                  <span className="text-slate-500">× {copies}</span>
                )}
              </div>

              {/* The Physical Sticker Mockup */}
              <div
                className="relative bg-white shadow-2xl rounded-sm border border-slate-300 overflow-hidden transition-all duration-150 flex items-center justify-center"
                style={{
                  width: `${cardW}px`,
                  height: `${cardH}px`,
                }}
              >
                {isLoadingHtml ? (
                  <div className="flex flex-col items-center justify-center gap-2 text-slate-400 text-xs p-6">
                    <Loader2 size={24} className="animate-spin text-primary-600" />
                    <span>Génération de l'aperçu...</span>
                  </div>
                ) : previewHtml ? (
                  <div
                    style={{
                      width: `${cardW}px`,
                      height: `${cardH}px`,
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    <iframe
                      title="Aperçu Étiquette"
                      srcDoc={previewHtml}
                      scrolling="no"
                      className="border-0 pointer-events-none select-none absolute top-0 left-0"
                      sandbox="allow-same-origin"
                      style={{
                        width: `${baseW}px`,
                        height: `${baseH * Math.max(pageCount, 1)}px`,
                        transform: `scale(${scale}) translateY(-${currentPage * baseH}px)`,
                        transformOrigin: "top left",
                      }}
                    />
                  </div>
                ) : (
                  <div className="text-slate-400 text-xs p-4 text-center">
                    Aucun aperçu disponible
                  </div>
                )}
              </div>

              {/* Pagination controls for multiple labels/pages */}
              {pageCount > 1 && (
                <div className="mt-3 flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="Étiquette précédente"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="font-mono text-3xs text-slate-300">
                    Étiquette {currentPage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={currentPage >= pageCount - 1}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="Étiquette suivante"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}

              {/* Status Note */}
              <div className="mt-4 text-center">
                <p className="text-3xs text-slate-500 max-w-sm">
                  Impression native directe aux dimensions réelles. Zéro marge navigateur, zéro découpe.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
