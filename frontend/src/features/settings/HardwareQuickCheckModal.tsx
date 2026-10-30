import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  X,
  ScanBarcode,
  Receipt,
  Printer,
  CheckCircle2,
  AlertCircle,
  Zap,
  Scissors,
  Layers,
  ShoppingBag,
  Volume2,
  Sparkles,
  ArrowRight,
  Clock,
  Trash2,
  RefreshCw,
  Loader2,
} from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import {
  getPrinterConfig,
  savePrinterConfig,
  testPrintTicket,
  type PrinterConfig,
} from "@/lib/printerConfig";
import type { PrinterInfo } from "@/vite-env";
import { cn } from "@/lib/utils";

interface MatchedVariant {
  id: number;
  barcode: string;
  size_eu: number;
  colour: string;
  product_name: string;
  product_brand?: string;
  product_reference?: string;
  product_sale_price?: string;
  stock_qty: number;
}

interface ScanHistoryItem {
  id: string;
  barcode: string;
  timestamp: string;
  scanTimeMs?: number;
  matchedProduct?: string;
  sizeEu?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "scanner" | "printer";
}

/**
 * Synthesizes a realistic retail POS barcode scanner beep (2093 Hz, 70ms)
 * using the Web Audio API without any external dependencies.
 */
function playScannerBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(2093, ctx.currentTime); // C7 ~ 2093 Hz
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  } catch {
    // Gracefully ignore if autoplay policy blocks before user interaction
  }
}

