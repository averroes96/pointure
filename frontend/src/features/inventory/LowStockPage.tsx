import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShoppingCart, Package } from "lucide-react";
import api, { type PaginatedResponse } from "@/lib/api";
import type { Variant } from "@/types";
import { cn } from "@/lib/utils";

function handleOrder(variant: Variant) {
  alert("Fonctionnalité commandes bientôt disponible");
}

interface VariantTableProps {
  variants: Variant[];
  isLoading: boolean;
}

function VariantTable({ variants, isLoading }: VariantTableProps) {
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
                  onClick={() => handleOrder(variant)}
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
  const { data, isLoading } = useQuery<PaginatedResponse<Variant>>({
    queryKey: ["variants", "low-stock"],
    queryFn: () =>
      api.get("/inventory/variants/?is_low_stock=true&page_size=100").then((r) => r.data),
  });

  const allVariants = (data?.results ?? []).slice().sort((a, b) => a.stock_qty - b.stock_qty);

  const outOfStock = allVariants.filter((v) => v.stock_qty === 0);
  const lowStock = allVariants.filter((v) => v.stock_qty > 0 && v.is_low_stock);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">Articles en rupture / alerte</h1>
        <p className="text-sm text-text-muted">Suivi des niveaux de stock critiques</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="kpi-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="kpi-card__label">Articles en rupture</div>
              <div className="kpi-card__value text-danger">{isLoading ? "..." : outOfStock.length}</div>
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
              <div className="kpi-card__label">Articles en alerte</div>
              <div className="kpi-card__value text-warning">{isLoading ? "..." : lowStock.length}</div>
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
              {outOfStock.length}
            </span>
            <h2 className="font-semibold text-text-primary">En rupture</h2>
          </div>
          <span className="text-xs text-text-muted">Stock = 0</span>
        </div>
        <VariantTable variants={outOfStock} isLoading={isLoading} />
      </div>

      {/* Low stock section */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <span className="badge badge-warning">
              {lowStock.length}
            </span>
            <h2 className="font-semibold text-text-primary">Stock bas</h2>
          </div>
          <span className="text-xs text-text-muted">Sous le seuil d'alerte</span>
        </div>
        <VariantTable variants={lowStock} isLoading={isLoading} />
      </div>
    </div>
  );
}
