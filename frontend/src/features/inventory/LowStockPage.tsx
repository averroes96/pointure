import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
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
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Article</th>
            <th>Pointure</th>
            <th>Couleur</th>
            <th className="text-end">Stock actuel</th>
            <th className="text-end">Seuil d'alerte</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={7} className="text-center py-8 text-text-muted">Chargement...</td>
            </tr>
          )}
          {!isLoading && variants.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center py-8 text-text-muted">Aucun article dans cette catégorie.</td>
            </tr>
          )}
          {variants.map((variant) => (
            <tr key={variant.id}>
              <td>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-surface rounded flex items-center justify-center flex-shrink-0">
                    <Package size={13} className="text-text-muted" />
                  </div>
                  <span className="font-medium text-text-primary">{variant.product_name}</span>
                </div>
              </td>
              <td className="font-mono text-text-muted">{variant.size_eu}</td>
              <td className="text-text-muted">{variant.colour || "—"}</td>
              <td className="text-end">
                <span
                  className={cn(
                    "font-mono font-semibold",
                    variant.stock_qty === 0 ? "text-danger" : "text-warning"
                  )}
                >
                  {variant.stock_qty}
                </span>
              </td>
              <td className="text-end font-mono text-text-muted">{variant.alert_threshold}</td>
              <td>
                {variant.stock_qty === 0 ? (
                  <span className="badge badge-danger">Rupture</span>
                ) : (
                  <span className="badge badge-warning">Stock bas</span>
                )}
              </td>
              <td>
                <button
                  onClick={() => onOrder(variant)}
                  className="btn-secondary btn-sm flex items-center gap-1"
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
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Référence</th>
            <th className="text-end">Stock total</th>
            <th className="text-end">Seuil global</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={6} className="text-center py-8 text-text-muted">Chargement...</td>
            </tr>
          )}
          {!isLoading && products.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center py-8 text-text-muted">Aucun produit dans cette catégorie.</td>
            </tr>
          )}
          {products.map((product) => (
            <tr key={product.id}>
              <td>
                <Link to={`/inventory/products/${product.id}`} className="flex items-center gap-2 hover:underline">
                  <div className="w-7 h-7 bg-surface rounded flex items-center justify-center flex-shrink-0">
                    <Package size={13} className="text-text-muted" />
                  </div>
                  <span className="font-medium text-text-primary">{product.name}</span>
                </Link>
              </td>
              <td className="font-mono text-text-muted">{product.reference || "—"}</td>
              <td className="text-end">
                <span
                  className={cn(
                    "font-mono font-semibold",
                    product.total_stock === 0 ? "text-danger" : "text-warning"
                  )}
                >
                  {product.total_stock}
                </span>
              </td>
              <td className="text-end font-mono text-text-muted">{product.alert_threshold}</td>
              <td>
                {product.total_stock === 0 ? (
                  <span className="badge badge-danger">Rupture</span>
                ) : (
                  <span className="badge badge-warning">Stock bas</span>
                )}
              </td>
              <td>
                <button
                  onClick={() => onOrder(product)}
                  className="btn-secondary btn-sm flex items-center gap-1"
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
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"products" | "variants">("products");

  function handleOrderVariant(variant: Variant) {
    const needed = Math.max(1, (variant.alert_threshold ?? 0) - variant.stock_qty);
    const parts = [variant.product_name, variant.size_eu, variant.colour].filter(Boolean);
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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Articles en rupture / alerte</h1>
          <p className="text-sm text-text-muted">Suivi des niveaux de stock critiques</p>
        </div>
        <div className="flex items-center p-1 bg-surface rounded-lg border border-border">
          <button
            onClick={() => setActiveTab("products")}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === "products" ? "bg-white shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
            )}
          >
            Produits
          </button>
          <button
            onClick={() => setActiveTab("variants")}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === "variants" ? "bg-white shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
            )}
          >
            Variantes
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="kpi-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="kpi-card__label">En rupture ({activeTab === "products" ? "Produits" : "Variantes"})</div>
              <div className="kpi-card__value text-danger">{currentLoading ? "..." : currentOutOfStockLength}</div>
              <div className="text-xs text-text-muted mt-1">Stock = 0</div>
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-danger">
              <AlertTriangle size={20} className="text-white" />
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="kpi-card__label">En alerte ({activeTab === "products" ? "Produits" : "Variantes"})</div>
              <div className="kpi-card__value text-warning">{currentLoading ? "..." : currentLowStockLength}</div>
              <div className="text-xs text-text-muted mt-1">Sous le seuil</div>
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-warning">
              <AlertTriangle size={20} className="text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Out of stock section */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <span className="badge badge-danger">
              {currentOutOfStockLength}
            </span>
            <h2 className="font-semibold text-text-primary">En rupture</h2>
          </div>
          <span className="text-xs text-text-muted">Stock = 0</span>
        </div>
        {activeTab === "products" ? (
          <ProductTable products={outOfStockProducts} isLoading={productsLoading} onOrder={handleOrderProduct} />
        ) : (
          <VariantTable variants={outOfStockVariants} isLoading={variantsLoading} onOrder={handleOrderVariant} />
        )}
      </div>

      {/* Low stock section */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <span className="badge badge-warning">
              {currentLowStockLength}
            </span>
            <h2 className="font-semibold text-text-primary">Stock bas</h2>
          </div>
          <span className="text-xs text-text-muted">Sous le seuil d'alerte</span>
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
