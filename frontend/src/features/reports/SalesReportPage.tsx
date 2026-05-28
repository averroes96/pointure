import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import type { Branch } from "@/types";
import type { PaginatedResponse } from "@/lib/api";
import { useAuth } from "@/features/auth/AuthContext";
import { PlanGate, PlanLock } from "@/components/ui/PlanGate";

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
  if (pct === null) return <span className="text-text-muted text-sm">—</span>;

  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-success font-semibold text-sm">
        <TrendingUp size={14} />
        +{pct.toFixed(1)}%
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-danger font-semibold text-sm">
        <TrendingDown size={14} />
        {pct.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-text-muted text-sm">
      <Minus size={14} />
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
    "7": "7 derniers jours",
    "30": "30 derniers jours",
    "90": "90 derniers jours",
    custom: "Période personnalisée",
  };

  const handleExportCSV = () => {
    const headers = showMargin && isManagerOrOwner
      ? ["Date", "CA", "Nb ventes", "Panier moyen", "Coût ventes", "Marge brute", "Marge %"]
      : ["Date", "CA", "Nb ventes", "Panier moyen"];

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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Analytique des ventes</h1>
          <p className="text-sm text-text-muted">Évolution du chiffre d'affaires</p>
        </div>
        <div className="flex items-center gap-2">
          {isManagerOrOwner && (
            <PlanGate
              min="pro_retail"
              fallback={<PlanLock min="pro_retail" />}
            >
              <button
                onClick={() => setShowMargin((v) => !v)}
                className={showMargin ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
              >
                {showMargin ? "Masquer marges" : "Afficher marges"}
              </button>
            </PlanGate>
          )}
          <button onClick={handleExportCSV} className="btn-secondary btn-sm">
            Exporter CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card card-body">
        <div className="flex flex-wrap items-end gap-3">
          {/* Period presets */}
          <div>
            <label className="form-label">Période</label>
            <div className="flex gap-1">
              {(["7", "30", "90", "custom"] as PeriodPreset[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={
                    preset === p
                      ? "btn-primary btn-sm"
                      : "btn-secondary btn-sm"
                  }
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date range */}
          {preset === "custom" && (
            <div className="flex items-end gap-2">
              <div>
                <label className="form-label">Du</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label">Au</label>
                <input
                  type="date"
                  value={customTo}
                  max={todayISO()}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
          )}

          {/* Branch filter */}
          <div>
            <label className="form-label">Agence</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="form-input"
            >
              <option value="">Toutes les agences</option>
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
          <div className="kpi-card">
            <div className="kpi-card__label">CA Total</div>
            <div className="kpi-card__value text-primary-600">
              {formatDZD(plData.totals.revenue)} DZD
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-card__label">Coût des ventes</div>
            <div className="kpi-card__value text-danger">
              {formatDZD(plData.totals.cogs)} DZD
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-card__label">
              Marge brute{" "}
              <span className="text-xs font-normal text-text-muted">
                ({parseFloat(plData.totals.gross_margin_pct).toFixed(1)}%)
              </span>
            </div>
            <div className="kpi-card__value text-success">
              {formatDZD(plData.totals.gross_margin)} DZD
            </div>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="kpi-card lg:col-span-2">
            <div className="kpi-card__label">CA total période</div>
            <div className="kpi-card__value text-primary-600">
              {formatDZD(data.total_revenue)} DZD
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-card__label">Nb ventes</div>
            <div className="kpi-card__value">{data.total_sales}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-card__label">Croissance vs période préc.</div>
            <div className="mt-1">
              <GrowthBadge pct={data.growth_pct ?? null} />
            </div>
          </div>
        </div>
      )}

      {activeLoading && (
        <div className="card card-body text-center text-text-muted py-12">
          Chargement...
        </div>
      )}

      {!activeLoading && data && (
        <>
          {/* Bar chart */}
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Évolution du CA</h2>
            </div>
            <div className="card-body">
              {rows.length === 0 ? (
                <div className="text-center text-text-muted py-6">Aucune donnée.</div>
              ) : (
                <div className="space-y-2">
                  {rows.map((row) => {
                    const val = parseFloat(row.revenue) || 0;
                    const pct = maxRevenue > 0 ? (val / maxRevenue) * 100 : 0;
                    return (
                      <div key={row.period} className="flex items-center gap-3 group">
                        <span className="text-xs text-text-muted w-16 flex-shrink-0 text-right tabular-nums">
                          {formatPeriodLabel(row.period)}
                        </span>
                        <div className="flex-1 h-7 bg-surface rounded overflow-hidden">
                          <div
                            className="h-full bg-primary-500 group-hover:bg-primary-600 rounded transition-all duration-300 flex items-center ps-2"
                            style={{ width: `${Math.max(pct, 1)}%` }}
                          >
                            {pct > 20 && (
                              <span className="text-2xs text-white font-medium truncate">
                                {formatDZD(row.revenue)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-mono text-text-muted w-28 flex-shrink-0 tabular-nums text-right">
                          {formatDZD(row.revenue)} DZD
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Détail par période</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date / Semaine</th>
                    <th className="text-end">CA</th>
                    <th className="text-end">Nb ventes</th>
                    <th className="text-end">Panier moyen</th>
                    {showMargin && isManagerOrOwner && (
                      <>
                        <th className="text-end">Marge brute</th>
                        <th className="text-end">Marge %</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={showMargin && isManagerOrOwner ? 6 : 4} className="text-center py-8 text-text-muted">
                        Aucune donnée pour cette période.
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => {
                    const pl = plMap.get(row.period);
                    return (
                      <tr key={row.period}>
                        <td className="text-text-muted">{formatPeriodLabel(row.period)}</td>
                        <td className="text-end font-mono font-medium">
                          {formatDZD(row.revenue)}{" "}
                          <span className="text-2xs text-text-muted">DZD</span>
                        </td>
                        <td className="text-end text-text-muted">{row.sale_count}</td>
                        <td className="text-end font-mono text-text-muted">
                          {formatDZD(row.avg_basket)} DZD
                        </td>
                        {showMargin && isManagerOrOwner && (
                          <>
                            <td className="text-end font-mono text-success">
                              {pl ? `${formatDZD(pl.gross_margin)} DZD` : "—"}
                            </td>
                            <td className="text-end font-mono text-text-muted">
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
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Meilleures ventes</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Article</th>
                    <th>Marque</th>
                    <th className="text-end">Unités vendues</th>
                    <th className="text-end">CA</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-text-muted">
                        Aucun produit.
                      </td>
                    </tr>
                  )}
                  {topProducts.map((p, i) => (
                    <tr key={p.product_id}>
                      <td>
                        <span className="w-6 h-6 rounded-full bg-primary-50 text-primary-600 text-xs font-bold inline-flex items-center justify-center">
                          {i + 1}
                        </span>
                      </td>
                      <td className="font-medium text-text-primary">{p.product_name}</td>
                      <td className="text-text-muted">{p.brand || "—"}</td>
                      <td className="text-end font-mono">{p.units_sold}</td>
                      <td className="text-end font-mono font-medium text-primary-600">
                        {formatDZD(p.revenue)}{" "}
                        <span className="text-2xs text-text-muted">DZD</span>
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
