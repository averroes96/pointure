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
Nike,Air Max 90,sneakers,M,8500,5000,40,Noir,3
Nike,Air Max 90,sneakers,M,8500,5000,41,Noir,3
Nike,Air Max 90,sneakers,M,8500,5000,42,Blanc,3
Adidas,Stan Smith,sneakers,U,7500,4500,39,Blanc,3
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
    <div className="space-y-4">
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.products")}</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} {t("inventory.product")}</p>
        </div>
        {user?.role !== "cashier" && (
          <div className="flex gap-2">
            <button onClick={() => setShowImport(true)} className="btn-secondary">
              <Upload size={16} />
              Importer
            </button>
            <Link to="/inventory/products/new" className="btn-primary">
              <Plus size={16} />
              {t("common.new")}
            </Link>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="form-input ps-9"
          placeholder={t("common.search")}
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("inventory.product")}</th>
                <th>{t("inventory.brand")}</th>
                <th>{t("inventory.category")}</th>
                <th className="text-end">{t("inventory.sale_price")}</th>
                {user?.can_see_costs && <th className="text-end">{t("inventory.purchase_price")}</th>}
                <th className="text-end">{t("inventory.stock")}</th>
                <th>{t("common.status")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">{t("common.loading")}</td>
                </tr>
              )}
              {!isLoading && products.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">{t("common.no_data")}</td>
                </tr>
              )}
              {products.map((product) => (
                <tr
                  key={product.id}
                  className="cursor-pointer hover:bg-surface"
                  onClick={() => navigate(`/inventory/products/${product.id}`)}
                >
                  <td>
                    <div className="flex items-center gap-3">
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-8 h-8 rounded object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-surface rounded flex items-center justify-center">
                          <Package size={14} className="text-text-muted" />
                        </div>
                      )}
                      <span className="font-medium text-text-primary">{product.name}</span>
                    </div>
                  </td>
                  <td className="text-text-muted">{product.brand || "—"}</td>
                  <td>
                    <span className={cn("badge", "badge-info")}>
                      {product.category}
                    </span>
                  </td>
                  <td className="text-end font-mono">
                    {formatDZD(product.sale_price)} <span className="text-2xs text-text-muted">DZD</span>
                  </td>
                  {user?.can_see_costs && (
                    <td className="text-end font-mono text-text-muted">
                      {formatDZD(product.purchase_price)} <span className="text-2xs">DZD</span>
                    </td>
                  )}
                  <td className="text-end">
                    <span
                      className={cn(
                        "font-mono font-medium",
                        product.has_low_stock ? "text-warning" : "text-text-primary",
                        product.total_stock === 0 && "text-danger"
                      )}
                    >
                      {product.total_stock}
                    </span>
                    {product.has_low_stock && (
                      <AlertTriangle size={12} className="inline ms-1 text-warning" />
                    )}
                  </td>
                  <td>
                    <span className={cn("badge", product.is_active ? "badge-success" : "badge-neutral")}>
                      {product.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td>
                    <Link
                      to={`/inventory/products/${product.id}`}
                      className="btn-ghost btn-sm text-primary-500"
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
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Page {data.current_page} / {data.total_pages}
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
