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

function printVarianceReport(session: StocktakeSession, storeName: string) {
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
  <title>PV d'Inventaire — ${session.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 30px; font-size: 13px; color: #1e293b; }
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
      body { margin: 15px; }
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
      <strong>Succursale :</strong> ${session.branch_name || "Toutes succursales"}
    </div>
    <div style="text-align: right;">
      <strong>Statut :</strong> ${session.status_display}<br>
      <strong>Clôturé par :</strong> ${session.completed_by ? "Responsable" : "En cours"}
    </div>
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-val">${session.total_expected}</div>
      <div class="kpi-lbl">Stock Théorique</div>
    </div>
    <div class="kpi">
      <div class="kpi-val" style="color: #2563eb;">${session.total_counted}</div>
      <div class="kpi-lbl">Stock Compté</div>
    </div>
    <div class="kpi">
      <div class="kpi-val ${session.total_variance < 0 ? 'neg' : session.total_variance > 0 ? 'pos' : ''}">
        ${session.total_variance > 0 ? '+' : ''}${session.total_variance}
      </div>
      <div class="kpi-lbl">Écart Paires</div>
    </div>
    <div class="kpi">
      <div class="kpi-val ${Number(session.total_variance_cost) < 0 ? 'neg' : Number(session.total_variance_cost) > 0 ? 'pos' : ''}">
        ${formatDZD(session.total_variance_cost)} DZD
      </div>
      <div class="kpi-lbl">Impact Financier</div>
    </div>
  </div>

  <h3 style="margin-bottom: 6px;">Articles avec écarts (${shortages.length + surpluses.length} références)</h3>
  <table>
    <thead>
      <tr>
        <th>Article & Réf</th>
        <th>Taille / Couleur</th>
        <th>Code-barres</th>
        <th class="num">Théorique</th>
        <th class="num">Compté</th>
        <th class="num">Écart</th>
        <th class="num">Impact (DZD)</th>
        <th>Remarques</th>
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
      ${shortages.length + surpluses.length === 0 ? '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 12px;">Aucun écart constaté. Tout le stock est 100% conforme.</td></tr>' : ''}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-box">Visa de l'Opérateur / Compteur</div>
    <div class="sig-box">Visa & Signature du Gérant</div>
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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScannedItem, setLastScannedItem] = useState<{
    item: StocktakeItem;
    increment: number;
    timestamp: number;
  } | null>(null);
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [scanErrorMsg, setScanErrorMsg] = useState<string | null>(null);

  // Table filtering and search in active session
  const [searchFilter, setSearchFilter] = useState("");
  const [triageFilter, setTriageFilter] = useState<"all" | "variance" | "shortage" | "surplus" | "uncounted" | "exact">("all");

  const scanInputRef = useRef<HTMLInputElement>(null);

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
    if (activeSessionId && activeSession?.status !== "completed") {
      scanInputRef.current?.focus();
    }
  }, [activeSessionId, activeSession?.status, lastScannedItem]);

  // Flash reset timer
  useEffect(() => {
    if (!scanFlash) return;
    const timer = setTimeout(() => setScanFlash(null), 800);
    return () => clearTimeout(timer);
  }, [scanFlash]);

  // Fast Scan Mutation
  const scanMutation = useMutation({
    mutationFn: ({ barcode, increment }: { barcode: string; increment: number }) =>
      api.post(`/inventory/stocktakes/${activeSessionId}/scan/`, { barcode, increment }).then((r) => r.data),
    onSuccess: (data, vars) => {
      setScanErrorMsg(null);
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
      queryClient.invalidateQueries({ queryKey: ["stocktake-session", activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ["stocktake-sessions"] });
    },
    onError: (err: any) => {
      const msg = getApiError(err);
      setScanErrorMsg(msg);
      setScanFlash("error");
      if (soundEnabled) playAudioFeedback("error");
      setBarcodeInput("");
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
    mutationFn: (pin?: string) =>
      api.post(`/inventory/stocktakes/${activeSessionId}/apply/`, {
        ...(pin ? { manager_pin: pin } : {}),
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
    scanMutation.mutate({ barcode: code, increment: multiplier });
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
      if (triageFilter === "variance") return diff !== 0;
      if (triageFilter === "shortage") return diff < 0;
      if (triageFilter === "surplus") return diff > 0;
      if (triageFilter === "uncounted") return item.counted_qty === 0;
      if (triageFilter === "exact") return diff === 0 && item.expected_qty > 0;
      return true;
    });
  }, [activeSession?.items, searchFilter, triageFilter]);

  // Breakdown statistics for current session
  const stats = useMemo(() => {
    if (!activeSession?.items) {
      return { totalRefs: 0, scannedRefs: 0, shortagesCount: 0, surplusesCount: 0, exactCount: 0, progressPct: 0 };
    }
    const items = activeSession.items;
    const totalRefs = items.length;
    const scannedRefs = items.filter((i) => i.counted_qty > 0).length;
    const shortagesCount = items.filter((i) => i.counted_qty < i.expected_qty).length;
    const surplusesCount = items.filter((i) => i.counted_qty > i.expected_qty).length;
    const exactCount = items.filter((i) => i.counted_qty === i.expected_qty).length;
    const progressPct = totalRefs > 0 ? Math.round((scannedRefs / totalRefs) * 100) : 0;
    return { totalRefs, scannedRefs, shortagesCount, surplusesCount, exactCount, progressPct };
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
              onClick={() => printVarianceReport(activeSession, storeName)}
              className="btn-secondary btn-sm flex items-center gap-1.5"
              title="Imprimer le PV d'inventaire"
            >
              <Printer size={15} />
              Imprimer PV
            </button>

            {!isCompleted && (
              <button
                onClick={() => setConfirmApply(true)}
                className="btn-primary btn-sm flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20"
              >
                <CheckCircle2 size={15} />
                Valider & Ajuster le Stock
              </button>
            )}
          </div>
        </div>

        {/* Global KPIs Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">Stock Compté</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-black font-mono text-indigo-700">{activeSession.total_counted}</span>
              <span className="text-xs text-text-muted">paires</span>
            </div>
            <div className="mt-2 text-2xs text-text-muted flex items-center justify-between border-t border-border/60 pt-2">
              <span>Théorique :</span>
              <span className="font-mono font-semibold">{activeSession.total_expected} paires</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">Écart Net (Paires)</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span
                className={cn(
                  "text-2xl font-black font-mono",
                  activeSession.total_variance < 0 ? "text-rose-600" : activeSession.total_variance > 0 ? "text-emerald-600" : "text-text-primary"
                )}
              >
                {activeSession.total_variance > 0 ? `+${activeSession.total_variance}` : activeSession.total_variance}
              </span>
              <span className="text-xs text-text-muted">paires</span>
            </div>
            <div className="mt-2 text-2xs text-text-muted flex items-center justify-between border-t border-border/60 pt-2">
              <span>Manquants :</span>
              <span className="font-mono text-rose-600 font-bold">-{stats.shortagesCount} refs</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">Impact Financier (Coût)</span>
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
              <span>Excédents :</span>
              <span className="font-mono text-emerald-600 font-bold">+{stats.surplusesCount} refs</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-border shadow-xs flex flex-col justify-between">
            <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">Couverture Inventaire</span>
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
              <span className="text-2xs font-bold text-text-muted uppercase tracking-wider">Mode Audio</span>
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
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
                    Scannez les codes-barres sur les boîtes ou cartons en continu sans toucher à la souris.
                  </p>
                </div>
              </div>

              {/* Multiplier Pills */}
              <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-2xl border border-white/10 backdrop-blur-xs">
                <span className="text-2xs font-bold text-slate-400 px-2 uppercase tracking-wider">Multiplicateur :</span>
                {[
                  { label: "+1 paire", val: 1 },
                  { label: "+6 (1/2 carton)", val: 6 },
                  { label: "+12 (Carton)", val: 12 },
                  { label: "+24 (Double)", val: 24 },
                ].map((m) => (
                  <button
                    key={m.val}
                    type="button"
                    onClick={() => {
                      setMultiplier(m.val);
                      scanInputRef.current?.focus();
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
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

            <form onSubmit={handleBarcodeSubmit} className="relative">
              <input
                ref={scanInputRef}
                type="text"
                autoFocus
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="Scannez ici ou tapez le code-barres / référence / nom puis Entrée..."
                className="w-full h-14 pl-12 pr-32 rounded-2xl bg-white text-slate-900 placeholder:text-slate-400 font-mono text-base sm:text-lg font-bold border-2 border-transparent focus:border-primary-400 focus:outline-none focus:ring-4 focus:ring-primary-500/30 transition-all shadow-inner"
              />
              <ScanBarcode className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />

              <button
                type="submit"
                disabled={!barcodeInput.trim() || scanMutation.isPending}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 px-5 h-9 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {scanMutation.isPending ? "Comptage..." : "Valider"}
              </button>
            </form>

            {/* Error Message banner */}
            {scanErrorMsg && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/20 border border-rose-400/40 text-rose-200 text-xs font-medium flex items-center gap-2 animate-in fade-in">
                <AlertCircle size={16} className="text-rose-400 shrink-0" />
                <span>{scanErrorMsg}</span>
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
                      <span className="font-bold text-white bg-primary-500/30 px-2 py-0.5 rounded border border-primary-400/30">
                        Pointure {lastScannedItem.item.size_eu}
                      </span>
                      <span>Couleur : {lastScannedItem.item.colour}</span>
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
                  <span className={pill.color}>{pill.label}</span>
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
                placeholder="Filtrer par nom, réf, taille..."
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
                  <th className="py-3 px-4">Article & Réf</th>
                  <th className="py-3 px-3">Taille</th>
                  <th className="py-3 px-3">Couleur</th>
                  <th className="py-3 px-3">Code-barres</th>
                  <th className="py-3 px-3 text-right">Théorique</th>
                  <th className="py-3 px-4 text-center">Compté (Physique)</th>
                  <th className="py-3 px-3 text-right">Écart</th>
                  <th className="py-3 px-4 text-right">Impact Coût</th>
                  <th className="py-3 px-4">Dernier scan / Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.map((item) => {
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
                      <p className="font-medium text-xs">Aucun article ne correspond aux filtres sélectionnés.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                    <h3 className="font-bold text-base text-text-primary">Clôturer & Ajuster le Stock</h3>
                    <p className="text-xs text-text-muted">Synchronisation définitive des stocks physiques</p>
                  </div>
                </div>
                <button onClick={() => setConfirmApply(false)} className="text-text-muted hover:text-text-primary p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="p-4 rounded-2xl bg-surface border border-border space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Session :</span>
                    <span className="font-bold text-text-primary">{activeSession.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Total compté :</span>
                    <span className="font-mono font-bold text-indigo-700">{activeSession.total_counted} paires</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Écart total en volume :</span>
                    <span
                      className={cn(
                        "font-mono font-extrabold",
                        activeSession.total_variance < 0 ? "text-rose-600" : "text-emerald-600"
                      )}
                    >
                      {activeSession.total_variance > 0 ? `+${activeSession.total_variance}` : activeSession.total_variance} paires
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2">
                    <span className="text-text-muted font-bold">Impact financier brut :</span>
                    <span className="font-mono font-extrabold text-sm text-text-primary">
                      {formatDZD(activeSession.total_variance_cost)} DZD
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-2xs text-amber-800 leading-relaxed space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-600" />
                    Action irréversible :
                  </p>
                  <p>
                    Cette validation créera automatiquement des mouvements de stock d'ajustement (motif <strong>Ajustement inventaire</strong>) pour chaque article présentant un écart. La session sera verrouillée.
                  </p>
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
                  onClick={() => applyMutation.mutate()}
                  className="btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                  disabled={applyMutation.isPending}
                >
                  {applyMutation.isPending ? "Ajustement en cours..." : "Confirmer & Appliquer"}
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
              applyMutation.mutate(pin);
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
            Gérez vos récolements périodiques, comptez vos cartons et paires par code-barres et ajustez le stock sans écart.
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
          const isCancelled = sess.status === "cancelled";

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
                {(sess.scope_brand || sess.scope_category) && (
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
                  <span>Impact Financier :</span>
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
            <h3 className="font-bold text-base text-text-primary">Aucune session d'inventaire</h3>
            <p className="text-xs text-text-muted max-w-md mx-auto mt-1 mb-5">
              Créez votre première session d'inventaire physique pour scanner les paires et cartons de chaussures avec votre douchette.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus size={16} />
              Démarrer un Inventaire
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
  const { user } = useAuth();
  const [title, setTitle] = useState(`Inventaire du ${new Date().toLocaleDateString("fr-DZ")}`);
  const [branchId, setBranchId] = useState<string>("");
  const [scopeBrand, setScopeBrand] = useState("");
  const [scopeCategory, setScopeCategory] = useState("");
  const [autoPopulate, setAutoPopulate] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load branches
  const { data: branches } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data.results || r.data),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api
        .post("/inventory/stocktakes/", {
          title,
          branch: branchId ? Number(branchId) : null,
          scope_brand: scopeBrand.trim(),
          scope_category: scopeCategory,
          auto_populate: autoPopulate,
          notes,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      onCreated(data);
    },
    onError: (err) => setError(getApiError(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-border flex items-center justify-between bg-primary-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary-100 text-primary-700">
              <ClipboardList size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-text-primary">Nouvel Inventaire Physique</h3>
              <p className="text-2xs text-text-muted">Configuration du périmètre de comptage</p>
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
          className="p-5 space-y-4"
        >
          {error && (
            <div className="p-3 bg-danger-light text-danger text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="form-label text-xs">Intitulé de la session *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input text-xs font-bold"
              placeholder="Ex: Inventaire Général Octobre 2026"
            />
          </div>

          <div>
            <label className="form-label text-xs">Succursale / Emplacement</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="form-input text-xs"
            >
              <option value="">Toutes les succursales (Global)</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label text-xs">Marque (optionnel)</label>
              <input
                type="text"
                value={scopeBrand}
                onChange={(e) => setScopeBrand(e.target.value)}
                className="form-input text-xs"
                placeholder="Ex: Nike, Adidas..."
              />
            </div>

            <div>
              <label className="form-label text-xs">Catégorie (optionnel)</label>
              <select
                value={scopeCategory}
                onChange={(e) => setScopeCategory(e.target.value)}
                className="form-input text-xs"
              >
                <option value="">Toutes catégories</option>
                <option value="sneakers">Baskets / Sneakers</option>
                <option value="boots">Bottes / Bottines</option>
                <option value="sandals">Sandales</option>
                <option value="formal">Classique / Ville</option>
                <option value="sport">Sport</option>
                <option value="slippers">Pantoufles / Claquettes</option>
              </select>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface border border-border flex items-start gap-3">
            <input
              type="checkbox"
              id="autoPopulate"
              checked={autoPopulate}
              onChange={(e) => setAutoPopulate(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-primary-600 rounded border-border"
            />
            <div>
              <label htmlFor="autoPopulate" className="text-xs font-bold text-text-primary cursor-pointer">
                Pré-charger le stock théorique de tous les articles
              </label>
              <p className="text-2xs text-text-muted mt-0.5 leading-relaxed">
                Recommandé : initialise la liste avec toutes vos références existantes (compté = 0). Les paires non scannées apparaîtront directement comme manquantes.
              </p>
            </div>
          </div>

          <div>
            <label className="form-label text-xs">Observations / Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input text-xs resize-none"
              placeholder="Ex: Comptage annuel avant réassort"
            />
          </div>

          <div className="pt-3 border-t border-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary btn-sm"
              disabled={mutation.isPending}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn-primary btn-sm flex items-center gap-1.5"
              disabled={mutation.isPending || !title.trim()}
            >
              {mutation.isPending ? "Initialisation..." : "Démarrer l'inventaire"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
