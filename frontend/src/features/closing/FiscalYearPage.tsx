import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  CalendarCheck,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  FileSpreadsheet,
  FileText,
  Lock,
  Unlock,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Download,
  ExternalLink,
  Plus,
  Info,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";

interface FiscalYear {
  id: string;
  year: number;
  start_date: string;
  end_date: string;
  status: "open" | "closed";
  closed_at: string | null;
  closed_by: string | null;
  closed_by_name: string;
  reopened_reason: string;
  stocktake_session: string | null;
  stocktake_session_name: string;
  totals: Record<string, any>;
}

interface ChecklistItem {
  key: string;
  label: string;
  count: number;
  is_blocking: boolean;
  message: string;
  details?: any[];
}

interface ChecklistResponse {
  can_close: boolean;
  has_blocking: boolean;
  items: ChecklistItem[];
}

interface StocktakeOption {
  id: string;
  branch_name: string;
  total_items: number;
  adjusted_items: number;
  completed_at: string | null;
  created_at: string;
}

export default function FiscalYearPage() {
  const { t } = useTranslation();

  const [years, setYears] = useState<FiscalYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [activeStep, setActiveStep] = useState<number>(1);

  // Step 1: Checklist
  const [checklist, setChecklist] = useState<ChecklistResponse | null>(null);
  const [loadingChecklist, setLoadingChecklist] = useState<boolean>(false);

  // Step 2: Stocktake
  const [stocktakeOptions, setStocktakeOptions] = useState<StocktakeOption[]>([]);
  const [selectedStocktakeId, setSelectedStocktakeId] = useState<string>("");
  const [skipStocktake, setSkipStocktake] = useState<boolean>(false);

  // Step 3: Snapshot
  const [buildingSnapshot, setBuildingSnapshot] = useState<boolean>(false);

  // Step 5: Close
  const [confirmYearText, setConfirmYearText] = useState<string>("");
  const [closing, setClosing] = useState<boolean>(false);
  const [closeError, setCloseError] = useState<string>("");

  // Reopen Modal
  const [reopenModalOpen, setReopenModalOpen] = useState<boolean>(false);
  const [reopenReason, setReopenReason] = useState<string>("");
  const [reopening, setReopening] = useState<boolean>(false);

  // Create Modal
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [newYear, setNewYear] = useState<number>(new Date().getFullYear());
  const [newStartDate, setNewStartDate] = useState<string>(`${new Date().getFullYear()}-01-01`);
  const [newEndDate, setNewEndDate] = useState<string>(`${new Date().getFullYear()}-12-31`);
  const [creating, setCreating] = useState<boolean>(false);

  const [downloading, setDownloading] = useState<boolean>(false);

  const currentYear = years.find((y) => y.id === selectedYearId);

  // Load fiscal years
  const fetchYears = async () => {
    try {
      setLoading(true);
      const res = await api.get("/closing/years/");
      const data = res.data.results || res.data;
      setYears(data);
      if (data.length > 0) {
        // Select the most recent open year, or the first year
        const openYear = data.find((y: FiscalYear) => y.status === "open");
        setSelectedYearId(openYear ? openYear.id : data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch fiscal years", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchYears();
  }, []);

  // When selected year changes, reset steps and fetch checklist
  useEffect(() => {
    if (!currentYear) return;
    setActiveStep(1);
    setConfirmYearText("");
    setCloseError("");
    setSelectedStocktakeId(currentYear.stocktake_session || "");
    setSkipStocktake(!currentYear.stocktake_session);

    if (currentYear.status === "open") {
      fetchChecklist(currentYear.id);
      fetchStocktakeOptions();
    }
  }, [selectedYearId]);

  const fetchChecklist = async (yearId: string) => {
    setLoadingChecklist(true);
    try {
      const res = await api.get(`/closing/years/${yearId}/checklist/`);
      setChecklist(res.data);
    } catch (err) {
      console.error("Failed to load checklist", err);
    } finally {
      setLoadingChecklist(false);
    }
  };

  const fetchStocktakeOptions = async () => {
    try {
      const res = await api.get("/closing/years/stocktake-options/");
      setStocktakeOptions(res.data);
    } catch (err) {
      console.error("Failed to load stocktake options", err);
    }
  };

  const handleBuildSnapshot = async () => {
    if (!currentYear) return;
    setBuildingSnapshot(true);
    try {
      const payload: { stocktake_session_id?: string } = {};
      if (!skipStocktake && selectedStocktakeId) {
        payload.stocktake_session_id = selectedStocktakeId;
      }
      const res = await api.post(`/closing/years/${currentYear.id}/build-snapshot/`, payload);
      setYears((prev) => prev.map((y) => (y.id === currentYear.id ? res.data : y)));
    } catch (err) {
      console.error("Failed to build snapshot", err);
    } finally {
      setBuildingSnapshot(false);
    }
  };

  const handleCloseYear = async () => {
    if (!currentYear) return;
    setClosing(true);
    setCloseError("");
    try {
      const res = await api.post(`/closing/years/${currentYear.id}/close/`, {
        confirm_year: parseInt(confirmYearText, 10),
      });
      setYears((prev) => prev.map((y) => (y.id === currentYear.id ? res.data : y)));
      setActiveStep(1);
    } catch (err) {
      setCloseError(getApiError(err));
    } finally {
      setClosing(false);
    }
  };

  const handleReopenYear = async () => {
    if (!currentYear) return;
    setReopening(true);
    try {
      const res = await api.post(`/closing/years/${currentYear.id}/reopen/`, {
        reason: reopenReason,
      });
      setYears((prev) => prev.map((y) => (y.id === currentYear.id ? res.data : y)));
      setReopenModalOpen(false);
      setReopenReason("");
    } catch (err) {
      console.error("Failed to reopen fiscal year", err);
    } finally {
      setReopening(false);
    }
  };

  const handleCreateYear = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post("/closing/years/", {
        year: newYear,
        start_date: newStartDate,
        end_date: newEndDate,
      });
      setYears((prev) => [res.data, ...prev]);
      setSelectedYearId(res.data.id);
      setCreateModalOpen(false);
    } catch (err) {
      console.error("Failed to create fiscal year", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (url: string, filename: string) => {
    setDownloading(true);
    try {
      const res = await api.get(url, { responseType: "blob" });
      const blob = new Blob([res.data]);
      const link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error("Download failed", err);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <RefreshCw size={20} className="animate-spin" />
          <span>{t("closing.loading", "Loading closing data...")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 py-6">
      {/* ── Top Header & Year Selector ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <CalendarCheck className="text-primary-600 dark:text-primary-400" size={28} />
            {t("closing.title", "Fiscal Year Closing")}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t("closing.subtitle", "Year-end management: stocktake, snapshots, accountant pack, and period lock")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {years.length > 0 && (
            <select
              value={selectedYearId}
              onChange={(e) => setSelectedYearId(e.target.value)}
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {t("closing.select_year", "Fiscal Year")} {y.year} (
                  {y.status === "closed" ? t("closing.status_closed", "Closed") : t("closing.status_open", "Open")})
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white shadow-sm transition"
          >
            <Plus size={16} />
            {t("closing.create_new_year", "Initialize Fiscal Year")}
          </button>
        </div>
      </div>

      {/* ── No Fiscal Years Empty State ───────────────────────────────────── */}
      {years.length === 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
          <CalendarCheck size={48} className="mx-auto text-slate-400 dark:text-slate-600 mb-3" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t("closing.no_years", "No fiscal year configured.")}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">
            {t("closing.step1_desc", "Review the warnings below before closing the fiscal year.")}
          </p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition"
          >
            <Plus size={16} />
            {t("closing.create_new_year", "Initialize Fiscal Year")}
          </button>
        </div>
      )}

      {currentYear && (
        <>
          {/* ── Status Banner ─────────────────────────────────────────────── */}
          <div
            className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
              currentYear.status === "closed"
                ? "bg-slate-100 dark:bg-slate-900/80 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                : "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200"
            }`}
          >
            <div className="flex items-start gap-3">
              {currentYear.status === "closed" ? (
                <Lock className="text-slate-600 dark:text-slate-400 mt-0.5 shrink-0" size={20} />
              ) : (
                <Unlock className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" size={20} />
              )}
              <div>
                <div className="font-semibold text-base flex items-center gap-2">
                  <span>
                    {t("closing.select_year", "Fiscal Year")} {currentYear.year}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${
                      currentYear.status === "closed"
                        ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        : "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300"
                    }`}
                  >
                    {currentYear.status === "closed"
                      ? t("closing.status_closed", "Closed")
                      : t("closing.status_open", "Open")}
                  </span>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {formatDate(currentYear.start_date)} — {formatDate(currentYear.end_date)}
                  {currentYear.status === "closed" && currentYear.closed_at && (
                    <span className="ms-2">
                      • {t("closing.closed_on", { date: formatDate(currentYear.closed_at), user: currentYear.closed_by_name || "" })}
                    </span>
                  )}
                </div>
                {currentYear.reopened_reason && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 mt-1 font-medium">
                    {t("closing.reopened_reason_label", { reason: currentYear.reopened_reason })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {currentYear.status === "closed" ? (
                <>
                  <button
                    onClick={() =>
                      handleDownload(
                        `/closing/years/${currentYear.id}/export/`,
                        `export_exercice_${currentYear.year}.xlsx`
                      )
                    }
                    disabled={downloading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                  >
                    <FileSpreadsheet size={15} className="text-emerald-600" />
                    {t("closing.download_pack", "Download Accountant Pack (.xlsx)")}
                  </button>
                  <button
                    onClick={() =>
                      handleDownload(
                        `/closing/years/${currentYear.id}/summary-pdf/`,
                        `synthese_exercice_${currentYear.year}.pdf`
                      )
                    }
                    disabled={downloading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                  >
                    <FileText size={15} className="text-rose-600" />
                    {t("closing.download_pdf", "Print Annual Summary (.pdf)")}
                  </button>
                  <button
                    onClick={() => setReopenModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition"
                  >
                    <Unlock size={14} />
                    {t("closing.reopen_button", "Reopen Fiscal Year")}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleBuildSnapshot}
                  disabled={buildingSnapshot}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                  <RefreshCw size={14} className={buildingSnapshot ? "animate-spin" : ""} />
                  {t("closing.refresh_snapshot", "Recompute Snapshot")}
                </button>
              )}
            </div>
          </div>

          {/* ── View 1: Year is CLOSED ─────────────────────────────────────── */}
          {currentYear.status === "closed" && (
            <div className="space-y-6">
              {renderSnapshotKPIs(currentYear.totals, t)}
            </div>
          )}

          {/* ── View 2: Year is OPEN — 5-Step Closing Wizard ──────────────── */}
          {currentYear.status === "open" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
              {/* Stepper Tabs */}
              <div className="grid grid-cols-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 text-xs font-semibold">
                {[
                  { step: 1, label: t("closing.steps.checklist", "1. Checklist") },
                  { step: 2, label: t("closing.steps.stocktake", "2. Stock Count") },
                  { step: 3, label: t("closing.steps.review", "3. Review Snapshot") },
                  { step: 4, label: t("closing.steps.export", "4. Export Pack") },
                  { step: 5, label: t("closing.steps.close", "5. Close Year") },
                ].map(({ step, label }) => {
                  const isCurrent = activeStep === step;
                  const isPast = activeStep > step;
                  return (
                    <button
                      key={step}
                      onClick={() => setActiveStep(step)}
                      className={`py-3 px-2 text-center transition border-b-2 flex items-center justify-center gap-1.5 ${
                        isCurrent
                          ? "border-primary-600 text-primary-600 dark:text-primary-400 bg-white dark:bg-slate-900 font-bold"
                          : isPast
                          ? "border-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50"
                          : "border-transparent text-slate-400 dark:text-slate-600"
                      }`}
                    >
                      {isPast ? (
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      ) : (
                        <span
                          className={`w-4 h-4 rounded-full text-2xs flex items-center justify-center ${
                            isCurrent
                              ? "bg-primary-600 text-white"
                              : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {step}
                        </span>
                      )}
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Wizard Content Body */}
              <div className="p-6">
                {/* ── STEP 1: Checklist ─────────────────────────────────── */}
                {activeStep === 1 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {t("closing.step1_title", "Pre-closing Checklist")}
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {t("closing.step1_desc", "Review the warnings below before closing the fiscal year.")}
                      </p>
                    </div>

                    {checklist?.has_blocking && (
                      <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 flex items-start gap-3 text-rose-900 dark:text-rose-200 text-sm">
                        <AlertOctagon size={20} className="shrink-0 text-rose-600 mt-0.5" />
                        <div>
                          <div className="font-bold">
                            {t("closing.blocking_alert", "Open cash sessions prevent closing. Please close them.")}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {loadingChecklist ? (
                        <div className="py-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                          <RefreshCw size={16} className="animate-spin" />
                          <span>{t("closing.loading", "Loading...")}</span>
                        </div>
                      ) : (
                        checklist?.items.map((item) => (
                          <div
                            key={item.key}
                            className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
                              item.is_blocking
                                ? "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20"
                                : item.count > 0
                                ? "border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
                                : "border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              {item.is_blocking ? (
                                <AlertOctagon size={20} className="text-rose-600 shrink-0 mt-0.5" />
                              ) : item.count > 0 ? (
                                <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                              ) : (
                                <CheckCircle2 size={20} className="text-emerald-500 shrink-0 mt-0.5" />
                              )}
                              <div>
                                <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                                  {item.label}
                                </div>
                                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                                  {item.message}
                                </div>
                                {item.details && item.details.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {item.details.map((d: any) => (
                                      <div
                                        key={d.id}
                                        className="text-xs font-mono bg-white dark:bg-slate-800 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 inline-block me-2"
                                      >
                                        Session #{d.session_number} ({d.cashier_name}) — {d.branch_name}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <span
                              className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                                item.is_blocking
                                  ? "bg-rose-100 dark:bg-rose-900 text-rose-800 dark:text-rose-200"
                                  : item.count > 0
                                  ? "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
                                  : "bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200"
                              }`}
                            >
                              {item.count}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
                      <button
                        onClick={() => setActiveStep(2)}
                        disabled={checklist?.has_blocking}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-medium text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        {t("closing.btn_next", "Next")}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── STEP 2: Stocktake Link ────────────────────────────── */}
                {activeStep === 2 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {t("closing.step2_title", "Year-end Physical Stocktake")}
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {t("closing.step2_desc", "Link a completed physical stocktake session to determine exact stock valuation.")}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          {t("closing.select_stocktake_session", "Select completed stocktake session")}
                        </label>
                        <select
                          disabled={skipStocktake}
                          value={selectedStocktakeId}
                          onChange={(e) => setSelectedStocktakeId(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                        >
                          <option value="">
                            {t("closing.no_stocktake_selected", "No stocktake selected (calculated stock)")}
                          </option>
                          {stocktakeOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              Session #{opt.id.slice(0, 8)} ({opt.branch_name}) — {opt.total_items} items (
                              {formatDate(opt.completed_at || opt.created_at)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          {t("closing.or_new_stocktake", "Or start a new count in the stocktake module:")}
                        </div>
                        <Link
                          to="/inventory/stocktake"
                          target="_blank"
                          className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {t("closing.go_to_stocktake", "Open Stocktake")}
                          <ExternalLink size={13} />
                        </Link>
                      </div>

                      <label className="flex items-center gap-2.5 cursor-pointer pt-2">
                        <input
                          type="checkbox"
                          checked={skipStocktake}
                          onChange={(e) => {
                            setSkipStocktake(e.target.checked);
                            if (e.target.checked) setSelectedStocktakeId("");
                          }}
                          className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                          {t("closing.skip_stocktake_label", "Skip physical stocktake (use calculated ledger stock)")}
                        </span>
                      </label>
                    </div>

                    <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
                      <button
                        onClick={() => setActiveStep(1)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <ArrowLeft size={16} />
                        {t("closing.btn_prev", "Previous")}
                      </button>
                      <button
                        onClick={async () => {
                          await handleBuildSnapshot();
                          setActiveStep(3);
                        }}
                        disabled={buildingSnapshot}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-medium text-sm hover:bg-primary-700 disabled:opacity-50 transition"
                      >
                        {buildingSnapshot && <RefreshCw size={15} className="animate-spin" />}
                        {t("closing.btn_next", "Next")}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── STEP 3: Review Snapshot ───────────────────────────── */}
                {activeStep === 3 && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                          {t("closing.step3_title", "Review Financial & Stock Snapshot")}
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                          {t("closing.step3_desc", "Here is the frozen position as of year-end (stock, sales, invoices, receivables, and payables).")}
                        </p>
                      </div>
                      <button
                        onClick={handleBuildSnapshot}
                        disabled={buildingSnapshot}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                      >
                        <RefreshCw size={14} className={buildingSnapshot ? "animate-spin" : ""} />
                        {t("closing.refresh_snapshot", "Recompute Snapshot")}
                      </button>
                    </div>

                    {renderSnapshotKPIs(currentYear.totals, t)}

                    <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
                      <button
                        onClick={() => setActiveStep(2)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <ArrowLeft size={16} />
                        {t("closing.btn_prev", "Previous")}
                      </button>
                      <button
                        onClick={() => setActiveStep(4)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-medium text-sm hover:bg-primary-700 transition"
                      >
                        {t("closing.btn_next", "Next")}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── STEP 4: Export Pack ───────────────────────────────── */}
                {activeStep === 4 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {t("closing.step4_title", "Accountant Pack Export")}
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {t("closing.step4_desc", "Download the documents required by your accountant before proceeding to lock the period.")}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Excel Card */}
                      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between shadow-sm">
                        <div>
                          <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 mb-3">
                            <FileSpreadsheet size={22} />
                          </div>
                          <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                            {t("closing.pack_excel_title", "Complete Accounting Pack (.xlsx)")}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                            {t("closing.pack_excel_desc", "9 Excel sheets: Summary, Sales journal, Invoices, Credit notes, Purchases, Detailed stock valuation, Client balances, Supplier balances, Outstanding cheques.")}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            handleDownload(
                              `/closing/years/${currentYear.id}/export/`,
                              `export_exercice_${currentYear.year}.xlsx`
                            )
                          }
                          disabled={downloading}
                          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition"
                        >
                          <Download size={16} />
                          {t("closing.download_pack", "Download Accountant Pack (.xlsx)")}
                        </button>
                      </div>

                      {/* PDF Card */}
                      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between shadow-sm">
                        <div>
                          <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 mb-3">
                            <FileText size={22} />
                          </div>
                          <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                            {t("closing.pack_pdf_title", "Certified Closing Summary (.pdf)")}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                            {t("closing.pack_pdf_desc", "Official 1-page A4 summary with signature boxes for the accountant and store manager.")}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            handleDownload(
                              `/closing/years/${currentYear.id}/summary-pdf/`,
                              `synthese_exercice_${currentYear.year}.pdf`
                            )
                          }
                          disabled={downloading}
                          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm transition"
                        >
                          <Download size={16} />
                          {t("closing.download_pdf", "Print Annual Summary (.pdf)")}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
                      <button
                        onClick={() => setActiveStep(3)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <ArrowLeft size={16} />
                        {t("closing.btn_prev", "Previous")}
                      </button>
                      <button
                        onClick={() => setActiveStep(5)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-medium text-sm hover:bg-primary-700 transition"
                      >
                        {t("closing.btn_next", "Next")}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── STEP 5: Final Closing & Period Lock ───────────────── */}
                {activeStep === 5 && (
                  <div className="space-y-6 max-w-xl mx-auto py-2">
                    <div className="text-center">
                      <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center mx-auto mb-3">
                        <Lock size={28} />
                      </div>
                      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                        {t("closing.step5_title", "Final Closing & Period Lock")}
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t("closing.step5_desc", "Closing permanently freezes the figures and prevents further modifications in this period.")}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5 leading-relaxed">
                      <AlertTriangle size={18} className="shrink-0 text-amber-600 mt-0.5" />
                      <div>
                        {t(
                          "closing.close_warning",
                          "Warning: Once closed, no sale, invoice, stock movement, or payment can be back-dated to this period without formal reopening logged in the audit journal."
                        )}
                      </div>
                    </div>

                    {closeError && (
                      <div className="p-3 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 text-sm">
                        {closeError}
                      </div>
                    )}

                    <div className="space-y-3 pt-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t("closing.confirm_instruction", "To confirm closing, please type the year:")}{" "}
                        <span className="font-bold text-slate-900 dark:text-slate-100">{currentYear.year}</span>
                      </label>
                      <input
                        type="text"
                        placeholder={String(currentYear.year)}
                        value={confirmYearText}
                        onChange={(e) => setConfirmYearText(e.target.value)}
                        className="w-full text-center tracking-widest font-mono text-lg font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-rose-500"
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        onClick={handleCloseYear}
                        disabled={confirmYearText.trim() !== String(currentYear.year) || closing}
                        className="w-full py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                      >
                        {closing ? <RefreshCw size={16} className="animate-spin" /> : <Lock size={16} />}
                        {t("closing.close_button", { year: currentYear.year })}
                      </button>
                    </div>

                    <div className="flex justify-start pt-4 border-t border-slate-200 dark:border-slate-800">
                      <button
                        onClick={() => setActiveStep(4)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <ArrowLeft size={16} />
                        {t("closing.btn_prev", "Previous")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Reopen Modal ──────────────────────────────────────────────────── */}
      {reopenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Unlock size={20} className="text-amber-600" />
              {t("closing.reopen_modal_title", "Reopen Closed Fiscal Year")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t(
                "closing.reopen_modal_desc",
                "Warning: Reopening lifts the period lock and permits back-dated entries again. A mandatory reason will be recorded in the audit log."
              )}
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("closing.reopened_reason_label", { reason: "" })}
              </label>
              <textarea
                rows={3}
                required
                placeholder={t("closing.reopen_reason_placeholder", "Reason for reopening...")}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReopenModalOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t("closing.btn_cancel", "Cancel")}
              </button>
              <button
                type="button"
                onClick={handleReopenYear}
                disabled={!reopenReason.trim() || reopening}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {reopening ? <RefreshCw size={15} className="animate-spin" /> : t("closing.reopen_confirm", "Confirm Reopening")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Fiscal Year Modal ──────────────────────────────────────── */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleCreateYear}
            className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4"
          >
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CalendarCheck size={20} className="text-primary-600" />
              {t("closing.init_modal_title", "Create New Fiscal Year")}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("closing.year_field", "Year")}
                </label>
                <input
                  type="number"
                  min={2020}
                  max={2099}
                  required
                  value={newYear}
                  onChange={(e) => {
                    const y = parseInt(e.target.value, 10);
                    setNewYear(y);
                    setNewStartDate(`${y}-01-01`);
                    setNewEndDate(`${y}-12-31`);
                  }}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("closing.start_date_field", "Start Date")}
                  </label>
                  <input
                    type="date"
                    required
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("closing.end_date_field", "End Date")}
                  </label>
                  <input
                    type="date"
                    required
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg p-2.5 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t("closing.btn_cancel", "Cancel")}
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {creating ? <RefreshCw size={15} className="animate-spin" /> : t("closing.btn_save", "Save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function renderSnapshotKPIs(totals: any, t: any) {
  if (!totals) {
    return (
      <div className="p-8 text-center text-slate-400 border border-dashed rounded-xl">
        <Info size={32} className="mx-auto mb-2 text-slate-300" />
        <p className="text-sm">{t("closing.step3_desc", "Snapshot not computed yet.")}</p>
      </div>
    );
  }

  const fin = totals.financial_summary || {};
  const stock = totals.stock_summary || {};
  const bal = totals.balance_summary || {};
  const cheques = totals.pending_cheques || {};

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {/* 1. Commercial Summary */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="font-bold text-sm text-primary-700 dark:text-primary-400 border-b border-slate-100 dark:border-slate-800 pb-2">
          {t("closing.commercial_summary", "Commercial Activity & Sales")}
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.net_revenue_ht", "Net Revenue (HT)")}:</span>
            <span className="font-bold text-slate-900 dark:text-slate-100">{formatDZD(fin.net_revenue_ht)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.tva", "VAT")}:</span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{formatDZD(fin.tva_amount)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.stamp_duty", "Fiscal Stamp")}:</span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{formatDZD(fin.timbre_fiscal)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.cogs", "COGS")}:</span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{formatDZD(fin.cogs)} DZD</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-800 font-bold text-emerald-600 dark:text-emerald-400">
            <span>{t("closing.gross_margin", "Gross Margin")} ({fin.gross_margin_pct}%):</span>
            <span>{formatDZD(fin.gross_margin)} DZD</span>
          </div>
        </div>
      </div>

      {/* 2. Stock Valuation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="font-bold text-sm text-primary-700 dark:text-primary-400 border-b border-slate-100 dark:border-slate-800 pb-2">
          {t("closing.stock_summary", "Stock Valuation")}
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.sku_count", "Distinct SKUs")}:</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{stock.sku_count || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.total_units", "Total Stock Units")}:</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{stock.total_units || 0}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-800 font-bold text-blue-600 dark:text-blue-400">
            <span>{t("closing.stock_cost_val", "Stock Cost (PAMP)")}:</span>
            <span>{formatDZD(stock.total_cost_value)} DZD</span>
          </div>
          <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300">
            <span>{t("closing.stock_retail_val", "Stock Retail Value")}:</span>
            <span>{formatDZD(stock.total_retail_value)} DZD</span>
          </div>
        </div>
      </div>

      {/* 3. Balances & Cheques */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="font-bold text-sm text-primary-700 dark:text-primary-400 border-b border-slate-100 dark:border-slate-800 pb-2">
          {t("closing.balances_summary", "Receivables & Payables")}
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.client_debt", "Client Receivables")}:</span>
            <span className="font-bold text-rose-600 dark:text-rose-400">{formatDZD(bal.client_debt_total)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.client_credit", "Client Advances")}:</span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{formatDZD(bal.client_credit_total)} DZD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("closing.supplier_debt", "Supplier Payables")}:</span>
            <span className="font-bold text-amber-600 dark:text-amber-400">{formatDZD(bal.supplier_debt_total)} DZD</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400">
            <span>{t("closing.cheques_receivable", "Cheques to cash")}:</span>
            <span>{formatDZD(cheques.receivable_total)} DZD</span>
          </div>
        </div>
      </div>
    </div>
  );
}
