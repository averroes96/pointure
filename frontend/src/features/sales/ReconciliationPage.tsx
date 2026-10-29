/**
 * Cash Sessions, Movements, and Z-Reports Page (ShoeDZ POS).
 *
 * Implements Algerian retail cash shift workflow:
 * 1. Open shift with opening float (fond de caisse initial).
 * 2. Real-time cash tracking (Sales in Cash, TPE CIB/Edahabia, BaridiMob, Cheque, CCP, Virement).
 * 3. Live petty cash movements (apports / dépenses magasin / retraits).
 * 4. Mid-day Flash Reading (Rapport X) for thermal printer.
 * 5. End-of-shift cash drawer count with automatic discrepancy/gap detection and sequential Z-Report generation (Z-0001, Z-0002...).
 * 6. Manager / Owner approval of discrepancies.
 * 7. Thermal 80mm / 58mm ESC/POS ticket printing for Rapports Z and X.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Coins, ArrowDownUp, Receipt, Printer, Check, CheckCircle, Clock,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Plus, Minus,
  X, Eye, ShieldCheck, CreditCard, Smartphone, DollarSign,
  ArrowDownRight, ArrowUpRight, Search, FileText
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";
import { printTicket } from "@/lib/printerConfig";
import { openPrintPopup } from "@/lib/printPopup";
import { cn, normalizeNumericInput, extractDigitFromKeyEvent } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import { useTranslation } from "react-i18next";
import type { CashSession, CashMovement, CashReconciliation } from "@/types";

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const METHODS = ["cash", "cheque", "ccp", "virement"] as const;
type Method = (typeof METHODS)[number];

// ── Gap Pill ──────────────────────────────────────────────────────────────────

function GapPill({ gap }: { gap: number }) {
  if (Math.abs(gap) < 0.01) {
    return <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-lg text-xs font-bold font-mono">✓ 0 DZD</span>;
  }
  if (gap < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 border border-red-200/80 px-2 py-0.5 rounded-lg text-xs font-bold font-mono">
        <ArrowDownRight size={12} className="stroke-[2.5]" />
        {formatDZD(gap)} DZD
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-lg text-xs font-bold font-mono">
      <ArrowUpRight size={12} className="stroke-[2.5]" />
      +{formatDZD(gap)} DZD
    </span>
  );
}

// ── Legacy Print Template (CashReconciliation) ───────────────────────────────

function buildLegacyPrintHtml(rec: CashReconciliation): string {
  const opening = parseFloat(rec.opening_float || "0");
  const exp = parseFloat(rec.expenses || "0");
  const drops = parseFloat(rec.cash_drops || "0");
  const expectedCash = parseFloat(rec.expected_cash || "0");
  const totalGap = parseFloat(rec.total_gap || "0");
  const gapColor = totalGap < 0 ? "color:#c0392b;" : totalGap > 0 ? "color:#e67e22;" : "color:#27ae60;";

  const rows = METHODS.map((m) => {
    const sys = m === "cash" ? expectedCash : parseFloat((rec as any)[`system_${m}`] ?? "0");
    const act = parseFloat((rec as any)[`actual_${m}`] ?? "0");
    const gap = m === "cash" ? act - expectedCash : act - sys;
    const gapStr = gap === 0 ? "—" : `${gap > 0 ? "+" : ""}${gap.toLocaleString("fr-DZ")}`;
    const color = gap < 0 ? "color:#c0392b;" : gap > 0 ? "color:#e67e22;" : "color:#27ae60;";
    return `<tr>
      <td>${m === "cash" ? "Espèces (Caisse Théorique)" : m.toUpperCase()}</td>
      <td style="text-align:right;">${sys.toLocaleString("fr-DZ")} DZD</td>
      <td style="text-align:right;">${act.toLocaleString("fr-DZ")} DZD</td>
      <td style="text-align:right;font-weight:600;${color}">${gapStr} DZD</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Fermeture de caisse ${rec.date}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;font-size:12px;color:#000;padding:12mm;}
    h1{font-size:17px;font-weight:700;margin-bottom:3px;}
    .meta{font-size:11px;color:#555;margin-bottom:12px;}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;background:#f9f9f9;padding:10px;border-radius:6px;border:1px solid #ddd;}
    .grid-item{font-size:11px;}
    .grid-item strong{display:block;font-size:12px;color:#111;margin-top:2px;}
    table{width:100%;border-collapse:collapse;margin-top:8px;}
    th,td{padding:6px 8px;border-bottom:1px solid #eee;text-align:left;}
    th{background:#f5f5f5;font-weight:600;font-size:10px;text-transform:uppercase;}
    tfoot td{border-top:2px solid #ccc;font-weight:700;}
  </style>
</head>
<body>
  <h1>Fermeture de caisse (Journalier)</h1>
  <div class="meta">
    Date : ${rec.date}${rec.branch_name ? ` · Caisse : ${rec.branch_name}` : ""}
    · Soumis par : ${rec.submitted_by_name ?? "—"}
  </div>
  <div class="grid">
    <div class="grid-item">Fond de caisse initial<strong>+ ${opening.toLocaleString("fr-DZ")} DZD</strong></div>
    <div class="grid-item">Ventes Espèces<strong>+ ${parseFloat(rec.system_cash).toLocaleString("fr-DZ")} DZD</strong></div>
    <div class="grid-item">Dépenses & Retraits<strong>- ${(exp + drops).toLocaleString("fr-DZ")} DZD</strong></div>
    <div class="grid-item">Caisse Théorique<strong>= ${expectedCash.toLocaleString("fr-DZ")} DZD</strong></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Mode</th>
        <th style="text-align:right;">Théorique / Système</th>
        <th style="text-align:right;">Compté</th>
        <th style="text-align:right;">Écart</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td>TOTAL</td>
        <td style="text-align:right;">${parseFloat(rec.total_system).toLocaleString("fr-DZ")} DZD</td>
        <td style="text-align:right;">${parseFloat(rec.total_actual).toLocaleString("fr-DZ")} DZD</td>
        <td style="text-align:right;${gapColor}">
          ${totalGap === 0 ? "—" : `${totalGap > 0 ? "+" : ""}${totalGap.toLocaleString("fr-DZ")}`} DZD
        </td>
      </tr>
    </tfoot>
  </table>
  ${rec.notes ? `<p style="margin-top:12px;font-size:11px;"><strong>Notes :</strong> ${rec.notes}</p>` : ""}
</body>
</html>`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"sessions" | "legacy">("sessions");
  const [dateFilter, setDateFilter] = useState("");
  const branchId = currentBranch?.id ?? null;
  const canApprove = user?.role === "owner" || user?.role === "manager";

  // Modals state
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openingFloatInput, setOpeningFloatInput] = useState("0");

  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementType, setMovementType] = useState<"in" | "out">("out");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementCategory, setMovementCategory] = useState("Dépense magasin");
  const [movementNotes, setMovementNotes] = useState("");
  const [movementError, setMovementError] = useState<string | null>(null);

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualCashInput, setActualCashInput] = useState("");
  const [actualTpeInput, setActualTpeInput] = useState("");
  const [actualBaridimobInput, setActualBaridimobInput] = useState("");
  const [closingNotesInput, setClosingNotesInput] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);

  // Preview modals
  const [xReportData, setXReportData] = useState<{ session: CashSession; stats: any; x_report_html: string } | null>(null);
  const [zReportData, setZReportData] = useState<{ session: CashSession; z_report_html: string } | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // ── Queries ──
  // Current active session
  const { data: currentSession, isLoading: sessionLoading, refetch: refetchCurrentSession } = useQuery<CashSession | null>({
    queryKey: ["cash-session-current", branchId],
    queryFn: () =>
      api.get(`/sales/sessions/current/${branchId ? `?branch=${branchId}` : ""}`).then((r) => r.data),
    staleTime: 10_000,
  });

  // History of sessions
  const { data: sessionsHistory, isLoading: historyLoading, refetch: refetchHistory } = useQuery<CashSession[]>({
    queryKey: ["cash-sessions", dateFilter, branchId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFilter) params.set("date", dateFilter);
      if (branchId) params.set("branch", String(branchId));
      return api.get(`/sales/sessions/?${params.toString()}`).then((r) => r.data.results || r.data);
    },
  });

  // ── Legacy Queries & Mutations ──
  const [legacyDate, setLegacyDate] = useState(todayISO());
  const [legacyOpeningFloat, setLegacyOpeningFloat] = useState("");
  const [legacyExpenses, setLegacyExpenses] = useState("");
  const [legacyCashDrops, setLegacyCashDrops] = useState("");
  const [legacyAmounts, setLegacyAmounts] = useState({ cash: "", cheque: "", ccp: "", virement: "" });
  const [legacyNotes, setLegacyNotes] = useState("");
  const [legacyFormError, setLegacyFormError] = useState<string | null>(null);

  const { data: legacyHistory, refetch: refetchLegacyHistory } = useQuery<CashReconciliation[]>({
    queryKey: ["reconciliations", "history"],
    queryFn: () => api.get("/sales/reconciliations/history/").then((r) => r.data),
    enabled: activeTab === "legacy",
  });

  // ── Session Mutations ──

  const openSessionMutation = useMutation({
    mutationFn: () =>
      api.post("/sales/sessions/open_session/", {
        opening_float: openingFloatInput || "0",
        branch_id: branchId,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      setShowOpenModal(false);
      setOpeningFloatInput("0");
    },
  });

  const movementMutation = useMutation({
    mutationFn: () =>
      api.post(`/sales/sessions/${currentSession?.id}/movement/`, {
        type: movementType,
        amount: movementAmount,
        category: movementCategory,
        notes: movementNotes,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      setShowMovementModal(false);
      setMovementAmount("");
      setMovementNotes("");
      setMovementError(null);
    },
    onError: (err) => setMovementError(getApiError(err)),
  });

  const closeSessionMutation = useMutation({
    mutationFn: () =>
      api.post(`/sales/sessions/${currentSession?.id}/close/`, {
        actual_cash: actualCashInput || "0",
        actual_tpe: actualTpeInput || "0",
        actual_baridimob: actualBaridimobInput || "0",
        closing_notes: closingNotesInput,
      }).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      setShowCloseModal(false);
      setActualCashInput("");
      setClosingNotesInput("");
      setCloseError(null);

      // Automatically print closing Z-Report on thermal printer
      if (data.z_report_html) {
        printTicket(data.z_report_html);
        setZReportData({ session: data.session, z_report_html: data.z_report_html });
      }
    },
    onError: (err) => setCloseError(getApiError(err)),
  });

  const approveSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      api.post(`/sales/sessions/${sessionId}/approve/`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
    },
  });

  // Fetch X-Report
  const fetchXReport = async () => {
    if (!currentSession) return;
    try {
      const res = await api.get(`/sales/sessions/${currentSession.id}/x_report/`);
      setXReportData(res.data);
    } catch (err) {
      console.error("Failed to load X-Report:", err);
    }
  };

  // Fetch Z-Report
  const fetchZReport = async (sessionId: string) => {
    try {
      const res = await api.get(`/sales/sessions/${sessionId}/z_report/`);
      setZReportData(res.data);
    } catch (err) {
      console.error("Failed to load Z-Report:", err);
    }
  };

  // Expected cash for active session
  const activeExpectedCash = Number(currentSession?.stats?.expected_cash ?? currentSession?.expected_cash ?? 0);
  const countedCashNumber = parseFloat(actualCashInput || "0") || 0;
  const liveGap = countedCashNumber - activeExpectedCash;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* ── Page Header & Tabs ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <Coins className="text-amber-500 stroke-[2.2]" size={26} />
            <span>Gestion de Caisse & Rapports Z</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Suivi des shifts, encaissements par moyen de paiement (Espèces, TPE CIB, BaridiMob), mouvements et clôtures Z
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab("sessions")}
            className={cn(
              "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
              activeTab === "sessions"
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Receipt size={14} className="text-amber-600 dark:text-amber-400" />
            <span>Sessions & Rapports Z</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("legacy")}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
              activeTab === "legacy"
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            )}
          >
            <FileText size={13} />
            <span>Ancien Journalier</span>
          </button>
        </div>
      </div>

      {activeTab === "sessions" ? (
        <>
          {/* ── Active Session Card / Hero ── */}
          {currentSession ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-emerald-50/40 via-amber-50/20 to-transparent dark:from-emerald-950/20 dark:via-amber-950/10 dark:to-transparent rounded-full -mr-32 -mt-32 pointer-events-none" />

              {/* Status Header & Action Buttons */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Receipt size={24} className="stroke-[2.2]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500 text-white text-xs font-extrabold tracking-wide shadow-2xs">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        SESSION ACTIVE {currentSession.session_code}
                      </span>
                      {currentSession.branch_name && (
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-lg border border-transparent dark:border-slate-700">
                          {currentSession.branch_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Ouverte par <strong>{currentSession.cashier_name}</strong> le {formatDate(currentSession.opened_at)}
                    </p>
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={fetchXReport}
                    className="btn-secondary text-xs py-2 px-3 rounded-xl flex items-center gap-1.5 font-bold shadow-2xs"
                    title="Imprimer un ticket flash mi-journée sans fermer la caisse"
                  >
                    <Printer size={14} className="text-slate-600" />
                    <span>Lecture X (Flash)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMovementType("out");
                      setMovementCategory("Dépense magasin");
                      setShowMovementModal(true);
                    }}
                    className="btn-secondary text-xs py-2 px-3 rounded-xl flex items-center gap-1.5 font-bold shadow-2xs"
                    title="Ajouter ou retirer des espèces de la caisse"
                  >
                    <ArrowDownUp size={14} className="text-amber-600" />
                    <span>Mouvement (+ / -)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActualCashInput(String(activeExpectedCash));
                      setActualTpeInput(String(currentSession.stats?.tpe_sales ?? 0));
                      setActualBaridimobInput(String(currentSession.stats?.baridimob_sales ?? 0));
                      setShowCloseModal(true);
                    }}
                    className="btn-primary text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-xs"
                  >
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span>Clôturer Caisse (Rapport Z)</span>
                  </button>
                </div>
              </div>

              {/* Live Shift KPI Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 pt-6">
                {/* 1. Fond initial */}
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700">
                  <p className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fond Initial</p>
                  <p className="text-base font-black font-mono text-slate-900 dark:text-white mt-1">
                    {formatDZD(currentSession.opening_float)} <span className="text-2xs text-slate-400 font-sans">DZD</span>
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Espèces au départ</p>
                </div>

                {/* 2. Ventes Espèces */}
                <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800">
                  <p className="text-2xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">Ventes Espèces</p>
                  <p className="text-base font-black font-mono text-emerald-950 dark:text-emerald-200 mt-1">
                    +{formatDZD(currentSession.stats?.cash_sales ?? 0)} <span className="text-2xs text-emerald-600 dark:text-emerald-400 font-sans">DZD</span>
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {currentSession.stats?.sales_count ?? 0} vente(s) au total
                  </p>
                </div>

                {/* 3. TPE (CIB / Dahabia) */}
                <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800">
                  <p className="text-2xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1">
                    <CreditCard size={11} /> TPE (CIB/Dahabia)
                  </p>
                  <p className="text-base font-black font-mono text-blue-950 dark:text-blue-200 mt-1">
                    {formatDZD(currentSession.stats?.tpe_sales ?? 0)} <span className="text-2xs text-blue-600 dark:text-blue-400 font-sans">DZD</span>
                  </p>
                  <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-0.5">Terminal électronique</p>
                </div>

                {/* 4. BaridiMob */}
                <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800">
                  <p className="text-2xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1">
                    <Smartphone size={11} /> BaridiMob
                  </p>
                  <p className="text-base font-black font-mono text-amber-950 dark:text-amber-200 mt-1">
                    {formatDZD(currentSession.stats?.baridimob_sales ?? 0)} <span className="text-2xs text-amber-600 dark:text-amber-400 font-sans">DZD</span>
                  </p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">Virements RIP / CCP</p>
                </div>

                {/* 5. Mouvements d'espèces */}
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700">
                  <p className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Mouvements Net</p>
                  <div className="flex items-baseline gap-1 mt-1 font-mono text-sm font-bold">
                    <span className="text-emerald-600 dark:text-emerald-400">+{formatDZD(currentSession.stats?.total_cash_in ?? 0)}</span>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <span className="text-red-600 dark:text-red-400">-{formatDZD(currentSession.stats?.total_cash_out ?? 0)}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Apports & Dépenses</p>
                </div>

                {/* 6. Caisse Théorique (Tiroir attendu) */}
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-xs">
                  <p className="text-2xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <Coins size={12} /> Caisse Théorique
                  </p>
                  <p className="text-lg font-black font-mono text-white mt-1">
                    {formatDZD(activeExpectedCash)} <span className="text-2xs text-slate-400 font-sans">DZD</span>
                  </p>
                  <p className="text-[10px] text-slate-300 mt-0.5 truncate">Espèces attendues dans tiroir</p>
                </div>
              </div>

              {/* Live Shift Movements Drawer Table */}
              {currentSession.movements && currentSession.movements.length > 0 && (
                <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <ArrowDownUp size={13} className="text-amber-500" />
                      <span>Mouvements d'espèces durant ce shift ({currentSession.movements.length})</span>
                    </h3>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-700">
                        <tr>
                          <th className="py-2 px-3 text-start font-bold">Heure</th>
                          <th className="py-2 px-3 text-start font-bold">Type</th>
                          <th className="py-2 px-3 text-start font-bold">Motif / Catégorie</th>
                          <th className="py-2 px-3 text-end font-bold">Montant</th>
                          <th className="py-2 px-3 text-start font-bold">Par</th>
                          <th className="py-2 px-3 text-start font-bold">Observations</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {currentSession.movements.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                            <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">
                              {new Date(m.created_at).toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td className="py-2 px-3">
                              {m.type === "in" ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-2xs border border-emerald-200/60 dark:border-emerald-800">
                                  <Plus size={10} /> Apport
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-bold text-2xs border border-red-200/60 dark:border-red-800">
                                  <Minus size={10} /> Dépense
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">{m.category}</td>
                            <td className="py-2 px-3 text-end font-mono font-bold">
                              <span className={m.type === "in" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                                {m.type === "in" ? "+" : "-"}{formatDZD(m.amount)} DZD
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{m.created_by_name ?? "—"}</td>
                            <td className="py-2 px-3 text-slate-500 dark:text-slate-400 italic">{m.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Empty State: No register open */
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center shadow-xs">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3 shadow-2xs">
                <Coins size={32} />
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">Aucune session de caisse ouverte</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 mb-5">
                Ouvrez une session de caisse pour démarrer votre vacation. Les ventes seront rattachées au shift en cours et un Rapport Z numéroté sera généré à la clôture.
              </p>
              <button
                type="button"
                onClick={() => setShowOpenModal(true)}
                className="btn-primary text-xs py-2.5 px-5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold shadow-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus size={16} />
                <span>Ouvrir une Session de Caisse</span>
              </button>
            </div>
          )}

          {/* ── Historical Sessions & Z-Reports Table ── */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/40 dark:bg-slate-950/40">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Receipt size={17} className="text-amber-500" />
                  <span>Historique des Sessions & Rapports Z</span>
                </h2>
                <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Consultez les vacations fermées, réimprimez les tickets Z et validez les écarts
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="form-input text-xs py-1.5 px-2.5 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                {dateFilter && (
                  <button
                    type="button"
                    onClick={() => setDateFilter("")}
                    className="btn-ghost text-xs py-1 px-2 text-slate-500 hover:text-slate-800"
                  >
                    Effacer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => refetchHistory()}
                  className="btn-secondary text-xs py-1.5 px-2.5 rounded-xl flex items-center gap-1.5"
                  title="Actualiser"
                >
                  <RefreshCw size={13} />
                  <span>Actualiser</span>
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/90 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200/80 dark:border-slate-700 uppercase font-bold text-[11px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4 text-start">N° Rapport Z</th>
                    <th className="py-3 px-4 text-start">Période / Date</th>
                    <th className="py-3 px-4 text-start">Caissier</th>
                    <th className="py-3 px-4 text-end">Ventes Totales</th>
                    <th className="py-3 px-4 text-end">Caisse Attendue</th>
                    <th className="py-3 px-4 text-end">Caisse Comptée</th>
                    <th className="py-3 px-4 text-end">Écart</th>
                    <th className="py-3 px-4 text-center">Statut</th>
                    <th className="py-3 px-4 text-end">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {sessionsHistory && sessionsHistory.length > 0 ? (
                    sessionsHistory.map((s) => {
                      const isExpanded = expandedSessionId === s.id;
                      const gap = parseFloat(s.cash_gap || "0");
                      const isClosed = s.status === "closed";

                      return (
                        <tr key={s.id} className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          {/* Code */}
                          <td className="py-3 px-4 font-mono font-extrabold text-slate-900 dark:text-white">
                            {s.session_code}
                          </td>

                          {/* Date */}
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                            <div>{formatDate(s.opened_at)}</div>
                            {s.closed_at && (
                              <div className="text-2xs text-slate-400 dark:text-slate-500">
                                Clôturé : {new Date(s.closed_at).toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                          </td>

                          {/* Cashier */}
                          <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                            {s.cashier_name}
                            {s.branch_name && (
                              <span className="block text-2xs text-slate-400 dark:text-slate-500">{s.branch_name}</span>
                            )}
                          </td>

                          {/* Sales */}
                          <td className="py-3 px-4 text-end font-mono font-bold text-slate-900 dark:text-white">
                            {formatDZD(s.system_total_sales)} DZD
                            <span className="block text-2xs text-slate-400 dark:text-slate-500 font-normal">
                              {s.system_sales_count} vente(s)
                            </span>
                          </td>

                          {/* Expected Cash */}
                          <td className="py-3 px-4 text-end font-mono text-slate-600 dark:text-slate-300">
                            {formatDZD(s.expected_cash)} DZD
                          </td>

                          {/* Counted Cash */}
                          <td className="py-3 px-4 text-end font-mono font-bold text-slate-900 dark:text-white">
                            {isClosed ? `${formatDZD(s.actual_cash)} DZD` : "—"}
                          </td>

                          {/* Gap */}
                          <td className="py-3 px-4 text-end font-mono">
                            {isClosed ? <GapPill gap={gap} /> : <span className="text-slate-400">—</span>}
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4 text-center">
                            {s.status === "open" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-extrabold text-2xs border border-emerald-200 dark:border-emerald-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                En cours
                              </span>
                            ) : s.approved_by ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-2xs border border-emerald-200 dark:border-emerald-800">
                                <Check size={11} /> Approuvé
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-2xs border border-slate-200 dark:border-slate-700">
                                Clôturé
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-end">
                            <div className="flex items-center justify-end gap-1.5">
                              {isClosed && (
                                <button
                                  type="button"
                                  onClick={() => fetchZReport(s.id)}
                                  className="btn-secondary btn-sm text-xs py-1 px-2 rounded-lg flex items-center gap-1"
                                  title="Réimprimer le ticket Rapport Z sur imprimante thermique"
                                >
                                  <Printer size={13} />
                                  <span>Ticket Z</span>
                                </button>
                              )}

                              {canApprove && isClosed && !s.approved_by && (
                                <button
                                  type="button"
                                  onClick={() => approveSessionMutation.mutate(s.id)}
                                  className="btn-secondary btn-sm text-xs py-1 px-2 rounded-lg text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                                  title="Approuver la fermeture"
                                >
                                  <Check size={13} />
                                  <span>Approuver</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setExpandedSessionId(isExpanded ? null : s.id)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                              >
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        {historyLoading ? "Chargement des sessions..." : "Aucune session de caisse enregistrée."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* ── Legacy Tab (CashReconciliation) ── */
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6">
            <h2 className="text-base font-extrabold text-slate-900 mb-1">
              Historique des Clôtures Journalières (Ancien format)
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Consultez les anciennes fiches de fermeture par date
            </p>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 text-start">Date</th>
                    <th className="py-2.5 px-3 text-start">Agence</th>
                    <th className="py-2.5 px-3 text-end">Ventes Système</th>
                    <th className="py-2.5 px-3 text-end">Compté Réel</th>
                    <th className="py-2.5 px-3 text-end">Écart</th>
                    <th className="py-2.5 px-3 text-start">Soumis par</th>
                    <th className="py-2.5 px-3 text-end">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {legacyHistory && legacyHistory.length > 0 ? (
                    legacyHistory.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-medium text-slate-900">{rec.date}</td>
                        <td className="py-2.5 px-3 text-slate-600">{rec.branch_name ?? "—"}</td>
                        <td className="py-2.5 px-3 text-end font-mono">{formatDZD(rec.total_system)} DZD</td>
                        <td className="py-2.5 px-3 text-end font-mono font-bold">{formatDZD(rec.total_actual)} DZD</td>
                        <td className="py-2.5 px-3 text-end font-mono">
                          <GapPill gap={parseFloat(rec.total_gap)} />
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{rec.submitted_by_name ?? "—"}</td>
                        <td className="py-2.5 px-3 text-end">
                          <button
                            onClick={() => openPrintPopup(buildLegacyPrintHtml(rec), "210mm", 10)}
                            className="btn-ghost btn-sm text-slate-500 hover:text-slate-900"
                            title="Imprimer"
                          >
                            <Printer size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400">
                        Aucun ancien enregistrement trouvé.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Open Cash Session ── */}
      {showOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Coins size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Ouvrir la session de caisse</h3>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">Démarrer un nouveau shift de vente</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOpenModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Fond de caisse initial (Espèces de départ dans le tiroir)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={openingFloatInput}
                    onChange={(e) => setOpeningFloatInput(normalizeNumericInput(e.target.value))}
                    placeholder="0.00"
                    className="form-input text-base font-bold font-mono py-2.5 pl-3 pr-14 rounded-xl w-full"
                    autoFocus
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400 dark:text-slate-500">
                    DZD
                  </span>
                </div>
                {/* Quick Presets */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[0, 2000, 5000, 10000, 20000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setOpeningFloatInput(String(amt))}
                      className={cn(
                        "px-2.5 py-1 text-2xs font-bold rounded-lg border transition-colors cursor-pointer",
                        openingFloatInput === String(amt)
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                      )}
                    >
                      {amt === 0 ? "0 DZD" : `${amt.toLocaleString("fr-DZ")} DZD`}
                    </button>
                  ))}
                </div>
              </div>

              {openSessionMutation.isError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{getApiError(openSessionMutation.error)}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOpenModal(false)}
                  className="btn-secondary flex-1 py-2.5 text-xs font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => openSessionMutation.mutate()}
                  disabled={openSessionMutation.isPending}
                  className="btn-primary flex-1 py-2.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-xs cursor-pointer"
                >
                  {openSessionMutation.isPending ? "Ouverture..." : "Confirmer l'ouverture"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Cash Movement (+ / -) ── */}
      {showMovementModal && currentSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "w-10 h-10 rounded-2xl flex items-center justify-center",
                  movementType === "in" ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300" : "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300"
                )}>
                  <ArrowDownUp size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">Mouvement d'espèces</h3>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">Session {currentSession.session_code}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowMovementModal(false); setMovementError(null); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Type Switcher */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setMovementType("out");
                    setMovementCategory("Dépense magasin");
                  }}
                  className={cn(
                    "py-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer",
                    movementType === "out" ? "bg-red-600 text-white shadow-2xs" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  )}
                >
                  <Minus size={13} />
                  <span>Dépense / Retrait (-)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMovementType("in");
                    setMovementCategory("Apport monnaie");
                  }}
                  className={cn(
                    "py-2 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer",
                    movementType === "in" ? "bg-emerald-600 text-white shadow-2xs" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  )}
                >
                  <Plus size={13} />
                  <span>Apport d'espèces (+)</span>
                </button>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Montant (DZD) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={movementAmount}
                    onChange={(e) => {
                      setMovementAmount(normalizeNumericInput(e.target.value));
                      if (movementError) setMovementError(null);
                    }}
                    onKeyDown={(e) => {
                      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                        const digit = extractDigitFromKeyEvent(e);
                        if (digit !== null && !/^[0-9]$/.test(e.key)) {
                          e.preventDefault();
                          setMovementAmount((prev) => `${prev}${digit}`);
                          if (movementError) setMovementError(null);
                        }
                      }
                    }}
                    placeholder="0.00"
                    className="form-input text-base font-bold font-mono py-2 pl-3 pr-14 rounded-xl w-full"
                    autoFocus
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400 pointer-events-none">
                    DZD
                  </span>
                </div>
                {/* Quick amount pills */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {[100, 200, 500, 1000, 2000, 5000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setMovementAmount((prev) => String((parseFloat(prev) || 0) + preset));
                        if (movementError) setMovementError(null);
                      }}
                      className="px-2 py-1 text-2xs font-mono font-bold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                    >
                      +{preset.toLocaleString("fr-DZ")}
                    </button>
                  ))}
                  {movementAmount && (
                    <button
                      type="button"
                      onClick={() => setMovementAmount("")}
                      className="px-2 py-1 text-2xs font-bold rounded-lg bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 transition-colors cursor-pointer ms-auto"
                    >
                      Effacer
                    </button>
                  )}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Motif / Catégorie *
                </label>
                <select
                  value={movementCategory}
                  onChange={(e) => setMovementCategory(e.target.value)}
                  className="form-input text-xs py-2 rounded-xl w-full"
                >
                  {movementType === "out" ? (
                    <>
                      <option value="Dépense magasin">Dépense magasin (café, transport, fournitures...)</option>
                      <option value="Paiement fournisseur">Paiement fournisseur direct</option>
                      <option value="Retrait patron / coffre">Retrait gérant / versement coffre</option>
                      <option value="Autre retrait">Autre dépense / retrait</option>
                    </>
                  ) : (
                    <>
                      <option value="Apport monnaie">Apport de monnaie (pièces / billets)</option>
                      <option value="Apport fond de caisse">Apport fond de caisse supplémentaire</option>
                      <option value="Remboursement prêt">Remboursement avance ou prêt</option>
                      <option value="Autre apport">Autre apport</option>
                    </>
                  )}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Observations / Détails (optionnel)
                </label>
                <input
                  type="text"
                  value={movementNotes}
                  onChange={(e) => setMovementNotes(e.target.value)}
                  placeholder="Ex : Facture papier ticket"
                  className="form-input text-xs py-2 rounded-xl w-full"
                />
              </div>

              {movementError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{movementError}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowMovementModal(false); setMovementError(null); }}
                  className="btn-secondary flex-1 py-2.5 text-xs font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!movementAmount || parseFloat(movementAmount) <= 0) {
                      setMovementError("Veuillez saisir un montant valide.");
                      return;
                    }
                    movementMutation.mutate();
                  }}
                  disabled={movementMutation.isPending}
                  className={cn(
                    "flex-1 py-2.5 text-xs font-bold rounded-xl text-white shadow-xs transition-colors cursor-pointer",
                    movementType === "out" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                  )}
                >
                  {movementMutation.isPending ? "Enregistrement..." : "Enregistrer le mouvement"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Close Session & Generate Z-Report ── */}
      {showCloseModal && currentSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-slate-900 dark:bg-slate-800 text-emerald-400 flex items-center justify-center border border-transparent dark:border-slate-700">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                    Clôture de Caisse · Rapport Z
                  </h3>
                  <p className="text-2xs text-slate-500 dark:text-slate-400">
                    Session {currentSession.session_code} · {currentSession.cashier_name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowCloseModal(false); setCloseError(null); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Expected vs Counted Comparison Box */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Espèces Attendues (Théorique) :</span>
                  <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                    {formatDZD(activeExpectedCash)} DZD
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-800 dark:text-slate-200 mb-1">
                    Espèces Physiques Comptées dans le tiroir *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={actualCashInput}
                      onChange={(e) => setActualCashInput(normalizeNumericInput(e.target.value))}
                      placeholder="0.00"
                      className="form-input text-lg font-black font-mono py-2.5 pl-3 pr-14 rounded-xl w-full border-slate-300 dark:border-slate-700"
                      autoFocus
                    />
                    <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400 dark:text-slate-500">
                      DZD
                    </span>
                  </div>
                </div>

                {/* Live Gap Indicator */}
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">Écart de Caisse :</span>
                  <GapPill gap={liveGap} />
                </div>
              </div>

              {/* TPE & BaridiMob counts */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-2xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Total TPE Réel (Tickets CIB)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={actualTpeInput}
                    onChange={(e) => setActualTpeInput(normalizeNumericInput(e.target.value))}
                    className="form-input text-xs font-mono py-2 rounded-xl w-full"
                    placeholder={formatDZD(currentSession.stats?.tpe_sales ?? 0)}
                  />
                </div>
                <div>
                  <label className="block text-2xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Total BaridiMob Réel
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={actualBaridimobInput}
                    onChange={(e) => setActualBaridimobInput(normalizeNumericInput(e.target.value))}
                    className="form-input text-xs font-mono py-2 rounded-xl w-full"
                    placeholder={formatDZD(currentSession.stats?.baridimob_sales ?? 0)}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Observations de clôture (justification de l'écart si présent)
                </label>
                <textarea
                  value={closingNotesInput}
                  onChange={(e) => setClosingNotesInput(e.target.value)}
                  placeholder="Ex : Erreur monnaie client de 100 DZD..."
                  rows={2}
                  className="form-input text-xs py-2 rounded-xl w-full"
                />
              </div>

              {closeError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{closeError}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  className="btn-secondary flex-1 py-2.5 text-xs font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => closeSessionMutation.mutate()}
                  disabled={closeSessionMutation.isPending}
                  className="btn-primary flex-1 py-2.5 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Printer size={14} className="text-emerald-400" />
                  <span>{closeSessionMutation.isPending ? "Clôture..." : "Valider & Imprimer Rapport Z"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: X-Report Preview & Print ── */}
      {xReportData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                <Printer size={16} className="text-amber-500" />
                <span>Ticket Lecture X (Flash)</span>
              </h3>
              <button
                type="button"
                onClick={() => setXReportData(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-100/50 dark:bg-slate-950/60 flex justify-center">
              <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden w-full max-w-[82mm] h-[480px]">
                <iframe
                  title="Ticket Lecture X"
                  srcDoc={xReportData.x_report_html}
                  className="w-full h-full border-0 select-none bg-white"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setXReportData(null)}
                className="btn-secondary flex-1 py-2 text-xs font-bold rounded-xl"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => {
                  printTicket(xReportData.x_report_html);
                  setXReportData(null);
                }}
                className="btn-primary flex-1 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer size={14} />
                <span>Imprimer Ticket X</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Z-Report Preview & Print ── */}
      {zReportData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
              <h3 className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                <Receipt size={16} className="text-emerald-500" />
                <span>Ticket Rapport Z ({zReportData.session.session_code})</span>
              </h3>
              <button
                type="button"
                onClick={() => setZReportData(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-100/50 dark:bg-slate-950/60 flex justify-center">
              <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden w-full max-w-[82mm] h-[480px]">
                <iframe
                  title="Ticket Rapport Z"
                  srcDoc={zReportData.z_report_html}
                  className="w-full h-full border-0 select-none bg-white"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setZReportData(null)}
                className="btn-secondary flex-1 py-2 text-xs font-bold rounded-xl"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => {
                  printTicket(zReportData.z_report_html);
                  setZReportData(null);
                }}
                className="btn-primary flex-1 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer size={14} />
                <span>Imprimer Ticket Z</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
