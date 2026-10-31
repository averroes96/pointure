import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, ShoppingCart, History, FileText, Truck, FileX,
  Package, BarChart2, AlertTriangle, Users, TrendingDown, CreditCard,
  Factory, PieChart, CalendarDays, BarChart, BookOpen,
  Settings, ShoppingBag, ArrowLeftRight, Shield, Gift, ClipboardCheck, ScanBarcode, Tag, Receipt, Webhook,
  ShieldAlert, ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { usePlan, PLAN_LABELS } from "@/hooks/usePlan";
import { useBusinessMode } from "@/hooks/useBusinessMode";
import type { Plan } from "@/types";
import i18n from "@/lib/i18n";
const t = i18n.t.bind(i18n);

interface NavSection {
  key: string;
  label: string;
  icon?: LucideIcon;
  items: NavItem[];
}

interface NavItem {
  to: string;
  labelKey?: string;
  label?: string;
  icon: LucideIcon;
  managerOnly?: boolean;
  /** If set, item is shown but locked/dimmed when tenant plan is below this */
  minPlan?: Plan;
}

function useNavSections(): NavSection[] {
  const { t } = useTranslation();
  return [
    {
      key: "dashboard",
      label: "",
      items: [
        { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
      ],
    },
    {
      key: "sales",
      label: t("nav.sales"),
      items: [
        { to: "/sales/new", labelKey: "nav.new_sale", icon: ShoppingCart },
        { to: "/sales", labelKey: "nav.sale_history", icon: History },
        { to: "/sales/reconciliation", labelKey: "nav.reconciliation", icon: ClipboardCheck },
        { to: "/promotions", labelKey: "nav.promotions", icon: Tag, managerOnly: true },
        { to: "/deliveries/drafts", labelKey: "nav.draft_orders", icon: Truck, managerOnly: true, minPlan: "pro_retail" },
      ],
    },
    {
      key: "invoicing",
      label: t("nav.invoicing"),
      items: [
        { to: "/invoices/new", labelKey: "nav.new_invoice", icon: FileText, managerOnly: true, minPlan: "pro_wholesale" },
        { to: "/invoices", labelKey: "nav.invoice_list", icon: FileText, managerOnly: true, minPlan: "pro_wholesale" },
        { to: "/delivery-notes", labelKey: "nav.delivery_notes", icon: Truck, managerOnly: true, minPlan: "pro_wholesale" },
        { to: "/credit-notes", labelKey: "nav.credit_notes", icon: FileX, managerOnly: true, minPlan: "pro_wholesale" },
      ],
    },

    {
      key: "inventory",
      label: t("nav.inventory"),
      items: [
        { to: "/inventory/products", labelKey: "nav.products", icon: Package },
        { to: "/inventory/movements", labelKey: "nav.stock_movements", icon: BarChart2, managerOnly: true },
        { to: "/inventory/transfers", labelKey: "nav.transfers", icon: ArrowLeftRight, managerOnly: true },
        { to: "/inventory/defects", labelKey: "nav.defects", icon: ShieldAlert, managerOnly: true },
        { to: "/inventory/low-stock", labelKey: "nav.low_stock", icon: AlertTriangle },
        { to: "/inventory/scanner", labelKey: "nav.barcode_scanner", icon: ScanBarcode },
        { to: "/inventory/stocktake", labelKey: "nav.stocktake", icon: ClipboardList, managerOnly: true },
      ],
    },
    {
      key: "clients",
      label: t("nav.clients"),
      items: [
        { to: "/clients", labelKey: "nav.client_list", icon: Users, managerOnly: true },
        { to: "/clients/ledger", labelKey: "nav.global_ledger", icon: BookOpen, managerOnly: true },
        { to: "/clients/ageing", labelKey: "nav.debt_ageing", icon: TrendingDown, managerOnly: true },
        { to: "/cheques", labelKey: "nav.cheque_tracker", icon: CreditCard, managerOnly: true },
        { to: "/loyalty", labelKey: "nav.loyalty", icon: Gift, managerOnly: true, minPlan: "pro_retail" },
      ],
    },
    {
      key: "suppliers",
      label: t("nav.suppliers"),
      items: [
        { to: "/suppliers", labelKey: "nav.suppliers", icon: Factory, managerOnly: true },
        { to: "/purchase-orders", labelKey: "nav.purchase_orders", icon: ShoppingBag, managerOnly: true },
        { to: "/suppliers/payables", labelKey: "nav.supplier_payables", icon: Receipt, managerOnly: true },
      ],
    },
    {
      key: "reports",
      label: t("nav.reports"),
      items: [
        { to: "/reports/daily", labelKey: "nav.daily_report", icon: CalendarDays, managerOnly: true },
        { to: "/reports/sales", labelKey: "nav.sales_analytics", icon: BarChart, managerOnly: true, minPlan: "pro_retail" },
        { to: "/reports/stock", labelKey: "nav.stock_report", icon: PieChart, managerOnly: true },
        { to: "/reports/builder", labelKey: "nav.report_builder", icon: BarChart2, managerOnly: true, minPlan: "enterprise" },
      ],
    },
    {
      key: "settings",
      label: "",
      items: [
        { to: "/settings", labelKey: "nav.settings", icon: Settings, managerOnly: true },
        { to: "/settings/audit-log", labelKey: "nav.audit_log", icon: Shield, managerOnly: true },
        { to: "/settings/webhooks", labelKey: "nav.webhooks", icon: Webhook, managerOnly: true, minPlan: "pro_retail" },
      ],
    },
  ];
}

interface SidebarProps {
  onItemClick?: () => void;
  isOpen?: boolean;
}

export default function Sidebar({ onItemClick, isOpen }: SidebarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { canAccess } = usePlan();
  const { showWholesaleUI } = useBusinessMode();
  const navSections = useNavSections();
  const isCashier = user?.role === "cashier";
  const navRef = useRef<HTMLElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  const visibleNavSections = navSections.filter((section) => {
    if (section.key === "invoicing" && !showWholesaleUI) return false;
    return true;
  });

  useEffect(() => {
    const handleFocusSidebar = () => {
      // Remember where focus was before entering sidebar
      if (document.activeElement && !navRef.current?.contains(document.activeElement)) {
        lastFocusedElementRef.current = document.activeElement as HTMLElement;
      }

      requestAnimationFrame(() => {
        if (!navRef.current) return;
        const links = Array.from(navRef.current.querySelectorAll<HTMLAnchorElement>("a.nav-item"));
        if (!links.length) return;
        // Prioritize active link, otherwise first link
        const activeLink = navRef.current.querySelector<HTMLAnchorElement>("a.nav-item.active") || links[0];
        activeLink?.focus();
        activeLink?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    };

    const handleEscape = () => {
      if (navRef.current && navRef.current.contains(document.activeElement)) {
        window.dispatchEvent(new CustomEvent("app-close-sidebar"));
        if (lastFocusedElementRef.current && typeof lastFocusedElementRef.current.focus === "function") {
          lastFocusedElementRef.current.focus();
        }
      }
    };

    window.addEventListener("app-focus-sidebar", handleFocusSidebar);
    window.addEventListener("app-shortcut-escape", handleEscape);

    return () => {
      window.removeEventListener("app-focus-sidebar", handleFocusSidebar);
      window.removeEventListener("app-shortcut-escape", handleEscape);
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const links = Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>("a.nav-item") ?? []);
      if (!links.length) return;
      const currentIndex = links.indexOf(document.activeElement as HTMLAnchorElement);
      let nextIndex = 0;
      if (e.key === "ArrowDown") {
        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % links.length;
      } else {
        nextIndex = currentIndex === -1 ? links.length - 1 : (currentIndex - 1 + links.length) % links.length;
      }
      links[nextIndex]?.focus();
      links[nextIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Home") {
      e.preventDefault();
      const links = Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>("a.nav-item") ?? []);
      links[0]?.focus();
      links[0]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "End") {
      e.preventDefault();
      const links = Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>("a.nav-item") ?? []);
      links[links.length - 1]?.focus();
      links[links.length - 1]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Escape") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("app-close-sidebar"));
      if (lastFocusedElementRef.current && typeof lastFocusedElementRef.current.focus === "function") {
        lastFocusedElementRef.current.focus();
      }
    }
  };

  return (
    <nav
      ref={navRef}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      aria-label={t("nav.main_menu", "Menu de navigation")}
      aria-hidden={isOpen === false ? true : undefined}
      inert={isOpen === false ? "" : undefined}
      className="layout-sidebar outline-none"
    >
      {/* Brand */}
      <NavLink
        to="/"
        onClick={onItemClick}
        className="px-4 py-3.5 border-b border-slate-800/80 flex items-center gap-3 hover:bg-slate-800/50 transition-colors group"
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-md shadow-primary-500/20 flex items-center justify-center text-white text-base transition-transform group-hover:scale-105 shrink-0">
          <span>👟</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-white font-extrabold text-sm tracking-tight leading-tight">ShoeDZ</span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30 leading-none">
              POS
            </span>
          </div>
          <div className="text-slate-400 text-xs leading-tight truncate mt-0.5 font-medium">
            {user?.tenant?.name || "Boutique"}
          </div>
        </div>
      </NavLink>

      {/* Nav sections */}
      <div className="flex-1 py-3 overflow-y-auto space-y-1">
        {visibleNavSections.map((section) => (
          <div key={section.key} className="space-y-0.5">
            {section.label && (
              <div className="px-4 pt-3.5 pb-1 text-[11px] uppercase tracking-wider text-slate-500 font-bold select-none">
                {section.label}
              </div>
            )}
            {section.items
              .filter((item) => !isCashier || !item.managerOnly)
              .map((item) => {
                const locked = !!item.minPlan && !canAccess(item.minPlan);

                if (locked) {
                  // Show a non-clickable dimmed row with plan badge
                  return (
                    <div
                      key={item.to}
                      className="nav-item opacity-40 cursor-not-allowed select-none"
                      title={`${t("nav.plan_locked")} ${PLAN_LABELS[item.minPlan!]}`}
                    >
                      <item.icon size={17} className="shrink-0 text-slate-500" />
                      <span className="text-sm font-medium flex-1 truncate">
                        {item.labelKey ? t(item.labelKey) : item.label}
                      </span>
                      <span className="text-[10px] font-semibold bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-700 leading-none">
                        {PLAN_LABELS[item.minPlan!]}
                      </span>
                    </div>
                  );
                }

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onItemClick}
                    className={({ isActive }) =>
                      cn("nav-item group", isActive && "active")
                    }
                  >
                    <item.icon size={17} className="shrink-0 transition-transform group-hover:scale-110" />
                    <span className="text-sm font-medium truncate">
                      {item.labelKey ? t(item.labelKey) : item.label}
                    </span>
                    {item.to === "/sales/new" && (
                      <kbd className="ms-auto text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/80">
                        F1
                      </kbd>
                    )}
                    {item.to === "/settings" && (
                      <kbd className="ms-auto text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/80">
                        Alt+P
                      </kbd>
                    )}
                  </NavLink>
                );
              })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800/80 px-4 py-3 text-center select-none bg-slate-950/40">
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            ShoeDZ Desktop
          </span>
          <span className="text-[10px] font-mono text-slate-500 font-semibold">v1.4.9</span>
        </div>
        <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5 mt-2 font-mono">
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] shadow-xs">F5</kbd>
          <span className="text-slate-600">·</span>
          <span>↑ ↓ Naviguer</span>
          <span className="text-slate-600">·</span>
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] shadow-xs">↵</kbd>
        </div>
      </div>
    </nav>
  );
}
