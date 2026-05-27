import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, ShoppingCart, History, FileText, Truck, FileX,
  Package, BarChart2, AlertTriangle, Users, TrendingDown, CreditCard,
  Factory, ClipboardList, PieChart, CalendarDays, BarChart,
  Settings, ChevronDown, ChevronRight, ShoppingBag, ArrowLeftRight,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

interface NavSection {
  key: string;
  label: string;
  icon?: React.FC<{ size?: number }>;
  items: NavItem[];
}

interface NavItem {
  to: string;
  labelKey?: string;
  label?: string;
  icon: React.FC<{ size?: number }>;
  managerOnly?: boolean;
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
      ],
    },
    {
      key: "invoicing",
      label: t("nav.invoicing"),
      items: [
        { to: "/invoices/new", labelKey: "nav.new_invoice", icon: FileText, managerOnly: true },
        { to: "/invoices", labelKey: "nav.invoice_list", icon: FileText, managerOnly: true },
        { to: "/delivery-notes", labelKey: "nav.delivery_notes", icon: Truck, managerOnly: true },
        { to: "/credit-notes", labelKey: "nav.credit_notes", icon: FileX, managerOnly: true },
      ],
    },
    {
      key: "inventory",
      label: t("nav.inventory"),
      items: [
        { to: "/inventory/products", labelKey: "nav.products", icon: Package },
        { to: "/inventory/movements", labelKey: "nav.stock_movements", icon: BarChart2, managerOnly: true },
        { to: "/inventory/transfers", label: "Transferts", icon: ArrowLeftRight, managerOnly: true },
        { to: "/inventory/low-stock", labelKey: "nav.low_stock", icon: AlertTriangle },
      ],
    },
    {
      key: "clients",
      label: t("nav.clients"),
      items: [
        { to: "/clients", labelKey: "nav.client_list", icon: Users, managerOnly: true },
        { to: "/clients/ageing", labelKey: "nav.debt_ageing", icon: TrendingDown, managerOnly: true },
        { to: "/cheques", labelKey: "nav.cheque_tracker", icon: CreditCard, managerOnly: true },
      ],
    },
    {
      key: "suppliers",
      label: t("nav.suppliers"),
      items: [
        { to: "/suppliers", labelKey: "nav.suppliers", icon: Factory, managerOnly: true },
        { to: "/purchase-orders", label: "Commandes d'achat", icon: ShoppingBag, managerOnly: true },
      ],
    },
    {
      key: "reports",
      label: t("nav.reports"),
      items: [
        { to: "/reports/daily", labelKey: "nav.daily_report", icon: CalendarDays, managerOnly: true },
        { to: "/reports/sales", labelKey: "nav.sales_analytics", icon: BarChart, managerOnly: true },
        { to: "/reports/stock", labelKey: "nav.stock_report", icon: PieChart, managerOnly: true },
      ],
    },
    {
      key: "settings",
      label: "",
      items: [
        { to: "/settings", labelKey: "nav.settings", icon: Settings, managerOnly: true },
      ],
    },
  ];
}

export default function Sidebar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navSections = useNavSections();
  const isCashier = user?.role === "cashier";

  return (
    <nav className="layout-sidebar">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-white/10 flex items-center gap-3">
        <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
          <span className="text-lg">👟</span>
        </div>
        <div>
          <div className="text-white font-bold text-sm leading-tight">ShoeDZ</div>
          <div className="text-white/50 text-2xs leading-tight truncate max-w-[150px]">
            {user?.tenant?.name ?? ""}
          </div>
        </div>
      </div>

      {/* Nav sections */}
      <div className="flex-1 py-2 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.key}>
            {section.label && (
              <div className="nav-section-title">{section.label}</div>
            )}
            {section.items
              .filter((item) => !isCashier || !item.managerOnly)
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn("nav-item", isActive && "active")
                  }
                >
                  <item.icon size={16} />
                  <span className="text-sm">{item.labelKey ? t(item.labelKey) : item.label}</span>
                </NavLink>
              ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-white/10 px-4 py-3 text-2xs text-white/30 text-center">
        ShoeDZ v1.0 — MVP
      </div>
    </nav>
  );
}
