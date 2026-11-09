import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Package,
  Users,
  Truck,
  FileText,
  CornerDownLeft,
  X,
  Loader2,
  Sparkles,
  Layers,
  Settings,
  Plus,
  Receipt,
  FileCheck,
  Calendar,
  Building2,
  type LucideIcon,
} from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import { useAuth } from "@/features/auth/AuthContext";
import { canAccessPath } from "@/lib/roleAccess";
import { cn } from "@/lib/utils";

interface QuickSearchResult {
  products: Array<{
    id: number;
    name: string;
    reference: string;
    brand: string;
    sale_price: string;
    location: string;
    stock_qty: number;
  }>;
  clients: Array<{
    id: string;
    name: string;
    phone: string;
    wilaya: string;
    price_tier: string;
    outstanding_balance: string;
  }>;
  suppliers: Array<{
    id: number;
    name: string;
    phone: string;
    outstanding_balance: string;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    client_name: string;
    total_ttc: string;
    status: string;
    date: string;
  }>;
}

interface ActionItem {
  type: "action";
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  path?: string;
  onSelect?: () => void;
  keywords: string[];
}

interface ProductItem {
  type: "product";
  id: number;
  title: string;
  reference: string;
  brand: string;
  sale_price: string;
  location: string;
  stock_qty: number;
}

interface ClientItem {
  type: "client";
  id: string;
  title: string;
  phone: string;
  price_tier: string;
  outstanding_balance: string;
}

interface SupplierItem {
  type: "supplier";
  id: number;
  title: string;
  phone: string;
  outstanding_balance: string;
}

interface InvoiceItem {
  type: "invoice";
  id: string;
  title: string;
  client_name: string;
  total_ttc: string;
  status: string;
  date: string;
}

type UnifiedSearchItem = ActionItem | ProductItem | ClientItem | SupplierItem | InvoiceItem;

