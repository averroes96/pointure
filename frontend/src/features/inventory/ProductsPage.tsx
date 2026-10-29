import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Search, AlertTriangle, Package, Upload, Tag, Trash2, Loader2, Printer, CheckCircle2, X, Filter } from "lucide-react";
import api, { formatDZD, type PaginatedResponse } from "@/lib/api";
import type { Product } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import ImportModal from "@/components/ui/ImportModal";
import BulkPriceUpdateModal from "./components/BulkPriceUpdateModal";
import { viewPdfDocument } from "@/lib/pdfViewer";
import { triggerLabelPrint } from "./components/labelPrintStore";

const PRODUCT_TEMPLATE = `brand,name,category,gender,sale_price,purchase_price,size_eu,colour,alert_threshold
Nike,Air Max 90,sneakers,M,8500,5000,42,Noir,3
Cuir Dz,Sacoche Bandoulière,accessories,U,3500,2000,,,3
Adidas,Stan Smith,sneakers,U,7500,4500,,,3
`;

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "sneakers", label: "Sneakers" },
  { value: "boots", label: "Bottes" },
  { value: "sandals", label: "Sandales" },
  { value: "formal", label: "Chaussures formelles" },
  { value: "sport", label: "Sport" },
  { value: "kids", label: "Enfants" },
  { value: "slippers", label: "Pantoufles" },
  { value: "other", label: "Autre" },
];

const CATEGORY_LABELS: Record<string, string> = {
  sneakers: "Sneakers",
  boots: "Bottes",
  sandals: "Sandales",
  formal: "Chaussures formelles",
  sport: "Sport",
  kids: "Enfants",
  slippers: "Pantoufles",
  accessories: "Accessoires",
  other: "Autre",
};

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "M", label: "Homme" },
  { value: "F", label: "Femme" },
  { value: "K", label: "Enfant" },
  { value: "U", label: "Unisexe" },
];

const SEASON_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Toutes saisons" },
  { value: "summer", label: "Été" },
  { value: "winter", label: "Hiver" },
  { value: "spring_fall", label: "Mi-saison" },
];

