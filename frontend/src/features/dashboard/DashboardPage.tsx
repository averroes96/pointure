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
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 hover:border-slate-300 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <span className="truncate">{label}</span>
            {live && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                {t("dashboard.live")}
              </span>
            )}
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-slate-900 mt-1.5 tabular-nums truncate">
            {value}
          </div>
          {subtitle && <div className="text-xs font-medium text-slate-500 mt-1">{subtitle}</div>}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${color}`}>
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
  const { t } = useTranslation();
  const connected = status === "connected";

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900 text-sm">{t("dashboard.real_time")}</h2>
          <span className={cn(
            "flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full border",
            connected
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : status === "connecting"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-rose-50 text-rose-700 border-rose-200",
          )}>
            {connected
              ? <Wifi size={11} />
              : <WifiOff size={11} />}
            {connected ? t("dashboard.connected") : status === "connecting" ? t("dashboard.connecting") : t("dashboard.disconnected")}
          </span>
        </div>
        {saleCountDelta > 0 && (
          <span className="text-xs font-mono font-medium text-slate-500">
            {t("dashboard.sales_this_session", { count: saleCountDelta })}
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {/* Last sale */}
        <div className="px-5 py-4">
          <div className="text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            {t("dashboard.last_sale")}
          </div>
          {lastSale ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {lastSale.branch_name}
                </div>
                <div className="text-xs font-mono text-slate-500 mt-0.5">
                  #{lastSale.receipt_number} · {formatSecondsAgo(lastSale.ts, t)}
                </div>
              </div>
              <div className="font-mono font-bold text-sm text-emerald-600 tabular-nums">
                +{formatDZD(lastSale.total_amount)} <span className="text-2xs font-normal">DZD</span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 italic">
              {connected ? t("dashboard.waiting_next_sale") : "—"}
            </div>
          )}
        </div>

        {/* Stock alerts */}
        {stockAlerts.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-2xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Bell size={12} className="text-amber-500" />
                {t("dashboard.stock_alerts")}
              </div>
              <button
                onClick={clearAlerts}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
              >
                <X size={13} />
              </button>
            </div>
            <div className="space-y-2">
              {stockAlerts.map((alert) => (
                <div
                  key={`${alert.variant_id}-${alert.ts}`}
                  className={cn(
                    "flex items-center justify-between text-xs rounded-xl px-3 py-2 border",
                    alert.is_out_of_stock
                      ? "bg-rose-50 border-rose-200 text-rose-700"
                      : "bg-amber-50 border-amber-200 text-amber-800",
                  )}
                >
                  <span className="font-semibold truncate max-w-[160px]">
                    {alert.product_name} EU{alert.size_eu}
                    {alert.colour ? ` / ${alert.colour}` : ""}
                  </span>
                  <span className="font-mono font-bold shrink-0 ml-2">
                    {alert.is_out_of_stock ? t("dashboard.out_of_stock") : t("dashboard.stock_remaining", { count: alert.stock_qty })}
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

function formatSecondsAgo(ts: number, t: (key: string, options?: any) => string): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return t("dashboard.seconds_ago", { count: secs });
  const mins = Math.floor(secs / 60);
  return t("topbar.minutes_ago", { count: mins });
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
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.dashboard")}</h1>
        <p className="text-xs font-medium text-slate-500 mt-0.5">
          {kpis?.as_of ? `Mise à jour : ${formatDate(kpis.as_of)}` : "Aperçu général de votre activité"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label={t("dashboard.today_revenue")}
          value={kpisLoading ? "..." : formatDZD(liveRevenue) + " DZD"}
          icon={TrendingUp}
          color="bg-primary-600"
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
          color="bg-rose-500"
        />
        <KPICard
          label={t("dashboard.low_stock")}
          value={kpisLoading ? "..." : String(kpis?.low_stock_sku_count ?? 0)}
          icon={AlertTriangle}
          color="bg-amber-500"
        />
        <KPICard
          label={t("dashboard.cheques_due")}
          value={kpisLoading ? "..." : String(kpis?.cheques_due_this_week ?? 0)}
          icon={CreditCard}
          color="bg-indigo-600"
        />
      </div>

      {/* Charts + live feed row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart (2/3 width) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 lg:col-span-2 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-semibold text-slate-900 text-sm">{t("dashboard.revenue_chart")}</h2>
          </div>
          <div className="h-72">
            {salesData && salesData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
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
                    contentStyle={{
                      backgroundColor: "#FFFFFF",
                      borderRadius: "12px",
                      border: "1px solid #E2E8F0",
                      boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08)",
                      fontSize: "12px",
                      fontFamily: "Plus Jakarta Sans, sans-serif",
                    }}
                    formatter={(value: number) => [formatDZD(value) + " DZD", "Chiffre d'affaires"]}
                    labelFormatter={(v) => formatDate(v)}
                  />
                  <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm font-medium">
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
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="font-semibold text-slate-900 text-sm">{t("dashboard.best_sellers")}</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {bestSellers?.slice(0, 5).map((item, i) => (
                <div key={item.product_id} className="py-3 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{item.product_name}</div>
                    <div className="text-xs text-slate-400 font-medium">{item.brand}</div>
                  </div>
                  <div className="text-sm font-mono font-bold text-primary-600 tabular-nums">
                    {item.units_sold} <span className="text-2xs font-normal text-slate-400">paires</span>
                  </div>
                </div>
              ))}
              {!bestSellers?.length && (
                <div className="py-8 text-center text-sm text-slate-400 font-medium">
                  {t("common.no_data")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Best sellers — shown below for enterprise (live feed takes the right column) */}
      {isEnterprise && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-semibold text-slate-900 text-sm">{t("dashboard.best_sellers")}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {bestSellers?.slice(0, 5).map((item, i) => (
              <div key={item.product_id} className="py-3 flex items-center gap-3">
                <div className="w-7 h-7 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{item.product_name}</div>
                  <div className="text-xs text-slate-400 font-medium">{item.brand}</div>
                </div>
                <div className="text-sm font-mono font-bold text-primary-600 tabular-nums">
                  {item.units_sold} <span className="text-2xs font-normal text-slate-400">paires</span>
                </div>
              </div>
            ))}
            {!bestSellers?.length && (
              <div className="py-8 text-center text-sm text-slate-400 font-medium">
                {t("common.no_data")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