export default function QuickSearchModal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role;

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Listen for global quick-search events
  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setQuery("");
      setSelectedIndex(0);
    };
    const handleToggle = () => setIsOpen((prev) => !prev);
    const handleClose = () => setIsOpen(false);

    window.addEventListener("app-open-quick-search", handleOpen);
    window.addEventListener("app-toggle-quick-search", handleToggle);
    window.addEventListener("app-shortcut-escape", handleClose);

    return () => {
      window.removeEventListener("app-open-quick-search", handleOpen);
      window.removeEventListener("app-toggle-quick-search", handleToggle);
      window.removeEventListener("app-shortcut-escape", handleClose);
    };
  }, []);

  // Auto focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  // Define Quick Actions
  const staticActions = useMemo<ActionItem[]>(() => {
    const actions: Array<ActionItem & { requiredPath?: string }> = [
      {
        type: "action",
        id: "sales_new",
        title: t("quick_search.act_new_sale", "Nouvelle vente / Caisse POS"),
        subtitle: t("quick_search.act_new_sale_desc", "Ouvrir le terminal de caisse (F1)"),
        icon: Receipt,
        path: "/sales/new",
        keywords: ["vente", "caisse", "pos", "ticket", "vendre", "بيع", "صندوق"],
      },
      {
        type: "action",
        id: "quotes_new",
        title: t("quick_search.act_new_quote", "Nouveau devis / Proforma"),
        subtitle: t("quick_search.act_new_quote_desc", "Établir un devis ou facture proforma de gros (Alt + D)"),
        icon: FileCheck,
        path: "/quotes/new",
        requiredPath: "/quotes",
        keywords: ["devis", "proforma", "offre", "عرض أسعار", "فاتورة شكلية", "gros"],
      },
      {
        type: "action",
        id: "invoices_new",
        title: t("quick_search.act_new_invoice", "Nouvelle facture client"),
        subtitle: t("quick_search.act_new_invoice_desc", "Créer une facture de vente (Shift + F3)"),
        icon: FileText,
        path: "/invoices/new",
        requiredPath: "/invoices",
        keywords: ["facture", "facturation", "invoice", "فاتورة"],
      },
      {
        type: "action",
        id: "add_cartons",
        title: t("quick_search.act_carton_sale", "Vente au carton (Gros & Série)"),
        subtitle: t("quick_search.act_carton_sale_desc", "Saisir une commande par cartons complets (Alt + C)"),
        icon: Layers,
        path: "/invoices/new?mode=carton",
        requiredPath: "/invoices",
        keywords: ["carton", "colisage", "série", "gros", "demi-gros", "كرتون", "جملة"],
      },
      {
        type: "action",
        id: "delivery_notes_new",
        title: t("quick_search.act_new_delivery_note", "Nouveau bon de livraison (BL)"),
        subtitle: t("quick_search.act_new_delivery_note_desc", "Éditer un bon de livraison (Shift + F6)"),
        icon: Truck,
        path: "/delivery-notes/new",
        requiredPath: "/delivery-notes",
        keywords: ["livraison", "bl", "bon", "voucher", "توصيل", "وصل"],
      },
      {
        type: "action",
        id: "po_new",
        title: t("quick_search.act_new_po", "Nouveau bon de commande fournisseur"),
        subtitle: t("quick_search.act_new_po_desc", "Passer commande auprès d'un fabricant / atelier (Alt + B)"),
        icon: Building2,
        path: "/purchase-orders/new",
        requiredPath: "/purchase-orders",
        keywords: ["fournisseur", "achat", "commande", "po", "مورد", "شراء"],
      },
      {
        type: "action",
        id: "products_new",
        title: t("quick_search.act_new_product", "Créer un nouveau produit"),
        subtitle: t("quick_search.act_new_product_desc", "Ajouter un modèle au catalogue (F9)"),
        icon: Plus,
        path: "/inventory/products/new",
        requiredPath: "/inventory/products",
        keywords: ["produit", "article", "chaussure", "créer", "nouveau", "منتج", "حذاء"],
      },
      {
        type: "action",
        id: "clients_statement",
        title: t("quick_search.act_client_statement", "Relevés de compte clients"),
        subtitle: t("quick_search.act_client_statement_desc", "Consulter l'historique de compte et les créances (Alt + R)"),
        icon: Users,
        path: "/clients",
        requiredPath: "/clients",
        keywords: ["relevé", "compte", "client", "créance", "solde", "dette", "كشف حساب", "ديون"],
      },
      {
        type: "action",
        id: "daily_closing",
        title: t("quick_search.act_daily_report", "Rapport journalier & Clôture de caisse"),
        subtitle: t("quick_search.act_daily_report_desc", "Contrôler les totaux et clôturer la journée (F7)"),
        icon: Calendar,
        path: "/reports/daily",
        requiredPath: "/reports/daily",
        keywords: ["clôture", "caisse", "rapport", "journalier", "تقرير", "إغلاق"],
      },
      {
        type: "action",
        id: "settings",
        title: t("quick_search.act_settings", "Paramètres & Configuration"),
        subtitle: t("quick_search.act_settings_desc", "Imprimantes, politiques et modes de vente (Alt + P)"),
        icon: Settings,
        path: "/settings",
        requiredPath: "/settings",
        keywords: ["paramètres", "configuration", "imprimante", "settings", "mode", "إعدادات"],
      },
    ];

    return actions
      .filter((a) => canAccessPath(role, a.requiredPath || a.path || ""))
      .map(({ requiredPath: _, ...rest }) => rest);
  }, [t, role]);

  // Query server API for Products, Clients, Suppliers, Invoices
  const cleanQuery = query.trim();
  const { data: serverData, isFetching } = useQuery<QuickSearchResult>({
    queryKey: ["quick-search", cleanQuery],
    queryFn: () =>
      api
        .get<QuickSearchResult>(`/core/quick-search/?q=${encodeURIComponent(cleanQuery)}`)
        .then((r) => r.data)
        .catch(() => ({ products: [], clients: [], suppliers: [], invoices: [] })),
    enabled: isOpen && cleanQuery.length >= 2,
    staleTime: 10 * 1000,
  });

  // Filter actions matching query
  const filteredActions = useMemo<ActionItem[]>(() => {
    if (!cleanQuery) return staticActions.slice(0, 5);
    const q = cleanQuery.toLowerCase();
    return staticActions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.subtitle.toLowerCase().includes(q) ||
        a.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [staticActions, cleanQuery]);

  // Flatten server results
  const productItems = useMemo<ProductItem[]>(
    () =>
      (serverData?.products ?? []).map((p) => ({
        type: "product",
        id: p.id,
        title: p.name,
        reference: p.reference,
        brand: p.brand,
        sale_price: p.sale_price,
        location: p.location,
        stock_qty: p.stock_qty,
      })),
    [serverData?.products]
  );

  const clientItems = useMemo<ClientItem[]>(
    () =>
      (serverData?.clients ?? []).map((c) => ({
        type: "client",
        id: c.id,
        title: c.name,
        phone: c.phone,
        price_tier: c.price_tier,
        outstanding_balance: c.outstanding_balance,
      })),
    [serverData?.clients]
  );

  const supplierItems = useMemo<SupplierItem[]>(
    () =>
      (serverData?.suppliers ?? []).map((s) => ({
        type: "supplier",
        id: s.id,
        title: s.name,
        phone: s.phone,
        outstanding_balance: s.outstanding_balance,
      })),
    [serverData?.suppliers]
  );

  const invoiceItems = useMemo<InvoiceItem[]>(
    () =>
      (serverData?.invoices ?? []).map((inv) => ({
        type: "invoice",
        id: inv.id,
        title: inv.number,
        client_name: inv.client_name,
        total_ttc: inv.total_ttc,
        status: inv.status,
        date: inv.date,
      })),
    [serverData?.invoices]
  );

  // Combined flat list for keyboard navigation
  const allItems = useMemo<UnifiedSearchItem[]>(() => {
    return [
      ...filteredActions,
      ...productItems,
      ...clientItems,
      ...supplierItems,
      ...invoiceItems,
    ];
  }, [filteredActions, productItems, clientItems, supplierItems, invoiceItems]);

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [cleanQuery]);

  // Ensure active element is scrolled into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  function handleSelectItem(item: UnifiedSearchItem) {
    setIsOpen(false);
    switch (item.type) {
      case "action":
        if (item.onSelect) item.onSelect();
        else if (item.path) navigate(item.path);
        break;
      case "product":
        navigate(`/inventory/products/${item.id}`);
        break;
      case "client":
        navigate(`/clients/${item.id}`);
        break;
      case "supplier":
        navigate(`/suppliers/${item.id}`);
        break;
      case "invoice":
        navigate(`/invoices/${item.id}/edit`);
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (allItems.length > 0 ? (prev + 1) % allItems.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (allItems.length > 0 ? (prev - 1 + allItems.length) % allItems.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (allItems[selectedIndex]) {
        handleSelectItem(allItems[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 bg-black/60 dark:bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Top Search Input */}
        <div className="relative flex items-center px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <Search size={18} className="text-primary-500 shrink-0 me-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("quick_search.input_placeholder", "Rechercher articles, clients, fournisseurs, factures ou actions…")}
            className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          {isFetching ? (
            <Loader2 size={16} className="animate-spin text-primary-500 shrink-0 ms-2" />
          ) : query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
            >
              <X size={16} />
            </button>
          ) : (
            <div className="flex items-center gap-1 shrink-0 ms-2">
              <kbd className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 shadow-2xs">
                Échap
              </kbd>
            </div>
          )}
        </div>

        {/* Results Container */}
        <div ref={listRef} className="overflow-y-auto max-h-[60vh] p-2 space-y-4 divide-y divide-slate-100 dark:divide-slate-800/60">
          {allItems.length === 0 && (
            <div className="py-12 text-center">
              <Search size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {t("quick_search.no_results_title", "Aucun résultat trouvé")}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {t("quick_search.no_results_desc", "Vérifiez l'orthographe ou essayez un nom, une référence, un numéro de téléphone ou un libellé de document.")}
              </p>
            </div>
          )}

          {/* Actions & Navigation Section */}
          {filteredActions.length > 0 && (
            <div className="pt-1.5 first:pt-0">
              <div className="px-2.5 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={12} className="text-primary-500" />
                {t("quick_search.sec_actions", "Actions & Raccourcis")}
              </div>
              <div className="space-y-0.5">
                {filteredActions.map((item) => {
                  const globalIdx = allItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={isSelected}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      className={cn(
                        "w-full text-start px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer",
                        isSelected
                          ? "bg-primary-50 dark:bg-primary-950/60 text-primary-900 dark:text-primary-100 font-semibold"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn(
                          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                          isSelected ? "bg-primary-100 dark:bg-primary-900/60 text-primary-600 dark:text-primary-300" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                        )}>
                          <Icon size={14} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{item.title}</div>
                          <div className="text-[11px] text-slate-400 truncate">{item.subtitle}</div>
                        </div>
                      </div>
                      <CornerDownLeft size={13} className={cn("shrink-0", isSelected ? "text-primary-500" : "opacity-0")} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Products Section */}
          {productItems.length > 0 && (
            <div className="pt-2">
              <div className="px-2.5 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Package size={12} className="text-emerald-500" />
                {t("quick_search.sec_products", "Articles & Chaussures")} ({productItems.length})
              </div>
              <div className="space-y-0.5">
                {productItems.map((item) => {
                  const globalIdx = allItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={isSelected}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      className={cn(
                        "w-full text-start px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer",
                        isSelected
                          ? "bg-primary-50 dark:bg-primary-950/60 text-primary-900 dark:text-primary-100 font-semibold"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="min-w-0">
                          <div className="font-semibold truncate flex items-center gap-1.5">
                            {item.title}
                            {item.brand && <span className="text-slate-400 font-normal">· {item.brand}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                            {item.reference && (
                              <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded text-slate-600 dark:text-slate-300 font-bold">
                                {item.reference}
                              </span>
                            )}
                            {item.location && (
                              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/50 px-1 rounded">
                                📍 {item.location}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-end shrink-0 flex items-center gap-2">
                        <div>
                          <div className="font-mono font-bold text-xs">{formatDZD(item.sale_price)} DZD</div>
                          <div className={cn("text-[10px] font-semibold", item.stock_qty > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>
                            {item.stock_qty} en stock
                          </div>
                        </div>
                        <CornerDownLeft size={13} className={cn("shrink-0", isSelected ? "text-primary-500" : "opacity-0")} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Clients Section */}
          {clientItems.length > 0 && (
            <div className="pt-2">
              <div className="px-2.5 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Users size={12} className="text-blue-500" />
                {t("quick_search.sec_clients", "Clients & Partenaires")} ({clientItems.length})
              </div>
              <div className="space-y-0.5">
                {clientItems.map((item) => {
                  const globalIdx = allItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={isSelected}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      className={cn(
                        "w-full text-start px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer",
                        isSelected
                          ? "bg-primary-50 dark:bg-primary-950/60 text-primary-900 dark:text-primary-100 font-semibold"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold truncate flex items-center gap-1.5">
                          {item.title}
                          {item.price_tier && item.price_tier !== "detail" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 uppercase">
                              {item.price_tier === "gros" ? "Gros" : "Demi-gros"}
                            </span>
                          )}
                        </div>
                        {item.phone && <div className="text-[11px] font-mono text-slate-400 mt-0.5">{item.phone}</div>}
                      </div>
                      <div className="text-end shrink-0 flex items-center gap-2">
                        {Number(item.outstanding_balance) !== 0 && (
                          <div>
                            <div className="text-[10px] text-slate-400 font-medium">Solde</div>
                            <div className={cn("font-mono font-bold text-xs", Number(item.outstanding_balance) > 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400")}>
                              {formatDZD(item.outstanding_balance)} DZD
                            </div>
                          </div>
                        )}
                        <CornerDownLeft size={13} className={cn("shrink-0", isSelected ? "text-primary-500" : "opacity-0")} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Suppliers Section */}
          {supplierItems.length > 0 && (
            <div className="pt-2">
              <div className="px-2.5 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 size={12} className="text-indigo-500" />
                {t("quick_search.sec_suppliers", "Fournisseurs & Ateliers")} ({supplierItems.length})
              </div>
              <div className="space-y-0.5">
                {supplierItems.map((item) => {
                  const globalIdx = allItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={isSelected}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      className={cn(
                        "w-full text-start px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer",
                        isSelected
                          ? "bg-primary-50 dark:bg-primary-950/60 text-primary-900 dark:text-primary-100 font-semibold"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{item.title}</div>
                        {item.phone && <div className="text-[11px] font-mono text-slate-400 mt-0.5">{item.phone}</div>}
                      </div>
                      <div className="text-end shrink-0 flex items-center gap-2">
                        {Number(item.outstanding_balance) > 0 && (
                          <div>
                            <div className="text-[10px] text-slate-400 font-medium">Dû fournisseur</div>
                            <div className="font-mono font-bold text-xs text-rose-500">
                              {formatDZD(item.outstanding_balance)} DZD
                            </div>
                          </div>
                        )}
                        <CornerDownLeft size={13} className={cn("shrink-0", isSelected ? "text-primary-500" : "opacity-0")} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Invoices Section */}
          {invoiceItems.length > 0 && (
            <div className="pt-2">
              <div className="px-2.5 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText size={12} className="text-amber-500" />
                {t("quick_search.sec_invoices", "Factures & Documents")} ({invoiceItems.length})
              </div>
              <div className="space-y-0.5">
                {invoiceItems.map((item) => {
                  const globalIdx = allItems.indexOf(item);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-active={isSelected}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      className={cn(
                        "w-full text-start px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer",
                        isSelected
                          ? "bg-primary-50 dark:bg-primary-950/60 text-primary-900 dark:text-primary-100 font-semibold"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold truncate flex items-center gap-1.5">
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{item.title}</span>
                          {item.client_name && <span className="text-slate-500 dark:text-slate-400 truncate">· {item.client_name}</span>}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{item.date}</div>
                      </div>
                      <div className="text-end shrink-0 flex items-center gap-2">
                        <div>
                          <div className="font-mono font-bold text-xs">{formatDZD(item.total_ttc)} DZD</div>
                          <div className="text-[10px] text-slate-400 capitalize">{item.status}</div>
                        </div>
                        <CornerDownLeft size={13} className={cn("shrink-0", isSelected ? "text-primary-500" : "opacity-0")} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-2xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="font-mono font-bold px-1 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">↑↓</kbd>
              <span>{t("quick_search.hint_navigate", "Naviguer")}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono font-bold px-1 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">↵ Entrée</kbd>
              <span>{t("quick_search.hint_open", "Ouvrir")}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono font-bold px-1 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">Échap</kbd>
              <span>{t("quick_search.hint_close", "Fermer")}</span>
            </span>
          </div>
          <span className="font-semibold text-primary-600 dark:text-primary-400">ShoeDZ QuickSearch</span>
        </div>
      </div>
    </div>
  );
}