export default function HardwareQuickCheckModal({
  isOpen,
  onClose,
  initialTab = "scanner",
}: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"scanner" | "printer">(initialTab);

  // ── Scanner State ──
  const [scanInput, setScanInput] = useState("");
  const [isFlashing, setIsFlashing] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [lastScanSpeedMs, setLastScanSpeedMs] = useState<number | null>(null);
  const [matchedVariant, setMatchedVariant] = useState<MatchedVariant | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [isInputFocused, setIsInputFocused] = useState(false);

  const scannerInputRef = useRef<HTMLInputElement>(null);
  const scanStartTimeRef = useRef<number | null>(null);

  // ── Printer State ──
  const [config, setConfig] = useState<PrinterConfig>(getPrinterConfig());
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testPrinting, setTestPrinting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const isDesktop = !!window.electronAPI?.isDesktop;

  // Sync config when modal opens
  useEffect(() => {
    if (isOpen) {
      setConfig(getPrinterConfig());
      setActiveTab(initialTab);
      setFeedbackMessage(null);
    }
  }, [isOpen, initialTab]);

  // Load Windows printers if on Desktop
  const loadPrinters = useCallback(async () => {
    if (!window.electronAPI?.getPrinters) return;
    setLoadingPrinters(true);
    try {
      const list = await window.electronAPI.getPrinters();
      setPrinters(list || []);
    } catch (err) {
      console.warn("Could not load printer list:", err);
    } finally {
      setLoadingPrinters(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && isDesktop) {
      loadPrinters();
    }
  }, [isOpen, isDesktop, loadPrinters]);

  // Auto-focus scanner input when modal opens or scanner tab is active
  useEffect(() => {
    if (isOpen && activeTab === "scanner") {
      const timer = setTimeout(() => {
        scannerInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, activeTab]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Helper to show temporary feedback message
  const showFeedback = (text: string, type: "success" | "error" = "success") => {
    setFeedbackMessage({ text, type });
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  // ── Execute Barcode Scan Processing ──
  const handleProcessScan = async (rawCode: string, speedMs?: number) => {
    const barcode = rawCode.trim();
    if (!barcode) return;

    // 1. Play POS scanner audio beep
    playScannerBeep();

    // 2. Trigger visual green flash
    setIsFlashing(true);
    setLastScannedBarcode(barcode);
    setLastScanSpeedMs(speedMs ?? null);
    setTimeout(() => {
      setIsFlashing(false);
    }, 1800);

    // 3. Clear input field immediately for next scan
    setScanInput("");
    scanStartTimeRef.current = null;
    scannerInputRef.current?.focus();

    // 4. Query backend for footwear model details
    setLookupLoading(true);
    setLookupNotFound(false);
    setMatchedVariant(null);

    let foundVariant: MatchedVariant | null = null;
    try {
      const res = await api.get(`/inventory/variants/?barcode=${encodeURIComponent(barcode)}`);
      const items = res.data?.results || (Array.isArray(res.data) ? res.data : []);
      if (items.length > 0) {
        foundVariant = items[0];
        setMatchedVariant(foundVariant);
      } else {
        // Fallback search
        const fallbackRes = await api.get(`/inventory/variants/?search=${encodeURIComponent(barcode)}`);
        const fallbackItems = fallbackRes.data?.results || [];
        if (fallbackItems.length > 0) {
          foundVariant = fallbackItems[0];
          setMatchedVariant(foundVariant);
        } else {
          setLookupNotFound(true);
        }
      }
    } catch {
      setLookupNotFound(true);
    } finally {
      setLookupLoading(false);
    }

    // 5. Append to recent history
    setScanHistory((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        barcode,
        timestamp: new Date().toLocaleTimeString("fr-DZ", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        scanTimeMs: speedMs,
        matchedProduct: foundVariant ? `${foundVariant.product_brand || ""} ${foundVariant.product_name}`.trim() : undefined,
        sizeEu: foundVariant?.size_eu,
      },
      ...prev.slice(0, 4),
    ]);
  };

  const handleScannerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const speed = scanStartTimeRef.current ? Math.max(1, Date.now() - scanStartTimeRef.current) : undefined;
      handleProcessScan(scanInput, speed);
    } else {
      if (!scanStartTimeRef.current) {
        scanStartTimeRef.current = Date.now();
      }
    }
  };

  // Quick button to simulate scanning a demo barcode
  const handleTestSampleBarcode = () => {
    handleProcessScan("6130001234567", 18);
  };

  // ── Paper Width Change ──
  const handleSelectPaperWidth = (paperWidth: "80mm" | "58mm") => {
    const updated: PrinterConfig = {
      ...config,
      ticket: {
        ...config.ticket,
        paperWidth,
      },
    };
    setConfig(updated);
    savePrinterConfig(updated);
    showFeedback(t("hardware.paper_selected_saved", { format: paperWidth }), "success");
  };

  // ── Ticket Printer Selection Change ──
  const handleSelectPrinterName = (printerName: string) => {
    const updated: PrinterConfig = {
      ...config,
      ticket: {
        ...config.ticket,
        printerName,
      },
    };
    setConfig(updated);
    savePrinterConfig(updated);
  };

  // ── Test Print Ticket Action ──
  const handleTestPrint = async () => {
    setTestPrinting(true);
    try {
      const res = await testPrintTicket(config.ticket.printerName, config.ticket.paperWidth);
      if (res.success) {
        localStorage.setItem("shodz_printer_tested", "true");
        showFeedback(t("hardware.test_print_success", "Ticket test envoyé à l'imprimante !"), "success");
      } else {
        showFeedback(
          t("hardware.test_print_fail", "Échec de l'impression : {{reason}}", {
            reason: res.failureReason || "Vérifiez que l'imprimante est allumée et connectée.",
          }),
          "error"
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showFeedback(message, "error");
    } finally {
      setTestPrinting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hardware-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200/60 dark:border-primary-800/60 flex items-center justify-center shadow-xs">
              <ScanBarcode size={20} className="stroke-[2.2]" />
            </div>
            <div>
              <h2
                id="hardware-modal-title"
                className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"
              >
                <span>{t("hardware.modal_title", "Assistant Matériel POS")}</span>
                <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  Desktop & POS
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  "hardware.modal_subtitle",
                  "Vérification rapide du lecteur code-barres et de l'imprimante thermique"
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label={t("hardware.close", "Fermer")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "scanner"}
              onClick={() => setActiveTab("scanner")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === "scanner"
                  ? "bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-2xs border border-slate-200/80 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <ScanBarcode size={15} />
              <span>{t("hardware.tab_scanner", "Lecteur Code-barres (Douchette)")}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "printer"}
              onClick={() => setActiveTab("printer")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === "printer"
                  ? "bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-2xs border border-slate-200/80 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <Receipt size={15} />
              <span>{t("hardware.tab_printer", "Imprimante & Papier Thermique")}</span>
            </button>
          </div>
        </div>

        {/* Notification Feedback Toast */}
        {feedbackMessage && (
          <div className="px-6 pt-3 shrink-0">
            <div
              className={cn(
                "p-3 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-150",
                feedbackMessage.type === "success"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80"
                  : "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80"
              )}
            >
              {feedbackMessage.type === "success" ? (
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{feedbackMessage.text}</span>
            </div>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* ════════════════ TAB 1: SCANNER ════════════════ */}
          {activeTab === "scanner" && (
            <div className="space-y-5">
              {/* Tip Banner */}
              <div className="p-3.5 rounded-2xl bg-primary-50/60 dark:bg-primary-950/30 border border-primary-200/60 dark:border-primary-900/40 flex items-start gap-3">
                <Volume2 size={16} className="text-primary-600 dark:text-primary-400 mt-0.5 shrink-0" />
                <div className="text-xs text-slate-700 dark:text-slate-300">
                  <p className="font-semibold text-primary-900 dark:text-primary-200">
                    {t(
                      "hardware.assistant_quick_tip",
                      "Astuce : Branchez votre douchette en USB et pointez le faisceau laser sur une étiquette de chaussure."
                    )}
                  </p>
                  <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t(
                      "hardware.scanner_section_desc",
                      "Vérifiez que votre douchette en émulation clavier (HID) transmet correctement le code et la touche Entrée."
                    )}
                  </p>
                </div>
              </div>

              {/* ── Interactive Tester Zone ── */}
              <div
                onClick={() => scannerInputRef.current?.focus()}
                className={cn(
                  "relative p-6 rounded-3xl border-2 transition-all duration-300 cursor-text",
                  isFlashing
                    ? "bg-emerald-50 dark:bg-emerald-950/70 border-emerald-500 ring-4 ring-emerald-500/25 shadow-lg shadow-emerald-500/10"
                    : isInputFocused
                    ? "bg-slate-50/80 dark:bg-slate-800/50 border-primary-500 ring-4 ring-primary-500/15 shadow-sm"
                    : "bg-slate-50/50 dark:bg-slate-800/30 border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400"
                )}
              >
                {/* Active Listening Radar Badge */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                    </span>
                    <span className="text-2xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      {isFlashing
                        ? t("hardware.sound_enabled", "Signal sonore actif (Beep POS)")
                        : t("hardware.scanner_listening", "Écoute active du port HID...")}
                    </span>
                  </div>

                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                    HID USB Wedge
                  </span>
                </div>

                {/* Instruction Icon & Title */}
                <div className="text-center py-2">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 shadow-xs mb-3 text-primary-600 dark:text-primary-400">
                    <ScanBarcode size={28} className="stroke-[2.2]" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t(
                      "hardware.scanner_instruction",
                      "Scannez le code-barres de n'importe quelle boîte avec votre douchette"
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                    {t(
                      "hardware.scanner_placeholder",
                      "En attente du scan (cliquez ici si le curseur n'est pas actif)..."
                    )}
                  </p>
                </div>

                {/* The Interactive Keyboard Wedge Input */}
                <div className="mt-4">
                  <input
                    ref={scannerInputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={handleScannerKeyDown}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    placeholder="EAN-13 / Code-128..."
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    className="w-full text-center text-lg font-mono font-bold tracking-widest px-4 py-3 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white shadow-inner focus:outline-hidden focus:border-primary-500"
                  />
                </div>

                {/* Green Flash Result Banner */}
                {lastScannedBarcode && (
                  <div
                    className={cn(
                      "mt-4 p-4 rounded-2xl border text-center transition-all duration-300",
                      isFlashing
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-md transform scale-102"
                        : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800"
                    )}
                  >
                    <div className="flex items-center justify-center gap-2 font-mono text-sm font-extrabold tracking-wide">
                      <CheckCircle2 size={18} className={isFlashing ? "text-white" : "text-emerald-600 dark:text-emerald-400"} />
                      <span>
                        {t("hardware.scanner_success", "Code-barres lu : {{barcode}} ✓ Douchette prête !", {
                          barcode: lastScannedBarcode,
                        })}
                      </span>
                    </div>

                    {lastScanSpeedMs !== null && (
                      <p
                        className={cn(
                          "text-2xs mt-1 font-sans",
                          isFlashing ? "text-emerald-100" : "text-emerald-700 dark:text-emerald-400"
                        )}
                      >
                        {t("hardware.scanner_speed", "Temps de lecture : {{ms}} ms (Scan instantané)", {
                          ms: lastScanSpeedMs,
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Footwear Product Match Preview (Bonus feature for shoe shop) ── */}
              {lookupLoading && (
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <Loader2 size={16} className="animate-spin text-primary-600" />
                  <span>Recherche dans le catalogue de chaussures...</span>
                </div>
              )}

              {!lookupLoading && matchedVariant && (
                <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2">
                  <div className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    <Sparkles size={14} className="text-emerald-600 dark:text-emerald-400" />
                    <span>{t("hardware.scanner_product_found", "Chaussure identifiée dans le stock :")}</span>
                  </div>

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {matchedVariant.product_brand ? `${matchedVariant.product_brand} — ` : ""}
                        {matchedVariant.product_name}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-2xs font-bold text-slate-700 dark:text-slate-300">
                          {t("hardware.scanner_size", "Pointure")} : {matchedVariant.size_eu}
                        </span>
                        {matchedVariant.colour && (
                          <span className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-2xs font-medium text-slate-600 dark:text-slate-300">
                            {t("hardware.scanner_color", "Couleur")} : {matchedVariant.colour}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/50 text-2xs font-bold text-emerald-800 dark:text-emerald-300">
                          {t("hardware.scanner_stock", "En stock")} : {matchedVariant.stock_qty}
                        </span>
                      </div>
                    </div>

                    {matchedVariant.product_sale_price && (
                      <div className="text-right">
                        <span className="text-sm font-black font-mono text-primary-600 dark:text-primary-400">
                          {formatDZD(matchedVariant.product_sale_price)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!lookupLoading && lookupNotFound && lastScannedBarcode && (
                <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between gap-2">
                  <span>
                    {t(
                      "hardware.scanner_product_not_found",
                      "Code valide (non répertorié dans le stock actuel)"
                    )}
                  </span>
                  <Link
                    to={`/inventory/products/new?barcode=${encodeURIComponent(lastScannedBarcode)}`}
                    className="text-2xs font-bold text-primary-600 dark:text-primary-400 hover:underline shrink-0"
                  >
                    Créer cet article →
                  </Link>
                </div>
              )}

              {/* ── Quick Test Trigger (for testing without physical scanner) ── */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTestSampleBarcode}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                >
                  <Zap size={14} />
                  <span>
                    {t("hardware.scanner_test_sample", "Tester avec un code exemple (6130001234567)")}
                  </span>
                </button>

                {scanHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setScanHistory([])}
                    className="inline-flex items-center gap-1 text-2xs font-medium text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <Trash2 size={12} />
                    <span>{t("hardware.scanner_clear_history", "Effacer l'historique")}</span>
                  </button>
                )}
              </div>

              {/* ── Recent Scans History ── */}
              {scanHistory.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <h4 className="text-2xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Clock size={12} />
                    <span>{t("hardware.scanner_recent_title", "Historique des derniers scans")}</span>
                  </h4>
                  <div className="space-y-1.5">
                    {scanHistory.map((item) => (
                      <div
                        key={item.id}
                        className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-white">
                            {item.barcode}
                          </span>
                          {item.matchedProduct && (
                            <span className="text-2xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                              — {item.matchedProduct} {item.sizeEu ? `(T.${item.sizeEu})` : ""}
                            </span>
                          )}
                        </div>
                        <span className="text-2xs font-mono text-slate-400 shrink-0">
                          {item.timestamp}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════════════════ TAB 2: PRINTER & THERMAL PAPER ════════════════ */}
          {activeTab === "printer" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t("hardware.paper_section_title", "Format du Papier Thermique de Caisse")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t(
                    "hardware.paper_section_desc",
                    "Choisissez la largeur du rouleau installée dans votre imprimante de caisse."
                  )}
                </p>
              </div>

              {/* Visual Side-by-Side Paper Selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ── 80 mm (Standard) Card ── */}
                <div
                  onClick={() => handleSelectPaperWidth("80mm")}
                  className={cn(
                    "relative p-5 rounded-3xl border-2 transition-all duration-200 cursor-pointer flex flex-col justify-between",
                    config.ticket.paperWidth === "80mm"
                      ? "bg-primary-50/40 dark:bg-primary-950/30 border-primary-600 ring-2 ring-primary-600/30 shadow-sm"
                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                  )}
                >
                  <div>
                    {/* Header: Title + Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <span className="text-base font-extrabold text-slate-900 dark:text-white">
                          {t("hardware.paper_80mm_title", "80 mm (Standard Caisse)")}
                        </span>
                        <span className="ml-2 text-2xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                          {t("hardware.paper_80mm_badge", "Recommandé")}
                        </span>
                      </div>

                      <div
                        className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                          config.ticket.paperWidth === "80mm"
                            ? "border-primary-600 bg-primary-600 text-white"
                            : "border-slate-300 dark:border-slate-600"
                        )}
                      >
                        {config.ticket.paperWidth === "80mm" && <CheckCircle2 size={14} className="stroke-[3]" />}
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
                      {t(
                        "hardware.paper_80mm_desc",
                        "Pour imprimante de caisse standard (Xprinter, Epson, Bixolon). Largeur optimale avec détail complet, logo et découpe automatique."
                      )}
                    </p>

                    {/* Realistic Visual Mockup Receipt for 80mm */}
                    <div className="mx-auto w-48 bg-white dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs font-mono text-3xs text-slate-800 dark:text-slate-200 space-y-1.5 select-none">
                      <div className="text-center font-bold pb-1 border-b border-dashed border-slate-300 dark:border-slate-700">
                        ★ SHOEDZ POINTURE ★
                      </div>
                      <div className="flex justify-between">
                        <span>Sneakers Air T.42</span>
                        <span className="font-bold">6 500 DZD</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Mocassins Cuir T.41</span>
                        <span className="font-bold">4 200 DZD</span>
                      </div>
                      <div className="pt-1 border-t border-dashed border-slate-300 dark:border-slate-700 flex justify-between font-bold text-2xs">
                        <span>TOTAL</span>
                        <span>10 700 DZD</span>
                      </div>
                      <div className="text-center pt-1 text-4xs text-slate-400 flex items-center justify-center gap-1">
                        <Scissors size={10} />
                        <span>-------------------</span>
                      </div>
                    </div>
                  </div>

                  {/* Feature Tags */}
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                    <span className="text-2xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      ✓ {t("hardware.paper_80mm_feature_autocut", "Découpe automatique")}
                    </span>
                    <span className="text-2xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      ✓ {t("hardware.paper_80mm_feature_detail", "Mise en page 2 colonnes")}
                    </span>
                  </div>
                </div>

                {/* ── 58 mm (Compact) Card ── */}
                <div
                  onClick={() => handleSelectPaperWidth("58mm")}
                  className={cn(
                    "relative p-5 rounded-3xl border-2 transition-all duration-200 cursor-pointer flex flex-col justify-between",
                    config.ticket.paperWidth === "58mm"
                      ? "bg-primary-50/40 dark:bg-primary-950/30 border-primary-600 ring-2 ring-primary-600/30 shadow-sm"
                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                  )}
                >
                  <div>
                    {/* Header: Title + Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <span className="text-base font-extrabold text-slate-900 dark:text-white">
                          {t("hardware.paper_58mm_title", "58 mm (Compact / Étroit)")}
                        </span>
                        <span className="ml-2 text-2xs font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300">
                          {t("hardware.paper_58mm_badge", "Compact")}
                        </span>
                      </div>

                      <div
                        className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                          config.ticket.paperWidth === "58mm"
                            ? "border-primary-600 bg-primary-600 text-white"
                            : "border-slate-300 dark:border-slate-600"
                        )}
                      >
                        {config.ticket.paperWidth === "58mm" && <CheckCircle2 size={14} className="stroke-[3]" />}
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
                      {t(
                        "hardware.paper_58mm_desc",
                        "Pour mini imprimante thermique portable, Bluetooth ou comptoir étroit. Format économique sans découpe."
                      )}
                    </p>

                    {/* Realistic Visual Mockup Receipt for 58mm */}
                    <div className="mx-auto w-36 bg-white dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs font-mono text-4xs text-slate-800 dark:text-slate-200 space-y-1 select-none">
                      <div className="text-center font-bold pb-1 border-b border-dashed border-slate-300 dark:border-slate-700">
                        ★ SHOEDZ ★
                      </div>
                      <div className="truncate">Air T.42</div>
                      <div className="text-right font-bold">6 500 DZD</div>
                      <div className="truncate">Cuir T.41</div>
                      <div className="text-right font-bold">4 200 DZD</div>
                      <div className="pt-1 border-t border-dashed border-slate-300 dark:border-slate-700 flex justify-between font-bold text-3xs">
                        <span>TOTAL</span>
                        <span>10 700</span>
                      </div>
                    </div>
                  </div>

                  {/* Feature Tags */}
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                    <span className="text-2xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      ✓ {t("hardware.paper_58mm_feature_compact", "Format compact")}
                    </span>
                    <span className="text-2xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      ✓ {t("hardware.paper_58mm_feature_economy", "Économie de papier")}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Printer Device & Test Print Action ── */}
              <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t("hardware.assigned_printer", "Imprimante de caisse utilisée :")}
                    </label>

                    {/* Printer select on desktop or static label on web */}
                    {isDesktop && printers.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={config.ticket.printerName}
                          onChange={(e) => handleSelectPrinterName(e.target.value)}
                          className="px-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                        >
                          <option value="">{t("hardware.default_printer", "Imprimante par défaut Windows / Système")}</option>
                          {printers.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.displayName || p.name} {p.isDefault ? "★ (Défaut)" : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={loadPrinters}
                          disabled={loadingPrinters}
                          title="Actualiser la liste"
                          className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          <RefreshCw size={13} className={cn(loadingPrinters && "animate-spin")} />
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                        {config.ticket.printerName || t("hardware.default_printer", "Imprimante par défaut Windows / Système")}
                      </p>
                    )}
                  </div>

                  {/* Big Test Print Button */}
                  <button
                    type="button"
                    onClick={handleTestPrint}
                    disabled={testPrinting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold text-white bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 transition-all shadow-md cursor-pointer disabled:opacity-60"
                  >
                    {testPrinting ? (
                      <Loader2 size={16} className="animate-spin text-white" />
                    ) : (
                      <Printer size={16} />
                    )}
                    <span>
                      {t("hardware.btn_test_print", "Imprimer un ticket test ({{format}})", {
                        format: config.ticket.paperWidth,
                      })}
                    </span>
                  </button>
                </div>
              </div>

              {/* Link to Full Settings */}
              <div className="text-right">
                <Link
                  to="/settings"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                >
                  <span>{t("hardware.open_full_printer_settings", "Ouvrir les paramètres d'impression complets →")}</span>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {t("hardware.close", "Fermer")}
          </button>
        </div>
      </div>
    </div>
  );
}
