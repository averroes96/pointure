import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Search, AlertTriangle, Package, Upload } from "lucide-react";
import api, { formatDZD, type PaginatedResponse } from "@/lib/api";
import type { Product } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import ImportModal from "@/components/ui/ImportModal";

const PRODUCT_TEMPLATE = `brand,name,category,gender,sale_price,purchase_price,size_eu,colour,alert_threshold
Nike,Air Max 90,sneakers,M,8500,5000,42,Noir,3
Cuir Dz,Sacoche Bandoulière,accessories,U,3500,2000,,,3
Adidas,Stan Smith,sneakers,U,7500,4500,,,3
`;

export default function ProductsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ["products", { search, page }],
    queryFn: () =>
      api.get(`/inventory/products/?search=${search}&page=${page}`).then((r) => r.data),
  });

  const products = data?.results ?? [];

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

      {/* Search & Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            data-shortcut-search="true"
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9 pe-12 bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
            placeholder={t("common.search")}
          />
          <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md shadow-2xs pointer-events-none">
            F2
          </kbd>
        </div>
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
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
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">{t("common.loading")}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && products.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
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
                  className="group cursor-pointer hover:bg-slate-50/80 transition-colors"
                  onClick={() => navigate(`/inventory/products/${product.id}`)}
                >
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
                      {product.category}
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
                  <td className="py-3.5 px-4 text-end">
                    <Link
                      to={`/inventory/products/${product.id}`}
                      className="btn-ghost btn-sm text-primary-600 hover:bg-primary-50 hover:text-primary-700 font-semibold inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t("common.view")}
                    </Link>
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
    </div>
  );
}
