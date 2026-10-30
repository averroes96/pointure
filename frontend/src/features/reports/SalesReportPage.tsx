import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, Download } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import type { Branch } from "@/types";
import type { PaginatedResponse } from "@/lib/api";
import { useAuth } from "@/features/auth/AuthContext";
import { PlanGate, PlanLock } from "@/components/ui/PlanGate";
import { cn } from "@/lib/utils";

interface SalesPeriodRow {
  period: string;
  revenue: string;
  sale_count: number;
  avg_basket: string;
}

interface SalesTopProduct {
  product_id: number;
  product_name: string;
  brand: string;
  units_sold: number;
  revenue: string;
}

interface SalesReportResponse {
  rows: SalesPeriodRow[];
  top_products: SalesTopProduct[];
  total_revenue: string;
  total_sales: number;
  growth_pct: number | null;
}

interface ProfitLossRow {
  period: string;
  revenue: string;
  sale_count: number;
  cogs: string;
  gross_margin: string;
  gross_margin_pct: string;
}

interface ProfitLossResponse {
  rows: ProfitLossRow[];
  totals: {
    revenue: string;
    sale_count: number;
    cogs: string;
    gross_margin: string;
    gross_margin_pct: string;
  };
}

type PeriodPreset = "7" | "30" | "90" | "custom";

function formatPeriodLabel(period: string): string {
  if (!period) return period;
  const d = new Date(period);
  if (isNaN(d.getTime())) return period;
  return d.toLocaleDateString("fr-DZ", { day: "2-digit", month: "2-digit" });
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-400 text-sm">—</span>;

  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-sm">
        <TrendingUp size={15} />
        +{pct.toFixed(1)}%
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-rose-600 font-bold text-sm">
        <TrendingDown size={15} />
        {pct.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 text-sm font-medium">
      <Minus size={15} />
      0%
    </span>
  );
}

function subtractDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export default function SalesReportPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PeriodPreset>("30");
  const [customFrom, setCustomFrom] = useState(subtractDays(30));
  const [customTo, setCustomTo] = useState(todayISO());
  const [branchId, setBranchId] = useState("");
  const [showMargin, setShowMargin] = useState(false);

  const { user } = useAuth();
  const isManagerOrOwner = user?.role === "manager" || user?.role === "owner";

  const { data: branchesData } = useQuery<PaginatedResponse<Branch>>({
    queryKey: ["branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data),
  });
  const branches = branchesData?.results ?? [];

  // Build query params
  const queryParams = () => {
    const p = new URLSearchParams();
    if (branchId) p.set("branch", branchId);
    if (preset === "custom") {
      p.set("from", customFrom);
      p.set("to", customTo);
    } else {
      p.set("period", preset);
    }
    return p.toString();
  };

  const { data, isLoading } = useQuery<SalesReportResponse>({
    queryKey: ["reports", "sales", { preset, customFrom, customTo, branchId }],
    queryFn: () =>
      api.get(`/reports/sales-by-period/?${queryParams()}`).then((r) => r.data),
  });

  const { data: plData, isLoading: plLoading } = useQuery<ProfitLossResponse>({
    queryKey: ["reports", "profit-loss", { preset, customFrom, customTo, branchId }],
    queryFn: () =>
      api.get(`/reports/profit-loss/?${queryParams()}`).then((r) => r.data),
    enabled: showMargin && isManagerOrOwner,
  });

  const rows = data?.rows ?? [];
  const topProducts = data?.top_products ?? [];
  const plRows = plData?.rows ?? [];

  // Merge P&L rows into a map keyed by period
  const plMap = new Map<string, ProfitLossRow>();
  plRows.forEach((r) => plMap.set(r.period, r));

  // Find max revenue for bar chart scale
  const maxRevenue = rows.reduce((max, row) => {
    const v = parseFloat(row.revenue) || 0;
    return v > max ? v : max;
  }, 0);

  const PRESET_LABELS: Record<PeriodPreset, string> = {
    "7": t("report.last_7_days"),
    "30": t("report.last_30_days"),
    "90": t("report.last_90_days"),
    custom: t("report.custom_period"),
  };

  const handleExportCSV = () => {
    const headers = showMargin && isManagerOrOwner
      ? ["Date", t("report.revenue"), t("report.sale_count"), t("report.avg_basket"), t("report.cogs"), t("report.gross_margin"), t("report.gross_margin_pct")]
      : ["Date", t("report.revenue"), t("report.sale_count"), t("report.avg_basket")];

    const csvRows = rows.map((row) => {
      const pl = plMap.get(row.period);
      const base = [
        formatPeriodLabel(row.period),
        row.revenue,
        String(row.sale_count),
        row.avg_basket,
      ];
      if (showMargin && isManagerOrOwner && pl) {
        return [...base, pl.cogs, pl.gross_margin, pl.gross_margin_pct];
      }
      return base;
    });

    const csv = [headers, ...csvRows].map((r) => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-ventes-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeLoading = isLoading || (showMargin && isManagerOrOwner && plLoading);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white">{t("report.sales_analytics")}</h1>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t("report.sales_evolution_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2.5">
          {isManagerOrOwner && (
            <PlanGate
              min="pro_retail"
              fallback={<PlanLock min="pro_retail" />}
            >
              <button
                onClick={() => setShowMargin((v) => !v)}
                className={cn(
                  "px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all",
                  showMargin
                    ? "bg-primary-600 text-white border-primary-600 shadow-xs"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-2xs"
                )}
              >
                {showMargin ? t("report.hide_margins") : t("report.show_margins")}
              </button>
            </PlanGate>
          )}
          <button
            onClick={handleExportCSV}
            className="btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl shadow-2xs"
          >
            <Download size={14} />
            {t("common.export_csv")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5">
        <div className="flex flex-wrap items-end gap-4">
          {/* Period presets */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("report.period")}</label>
            <div className="flex items-center gap-1 p-1 bg-slate-100/80 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700">
              {(["7", "30", "90", "custom"] as PeriodPreset[]).map((p) => {
                const isActive = preset === p;
                return (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded-lg transition-all",
                      isActive
                        ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                    )}
                  >
                    {PRESET_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom date range */}
          {preset === "custom" && (
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("report.date_from")}</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="input rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("report.date_to")}</label>
                <input
                  type="date"
                  value={customTo}
                  max={todayISO()}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="input rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                />
              </div>
            </div>
          )}

          {/* Branch filter */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("reconciliation.legacy_col_branch")}</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="input rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm min-w-[180px]"
            >
              <option value="">{t("report.all_branches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* P&L KPI cards (when margin is shown) */}
      {showMargin && isManagerOrOwner && plData && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("report.total_revenue")}</div>
            <div className="text-2xl font-bold font-mono tracking-tight text-primary-600 dark:text-primary-400 mt-1 tabular-nums">
              {formatDZD(plData.totals.revenue)} <span className="text-xs font-normal text-slate-400">DZD</span>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("report.cogs")}</div>
            <div className="text-2xl font-bold font-mono tracking-tight text-rose-600 dark:text-rose-400 mt-1 tabular-nums">
              {formatDZD(plData.totals.cogs)} <span className="text-xs font-normal text-slate-400">DZD</span>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t("report.gross_margin")}{" "}
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                ({parseFloat(plData.totals.gross_margin_pct).toFixed(1)}%)
              </span>
            </div>
            <div className="text-2xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
              {formatDZD(plData.totals.gross_margin)} <span className="text-xs font-normal text-slate-400">DZD</span>
            </div>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5 lg:col-span-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("report.period_revenue")}</div>
            <div className="text-2xl font-bold font-mono tracking-tight text-primary-600 dark:text-primary-400 mt-1 tabular-nums">
              {formatDZD(data.total_revenue)} <span className="text-xs font-normal text-slate-400">DZD</span>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("report.sale_count")}</div>
            <div className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white mt-1 tabular-nums">
              {data.total_sales}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("report.growth_vs_previous")}</div>
            <div className="mt-2">
              <GrowthBadge pct={data.growth_pct ?? null} />
            </div>
          </div>
        </div>
      )}

      {activeLoading && (
        <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-12 text-center text-slate-400 font-medium">
          <div className="flex items-center justify-center gap-2">
            <div className="h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span>{t("common.loading")}</span>
          </div>
        </div>
      )}

      {!activeLoading && data && (
        <>
          {/* Bar chart */}
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("report.revenue_evolution")}</h2>
            </div>
            <div>
              {rows.length === 0 ? (
                <div className="text-center text-slate-400 py-8 font-medium">{t("common.no_data")}</div>
              ) : (
                <div className="space-y-2.5">
                  {rows.map((row) => {
                    const val = parseFloat(row.revenue) || 0;
                    const pct = maxRevenue > 0 ? (val / maxRevenue) * 100 : 0;
                    return (
                      <div key={row.period} className="flex items-center gap-3 group">
                        <span className="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 w-16 shrink-0 text-end tabular-nums">
                          {formatPeriodLabel(row.period)}
                        </span>
                        <div className="flex-1 h-7 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden">
                          <div
                            className="h-full bg-primary-600 group-hover:bg-primary-700 rounded-lg transition-all duration-300 flex items-center ps-2.5"
                            style={{ width: `${Math.max(pct, 1)}%` }}
                          >
                            {pct > 20 && (
                              <span className="text-2xs text-white font-mono font-semibold truncate">
                                {formatDZD(row.revenue)} DZD
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-900 dark:text-white w-32 shrink-0 tabular-nums text-end">
                          {formatDZD(row.revenue)} <span className="text-2xs font-normal text-slate-400">DZD</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("report.detail_by_period")}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-3.5 text-start">{t("report.date_week")}</th>
                    <th className="px-4 py-3.5 text-end">{t("report.revenue")}</th>
                    <th className="px-4 py-3.5 text-end">{t("report.sale_count")}</th>
                    <th className="px-4 py-3.5 text-end">{t("report.avg_basket")}</th>
                    {showMargin && isManagerOrOwner && (
                      <>
                        <th className="px-4 py-3.5 text-end">{t("report.gross_margin")}</th>
                        <th className="px-4 py-3.5 text-end">{t("report.gross_margin_pct")}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={showMargin && isManagerOrOwner ? 6 : 4} className="text-center py-10 text-slate-400 font-medium">
                        {t("report.no_data_period")}
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => {
                    const pl = plMap.get(row.period);
                    return (
                      <tr key={row.period} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-600 dark:text-slate-300">{formatPeriodLabel(row.period)}</td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                          {formatDZD(row.revenue)}{" "}
                          <span className="text-2xs text-slate-400 font-normal">DZD</span>
                        </td>
                        <td className="px-4 py-3.5 text-end font-mono text-xs text-slate-600 dark:text-slate-300">{row.sale_count}</td>
                        <td className="px-4 py-3.5 text-end font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                          {formatDZD(row.avg_basket)} DZD
                        </td>
                        {showMargin && isManagerOrOwner && (
                          <>
                            <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {pl ? `${formatDZD(pl.gross_margin)} DZD` : "—"}
                            </td>
                            <td className="px-4 py-3.5 text-end font-mono font-semibold text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                              {pl ? `${parseFloat(pl.gross_margin_pct).toFixed(1)}%` : "—"}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top products */}
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("report.top_sales")}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="w-12 px-4 py-3.5 text-center">#</th>
                    <th className="px-4 py-3.5 text-start">{t("report.item")}</th>
                    <th className="px-4 py-3.5 text-start">{t("report.brand")}</th>
                    <th className="px-4 py-3.5 text-end">{t("report.units_sold")}</th>
                    <th className="px-4 py-3.5 text-end">{t("report.revenue")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {topProducts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-10 text-slate-400 font-medium">
                        {t("report.no_products")}
                      </td>
                    </tr>
                  )}
                  {topProducts.map((p, i) => (
                    <tr key={p.product_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3.5 text-center">
                        <span className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 border border-primary-100/50 dark:border-primary-800/60 text-xs font-bold inline-flex items-center justify-center">
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900 dark:text-white">{p.product_name}</td>
                      <td className="px-4 py-3.5 text-slate-400 font-medium text-xs">{p.brand || "—"}</td>
                      <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-800 dark:text-slate-200 tabular-nums">
                        {p.units_sold} <span className="text-2xs font-normal text-slate-400">{t("common.pairs")}</span>
                      </td>
                      <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-primary-600 dark:text-primary-400 tabular-nums">
                        {formatDZD(p.revenue)}{" "}
                        <span className="text-2xs font-normal text-slate-400">DZD</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
