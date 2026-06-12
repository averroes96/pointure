import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  TrendingUp, AlertTriangle, CreditCard, DollarSign,
  Wifi, WifiOff, Bell, X,
  type LucideIcon,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import api, { formatDZD, formatDate } from "@/lib/api";
import type { DashboardKPIs, SalesByPeriodRow, BestSellerRow } from "@/types";
import { usePlan } from "@/hooks/usePlan";
import { useSSE } from "@/hooks/useSSE";
import { cn } from "@/lib/utils";

// ── KPI card ──────────────────────────────────────────────────────────────────

function KPICard({
  label, value, icon: Icon, color, subtitle, live,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  subtitle?: string;
  live?: boolean;
}) {
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="kpi-card__label flex items-center gap-1.5">
            {label}
            {live && (
              <span className="flex items-center gap-1 text-success text-2xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
                LIVE
              </span>
            )}
          </div>
          <div className="kpi-card__value">{value}</div>
          {subtitle && <div className="text-xs text-text-muted mt-1">{subtitle}</div>}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </div>
  );
}

// ── Live sale feed (enterprise) ───────────────────────────────────────────────

function LiveFeed({
  status, lastSale, stockAlerts, saleCountDelta, clearAlerts,
}: {
  status: ReturnType<typeof useSSE>["status"];
  lastSale: ReturnType<typeof useSSE>["lastSale"];
  stockAlerts: ReturnType<typeof useSSE>["stockAlerts"];
  saleCountDelta: number;
  clearAlerts: () => void;
}) {
  const connected = status === "connected";

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-text-primary text-sm">Temps réel</h2>
          <span className={cn(
            "flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded-full",
            connected
              ? "bg-success/10 text-success"
              : status === "connecting"
                ? "bg-warning/10 text-warning"
                : "bg-danger/10 text-danger",
          )}>
            {connected
              ? <Wifi size={10} />
              : <WifiOff size={10} />}
            {connected ? "Connecté" : status === "connecting" ? "Connexion…" : "Déconnecté"}
          </span>
        </div>
        {saleCountDelta > 0 && (
          <span className="text-xs text-text-muted">
            +{saleCountDelta} vente{saleCountDelta > 1 ? "s" : ""} cette session
          </span>
        )}
      </div>

      <div className="divide-y divide-border">
        {/* Last sale */}
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
            Dernière vente
          </div>
          {lastSale ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {lastSale.branch_name}
                </div>
                <div className="text-xs text-text-muted">
                  #{lastSale.receipt_number} · {formatSecondsAgo(lastSale.ts)}
                </div>
              </div>
              <div className="font-mono font-bold text-success">
                +{formatDZD(lastSale.total_amount)} DZD
              </div>
            </div>
          ) : (
            <div className="text-sm text-text-muted">
              {connected ? "En attente de la prochaine vente…" : "—"}
            </div>
          )}
        </div>

        {/* Stock alerts */}
        {stockAlerts.length > 0 && (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-text-muted uppercase tracking-wide flex items-center gap-1">
                <Bell size={10} className="text-warning" />
                Alertes stock
              </div>
              <button
                onClick={clearAlerts}
                className="text-2xs text-text-muted hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </div>
            <div className="space-y-1.5">
              {stockAlerts.map((alert) => (
                <div
                  key={`${alert.variant_id}-${alert.ts}`}
                  className={cn(
                    "flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5",
                    alert.is_out_of_stock
                      ? "bg-danger/10 text-danger"
                      : "bg-warning/10 text-warning",
                  )}
                >
                  <span className="font-medium truncate max-w-[160px]">
                    {alert.product_name} EU{alert.size_eu}
                    {alert.colour ? ` / ${alert.colour}` : ""}
                  </span>
                  <span className="font-mono font-semibold flex-shrink-0 ml-2">
                    {alert.is_out_of_stock ? "Rupture" : `${alert.stock_qty} restant${alert.stock_qty > 1 ? "s" : ""}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSecondsAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `il y a ${secs}s`;
  const mins = Math.floor(secs / 60);
  return `il y a ${mins} min`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation();
  const { canAccess } = usePlan();
  const isEnterprise = canAccess("enterprise");

  const {
    status, lastSale, stockAlerts, totalSalesDelta, saleCountDelta, clearAlerts,
  } = useSSE(isEnterprise);

  const { data: kpis, isLoading: kpisLoading } = useQuery<DashboardKPIs>({
    queryKey: ["dashboard", "kpis"],
    queryFn: () => api.get("/reports/dashboard/").then((r) => r.data),
    // Enterprise gets live revenue via SSE; others still poll every 2 min
    refetchInterval: isEnterprise ? false : 120_000,
  });

  const { data: salesData } = useQuery<SalesByPeriodRow[]>({
    queryKey: ["reports", "sales-by-period", "day"],
    queryFn: () =>
      api.get(
        "/reports/sales-by-period/?period=day&from=" +
          new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0],
      ).then((r) => r.data),
  });

  const { data: bestSellers } = useQuery<BestSellerRow[]>({
    queryKey: ["reports", "best-sellers"],
    queryFn: () => api.get("/reports/best-sellers/").then((r) => r.data),
  });

  // Live revenue = REST snapshot + SSE delta
  const baseRevenue = parseFloat(kpis?.today_revenue ?? "0");
  const liveRevenue = baseRevenue + totalSalesDelta;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t("nav.dashboard")}</h1>
        <p className="text-sm text-text-muted">
          {kpis?.as_of ? formatDate(kpis.as_of) : ""}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label={t("dashboard.today_revenue")}
          value={kpisLoading ? "..." : formatDZD(liveRevenue) + " DZD"}
          icon={TrendingUp}
          color="bg-primary-500"
          live={isEnterprise && status === "connected"}
          subtitle={
            isEnterprise && saleCountDelta > 0
              ? `+${saleCountDelta} vente${saleCountDelta > 1 ? "s" : ""} live`
              : undefined
          }
        />
        <KPICard
          label={t("dashboard.outstanding_debt")}
          value={kpisLoading ? "..." : formatDZD(kpis?.total_outstanding_debt) + " DZD"}
          icon={DollarSign}
          color="bg-danger"
        />
        <KPICard
          label={t("dashboard.low_stock")}
          value={kpisLoading ? "..." : String(kpis?.low_stock_sku_count ?? 0)}
          icon={AlertTriangle}
          color="bg-warning"
        />
        <KPICard
          label={t("dashboard.cheques_due")}
          value={kpisLoading ? "..." : String(kpis?.cheques_due_this_week ?? 0)}
          icon={CreditCard}
          color="bg-accent"
        />
      </div>

      {/* Charts + live feed row */}
      <div className={cn("grid gap-4", isEnterprise ? "lg:grid-cols-3" : "lg:grid-cols-3")}>
        {/* Revenue chart (2/3 width) */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <h2 className="font-semibold text-text-primary">{t("dashboard.revenue_chart")}</h2>
          </div>
          <div className="card-body h-64">
            {salesData && salesData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString("fr-DZ", {
                        day: "2-digit",
                        month: "2-digit",
                      })
                    }
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} width={60} />
                  <Tooltip
                    formatter={(value: number) => [formatDZD(value) + " DZD", "Revenue"]}
                    labelFormatter={(v) => formatDate(v)}
                  />
                  <Bar dataKey="revenue" fill="#1A4A8A" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted text-sm">
                {t("common.no_data")}
              </div>
            )}
          </div>
        </div>

        {/* Right column: live feed (enterprise) or best sellers */}
        {isEnterprise ? (
          <LiveFeed
            status={status}
            lastSale={lastSale}
            stockAlerts={stockAlerts}
            saleCountDelta={saleCountDelta}
            clearAlerts={clearAlerts}
          />
        ) : (
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">{t("dashboard.best_sellers")}</h2>
            </div>
            <div className="card-body divide-y divide-border">
              {bestSellers?.slice(0, 5).map((item, i) => (
                <div key={item.product_id} className="py-2 flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.product_name}</div>
                    <div className="text-xs text-text-muted">{item.brand}</div>
                  </div>
                  <div className="text-sm font-mono font-medium text-primary-600">
                    {item.units_sold}
                  </div>
                </div>
              ))}
              {!bestSellers?.length && (
                <div className="py-6 text-center text-sm text-text-muted">
                  {t("common.no_data")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Best sellers — shown below for enterprise (live feed takes the right column) */}
      {isEnterprise && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-text-primary">{t("dashboard.best_sellers")}</h2>
          </div>
          <div className="card-body divide-y divide-border">
            {bestSellers?.slice(0, 5).map((item, i) => (
              <div key={item.product_id} className="py-2 flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.product_name}</div>
                  <div className="text-xs text-text-muted">{item.brand}</div>
                </div>
                <div className="text-sm font-mono font-medium text-primary-600">
                  {item.units_sold}
                </div>
              </div>
            ))}
            {!bestSellers?.length && (
              <div className="py-6 text-center text-sm text-text-muted">
                {t("common.no_data")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
