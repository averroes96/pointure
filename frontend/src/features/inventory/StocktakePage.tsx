import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  ScanBarcode,
  Search,
  Plus,
  Play,
  CheckCircle2,
  AlertTriangle,
  X,
  Volume2,
  VolumeX,
  Package,
  Layers,
  ArrowUpDown,
  Printer,
  FileDown,
  RotateCcw,
  ShieldCheck,
  Building2,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Filter,
  Check,
  Pause,
  AlertCircle,
  Clock,
  Sparkles,
} from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import type { StocktakeSession, StocktakeItem, Branch } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";
import ManagerPinModal from "@/components/ui/ManagerPinModal";

// ── Web Audio Synthesizer (No external assets required) ───────────────────────

function playAudioFeedback(type: "success" | "error" | "carton") {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === "success") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "carton") {
      [880, 1100, 1400].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.05);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.05 + 0.06);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.05);
        osc.stop(ctx.currentTime + idx * 0.05 + 0.06);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.setValueAtTime(140, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch {
    // Audio context may be restricted before first gesture
  }
}

// ── Print Variance Sheet Helper ───────────────────────────────────────────────

function printVarianceReport(
  session: StocktakeSession,
  storeName: string,
  t: (key: string, defaultVal?: string) => string
) {
  const items = session.items || [];
  const shortages = items.filter((i) => i.counted_qty < i.expected_qty);
  const surpluses = items.filter((i) => i.counted_qty > i.expected_qty);
  const exacts = items.filter((i) => i.counted_qty === i.expected_qty);

  const win = window.open("", "_blank");
  if (!win) return;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light">
  <title>PV d'Inventaire — ${session.title}</title>
  <style>
    :root { color-scheme: light !important; }
    html, body {
      background: #ffffff !important;
      color: #1e293b !important;
      color-scheme: light !important;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 30px; font-size: 13px; }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.5px; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12px; background: #f8fafc; padding: 12px; border-radius: 8px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; text-align: center; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
    .kpi-val { font-size: 18px; font-weight: bold; font-family: monospace; }
    .kpi-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
    th { background: #f1f5f9; text-align: left; padding: 8px; border: 1px solid #cbd5e1; font-weight: 600; }
    td { padding: 6px 8px; border: 1px solid #e2e8f0; }
    .num { text-align: right; font-family: monospace; }
    .neg { color: #dc2626; font-weight: bold; }
    .pos { color: #16a34a; font-weight: bold; }
    .signatures { margin-top: 50px; display: flex; justify-content: space-between; padding: 0 40px; }
    .sig-box { width: 220px; border-top: 1px solid #0f172a; text-align: center; padding-top: 8px; font-weight: bold; }
    @media print {
      body { margin: 15px; background: #ffffff !important; color: #1e293b !important; }
      @page { size: A4; margin: 1.5cm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${storeName} — PROCÈS-VERBAL D'INVENTAIRE</h1>
    <p style="margin: 4px 0; color: #64748b;">${session.title}</p>
  </div>

  <div class="meta">
    <div>
      <strong>Date :</strong> ${new Date(session.created_at).toLocaleString("fr-DZ")}<br>
      <strong>Succursale :</strong> ${session.branch_name || t("inventory.all_branches_global", "Toutes succursales")}
    </div>
    <div style="text-align: right;">
      <strong>Statut :</strong> ${session.status_display}<br>
      <strong>Clôturé par :</strong> ${session.completed_by ? "Responsable" : "En cours"}
    </div>
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-val">${session.total_expected}</div>
      <div class="kpi-lbl">${t("inventory.theoretical_stock", "Stock Théorique")}</div>
    </div>
    <div class="kpi">
      <div class="kpi-val" style="color: #2563eb;">${session.total_counted}</div>
      <div class="kpi-lbl">${t("inventory.counted_stock", "Stock Compté")}</div>
    </div>
    <div class="kpi">
      <div class="kpi-val ${session.total_variance < 0 ? 'neg' : session.total_variance > 0 ? 'pos' : ''}">
        ${session.total_variance > 0 ? '+' : ''}${session.total_variance}
      </div>
      <div class="kpi-lbl">${t("inventory.variance_pairs", "Écart Paires")}</div>
    </div>
    <div class="kpi">
      <div class="kpi-val ${Number(session.total_variance_cost) < 0 ? 'neg' : Number(session.total_variance_cost) > 0 ? 'pos' : ''}">
        ${formatDZD(session.total_variance_cost)} DZD
      </div>
      <div class="kpi-lbl">${t("inventory.financial_impact", "Impact Financier")}</div>
    </div>
  </div>

  <h3 style="margin-bottom: 6px;">Articles avec écarts (${shortages.length + surpluses.length} références)</h3>
  <table>
    <thead>
      <tr>
        <th>${t("inventory.col_item_ref", "Article & Réf")}</th>
        <th>${t("inventory.col_size", "Taille")} / ${t("inventory.col_colour", "Couleur")}</th>
        <th>${t("inventory.col_barcode", "Code-barres")}</th>
        <th class="num">${t("inventory.col_theoretical", "Théorique")}</th>
        <th class="num">${t("inventory.col_counted", "Compté")}</th>
        <th class="num">${t("inventory.col_variance", "Écart")}</th>
        <th class="num">${t("inventory.col_cost_impact", "Impact (DZD)")}</th>
        <th>${t("inventory.col_notes", "Remarques")}</th>
      </tr>
    </thead>
    <tbody>
      ${[...shortages, ...surpluses]
        .map((it) => {
          const varQty = it.counted_qty - it.expected_qty;
          const varCost = Number(it.unit_cost) * varQty;
          return `
            <tr>
              <td><strong>${it.product_name}</strong> ${it.product_reference ? `(${it.product_reference})` : ''}</td>
              <td>P.${it.size_eu || '-'} / ${it.colour || '-'}</td>
              <td style="font-family: monospace;">${it.barcode || '-'}</td>
              <td class="num">${it.expected_qty}</td>
              <td class="num" style="font-weight: bold;">${it.counted_qty}</td>
              <td class="num ${varQty < 0 ? 'neg' : 'pos'}">${varQty > 0 ? '+' : ''}${varQty}</td>
              <td class="num ${varCost < 0 ? 'neg' : 'pos'}">${formatDZD(varCost)}</td>
              <td>${it.notes || '-'}</td>
            </tr>
          `;
        })
        .join("")}
      ${shortages.length + surpluses.length === 0 ? `<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 12px;">${t("inventory.no_variance_perfect", "Aucun écart constaté. Tout le stock est 100% conforme.")}</td></tr>` : ''}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-box">${t("inventory.operator_visa", "Visa de l'Opérateur / Compteur")}</div>
    <div class="sig-box">${t("inventory.manager_visa", "Visa & Signature du Gérant")}</div>
  </div>

  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Stocktake Component
// ─────────────────────────────────────────────────────────────────────────────

export default function StocktakePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const storeName = user?.tenant?.name ?? "Pointure";

  // Navigation / View state
  const [activeSessionId, setActiveSessionId] = useState<string | number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  // Fast Scan Station state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [multiplier, setMultiplier] = useState<number>(1);
  const [scanMode, setScanMode] = useState<"auto" | "prompt_qty">("auto");
  const [promptQtyModal, setPromptQtyModal] = useState<{
    barcode: string;
    item: StocktakeItem;
    inputQty: string;
    mode: "add" | "set";
  } | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [bindSearch, setBindSearch] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScannedItem, setLastScannedItem] = useState<{
    item: StocktakeItem;
    increment: number;
    timestamp: number;
  } | null>(null);
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [scanErrorMsg, setScanErrorMsg] = useState<string | null>(null);

  // Validation modal options
  const [applyOnlyScanned, setApplyOnlyScanned] = useState<boolean>(true);
  const [applyKeepOpen, setApplyKeepOpen] = useState<boolean>(false);

  // Table filtering, search and pagination in active session
  const [searchFilter, setSearchFilter] = useState("");
  const [triageFilter, setTriageFilter] = useState<"all" | "scanned" | "variance" | "shortage" | "surplus" | "uncounted" | "exact">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const promptQtyInputRef = useRef<HTMLInputElement>(null);

  // Query: Sessions list
  const { data: sessions, isLoading: sessionsLoading } = useQuery<StocktakeSession[]>({
    queryKey: ["stocktake-sessions"],
    queryFn: () => api.get("/inventory/stocktakes/").then((r) => r.data.results || r.data),
  });

  // Query: Active Session Detail
  const { data: activeSession, isLoading: sessionLoading } = useQuery<StocktakeSession>({
    queryKey: ["stocktake-session", activeSessionId],
    queryFn: () => api.get(`/inventory/stocktakes/${activeSessionId}/`).then((r) => r.data),
    enabled: !!activeSessionId,
  });

  // Always keep scan input focused when in active session
  useEffect(() => {
    if (activeSessionId && activeSession?.status !== "completed" && !promptQtyModal && !unknownBarcode) {
      scanInputRef.current?.focus();
    }
  }, [activeSessionId, activeSession?.status, lastScannedItem, promptQtyModal, unknownBarcode]);

  useEffect(() => {
    if (promptQtyModal) {
      setTimeout(() => {
        promptQtyInputRef.current?.focus();
        promptQtyInputRef.current?.select();
      }, 30);
    }
  }, [promptQtyModal]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchFilter, triageFilter, activeSessionId]);

  // Flash reset timer
  useEffect(() => {
    if (!scanFlash) return;
    const timer = setTimeout(() => setScanFlash(null), 800);
    return () => clearTimeout(timer);
  }, [scanFlash]);

  // Search variants to bind an unknown barcode
  const { data: bindCandidates } = useQuery<any[]>({
    queryKey: ["stocktake-bind-candidates", bindSearch],
    queryFn: () =>
      api
        .get("/inventory/variants/", { params: { search: bindSearch.trim(), page_size: 8 } })
        .then((r) => r.data.results || r.data),
    enabled: !!unknownBarcode && bindSearch.trim().length >= 2,
  });

  // Fast Scan Mutation
  const scanMutation = useMutation({
    mutationFn: ({ barcode, increment, setQty }: { barcode: string; increment: number; setQty?: number }) =>
      api
        .post(`/inventory/stocktakes/${activeSessionId}/scan/`, {
          barcode,
          increment,
          ...(setQty !== undefined ? { set_qty: setQty } : {}),
        })
        .then((r) => r.data),
    onSuccess: (data, vars) => {
      setScanErrorMsg(null);
      setUnknownBarcode(null);
      setScanFlash("success");
      if (soundEnabled) {
        playAudioFeedback(vars.increment > 1 ? "carton" : "success");
      }
      setLastScannedItem({
        item: data.item,
        increment: vars.increment,
        timestamp: Date.now(),
      });
      setBarcodeInput("");
      if (scanMode === "prompt_qty" && vars.increment === 0 && vars.setQty === undefined) {
        setPromptQtyModal({
          barcode: vars.barcode,
          item: data.item,
          inputQty: String(multiplier > 1 ? multiplier : 1),
          mode: "add",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["stocktake-session", activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-sessions"] });
    },
    onError: (err: any, vars) => {
      const msg = getApiError(err);
      setScanErrorMsg(msg);
      if (err?.response?.status === 404) {
        setUnknownBarcode(vars.barcode);
        setBindSearch("");
      }
      setScanFlash("error");
      if (soundEnabled) playAudioFeedback("error");
      setBarcodeInput("");
    },
  });

  // Bind Unknown Barcode Mutation
  const bindBarcodeMutation = useMutation({
    mutationFn: ({ variantId, barcode, increment }: { variantId: number | string; barcode: string; increment: number }) =>
      api
        .post(`/inventory/stocktakes/${activeSessionId}/bind-barcode/`, {
          variant_id: variantId,
          barcode,
          increment,
        })
        .then((r) => r.data),
    onSuccess: (data, vars) => {
      setUnknownBarcode(null);
      setScanErrorMsg(null);
      setBindSearch("");
      setScanFlash("success");
      if (soundEnabled) playAudioFeedback("success");
      setLastScannedItem({
        item: data.item,
        increment: vars.increment,
        timestamp: Date.now(),
      });
      queryClient.invalidateQueries({ queryKey: ["stocktake-session", activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["variants"] });
    },
  });

  // Manual Quantity Update Mutation
  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, countedQty, notes }: { itemId: number; countedQty?: number; notes?: string }) =>
      api.patch(`/inventory/stocktakes/${activeSessionId}/update-item/`, {
        item_id: itemId,
        ...(countedQty !== undefined ? { counted_qty: countedQty } : {}),
        ...(notes !== undefined ? { notes } : {}),
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stocktake-session", activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-sessions"] });
    },
  });

  // Apply Inventory Mutation
  const applyMutation = useMutation({
    mutationFn: (opts?: { pin?: string; onlyScanned?: boolean; keepOpen?: boolean }) =>
      api.post(`/inventory/stocktakes/${activeSessionId}/apply/`, {
        only_scanned: opts?.onlyScanned ?? applyOnlyScanned,
        keep_open: opts?.keepOpen ?? applyKeepOpen,
        ...(opts?.pin ? { manager_pin: opts.pin } : {}),
      }).then((r) => r.data),
    onSuccess: () => {
      setConfirmApply(false);
      setShowPinModal(false);
      queryClient.invalidateQueries({ queryKey: ["stocktake-session", activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["variants"] });
    },
    onError: (err: any) => {
      const msg = getApiError(err);
      if (msg.includes("PIN") && user?.role === "cashier") {
        setShowPinModal(true);
      } else {
        alert(msg);
      }
    },
  });

  // Handle Barcode Submit
  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code || !activeSessionId) return;
    if (scanMode === "prompt_qty") {
      scanMutation.mutate({ barcode: code, increment: 0 });
    } else {
      scanMutation.mutate({ barcode: code, increment: multiplier });
    }
  }

  // Filtered & Sorted items in active session
  const filteredItems = useMemo(() => {
    if (!activeSession?.items) return [];
    return activeSession.items.filter((item) => {
      // Text search
      const q = searchFilter.toLowerCase().trim();
      const matchSearch =
        !q ||
        item.product_name.toLowerCase().includes(q) ||
        (item.product_reference && item.product_reference.toLowerCase().includes(q)) ||
        (item.barcode && item.barcode.includes(q)) ||
        (item.product_brand && item.product_brand.toLowerCase().includes(q)) ||
        String(item.size_eu).includes(q) ||
        item.colour.toLowerCase().includes(q);

      if (!matchSearch) return false;

      // Triage filter
      const diff = item.counted_qty - item.expected_qty;
      const isScanned = Boolean(item.last_scanned_at) || item.counted_qty > 0;
      if (triageFilter === "scanned") return isScanned;
      if (triageFilter === "variance") return diff !== 0;
      if (triageFilter === "shortage") return diff < 0;
      if (triageFilter === "surplus") return diff > 0;
      if (triageFilter === "uncounted") return !isScanned;
      if (triageFilter === "exact") return diff === 0 && isScanned;
      return true;
    });
  }, [activeSession?.items, searchFilter, triageFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  // Breakdown statistics for current session
  const stats = useMemo(() => {
    if (!activeSession?.items) {
      return {
        totalRefs: 0,
        scannedRefs: 0,
        shortagesCount: 0,
        surplusesCount: 0,
        exactCount: 0,
        scannedWithVarianceCount: 0,
        progressPct: 0,
      };
    }
    const items = activeSession.items;
    const totalRefs = items.length;
    const scannedItems = items.filter((i) => Boolean(i.last_scanned_at) || i.counted_qty > 0);
    const scannedRefs = scannedItems.length;
    const shortagesCount = items.filter((i) => i.counted_qty < i.expected_qty).length;
    const surplusesCount = items.filter((i) => i.counted_qty > i.expected_qty).length;
    const exactCount = scannedItems.filter((i) => i.counted_qty === i.expected_qty).length;
    const scannedWithVarianceCount = scannedItems.filter((i) => i.counted_qty !== i.expected_qty).length;
    const progressPct = totalRefs > 0 ? Math.round((scannedRefs / totalRefs) * 100) : 0;
    return { totalRefs, scannedRefs, shortagesCount, surplusesCount, exactCount, scannedWithVarianceCount, progressPct };
  }, [activeSession?.items]);

  // ── Render: Active Fast Scan View ───────────────────────────────────────────
  if (activeSessionId && activeSession) {
    const isCompleted = activeSession.status === "completed";

    return (
      <div className="space-y-5 pb-12 animate-in fade-in duration-200">
        {/* Top Header & Breadcrumb */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-border shadow-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveSessionId(null)}
                className="text-xs font-semibold text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
              >
                <ClipboardList size={14} />
                Toutes les sessions
              </button>
              <ChevronRight size={14} className="text-text-muted" />
              <span className="text-xs font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md">
                Session active
              </span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-black text-text-primary tracking-tight">
                {activeSession.title}
              </h1>
              <span className={cn("badge text-xs font-bold", getStatusBadgeClass(activeSession.status))}>
                {activeSession.status_display}
              </span>
              {activeSession.branch_name && (
                <span className="text-xs text-text-muted flex items-center gap-1 bg-surface px-2.5 py-1 rounded-lg border border-border">
                  <Building2 size={13} className="text-primary-500" />
                  {activeSession.branch_name}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => printVarianceReport(activeSession, storeName, t)}
              className="btn-secondary btn-sm flex items-center gap-1.5"
              title={t("inventory.print_pv")}
            >
              <Printer size={15} />
              {t("inventory.print_pv")}
            </button>

            {!isCompleted && stats.scannedRefs > 0 && (
              <button
                onClick={() => {
                  setApplyOnlyScanned(true);
                  setApplyKeepOpen(true);
                  setConfirmApply(true);
                }}
                className="btn-secondary btn-sm flex items-center gap-1.5 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                title={t("inventory.apply_discrepancies_tooltip")}
              >
                <Layers size={15} />
                {t("inventory.validate_scanned_batch", "Valider le lot scanné")} ({stats.scannedRefs})
              </button>
            )}

            {!isCompleted && (
              <button
                onClick={() => {
                  setApplyOnlyScanned(stats.scannedRefs < stats.totalRefs);
                  setApplyKeepOpen(false);
                  setConfirmApply(true);
                }}
                className="btn-primary btn-sm flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20"
              >
                <CheckCircle2 size={15} />
                {t("inventory.close_and_adjust", "Clôturer & Ajuster le Stock")}
              </button>
            )}
          </div>
        </div>

        {/* Global KPIs Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">{t("inventory.counted_stock")}</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-black font-mono text-indigo-700">{activeSession.total_counted}</span>
              <span className="text-xs text-text-muted">{t("inventory.pairs", "paires")}</span>
            </div>
            <div className="mt-2 text-2xs text-text-muted flex items-center justify-between border-t border-border/60 pt-2">
              <span>{t("inventory.theoretical_colon", "Théorique :")}</span>
              <span className="font-mono font-semibold">{activeSession.total_expected} {t("inventory.pairs", "paires")}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">{t("inventory.net_variance")}</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span
                className={cn(
                  "text-2xl font-black font-mono",
                  activeSession.total_variance < 0 ? "text-rose-600" : activeSession.total_variance > 0 ? "text-emerald-600" : "text-text-primary"
                )}
              >
                {activeSession.total_variance > 0 ? `+${activeSession.total_variance}` : activeSession.total_variance}
              </span>
              <span className="text-xs text-text-muted">{t("inventory.pairs", "paires")}</span>
            </div>
            <div className="mt-2 text-2xs text-text-muted flex items-center justify-between border-t border-border/60 pt-2">
              <span>{t("inventory.missing_pairs")}</span>
              <span className="font-mono text-rose-600 font-bold">-{stats.shortagesCount} refs</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">{t("inventory.financial_impact_cost")}</span>
            <div className="flex items-baseline gap-1 mt-2">
              <span
                className={cn(
                  "text-xl font-black font-mono",
                  Number(activeSession.total_variance_cost) < 0
                    ? "text-rose-600"
                    : Number(activeSession.total_variance_cost) > 0
                    ? "text-emerald-600"
                    : "text-text-primary"
                )}
              >
                {formatDZD(activeSession.total_variance_cost)}
              </span>
              <span className="text-xs text-text-muted font-sans font-bold">DZD</span>
            </div>
            <div className="mt-2 text-2xs text-text-muted flex items-center justify-between border-t border-border/60 pt-2">
              <span>{t("inventory.surplus_pairs")}</span>
              <span className="font-mono text-emerald-600 font-bold">+{stats.surplusesCount} refs</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">{t("inventory.coverage")}</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-black font-mono text-primary-600">{stats.progressPct}%</span>
              <span className="text-xs text-text-muted">({stats.scannedRefs}/{stats.totalRefs})</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
              <div
                className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${stats.progressPct}%` }}
              />
            </div>
          </div>

          <div className="col-span-2 lg:col-span-1 bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">{t("inventory.audio_mode")}</span>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={cn(
                  "p-1.5 rounded-lg border transition-all cursor-pointer",
                  soundEnabled
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-surface text-text-muted border-border"
                )}
                title={soundEnabled ? "Bip sonore actif" : "Silencieux"}
              >
                {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
            </div>
            <div className="mt-2 text-2xs text-text-muted leading-relaxed">
              {soundEnabled ? "Bip aigu au scan, double tonalité sur les cartons." : "Mode muet activé."}
            </div>
            <div className="mt-2 border-t border-border/60 pt-1.5 text-2xs text-text-muted flex items-center gap-1 font-mono">
              <Sparkles size={11} className="text-amber-500" />
              Scan sans clic actif
            </div>
          </div>
        </div>

        {/* ── FAST SCAN STATION (HERO INPUT) ─────────────────────────────── */}
        {!isCompleted && (
          <div
            className={cn(
              "rounded-3xl p-5 sm:p-6 border transition-all duration-300 shadow-md",
              scanFlash === "success"
                ? "bg-emerald-50/70 border-emerald-400 ring-4 ring-emerald-500/20"
                : scanFlash === "error"
                ? "bg-rose-50/70 border-rose-400 ring-4 ring-rose-500/20"
                : "bg-gradient-to-r from-slate-900 to-indigo-950 text-white border-slate-800"
            )}
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-white/10 text-emerald-400 backdrop-blur-xs">
                  <ScanBarcode size={24} />
                </div>
                <div>
                  <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                    Station de Scan Rapide
                    <span className="text-2xs font-mono font-normal uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                      Douchette prête
                    </span>
                  </h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Scannez par paire (+1), par carton (+6/+12/+18/+24) ou en mode Pile/Lot (saisie de quantité après scan).
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Scan Mode Toggle */}
                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-2xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setScanMode("auto");
                      setPromptQtyModal(null);
                      scanInputRef.current?.focus();
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                      scanMode === "auto"
                        ? "bg-emerald-500 text-white shadow-xs"
                        : "text-slate-300 hover:text-white hover:bg-white/10"
                    )}
                  >
                    +Auto au scan
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScanMode("prompt_qty");
                      scanInputRef.current?.focus();
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                      scanMode === "prompt_qty"
                        ? "bg-amber-500 text-slate-950 shadow-xs"
                        : "text-slate-300 hover:text-white hover:bg-white/10"
                    )}
                    title={t("inventory.batch_hint")}
                  >
                    {t("inventory.batch_prompt")} Saisie Qté (Pile/Lot)
                  </button>
                </div>

                {/* Multiplier Pills */}
                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-2xl border border-white/10 backdrop-blur-xs">
                  <span className="text-2xs font-bold text-slate-400 px-2 uppercase tracking-wider">{t("inventory.batch_prompt")}</span>
                  {[
                    { label: "+1", val: 1 },
                    { label: "+6", val: 6 },
                    { label: "+12", val: 12 },
                    { label: "+18", val: 18 },
                    { label: "+24", val: 24 },
                  ].map((m) => (
                    <button
                      key={m.val}
                      type="button"
                      onClick={() => {
                        setMultiplier(m.val);
                        scanInputRef.current?.focus();
                      }}
                      className={cn(
                        "px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                        multiplier === m.val
                          ? "bg-primary-500 text-white shadow-xs"
                          : "text-slate-300 hover:text-white hover:bg-white/10"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <form onSubmit={handleBarcodeSubmit} className="relative">
              <input
                ref={scanInputRef}
                type="text"
                autoFocus
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder={
                  scanMode === "prompt_qty"
                    ? "Mode Pile/Lot actif : scannez un article pour saisir directement sa quantité..."
                    : `Scannez ici ou tapez le code-barres / référence / nom puis Entrée (+${multiplier})...`
                }
                className="w-full h-14 pl-12 pr-32 rounded-2xl bg-white text-slate-900 placeholder:text-slate-400 font-mono text-base sm:text-lg font-bold border-2 border-transparent focus:border-primary-400 focus:outline-none focus:ring-4 focus:ring-primary-500/30 transition-all shadow-inner"
              />
              <ScanBarcode className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />

              <button
                type="submit"
                disabled={!barcodeInput.trim() || scanMutation.isPending}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 px-5 h-9 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {scanMutation.isPending ? "Comptage..." : scanMode === "prompt_qty" ? "Identifier" : `Compter +${multiplier}`}
              </button>
            </form>

            {/* Prompt Quantity Inline Bar (Pile / Lot Mode) */}
            {promptQtyModal && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const qty = Math.max(0, parseInt(promptQtyModal.inputQty) || 0);
                  if (promptQtyModal.mode === "set") {
                    scanMutation.mutate({ barcode: promptQtyModal.barcode, increment: 0, setQty: qty });
                  } else {
                    scanMutation.mutate({ barcode: promptQtyModal.barcode, increment: qty });
                  }
                  setPromptQtyModal(null);
                }}
                className="mt-4 p-4 rounded-2xl bg-amber-500/20 border-2 border-amber-400/60 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-2xs font-black uppercase">
                      Saisie Quantité Pile / Lot
                    </span>
                    <span className="text-sm font-black text-white">{promptQtyModal.item.product_name}</span>
                    {promptQtyModal.item.product_reference && (
                      <span className="text-xs font-mono text-amber-200">({promptQtyModal.item.product_reference})</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-200 mt-1">
                    Déjà compté : <strong className="font-mono text-emerald-300">{promptQtyModal.item.counted_qty}</strong> paires · Stock théorique :{" "}
                    <strong className="font-mono">{promptQtyModal.item.expected_qty}</strong> paires
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex rounded-xl bg-black/40 p-0.5 border border-white/15">
                    <button
                      type="button"
                      onClick={() => setPromptQtyModal({ ...promptQtyModal, mode: "add" })}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-2xs font-bold cursor-pointer",
                        promptQtyModal.mode === "add" ? "bg-amber-400 text-slate-950" : "text-slate-300"
                      )}
                    >
                      + Ajouter
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPromptQtyModal({
                          ...promptQtyModal,
                          mode: "set",
                          inputQty: String(promptQtyModal.item.counted_qty || 1),
                        })
                      }
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-2xs font-bold cursor-pointer",
                        promptQtyModal.mode === "set" ? "bg-amber-400 text-slate-950" : "text-slate-300"
                      )}
                    >
                      = Fixer total
                    </button>
                  </div>

                  <input
                    ref={promptQtyInputRef}
                    type="number"
                    min={0}
                    value={promptQtyModal.inputQty}
                    onChange={(e) => setPromptQtyModal({ ...promptQtyModal, inputQty: e.target.value })}
                    className="w-24 h-10 rounded-xl bg-white text-slate-900 font-mono font-black text-base text-center border-2 border-amber-400 focus:outline-none"
                  />

                  <button
                    type="submit"
                    className="h-10 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs cursor-pointer"
                  >
                    Valider (Entrée)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptQtyModal(null)}
                    className="p-2 text-slate-300 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </form>
            )}

            {/* Error Message + Unknown Barcode Quick-Association Panel */}
            {scanErrorMsg && (
              <div className="mt-3 p-3.5 rounded-2xl bg-rose-500/20 border border-rose-400/40 text-rose-100 text-xs space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle size={16} className="text-rose-400 shrink-0" />
                    <span>{scanErrorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setScanErrorMsg(null);
                      setUnknownBarcode(null);
                    }}
                    className="text-rose-300 hover:text-white"
                  >
                    <X size={15} />
                  </button>
                </div>

                {unknownBarcode && (
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-white/15 space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="text-2xs font-bold text-amber-300 uppercase tracking-wider">
                        Associer le code « {unknownBarcode} » à un article existant & compter (+{multiplier}) :
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                      <input
                        type="text"
                        value={bindSearch}
                        onChange={(e) => setBindSearch(e.target.value)}
                        placeholder="Rechercher l'article par référence ou nom (ex: 1457, BL-HS10)..."
                        className="w-full h-9 pl-8 pr-3 rounded-lg bg-white text-slate-900 text-xs font-medium focus:outline-none"
                      />
                    </div>
                    {bindCandidates && bindCandidates.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pt-1">
                        {bindCandidates.map((v: any) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() =>
                              bindBarcodeMutation.mutate({
                                variantId: v.id,
                                barcode: unknownBarcode,
                                increment: multiplier,
                              })
                            }
                            className="flex items-center justify-between p-2 rounded-lg bg-white/10 hover:bg-emerald-500/30 border border-white/10 text-left transition-all cursor-pointer"
                          >
                            <div>
                              <div className="text-xs font-bold text-white">
                                {v.product_name || v.str || `Article #${v.id}`}
                              </div>
                              <div className="text-2xs text-slate-300 font-mono">
                                {v.product_reference ? `Réf: ${v.product_reference} · ` : ""}
                                {v.size_eu ? `P.${v.size_eu} ` : ""}
                                {v.colour && v.colour !== "Standard" ? v.colour : ""}
                              </div>
                            </div>
                            <span className="px-2 py-1 rounded bg-emerald-500 text-white text-2xs font-bold shrink-0">
                              Associer & +{multiplier}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Last Scanned Item Card */}
            {lastScannedItem && (
              <div className="mt-4 p-3.5 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {lastScannedItem.item.product_image ? (
                      <img
                        src={lastScannedItem.item.product_image}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Package size={20} className="text-slate-300" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-white">
                        {lastScannedItem.item.product_name}
                      </span>
                      {lastScannedItem.item.product_reference && (
                        <span className="text-2xs font-mono text-slate-300 bg-white/10 px-1.5 py-0.5 rounded">
                          {lastScannedItem.item.product_reference}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-2xs text-slate-300 mt-1">
                      {lastScannedItem.item.size_eu > 0 && (
                        <span className="font-bold text-white bg-primary-500/30 px-2 py-0.5 rounded border border-primary-400/30">
                          Pointure {lastScannedItem.item.size_eu}
                        </span>
                      )}
                      {lastScannedItem.item.colour && lastScannedItem.item.colour !== "Standard" && (
                        <span>Couleur : {lastScannedItem.item.colour}</span>
                      )}
                      <span className="font-mono text-slate-400">({lastScannedItem.item.barcode})</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 self-end sm:self-center">
                  <div className="text-right">
                    <span className="text-2xs text-slate-400 block uppercase font-bold">Total Compté</span>
                    <span className="text-lg font-black font-mono text-emerald-400">
                      {lastScannedItem.item.counted_qty} paires
                    </span>
                  </div>

                  <div className="text-right pl-3 border-l border-white/10">
                    <span className="text-2xs text-slate-400 block uppercase font-bold">Écart</span>
                    <span
                      className={cn(
                        "text-lg font-black font-mono",
                        lastScannedItem.item.variance_qty < 0
                          ? "text-rose-400"
                          : lastScannedItem.item.variance_qty > 0
                          ? "text-emerald-400"
                          : "text-slate-300"
                      )}
                    >
                      {lastScannedItem.item.variance_qty > 0 ? `+${lastScannedItem.item.variance_qty}` : lastScannedItem.item.variance_qty}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LIVE INVENTORY TABLE & TRIAGE ───────────────────────────────── */}
        <div className="bg-white rounded-3xl border border-border shadow-xs overflow-hidden">
          {/* Controls Bar */}
          <div className="p-4 sm:p-5 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Triage Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              {[
                { key: "all", label: `Tous (${stats.totalRefs})` },
                { key: "scanned", label: `Scannés (${stats.scannedRefs})`, color: "text-indigo-600" },
                { key: "variance", label: `Écarts (${stats.shortagesCount + stats.surplusesCount})`, alert: stats.shortagesCount + stats.surplusesCount > 0 },
                { key: "shortage", label: `Manquants (${stats.shortagesCount})`, color: "text-rose-600" },
                { key: "surplus", label: `Excédents (${stats.surplusesCount})`, color: "text-emerald-600" },
                { key: "uncounted", label: `Non scannés (${stats.totalRefs - stats.scannedRefs})` },
                { key: "exact", label: `Conformes (${stats.exactCount})` },
              ].map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setTriageFilter(pill.key as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
                    triageFilter === pill.key
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-surface text-text-muted hover:text-text-primary border border-border"
                  )}
                >
                  <span className={triageFilter === pill.key ? "text-white" : pill.color}>{pill.label}</span>
                </button>
              ))}
            </div>

            {/* Search Box */}
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filtrer par nom, réf, code-barres..."
                className="w-full h-10 pl-9 pr-3.5 rounded-xl bg-surface border border-border text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface/70 text-text-muted border-b border-border text-2xs uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">{t("inventory.col_item_ref")}</th>
                  <th className="py-3 px-3">{t("inventory.col_size")}</th>
                  <th className="py-3 px-3">{t("inventory.col_colour")}</th>
                  <th className="py-3 px-3">{t("inventory.col_barcode")}</th>
                  <th className="py-3 px-3 text-right">{t("inventory.col_theoretical")}</th>
                  <th className="py-3 px-4 text-center">{t("inventory.col_counted")}</th>
                  <th className="py-3 px-3 text-right">{t("inventory.col_variance")}</th>
                  <th className="py-3 px-4 text-right">{t("inventory.col_cost_impact")}</th>
                  <th className="py-3 px-4">{t("inventory.col_notes")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginatedItems.map((item) => {
                  const variance = item.counted_qty - item.expected_qty;
                  const itemCostVariance = Number(item.unit_cost) * variance;

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "hover:bg-surface/50 transition-colors",
                        variance < 0 ? "bg-rose-50/20" : variance > 0 ? "bg-emerald-50/20" : ""
                      )}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-lg bg-surface border border-border flex items-center justify-center shrink-0 overflow-hidden">
                            {item.product_image ? (
                              <img src={item.product_image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Package size={15} className="text-text-muted" />
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-text-primary line-clamp-1">{item.product_name}</div>
                            {item.product_reference && (
                              <div className="text-2xs font-mono text-text-muted">{item.product_reference}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-xs bg-surface px-2 py-0.5 rounded border border-border">
                          {item.size_eu || "-"}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-text-secondary font-medium">{item.colour || "-"}</td>

                      <td className="py-3 px-3 font-mono text-2xs text-text-muted">{item.barcode || "-"}</td>

                      <td className="py-3 px-3 text-right font-mono font-bold text-text-secondary">
                        {item.expected_qty}
                      </td>

                      {/* Counted Quantity with Stepper */}
                      <td className="py-3 px-4 text-center">
                        {isCompleted ? (
                          <span className="font-mono font-black text-sm text-text-primary">{item.counted_qty}</span>
                        ) : (
                          <div className="inline-flex items-center gap-1 bg-surface border border-border rounded-xl p-1 shadow-2xs">
                            <button
                              type="button"
                              onClick={() =>
                                updateItemMutation.mutate({
                                  itemId: item.id,
                                  countedQty: Math.max(0, item.counted_qty - 1),
                                })
                              }
                              className="w-7 h-7 rounded-lg hover:bg-white text-text-muted hover:text-text-primary font-bold flex items-center justify-center transition-all cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={item.counted_qty}
                              onChange={(e) =>
                                updateItemMutation.mutate({
                                  itemId: item.id,
                                  countedQty: Math.max(0, parseInt(e.target.value) || 0),
                                })
                              }
                              className="w-12 text-center font-mono font-black text-sm bg-transparent focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateItemMutation.mutate({
                                  itemId: item.id,
                                  countedQty: item.counted_qty + 1,
                                })
                              }
                              className="w-7 h-7 rounded-lg hover:bg-white text-text-muted hover:text-text-primary font-bold flex items-center justify-center transition-all cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Variance */}
                      <td className="py-3 px-3 text-right">
                        <span
                          className={cn(
                            "font-mono font-bold text-xs px-2 py-0.5 rounded-lg",
                            variance < 0
                              ? "bg-rose-100 text-rose-800"
                              : variance > 0
                              ? "bg-emerald-100 text-emerald-800"
                              : "text-text-muted"
                          )}
                        >
                          {variance > 0 ? `+${variance}` : variance}
                        </span>
                      </td>

                      {/* Variance Cost */}
                      <td className="py-3 px-4 text-right font-mono font-semibold">
                        <span className={variance < 0 ? "text-rose-600" : variance > 0 ? "text-emerald-600" : "text-text-muted"}>
                          {formatDZD(itemCostVariance)} <span className="text-3xs text-text-muted font-sans">DZD</span>
                        </span>
                      </td>

                      {/* Notes / Last Scan */}
                      <td className="py-3 px-4">
                        {isCompleted ? (
                          <span className="text-2xs text-text-muted">{item.notes || "-"}</span>
                        ) : (
                          <input
                            type="text"
                            defaultValue={item.notes || ""}
                            onBlur={(e) => {
                              if (e.target.value !== (item.notes || "")) {
                                updateItemMutation.mutate({ itemId: item.id, notes: e.target.value });
                              }
                            }}
                            placeholder="Ajouter une note..."
                            className="w-full bg-transparent text-2xs text-text-primary placeholder:text-text-muted focus:bg-white focus:outline-none px-2 py-1 rounded border border-transparent focus:border-border transition-all"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-text-muted">
                      <ClipboardList size={32} className="mx-auto text-slate-300 mb-2" />
                      <p className="font-medium text-xs">
                        {stats.totalRefs === 0
                          ? "Mode Scan Libre actif : scannez votre premier code-barres ci-dessus pour ajouter et compter les articles au fur et à mesure."
                          : "Aucun article ne correspond aux filtres sélectionnés."}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {filteredItems.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-surface/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-text-muted">
              <div className="flex items-center gap-2">
                <span>
                  Affichage de{" "}
                  <strong className="text-text-primary">{(currentPage - 1) * pageSize + 1}</strong> à{" "}
                  <strong className="text-text-primary">
                    {Math.min(currentPage * pageSize, filteredItems.length)}
                  </strong>{" "}
                  sur <strong className="text-text-primary">{filteredItems.length}</strong> articles
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-7 px-2 rounded-lg border border-border bg-white text-2xs font-bold text-text-primary"
                >
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                  <option value={250}>250 / page</option>
                </select>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="btn-secondary btn-xs disabled:opacity-40"
                  >
                    Précédent
                  </button>
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-border font-mono font-bold text-text-primary">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="btn-secondary btn-xs disabled:opacity-40"
                  >
                    Suivant
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Confirmation Modal to Apply Inventory */}
        {confirmApply && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="p-6 border-b border-border flex items-center justify-between bg-emerald-50/50">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-emerald-100 text-emerald-700">
                    <CheckCircle2 size={22} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-text-primary">
                      {applyKeepOpen ? "Valider le lot scanné & Continuer" : "Clôturer & Ajuster le Stock"}
                    </h3>
                    <p className="text-xs text-text-muted">
                      {applyKeepOpen
                        ? "Applique immédiatement les écarts des articles scannés et garde la session ouverte"
                        : "Synchronisation des stocks physiques"}
                    </p>
                  </div>
                </div>
                <button onClick={() => setConfirmApply(false)} className="text-text-muted hover:text-text-primary p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Reconciliation Scope Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-primary block">
                    Mode d'ajustement du stock :
                  </label>
                  <label
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all",
                      applyOnlyScanned
                        ? "border-emerald-500 bg-emerald-50/40"
                        : "border-border bg-surface/50 hover:bg-surface"
                    )}
                  >
                    <input
                      type="radio"
                      name="applyScope"
                      checked={applyOnlyScanned}
                      onChange={() => setApplyOnlyScanned(true)}
                      className="mt-0.5 accent-emerald-600"
                    />
                    <div className="text-xs">
                      <div className="font-bold text-text-primary">
                        Ajuster uniquement les articles scannés / comptés ({stats.scannedRefs} réf.) — Recommandé
                      </div>
                      <p className="text-2xs text-text-muted mt-0.5">
                        Idéal pour un inventaire partiel ou sur plusieurs jours : seuls les articles que vous avez scannés ou modifiés seront ajustés ({stats.scannedWithVarianceCount} avec écart). Les articles non scannés restent intacts.
                      </p>
                    </div>
                  </label>

                  {!applyKeepOpen && stats.totalRefs > stats.scannedRefs && (
                    <label
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all",
                        !applyOnlyScanned
                          ? "border-rose-500 bg-rose-50/40"
                          : "border-border bg-surface/50 hover:bg-surface"
                      )}
                    >
                      <input
                        type="radio"
                        name="applyScope"
                        checked={!applyOnlyScanned}
                        onChange={() => setApplyOnlyScanned(false)}
                        className="mt-0.5 accent-rose-600"
                      />
                      <div className="text-xs">
                        <div className="font-bold text-text-primary">
                          Inventaire complet strict — Mettre à 0 les {stats.totalRefs - stats.scannedRefs} articles non scannés
                        </div>
                        <p className="text-2xs text-rose-700 mt-0.5">
                          Attention : tous les articles pré-chargés non scannés dans cette session verront leur stock passer à 0.
                        </p>
                      </div>
                    </label>
                  )}
                </div>

                {/* Keep Session Open Checkbox */}
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-50/60 border border-indigo-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyKeepOpen}
                    onChange={(e) => {
                      setApplyKeepOpen(e.target.checked);
                      if (e.target.checked) setApplyOnlyScanned(true);
                    }}
                    className="mt-0.5 accent-indigo-600 rounded"
                  />
                  <div className="text-2xs">
                    <span className="font-bold text-indigo-950 block">
                      Garder la session ouverte après validation de ce lot (Inventaire sur plusieurs jours / rayons)
                    </span>
                    <span className="text-indigo-700">
                      Les articles déjà scannés sont mis à jour en stock dès maintenant et vous pourrez continuer à scanner le reste du magasin plus tard.
                    </span>
                  </div>
                </label>

                <div className="p-4 rounded-2xl bg-surface border border-border space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Session :</span>
                    <span className="font-bold text-text-primary">{activeSession.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Articles audités (scannés) :</span>
                    <span className="font-mono font-bold text-indigo-700">
                      {stats.scannedRefs} réf. ({activeSession.total_counted} paires)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Références qui seront ajustées :</span>
                    <span className="font-mono font-extrabold text-emerald-700">
                      {applyOnlyScanned
                        ? `${stats.scannedWithVarianceCount} réf.`
                        : `${stats.shortagesCount + stats.surplusesCount} réf.`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-2 bg-surface/50">
                <button
                  type="button"
                  onClick={() => setConfirmApply(false)}
                  className="btn-secondary btn-sm"
                  disabled={applyMutation.isPending}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyMutation.mutate({
                      onlyScanned: applyOnlyScanned,
                      keepOpen: applyKeepOpen,
                    })
                  }
                  className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                  disabled={applyMutation.isPending}
                >
                  {applyMutation.isPending
                    ? "Ajustement en cours..."
                    : applyKeepOpen
                    ? "Valider ce lot & Continuer"
                    : "Confirmer & Clôturer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manager PIN Modal if Cashier */}
        {showPinModal && (
          <ManagerPinModal
            isOpen={showPinModal}
            title="Validation d'inventaire requise"
            reason="Le code PIN d'un responsable est obligatoire pour valider et appliquer les écarts d'inventaire."
            actionDescription="Clôture de l'inventaire et ajustement automatique des stocks"
            onCancel={() => setShowPinModal(false)}
            onSuccess={(pin) => {
              setShowPinModal(false);
              applyMutation.mutate({
                pin,
                onlyScanned: applyOnlyScanned,
                keepOpen: applyKeepOpen,
              });
            }}
          />
        )}
      </div>
    );
  }

  // ── Render: Session List View ───────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-150">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-text-primary tracking-tight flex items-center gap-2.5">
            <ClipboardList className="text-primary-600" size={26} />
            Inventaire Physique & Scan Rapide
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Inventaire tournant par scan libre, par rayon/étagère ou général — conçu pour les catalogues de plusieurs milliers d'articles.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2 shadow-xs cursor-pointer"
        >
          <Plus size={16} />
          Nouvel Inventaire
        </button>
      </div>

      {/* Sessions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sessions?.map((sess) => {
          const isDone = sess.status === "completed";

          return (
            <div
              key={sess.id}
              className={cn(
                "bg-white rounded-3xl p-5 border border-border shadow-xs hover:shadow-md transition-all flex flex-col justify-between group",
                isDone ? "border-emerald-200/80 bg-emerald-50/10" : ""
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <span className={cn("badge text-xs font-bold", getStatusBadgeClass(sess.status))}>
                    {sess.status_display}
                  </span>
                  <span className="text-2xs text-text-muted font-mono">
                    {new Date(sess.created_at).toLocaleDateString("fr-DZ")}
                  </span>
                </div>

                <h3 className="font-bold text-base text-text-primary line-clamp-1 group-hover:text-primary-600 transition-colors">
                  {sess.title}
                </h3>
                <p className="text-2xs text-text-muted mt-0.5 flex items-center gap-1">
                  <Building2 size={12} />
                  {sess.branch_name || "Toutes les succursales"}
                </p>

                {/* Scope if any */}
                {(sess.scope_brand || sess.scope_category || sess.notes) && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {sess.scope_brand && (
                      <span className="text-3xs font-semibold px-2 py-0.5 rounded bg-surface border border-border text-text-secondary">
                        Marque: {sess.scope_brand}
                      </span>
                    )}
                    {sess.scope_category && (
                      <span className="text-3xs font-semibold px-2 py-0.5 rounded bg-surface border border-border text-text-secondary">
                        Catégorie: {sess.scope_category}
                      </span>
                    )}
                    {sess.notes && (
                      <span className="text-3xs font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 line-clamp-1">
                        {sess.notes}
                      </span>
                    )}
                  </div>
                )}

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2 bg-surface p-3 rounded-2xl border border-border mt-4 text-center">
                  <div>
                    <span className="text-3xs uppercase font-bold text-text-muted block">Compté</span>
                    <span className="text-sm font-black font-mono text-indigo-700">{sess.total_counted}</span>
                  </div>
                  <div>
                    <span className="text-3xs uppercase font-bold text-text-muted block">Théorique</span>
                    <span className="text-sm font-black font-mono text-text-secondary">{sess.total_expected}</span>
                  </div>
                  <div>
                    <span className="text-3xs uppercase font-bold text-text-muted block">Écart</span>
                    <span
                      className={cn(
                        "text-sm font-black font-mono",
                        sess.total_variance < 0 ? "text-rose-600" : sess.total_variance > 0 ? "text-emerald-600" : "text-text-muted"
                      )}
                    >
                      {sess.total_variance > 0 ? `+${sess.total_variance}` : sess.total_variance}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between text-2xs text-text-muted px-1">
                  <span>{t("inventory.financial_impact", "Impact Financier")} :</span>
                  <span className="font-mono font-bold text-text-primary">
                    {formatDZD(sess.total_variance_cost)} DZD
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="pt-4 border-t border-border mt-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => printVarianceReport(sess, storeName)}
                  className="btn-secondary btn-xs flex items-center gap-1 text-text-muted hover:text-text-primary"
                  title="Imprimer PV"
                >
                  <Printer size={13} />
                  PV
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSessionId(sess.id)}
                  className={cn(
                    "btn-sm flex items-center gap-1.5 font-bold cursor-pointer",
                    isDone
                      ? "btn-secondary"
                      : "btn-primary bg-primary-600 hover:bg-primary-700 shadow-primary-600/20"
                  )}
                >
                  {isDone ? (
                    <>Consulter <ChevronRight size={14} /></>
                  ) : (
                    <>
                      <ScanBarcode size={15} />
                      Reprendre le scan
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}

        {sessions?.length === 0 && (
          <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-border p-8">
            <ClipboardList size={40} className="mx-auto text-slate-300 mb-3" />
            <h3 className="font-bold text-base text-text-primary">{t("inventory.no_sessions")}</h3>
            <p className="text-xs text-text-muted max-w-md mx-auto mt-1 mb-5">
              {t("inventory.no_sessions_hint", "Créez votre première session d'inventaire physique (partiel par scan libre, par rayon/marque, ou général).")}
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus size={16} />
              {t("inventory.start_stocktake", "Démarrer un Inventaire")}
            </button>
          </div>
        )}
      </div>

      {/* Create New Stocktake Session Modal */}
      {showCreateModal && (
        <CreateStocktakeModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(newSession) => {
            setShowCreateModal(false);
            setActiveSessionId(newSession.id);
            queryClient.invalidateQueries({ queryKey: ["stocktake-sessions"] });
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal: Create New Stocktake Session
// ─────────────────────────────────────────────────────────────────────────────

function CreateStocktakeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (session: StocktakeSession) => void;
}) {
  const { t } = useTranslation();
  const [inventoryMode, setInventoryMode] = useState<"scan_only" | "scoped" | "full">("scan_only");
  const [title, setTitle] = useState(`Inventaire du ${new Date().toLocaleDateString("fr-DZ")}`);
  const [branchId, setBranchId] = useState<string>("");
  const [scopeLocation, setScopeLocation] = useState("");
  const [scopeBrand, setScopeBrand] = useState("");
  const [scopeCategory, setScopeCategory] = useState("");
  const [scopeReference, setScopeReference] = useState("");
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load branches
  const { data: branches } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data.results || r.data),
  });

  // Load distinct brands & shelf locations for quick selection
  const { data: brandsList } = useQuery<string[]>({
    queryKey: ["product-brands"],
    queryFn: () => api.get("/inventory/products/brands/").then((r) => r.data),
  });

  const { data: locationsList } = useQuery<string[]>({
    queryKey: ["product-locations", branchId],
    queryFn: () =>
      api
        .get("/inventory/products/locations/", { params: branchId ? { branch: branchId } : {} })
        .then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api
        .post("/inventory/stocktakes/", {
          title,
          branch: branchId ? Number(branchId) : null,
          scope_brand: inventoryMode === "scoped" ? scopeBrand.trim() : "",
          scope_category: inventoryMode === "scoped" ? scopeCategory : "",
          scope_location: inventoryMode === "scoped" ? scopeLocation.trim() : "",
          scope_reference: inventoryMode === "scoped" ? scopeReference.trim() : "",
          only_in_stock: inventoryMode !== "scan_only" ? onlyInStock : false,
          auto_populate: inventoryMode !== "scan_only",
          notes,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      onCreated(data);
    },
    onError: (err) => setError(getApiError(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto">
        <div className="p-5 border-b border-border flex items-center justify-between bg-primary-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary-100 text-primary-700">
              <ClipboardList size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-text-primary">{t("inventory.new_stocktake_title")}</h3>
              <p className="text-2xs text-text-muted">{t("inventory.new_stocktake_subtitle")}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="p-5 space-y-4 max-h-[82vh] overflow-y-auto"
        >
          {error && (
            <div className="p-3 bg-danger-light text-danger text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          {/* Inventory Mode Selector */}
          <div className="space-y-2">
            <label className="form-label text-xs">{t("inventory.inventory_type")}</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setInventoryMode("scan_only");
                  if (title.startsWith("Inventaire")) {
                    setTitle(`Inventaire Tournant du ${new Date().toLocaleDateString("fr-DZ")}`);
                  }
                }}
                className={cn(
                  "p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between",
                  inventoryMode === "scan_only"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20"
                    : "border-border bg-surface/40 hover:bg-surface"
                )}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-text-primary">{t("inventory.mode_scan_only")}</span>
                    <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {t("inventory.mode_scan_only_recommended")}
                    </span>
                  </div>
                  <p className="text-2xs text-text-muted mt-1 leading-snug">
                    {t("inventory.mode_scan_only_desc")}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInventoryMode("scoped");
                  if (title.startsWith("Inventaire")) {
                    setTitle(`Inventaire Ciblé du ${new Date().toLocaleDateString("fr-DZ")}`);
                  }
                }}
                className={cn(
                  "p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between",
                  inventoryMode === "scoped"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20"
                    : "border-border bg-surface/40 hover:bg-surface"
                )}
              >
                <div>
                  <span className="text-xs font-black text-text-primary block">{t("inventory.mode_scoped")}</span>
                  <p className="text-2xs text-text-muted mt-1 leading-snug">
                    {t("inventory.mode_scoped_desc")}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInventoryMode("full");
                  if (title.startsWith("Inventaire")) {
                    setTitle(`Inventaire Général du ${new Date().toLocaleDateString("fr-DZ")}`);
                  }
                }}
                className={cn(
                  "p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between",
                  inventoryMode === "full"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20"
                    : "border-border bg-surface/40 hover:bg-surface"
                )}
              >
                <div>
                  <span className="text-xs font-black text-text-primary block">{t("inventory.mode_full")}</span>
                  <p className="text-2xs text-text-muted mt-1 leading-snug">
                    {t("inventory.mode_full_desc")}
                  </p>
                </div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label text-xs">{t("inventory.session_title")}</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="form-input text-xs font-bold"
                placeholder={t("inventory.session_title_placeholder")}
              />
            </div>

            <div>
              <label className="form-label text-xs">{t("inventory.branch_col", "Succursale")}</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="form-input text-xs"
              >
                <option value="">{t("inventory.all_branches_global")}</option>
                {branches?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scoped Filters */}
          {inventoryMode === "scoped" && (
            <div className="p-3.5 rounded-2xl bg-surface border border-border space-y-3">
              <div className="text-2xs font-bold uppercase tracking-wider text-primary-700">
                {t("inventory.filters")}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-2xs">{t("inventory.shelf_location_label")}</label>
                  <input
                    type="text"
                    list="stocktake-locations-list"
                    value={scopeLocation}
                    onChange={(e) => setScopeLocation(e.target.value)}
                    className="form-input text-xs"
                    placeholder={t("inventory.shelf_location_placeholder")}
                  />
                  <datalist id="stocktake-locations-list">
                    {locationsList?.map((loc) => (
                      <option key={loc} value={loc} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="form-label text-2xs">{t("inventory.category")}</label>
                  <select
                    value={scopeCategory}
                    onChange={(e) => setScopeCategory(e.target.value)}
                    className="form-input text-xs"
                  >
                    <option value="">{t("inventory.all_categories_stocktake")}</option>
                    <option value="sneakers">Baskets / Sneakers</option>
                    <option value="boots">Bottes / Bottines</option>
                    <option value="sandals">Sandales</option>
                    <option value="formal">Classique / Ville</option>
                    <option value="sport">Sport</option>
                    <option value="kids">Chaussures Enfants</option>
                    <option value="slippers">Pantoufles / Claquettes</option>
                    <option value="other">Autre</option>
                  </select>
                </div>

                <div>
                  <label className="form-label text-2xs">{t("inventory.brand")}</label>
                  <input
                    type="text"
                    list="stocktake-brands-list"
                    value={scopeBrand}
                    onChange={(e) => setScopeBrand(e.target.value)}
                    className="form-input text-xs"
                    placeholder={t("inventory.brand_placeholder")}
                  />
                  <datalist id="stocktake-brands-list">
                    {brandsList?.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="form-label text-2xs">{t("inventory.sku", "Préfixe Référence / Modèle")}</label>
                  <input
                    type="text"
                    value={scopeReference}
                    onChange={(e) => setScopeReference(e.target.value)}
                    className="form-input text-xs font-mono"
                    placeholder={t("inventory.ref_prefix_placeholder")}
                  />
                </div>
              </div>
            </div>
          )}

          {inventoryMode !== "scan_only" && (
            <label className="p-3 rounded-2xl bg-surface border border-border flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={(e) => setOnlyInStock(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-primary-600 rounded border-border"
              />
              <div>
                <span className="text-xs font-bold text-text-primary block">
                  {t("inventory.exclude_out_of_stock", "Exclure les articles déjà en rupture (Pré-charger uniquement si stock théorique > 0)")}
                </span>
                <span className="text-2xs text-text-muted">
                  {t("inventory.exclude_out_of_stock_hint", "Évite d'encombrer la liste avec d'anciennes références épuisées (vous pourrez toujours les scanner si vous en retrouvez une boîte).")}
                </span>
              </div>
            </label>
          )}

          <div>
            <label className="form-label text-xs">{t("common.notes")}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input text-xs resize-none"
              placeholder={t("inventory.session_notes_placeholder")}
            />
          </div>

          <div className="pt-3 border-t border-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary btn-sm"
              disabled={mutation.isPending}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn-primary btn-sm flex items-center gap-1.5"
              disabled={mutation.isPending || !title.trim()}
            >
              {mutation.isPending ? t("common.loading") : t("inventory.start_stocktake_session", "Démarrer l'inventaire")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
