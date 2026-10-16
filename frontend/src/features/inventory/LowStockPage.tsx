import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ShoppingCart, Package } from "lucide-react";
import api, { type PaginatedResponse } from "@/lib/api";
import type { Variant, Product } from "@/types";
import { cn } from "@/lib/utils";

interface VariantTableProps {
  variants: Variant[];
  isLoading: boolean;
  onOrder: (variant: Variant) => void;
}

function VariantTable({ variants, isLoading, onOrder }: VariantTableProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr className="border-b border-slate-200/80 bg-slate-50/70">
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.product")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.size")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.colour")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.current_stock")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.alert_threshold")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("common.status")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {isLoading && (
            <tr>
              <td colSpan={7} className="text-center py-12 text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">{t("common.loading")}</span>
                </div>
              </td>
            </tr>
          )}
          {!isLoading && variants.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center py-12 text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <Package size={32} className="text-slate-300 stroke-[1.5]" />
                  <span className="text-sm">{t("common.no_data")}</span>
                </div>
              </td>
            </tr>
          )}
          {variants.map((variant) => (
            <tr key={variant.id} className="group hover:bg-slate-50/80 transition-colors">
              <td className="py-3.5 px-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 text-slate-400 group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors border border-slate-200/60">
                    <Package size={14} />
                  </div>
                  <span className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">{variant.product_name}</span>
                </div>
              </td>
              <td className="py-3.5 px-4">
                {variant.size_eu > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-slate-100 text-slate-800 border border-slate-200">
                    T. {variant.size_eu}
                  </span>
                ) : (
                  <span className="text-slate-400 font-mono text-xs">—</span>
                )}
              </td>
              <td className="py-3.5 px-4 text-sm text-slate-600 font-medium">
                {variant.colour === "N/A" || variant.colour === "Standard"
                  ? (variant.size_eu > 0 ? t("common.na") : "—")
                  : variant.colour}
              </td>
              <td className="py-3.5 px-4 text-end">
                <span
                  className={cn(
                    "font-mono font-bold tabular-nums text-sm",
                    variant.stock_qty === 0 ? "text-red-600" : "text-amber-600"
                  )}
                >
                  {variant.stock_qty}
                </span>
              </td>
              <td className="py-3.5 px-4 text-end font-mono text-slate-500 tabular-nums text-sm">{variant.alert_threshold}</td>
              <td className="py-3.5 px-4">
                {variant.stock_qty === 0 ? (
                  <span className="badge badge-danger">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {t("inventory.out_of_stock_title")}
                  </span>
                ) : (
                  <span className="badge badge-warning">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {t("inventory.low_stock_status")}
                  </span>
                )}
              </td>
              <td className="py-3.5 px-4 text-end">
                <button
                  onClick={() => onOrder(variant)}
                  className="btn-secondary btn-sm flex items-center gap-1.5 font-semibold text-slate-700 hover:text-primary-600 hover:border-primary-300 rounded-lg ms-auto"
                >
                  <ShoppingCart size={13} />
                  Commander
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ProductTableProps {
  products: Product[];
  isLoading: boolean;
  onOrder: (product: Product) => void;
}

function ProductTable({ products, isLoading, onOrder }: ProductTableProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr className="border-b border-slate-200/80 bg-slate-50/70">
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.product")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.reference")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.total_stock")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.global_threshold")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("common.status")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {isLoading && (
            <tr>
              <td colSpan={6} className="text-center py-12 text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">{t("common.loading")}</span>
                </div>
              </td>
            </tr>
          )}
          {!isLoading && products.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center py-12 text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <Package size={32} className="text-slate-300 stroke-[1.5]" />
                  <span className="text-sm">{t("common.no_data")}</span>
                </div>
              </td>
            </tr>
          )}
          {products.map((product) => (
            <tr key={product.id} className="group hover:bg-slate-50/80 transition-colors">
              <td className="py-3.5 px-4">
                <Link to={`/inventory/products/${product.id}`} className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 text-slate-400 group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors border border-slate-200/60">
                    <Package size={14} />
                  </div>
                  <span className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">{product.name}</span>
                </Link>
              </td>
              <td className="py-3.5 px-4 font-mono text-2xs text-slate-500">{product.reference || "—"}</td>
              <td className="py-3.5 px-4 text-end">
                <span
                  className={cn(
                    "font-mono font-bold tabular-nums text-sm",
                    product.total_stock === 0 ? "text-red-600" : "text-amber-600"
                  )}
                >
                  {product.total_stock}
                </span>
              </td>
              <td className="py-3.5 px-4 text-end font-mono text-slate-500 tabular-nums text-sm">{product.alert_threshold}</td>
              <td className="py-3.5 px-4">
                {product.total_stock === 0 ? (
                  <span className="badge badge-danger">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {t("inventory.out_of_stock_title")}
                  </span>
                ) : (
                  <span className="badge badge-warning">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {t("inventory.low_stock_status")}
                  </span>
                )}
              </td>
              <td className="py-3.5 px-4 text-end">
                <button
                  onClick={() => onOrder(product)}
                  className="btn-secondary btn-sm flex items-center gap-1.5 font-semibold text-slate-700 hover:text-primary-600 hover:border-primary-300 rounded-lg ms-auto"
                >
                  <ShoppingCart size={13} />
                  Commander
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LowStockPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"products" | "variants">("products");

  function handleOrderVariant(variant: Variant) {
    const needed = Math.max(1, (variant.alert_threshold ?? 0) - variant.stock_qty);
    const parts = [
      variant.product_name,
      variant.size_eu > 0 ? `T${variant.size_eu}` : null,
      variant.colour && variant.colour !== "N/A" && variant.colour !== "Standard" ? variant.colour : null,
    ].filter(Boolean);
    const description = parts.join(" — ");
    navigate("/purchase-orders/new", {
      state: {
        lines: [{ description, quantity_ordered: String(needed), agreed_unit_price: "" }],
      },
    });
  }

  function handleOrderProduct(product: Product) {
    const needed = Math.max(1, (product.alert_threshold ?? 0) - product.total_stock);
    navigate("/purchase-orders/new", {
      state: {
        lines: [{ description: product.name, quantity_ordered: String(needed), agreed_unit_price: "" }],
      },
    });
  }

  const { data: variantsData, isLoading: variantsLoading } = useQuery<PaginatedResponse<Variant>>({
    queryKey: ["variants", "low-stock"],
    queryFn: () => api.get("/inventory/low-stock/?page_size=200").then((r) => r.data),
    enabled: activeTab === "variants",
  });

  const { data: productsData, isLoading: productsLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ["products", "low-stock"],
    queryFn: () => api.get("/inventory/products/low-stock/?page_size=200").then((r) => r.data),
    enabled: activeTab === "products",
  });

  const allVariants = (variantsData?.results ?? []).slice().sort((a, b) => a.stock_qty - b.stock_qty);
  const outOfStockVariants = allVariants.filter((v) => v.stock_qty === 0);
  const lowStockVariants = allVariants.filter((v) => v.stock_qty > 0 && v.is_low_stock);

  const allProducts = (productsData?.results ?? []).slice().sort((a, b) => a.total_stock - b.total_stock);
  const outOfStockProducts = allProducts.filter((p) => p.total_stock === 0);
  const lowStockProducts = allProducts.filter((p) => p.total_stock > 0 && p.is_total_low_stock);

  const currentOutOfStockLength = activeTab === "products" ? outOfStockProducts.length : outOfStockVariants.length;
  const currentLowStockLength = activeTab === "products" ? lowStockProducts.length : lowStockVariants.length;
  const currentLoading = activeTab === "products" ? productsLoading : variantsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("inventory.low_stock_title")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">{t("inventory.low_stock_desc")}</p>
        </div>
        <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/80 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab("products")}
            className={cn(
              "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
              activeTab === "products" ? "bg-white shadow-xs text-slate-900" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {t("inventory.products_tab", "Produits")}
          </button>
          <button
            onClick={() => setActiveTab("variants")}
            className={cn(
              "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
              activeTab === "variants" ? "bg-white shadow-xs text-slate-900" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {t("inventory.variants_tab", "Variantes")}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("inventory.out_of_stock_title")} ({activeTab === "products" ? t("inventory.products_tab", "Produits") : t("inventory.variants_tab", "Variantes")})
            </div>
            <div className="text-3xl font-bold font-mono text-red-600 mt-1 tabular-nums">
              {currentLoading ? "..." : currentOutOfStockLength}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{t("inventory.stock_zero")}</div>
          </div>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-red-50 text-red-600 border border-red-100 flex-shrink-0">
            <AlertTriangle size={22} />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              En alerte ({activeTab === "products" ? t("inventory.products_tab", "Produits") : t("inventory.variants_tab", "Variantes")})
            </div>
            <div className="text-3xl font-bold font-mono text-amber-600 mt-1 tabular-nums">
              {currentLoading ? "..." : currentLowStockLength}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Sous le seuil d'alerte</div>
          </div>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-amber-50 text-amber-600 border border-amber-100 flex-shrink-0">
            <AlertTriangle size={22} />
          </div>
        </div>
      </div>

      {/* Out of stock section */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <span className="badge badge-danger font-mono font-bold">
              {currentOutOfStockLength}
            </span>
            <h2 className="font-bold text-slate-900 text-sm">En rupture de stock</h2>
          </div>
          <span className="text-xs font-medium text-slate-500">{t("inventory.stock_zero")}</span>
        </div>
        {activeTab === "products" ? (
          <ProductTable products={outOfStockProducts} isLoading={productsLoading} onOrder={handleOrderProduct} />
        ) : (
          <VariantTable variants={outOfStockVariants} isLoading={variantsLoading} onOrder={handleOrderVariant} />
        )}
      </div>

      {/* Low stock section */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <span className="badge badge-warning font-mono font-bold">
              {currentLowStockLength}
            </span>
            <h2 className="font-bold text-slate-900 text-sm">{t("inventory.low_stock_status")}</h2>
          </div>
          <span className="text-xs font-medium text-slate-500">Sous le seuil d'alerte</span>
        </div>
        {activeTab === "products" ? (
          <ProductTable products={lowStockProducts} isLoading={productsLoading} onOrder={handleOrderProduct} />
        ) : (
          <VariantTable variants={lowStockVariants} isLoading={variantsLoading} onOrder={handleOrderVariant} />
        )}
      </div>
    </div>
  );
}
