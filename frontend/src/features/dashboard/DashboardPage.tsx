import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  TrendingUp, AlertTriangle, CreditCard, DollarSign,
  Wifi, WifiOff, Bell, X,
  ShoppingCart, Package, PlusCircle, ScanBarcode, FileText,
  Users, BarChart2, Settings, History, ClipboardCheck, ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import api, { formatDZD, formatDate } from "@/lib/api";
import type { DashboardKPIs, SalesByPeriodRow, BestSellerRow, Plan } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";
import { usePlan } from "@/hooks/usePlan";
import { useSSE } from "@/hooks/useSSE";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

// ── Quick action card ─────────────────────────────────────────────────────────

interface QuickActionItem {
  id: string;
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  shortcut?: string;
  iconBg: string;
  iconColor: string;
  managerOnly?: boolean;
  minPlan?: Plan;
}

function QuickActionCard({ item }: { item: QuickActionItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        "group relative flex flex-col justify-between p-4 bg-white dark:bg-slate-900/90 rounded-2xl",
        "border border-slate-200/80 dark:border-slate-800 shadow-xs",
        "hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md hover:-translate-y-0.5",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
        "transition-all duration-200"
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs transition-transform duration-200 group-hover:scale-110",
            item.iconBg
          )}
        >
          <Icon size={20} className={item.iconColor} />
        </div>

        {item.shortcut && (
          <kbd className="px-2 py-0.5 text-2xs font-mono font-semibold rounded-md bg-slate-100/90 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 shadow-2xs group-hover:bg-slate-200/90 dark:group-hover:bg-slate-700 group-hover:text-slate-800 dark:group-hover:text-white transition-colors">
            {item.shortcut}
          </kbd>
        )}
      </div>

      <div className="mt-3.5 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
            {item.title}
          </span>
          <ArrowUpRight
            size={14}
            className="text-slate-400 opacity-0 -translate-x-1 translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all shrink-0"
          />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium line-clamp-1 mt-0.5">
          {item.description}
        </p>
      </div>
    </Link>
  );
}

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
    <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5 hover:border-slate-300 dark:hover:border-slate-700 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <span className="truncate">{label}</span>
            {live && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                {t("dashboard.live")}
              </span>
            )}
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white mt-1.5 tabular-nums truncate">
            {value}
          </div>
          {subtitle && <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{subtitle}</div>}
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
    <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("dashboard.real_time")}</h2>
          <span className={cn(
            "flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full border",
            connected
              ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
              : status === "connecting"
                ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                : "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800",
          )}>
            {connected
              ? <Wifi size={11} />
              : <WifiOff size={11} />}
            {connected ? t("dashboard.connected") : status === "connecting" ? t("dashboard.connecting") : t("dashboard.disconnected")}
          </span>
        </div>
        {saleCountDelta > 0 && (
          <span className="text-xs font-mono font-medium text-slate-500 dark:text-slate-400">
            {t("dashboard.sales_this_session", { count: saleCountDelta })}
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {/* Last sale */}
        <div className="px-5 py-4">
          <div className="text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            {t("dashboard.last_sale")}
          </div>
          {lastSale ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {lastSale.branch_name}
                </div>
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  #{lastSale.receipt_number} · {formatSecondsAgo(lastSale.ts, t)}
                </div>
              </div>
              <div className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400 tabular-nums">
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
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md"
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
                      ? "bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                      : "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
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
  const { user } = useAuth();
  const { canAccess } = usePlan();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const isEnterprise = canAccess("enterprise");
  const isCashier = user?.role === "cashier";

  const {
    status, lastSale, stockAlerts, totalSalesDelta, saleCountDelta, clearAlerts,
  } = useSSE(isEnterprise);

  const { data: kpis, isLoading: kpisLoading } = useQuery<DashboardKPIs>({
    queryKey: ["dashboard", "kpis"],
    queryFn: () => api.get("/reports/dashboard/").then((r) => r.data),
    // Enterprise gets live revenue via SSE; others still poll every 2 min
    refetchInterval: isEnterprise ? false : 120_000,
  });

  const { data: salesData } = useQuery({
    queryKey: ["reports", "sales-by-period", "day"],
    queryFn: () =>
      api
        .get(
          "/reports/sales-by-period/?period=day&from=" +
            new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0],
        )
        .then((r) => {
          const rawRows: SalesByPeriodRow[] = Array.isArray(r.data)
            ? r.data
            : r.data?.rows ?? [];
          return rawRows.map((row) => ({
            ...row,
            revenue: parseFloat(String(row.revenue)) || 0,
          }));
        }),
  });

  const { data: bestSellers } = useQuery<BestSellerRow[]>({
    queryKey: ["reports", "best-sellers"],
    queryFn: () => api.get("/reports/best-sellers/").then((r) => r.data),
  });

  // Live revenue = REST snapshot + SSE delta
  const baseRevenue = parseFloat(kpis?.today_revenue ?? "0");
  const liveRevenue = baseRevenue + totalSalesDelta;

  const quickActions: QuickActionItem[] = [
    {
      id: "new-sale",
      title: t("dashboard.action_new_sale", "Nouvelle vente"),
      description: t("dashboard.action_new_sale_desc", "Caisse enregistreuse & encaissement"),
      to: "/sales/new",
      icon: ShoppingCart,
      shortcut: "F1",
      iconBg: "bg-emerald-500",
      iconColor: "text-white",
    },
    {
      id: "products",
      title: t("dashboard.action_products", "Catalogue stock"),
      description: t("dashboard.action_products_desc", "Articles, pointures et disponibilités"),
      to: "/inventory/products",
      icon: Package,
      shortcut: "F8",
      iconBg: "bg-indigo-600",
      iconColor: "text-white",
    },
    {
      id: "new-product",
      title: t("dashboard.action_new_product", "Nouveau produit"),
      description: t("dashboard.action_new_product_desc", "Ajouter un article & code-barres"),
      to: "/inventory/products/new",
      icon: PlusCircle,
      shortcut: "F9",
      iconBg: "bg-sky-500",
      iconColor: "text-white",
      managerOnly: true,
    },
    {
      id: "scanner",
      title: t("dashboard.action_scanner", "Scanner"),
      description: t("dashboard.action_scanner_desc", "Vérifier le prix et les références"),
      to: "/inventory/scanner",
      icon: ScanBarcode,
      shortcut: "F2",
      iconBg: "bg-cyan-600",
      iconColor: "text-white",
    },
    {
      id: "invoices",
      title: t("dashboard.action_invoices", "Factures B2B"),
      description: t("dashboard.action_invoices_desc", "Facturation, proforma & cartons"),
      to: "/invoices/new",
      icon: FileText,
      shortcut: "Shift+F3",
      iconBg: "bg-amber-500",
      iconColor: "text-white",
      managerOnly: true,
      minPlan: "pro_wholesale",
    },
    {
      id: "clients",
      title: t("dashboard.action_clients", "Clients & Crédits"),
      description: t("dashboard.action_clients_desc", "Comptes clients et créances"),
      to: "/clients",
      icon: Users,
      shortcut: "F4",
      iconBg: "bg-teal-600",
      iconColor: "text-white",
      managerOnly: true,
    },
    {
      id: "daily-report",
      title: t("dashboard.action_daily_report", "Rapport journalier"),
      description: t("dashboard.action_daily_report_desc", "Clôture de caisse & bilan du jour"),
      to: "/reports/daily",
      icon: BarChart2,
      shortcut: "F7",
      iconBg: "bg-violet-600",
      iconColor: "text-white",
      managerOnly: true,
    },
    {
      id: "settings",
      title: t("dashboard.action_settings", "Paramètres"),
      description: t("dashboard.action_settings_desc", "Configuration magasin & reçus"),
      to: "/settings",
      icon: Settings,
      shortcut: "Alt+P",
      iconBg: "bg-slate-700",
      iconColor: "text-white",
      managerOnly: true,
    },
    {
      id: "sale-history",
      title: t("dashboard.action_sale_history", "Historique ventes"),
      description: t("dashboard.action_sale_history_desc", "Tickets du jour et reçus clients"),
      to: "/sales",
      icon: History,
      iconBg: "bg-blue-600",
      iconColor: "text-white",
    },
    {
      id: "reconciliation",
      title: t("dashboard.action_reconciliation", "Fermeture de caisse"),
      description: t("dashboard.action_reconciliation_desc", "Comptage des espèces & réconciliation"),
      to: "/sales/reconciliation",
      icon: ClipboardCheck,
      iconBg: "bg-purple-600",
      iconColor: "text-white",
    },
  ];

  const visibleActions = quickActions.filter((action) => {
    if (isCashier) {
      if (action.managerOnly) return false;
      return true;
    }
    if (action.id === "sale-history" || action.id === "reconciliation") return false;
    if (action.minPlan && !canAccess(action.minPlan)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white">{t("nav.dashboard")}</h1>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
            {kpis?.as_of ? `Mise à jour : ${formatDate(kpis.as_of)}` : "Aperçu général de votre activité"}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            to="/inventory/products"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs hover:shadow-xs transition-all"
          >
            <Package size={15} className="text-indigo-600 dark:text-indigo-400" />
            <span>{t("nav.products", "Produits")}</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-2xs font-mono font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
              F8
            </kbd>
          </Link>
          <Link
            to="/sales/new"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-primary-600 hover:bg-primary-700 text-white shadow-2xs hover:shadow-xs transition-all"
          >
            <ShoppingCart size={15} />
            <span>{t("nav.new_sale", "Nouvelle vente")}</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-2xs font-mono font-medium text-primary-100 bg-primary-700/90 rounded border border-primary-500/50">
              F1
            </kbd>
          </Link>
        </div>
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

      {/* Quick actions cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-600 inline-block" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-sans">
              {t("dashboard.quick_actions", "Actions rapides")}
            </h2>
          </div>
          <span className="text-2xs font-medium text-slate-400 dark:text-slate-500">
            {t("dashboard.quick_actions_hint", "Accès direct & raccourcis clavier")}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {visibleActions.map((action) => (
            <QuickActionCard key={action.id} item={action} />
          ))}
        </div>
      </div>

      {/* Charts + live feed row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart (2/3 width) */}
        <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 lg:col-span-2 space-y-4">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("dashboard.revenue_chart")}</h2>
          </div>
          <div className="h-72">
            {salesData && salesData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#F1F5F9"} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: isDark ? "#94A3B8" : "#64748B" }}
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString("fr-DZ", {
                        day: "2-digit",
                        month: "2-digit",
                      })
                    }
                  />
                  <YAxis tick={{ fontSize: 11, fill: isDark ? "#94A3B8" : "#64748B" }} width={60} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#131B2E" : "#FFFFFF",
                      borderRadius: "12px",
                      border: isDark ? "1px solid #232E47" : "1px solid #E2E8F0",
                      boxShadow: isDark ? "0 10px 25px -5px rgba(0,0,0,0.5)" : "0 10px 15px -3px rgba(0,0,0,0.08)",
                      fontSize: "12px",
                      fontFamily: "Plus Jakarta Sans, sans-serif",
                      color: isDark ? "#F8FAFC" : "#0F172A",
                    }}
                    formatter={(value: number) => [formatDZD(value) + " DZD", t("dashboard.revenue")]}
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
          <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("dashboard.best_sellers")}</h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {bestSellers?.slice(0, 5).map((item, i) => (
                <div key={item.product_id} className="py-3 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 flex items-center justify-center text-xs font-bold shrink-0 border border-primary-100/50 dark:border-primary-800/60">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{item.product_name}</div>
                    <div className="text-xs text-slate-400 font-medium">{item.brand}</div>
                  </div>
                  <div className="text-sm font-mono font-bold text-primary-600 dark:text-primary-400 tabular-nums">
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
        <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 space-y-4">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("dashboard.best_sellers")}</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {bestSellers?.slice(0, 5).map((item, i) => (
              <div key={item.product_id} className="py-3 flex items-center gap-3">
                <div className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 flex items-center justify-center text-xs font-bold shrink-0 border border-primary-100/50 dark:border-primary-800/60">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{item.product_name}</div>
                  <div className="text-xs text-slate-400 font-medium">{item.brand}</div>
                </div>
                <div className="text-sm font-mono font-bold text-primary-600 dark:text-primary-400 tabular-nums">
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
