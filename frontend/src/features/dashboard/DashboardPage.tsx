import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TrendingUp, AlertTriangle, CreditCard, DollarSign } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import api, { formatDZD, formatDate } from "@/lib/api";
import type { DashboardKPIs, SalesByPeriodRow, BestSellerRow } from "@/types";

function KPICard({
  label, value, icon: Icon, color, subtitle,
}: {
  label: string;
  value: string | number;
  icon: React.FC<{ size?: number; className?: string }>;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="kpi-card__label">{label}</div>
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

export default function DashboardPage() {
  const { t } = useTranslation();

  const { data: kpis, isLoading: kpisLoading } = useQuery<DashboardKPIs>({
    queryKey: ["dashboard", "kpis"],
    queryFn: () => api.get("/reports/dashboard/").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: salesData } = useQuery<SalesByPeriodRow[]>({
    queryKey: ["reports", "sales-by-period", "day"],
    queryFn: () =>
      api.get("/reports/sales-by-period/?period=day&from=" +
        new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]
      ).then((r) => r.data),
  });

  const { data: bestSellers } = useQuery<BestSellerRow[]>({
    queryKey: ["reports", "best-sellers"],
    queryFn: () => api.get("/reports/best-sellers/").then((r) => r.data),
  });

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
          value={kpisLoading ? "..." : formatDZD(kpis?.today_revenue) + " DZD"}
          icon={TrendingUp}
          color="bg-primary-500"
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

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
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
                    tickFormatter={(v) => new Date(v).toLocaleDateString("fr-DZ", { day: "2-digit", month: "2-digit" })}
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

        {/* Best sellers (1/3 width) */}
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
              <div className="py-6 text-center text-sm text-text-muted">{t("common.no_data")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