export default function ProductsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Filter & Sort states
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 280);
    return () => clearTimeout(timer);
  }, [search]);

  const [category, setCategory] = useState("");
  const [stockStatus, setStockStatus] = useState<"" | "in_stock" | "low_stock" | "out_of_stock">("");
  const [brand, setBrand] = useState("");
  const [gender, setGender] = useState("");
  const [season, setSeason] = useState("");
  const [isActiveFilter, setIsActiveFilter] = useState("");
  const [ordering, setOrdering] = useState("name");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);

  // Multi-selection & Batch Actions
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkShelfLoading, setBulkShelfLoading] = useState(false);
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleteForce, setBulkDeleteForce] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  // Mass Price Update state
  const [bulkPriceModalOpen, setBulkPriceModalOpen] = useState(false);
  const [priceUpdateSuccessMessage, setPriceUpdateSuccessMessage] = useState<string | null>(null);
  const [lastUpdatedProductIds, setLastUpdatedProductIds] = useState<(number | string)[]>([]);

  // Fetch distinct brands for filter dropdown
  const { data: brandsList = [] } = useQuery<string[]>({
    queryKey: ["product-brands"],
    queryFn: () => api.get("/inventory/products/brands/").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: [
      "products",
      {
        search: debouncedSearch,
        category,
        stockStatus,
        brand,
        gender,
        season,
        isActiveFilter,
        ordering,
        branchId: currentBranch?.id ?? "all",
        page,
      },
    ],
    placeholderData: (previousData) => previousData,
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (category) params.set("category", category);
      if (stockStatus) params.set("stock_status", stockStatus);
      if (brand) params.set("brand", brand);
      if (gender) params.set("gender", gender);
      if (season) params.set("season", season);
      if (isActiveFilter) params.set("is_active", isActiveFilter);
      if (ordering) params.set("ordering", ordering);
      if (currentBranch?.id) params.set("branch_id", String(currentBranch.id));
      params.set("page", String(page));
      return api.get(`/inventory/products/?${params.toString()}`).then((r) => r.data);
    },
  });

  const products = data?.results ?? [];

  const hasActiveFilters = Boolean(
    search || category || stockStatus || brand || gender || season || isActiveFilter || ordering !== "name"
  );

  const resetAllFilters = () => {
    setSearch("");
    setCategory("");
    setStockStatus("");
    setBrand("");
    setGender("");
    setSeason("");
    setIsActiveFilter("");
    setOrdering("name");
    setPage(1);
  };

  const allCurrentPageSelected =
    products.length > 0 && products.every((p) => selectedIds.includes(p.id));
  const someCurrentPageSelected =
    products.some((p) => selectedIds.includes(p.id)) && !allCurrentPageSelected;

  function toggleSelectAll() {
    if (allCurrentPageSelected) {
      const currentIds = new Set(products.map((p) => p.id));
      setSelectedIds((prev) => prev.filter((id) => !currentIds.has(id)));
    } else {
      const currentIds = products.map((p) => p.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    }
  }

  function toggleSelectOne(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  async function handleShelfLabelsForIds(ids: (number | string)[]) {
    if (ids.length === 0 || bulkShelfLoading) return;
    setBulkShelfLoading(true);
    try {
      await triggerLabelPrint({
        title: `Étiquettes Rayon (${ids.length} articles)`,
        defaultCopies: 1,
        fetchHtml: async ({ w, h, copies }) => {
          const res = await api.post(
            `/inventory/products/shelf-labels/?output=html&w=${w}&h=${h}`,
            { product_ids: ids, copies },
            { responseType: "text" }
          );
          return res.data;
        },
      });
    } catch {
      alert("Erreur lors de la génération des étiquettes rayon.");
    } finally {
      setBulkShelfLoading(false);
    }
  }

  async function handleBulkShelfLabels() {
    await handleShelfLabelsForIds(selectedIds);
  }

  async function handleSingleShelfLabel(id: number) {
    try {
      await triggerLabelPrint({
        title: "Étiquette Rayon",
        defaultCopies: 1,
        fetchHtml: async ({ w, h, copies }) => {
          const res = await api.get(
            `/inventory/products/${id}/shelf-labels/?output=html&w=${w}&h=${h}&copies=${copies}`,
            { responseType: "text" }
          );
          return res.data;
        },
      });
    } catch {
      alert("Erreur lors de la génération de l'étiquette rayon.");
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.length === 0 || bulkDeleteLoading) return;
    setBulkDeleteLoading(true);
    setBulkDeleteError(null);
    try {
      await api.post("/inventory/products/bulk-delete/", {
        ids: selectedIds,
        force: bulkDeleteForce,
      });
      setSelectedIds([]);
      setBulkDeleteModalOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err: any) {
      const respData = err?.response?.data;
      if (respData?.has_transactions) {
        setBulkDeleteError(
          respData?.detail ||
            "Certains produits sélectionnés possèdent des ventes enregistrées. Cochez 'Forcer la suppression' pour continuer."
        );
        setBulkDeleteForce(true);
      } else {
        setBulkDeleteError(respData?.detail || respData?.error || "Erreur lors de la suppression groupée.");
      }
    } finally {
      setBulkDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {showImport && (
        <ImportModal
          title="Importer des produits"
          endpoint="/inventory/products/import/"
          templateCsv={PRODUCT_TEMPLATE}
          templateFilename="modele_produits.csv"
          onSuccess={() => { qc.invalidateQueries({ queryKey: ["products"] }); setShowImport(false); }}
          onClose={() => setShowImport(false)}
        />
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.products")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> {t("inventory.product")} enregistrés
          </p>
        </div>
        {user?.role !== "cashier" && (
          <div className="flex items-center gap-2.5">
            <button onClick={() => setShowImport(true)} className="btn-secondary">
              <Upload size={15} />
              Importer CSV
            </button>
            <Link to="/inventory/products/new" className="btn-primary">
              <Plus size={16} />
              {t("common.new")}
            </Link>
          </div>
        )}
      </div>

      {/* Price Update Success Notification Banner */}
      {priceUpdateSuccessMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl flex items-center justify-between gap-3 text-sm shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span className="font-medium">{priceUpdateSuccessMessage}</span>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdatedProductIds.length > 0 && (
              <button
                type="button"
                onClick={() => handleShelfLabelsForIds(lastUpdatedProductIds)}
                disabled={bulkShelfLoading}
                className="btn-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg flex items-center gap-1.5 px-3 py-1.5 text-xs shadow-2xs transition-colors"
              >
                <Printer size={13} />
                Réimprimer étiquettes rayon ({lastUpdatedProductIds.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setPriceUpdateSuccessMessage(null)}
              className="text-emerald-600 hover:text-emerald-800 p-1 rounded-md"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Search & Filters Panel */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        {/* Row 1: Search Input + Quick Stock Status Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              data-shortcut-search="true"
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="form-input ps-9 pe-12 py-2 text-xs bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
              placeholder="Nom, référence, marque, code-barres ou emplacement…"
            />
            <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md shadow-2xs pointer-events-none">
              F2
            </kbd>
          </div>

          {/* Quick Stock Status Pills */}
          <div className="inline-flex items-center bg-slate-100 p-1 rounded-xl gap-1 flex-wrap">
            {(
              [
                { id: "", label: "Tout le stock" },
                { id: "in_stock", label: "En stock (> 0)" },
                { id: "low_stock", label: "Stock bas" },
                { id: "out_of_stock", label: "En rupture (0)" },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => {
                  setStockStatus(pill.id);
                  setPage(1);
                }}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  stockStatus === pill.id
                    ? pill.id === "out_of_stock"
                      ? "bg-red-600 text-white shadow-2xs"
                      : pill.id === "low_stock"
                        ? "bg-amber-500 text-white shadow-2xs"
                        : "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Detailed Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 pe-1">
            <Filter size={13} />
            <span>Filtres :</span>
          </div>

          {/* Category Filter */}
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="form-input w-auto min-w-[155px] py-1.5 rounded-xl text-xs font-medium"
            title="Catégorie"
          >
            <option value="">Toutes les catégories</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {t(`category.${c.value}`, c.label)}
              </option>
            ))}
          </select>

          {/* Brand Filter */}
          {brandsList.length > 0 && (
            <select
              value={brand}
              onChange={(e) => { setBrand(e.target.value); setPage(1); }}
              className="form-input w-auto min-w-[140px] py-1.5 rounded-xl text-xs font-medium"
              title="Marque"
            >
              <option value="">Toutes les marques</option>
              {brandsList.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}

          {/* Gender Filter */}
          <select
            value={gender}
            onChange={(e) => { setGender(e.target.value); setPage(1); }}
            className="form-input w-auto min-w-[130px] py-1.5 rounded-xl text-xs font-medium"
            title="Genre"
          >
            <option value="">Tous les genres</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>

          {/* Season Filter */}
          <select
            value={season}
            onChange={(e) => { setSeason(e.target.value); setPage(1); }}
            className="form-input w-auto min-w-[135px] py-1.5 rounded-xl text-xs font-medium"
            title="Saison"
          >
            <option value="">Toutes les saisons</option>
            {SEASON_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Active Status Filter */}
          <select
            value={isActiveFilter}
            onChange={(e) => { setIsActiveFilter(e.target.value); setPage(1); }}
            className="form-input w-auto min-w-[130px] py-1.5 rounded-xl text-xs font-medium"
            title="Statut"
          >
            <option value="">Tous les statuts</option>
            <option value="true">Actifs uniquement</option>
            <option value="false">Inactifs</option>
          </select>

          {/* Sort Order */}
          <select
            value={ordering}
            onChange={(e) => { setOrdering(e.target.value); setPage(1); }}
            className="form-input w-auto min-w-[155px] py-1.5 rounded-xl text-xs font-medium ms-auto"
            title="Trier par"
          >
            <option value="name">Tri : Nom (A → Z)</option>
            <option value="-name">Tri : Nom (Z → A)</option>
            <option value="-created_at">Tri : Plus récents</option>
            <option value="created_at">Tri : Plus anciens</option>
            <option value="-sale_price">Tri : Prix décroissant</option>
            <option value="sale_price">Tri : Prix croissant</option>
            <option value="-total_stock_qty">Tri : Stock décroissant</option>
            <option value="total_stock_qty">Tri : Stock croissant</option>
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-bold cursor-pointer rounded-xl px-2.5 py-1.5 text-xs"
            >
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* Batch Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-900 text-white rounded-2xl shadow-lg border border-slate-800 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center bg-primary-600 text-white font-mono text-xs font-bold rounded-lg px-2.5 py-1">
              {selectedIds.length}
            </span>
            <span className="text-sm font-semibold">
              produit{selectedIds.length > 1 ? "s" : ""} sélectionné{selectedIds.length > 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {user?.role !== "cashier" && (
              <button
                type="button"
                onClick={() => setBulkPriceModalOpen(true)}
                className="btn-sm bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <Tag size={14} />
                {t("inventory.bulk_price_update", "Modifier les prix")} ({selectedIds.length})
              </button>
            )}

            <button
              type="button"
              onClick={handleBulkShelfLabels}
              disabled={bulkShelfLoading}
              className="btn-sm bg-white text-slate-900 hover:bg-slate-100 font-semibold rounded-xl flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              {bulkShelfLoading ? (
                <Loader2 size={14} className="animate-spin text-slate-600" />
              ) : (
                <Printer size={14} className="text-amber-600" />
              )}
              {t("inventory.print_shelf_labels", "Imprimer étiquettes rayon")} ({selectedIds.length})
            </button>

            {user?.role !== "cashier" && (
              <button
                type="button"
                onClick={() => {
                  setBulkDeleteError(null);
                  setBulkDeleteForce(false);
                  setBulkDeleteModalOpen(true);
                }}
                className="btn-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <Trash2 size={14} />
                Supprimer ({selectedIds.length})
              </button>
            )}

            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="btn-ghost btn-sm text-slate-300 hover:text-white hover:bg-slate-800 text-xs"
            >
              Désélectionner
            </button>
          </div>
        </div>
      )}

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allCurrentPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someCurrentPageSelected;
                    }}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    title="Tout sélectionner sur cette page"
                  />
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.product")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.brand")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.category")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.sale_price")}</th>
                {user?.can_see_costs && <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.purchase_price")}</th>}
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.stock")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("common.status")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={user?.can_see_costs ? 10 : 9} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">{t("common.loading")}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && products.length === 0 && (
                <tr>
                  <td colSpan={user?.can_see_costs ? 10 : 9} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <Package size={32} className="text-slate-300 stroke-[1.5]" />
                      <span className="text-sm">{t("common.no_data")}</span>
                    </div>
                  </td>
                </tr>
              )}
              {products.map((product) => (
                <tr
                  key={product.id}
                  className={cn(
                    "group cursor-pointer transition-colors",
                    selectedIds.includes(product.id) ? "bg-primary-50/40 hover:bg-primary-50/70" : "hover:bg-slate-50/80"
                  )}
                  onClick={() => navigate(`/inventory/products/${product.id}`)}
                >
                  <td className="py-3.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(product.id)}
                      onChange={() => toggleSelectOne(product.id)}
                      className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    />
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200/80 shadow-2xs flex-shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 text-slate-400 group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors border border-slate-200/60">
                          <Package size={16} />
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">
                          {product.name}
                        </div>
                        {product.reference && (
                          <div className="text-2xs font-mono text-slate-400 mt-0.5">
                            {product.reference}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 font-medium text-sm">
                    {product.brand || "—"}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {t(`category.${product.category}`, CATEGORY_LABELS[product.category] ?? product.category)}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-end">
                    <div className="font-mono font-bold text-slate-900 tabular-nums text-sm">
                      {formatDZD(product.sale_price)} <span className="text-2xs font-sans text-slate-400 font-normal">DZD</span>
                    </div>
                  </td>
                  {user?.can_see_costs && (
                    <td className="py-3.5 px-4 text-end">
                      <div className="font-mono text-slate-600 tabular-nums text-sm">
                        {formatDZD(product.purchase_price)} <span className="text-2xs font-sans text-slate-400 font-normal">DZD</span>
                      </div>
                      {product.pamp && parseFloat(product.pamp) > 0 && product.pamp !== product.purchase_price && (
                        <div
                          className="text-2xs font-mono text-amber-600 mt-0.5 font-medium"
                          title={t("inventory.pamp_tooltip")}
                        >
                          PAMP: {formatDZD(product.pamp)}
                        </div>
                      )}
                    </td>
                  )}
                  <td className="py-3.5 px-4 text-end">
                    {product.total_stock === 0 ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-red-50 text-red-700 border border-red-200 tabular-nums">
                        0
                      </span>
                    ) : product.has_low_stock ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-50 text-amber-700 border border-amber-200 tabular-nums">
                        <AlertTriangle size={11} className="text-amber-600" />
                        {product.total_stock}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-slate-100 text-slate-700 border border-slate-200 tabular-nums">
                        {product.total_stock}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={cn("badge", product.is_active ? "badge-success" : "badge-neutral")}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", product.is_active ? "bg-emerald-500" : "bg-slate-400")} />
                      {product.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-end" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleSingleShelfLabel(product.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                        title="Imprimer l'étiquette rayon"
                      >
                        <Tag size={15} />
                      </button>
                      <Link
                        to={`/inventory/products/${product.id}`}
                        className="btn-ghost btn-sm text-primary-600 hover:bg-primary-50 hover:text-primary-700 font-semibold inline-flex items-center gap-1"
                      >
                        {t("common.view")}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-5 py-3.5 border-t border-slate-200/80 bg-slate-50/40 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              Page <span className="font-mono font-semibold text-slate-700">{data.current_page}</span> sur{" "}
              <span className="font-mono font-semibold text-slate-700">{data.total_pages}</span>
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary btn-sm"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.next}
                className="btn-secondary btn-sm"
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Delete Modal */}
      {bulkDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="card max-w-md w-full p-6 space-y-4 bg-white shadow-xl rounded-2xl border border-red-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Supprimer définitivement {selectedIds.length} produit{selectedIds.length > 1 ? "s" : ""} ?
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Cette action est irréversible. Les produits sélectionnés et leurs déclinaisons seront définitivement effacés.
                </p>
              </div>
            </div>

            {bulkDeleteError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{bulkDeleteError}</span>
              </div>
            )}

            <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-amber-900 font-medium">
                <input
                  type="checkbox"
                  checked={bulkDeleteForce}
                  onChange={(e) => setBulkDeleteForce(e.target.checked)}
                  className="rounded border-amber-400 text-red-600 focus:ring-red-500 mt-0.5"
                />
                <span>
                  <strong>Forcer la suppression</strong> : Supprimer même si des produits ont des historiques de vente ou de facturation.
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setBulkDeleteModalOpen(false);
                  setBulkDeleteError(null);
                  setBulkDeleteForce(false);
                }}
                disabled={bulkDeleteLoading}
                className="btn-secondary btn-sm"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkDeleteLoading}
                className="btn-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl px-4 py-2 flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50"
              >
                {bulkDeleteLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Suppression…
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    Supprimer définitivement
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Price Update Modal */}
      {bulkPriceModalOpen && (
        <BulkPriceUpdateModal
          isOpen={bulkPriceModalOpen}
          onClose={() => setBulkPriceModalOpen(false)}
          selectedIds={selectedIds}
          selectedProducts={products.filter((p) => selectedIds.includes(p.id))}
          onSuccess={async (updatedIds, autoReprint) => {
            qc.invalidateQueries({ queryKey: ["products"] });
            setPriceUpdateSuccessMessage(`${updatedIds.length} produit(s) mis à jour avec succès.`);
            setLastUpdatedProductIds(updatedIds);
            setSelectedIds([]);
            if (autoReprint) {
              await handleShelfLabelsForIds(updatedIds);
            }
          }}
        />
      )}
    </div>
  );
}
