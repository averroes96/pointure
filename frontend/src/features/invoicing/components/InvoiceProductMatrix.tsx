import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Search, X, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";

export interface VariantData {
  id: number;
  size_eu: number;
  colour: string;
  stock_qty: number;
}

export interface ProductResult {
  id: number;
  name: string;
  brand: string;
  sale_price: string;
  wholesale_price?: string;
  purchase_price?: string;
  variants: VariantData[];
}

export interface MatrixConfig {
  id: string; // local uuid
  product: ProductResult | null;
  cartons: number;
  pairs_per_carton: number;
  unit_price: string;
  discount_pct: string;
  quantities: Record<string, Record<number, number>>; // colour -> size -> qty
}

export function localId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createEmptyMatrix(): MatrixConfig {
  return {
    id: localId(),
    product: null,
    cartons: 1,
    pairs_per_carton: 10,
    unit_price: "",
    discount_pct: "0",
    quantities: {},
  };
}

function ProductSearch({
  selectedProduct,
  onSelect,
  onClear,
}: {
  selectedProduct: ProductResult | null;
  onSelect: (p: ProductResult) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<{ results: ProductResult[] }>({
    queryKey: ["products-search", query],
    queryFn: () =>
      api.get(`/inventory/products/?search=${encodeURIComponent(query)}&page_size=8`).then((r) => r.data),
    enabled: open && query.length >= 2,
  });

  const results = data?.results ?? [];

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (selectedProduct) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg text-sm">
        <span className="flex-1 font-medium text-primary-700 truncate">{selectedProduct.name}</span>
        <button type="button" onClick={onClear} className="text-text-muted hover:text-danger">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          className="form-input pl-8 text-sm py-1.5 w-full"
          placeholder="Rechercher un produit..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(e.target.value.length >= 2);
          }}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
        />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {isFetching && <div className="p-3 text-xs text-text-muted">Chargement...</div>}
          {!isFetching && results.length === 0 && (
            <div className="p-3 text-xs text-text-muted">Aucun résultat.</div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors"
              onClick={() => { onSelect(p); setQuery(""); setOpen(false); }}
            >
              <span className="font-medium">{p.name}</span>
              {p.brand && <span className="text-text-muted ml-1.5">· {p.brand}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function InvoiceProductMatrix({
  config,
  onChange,
  onRemove,
}: {
  config: MatrixConfig;
  onChange: (c: MatrixConfig) => void;
  onRemove: () => void;
}) {
  const product = config.product;

  // Extract unique colours and sizes from variants
  const colours = product
    ? Array.from(new Set(product.variants.map((v) => v.colour || "N/A"))).sort()
    : [];
  const sizes = product
    ? Array.from(new Set(product.variants.map((v) => v.size_eu))).sort((a, b) => a - b)
    : [];

  function updateQty(colour: string, size: number, qty: number) {
    onChange({
      ...config,
      quantities: {
        ...config.quantities,
        [colour]: { ...config.quantities[colour], [size]: Math.max(0, qty) },
      },
    });
  }

  function applyEven() {
    if (!product || sizes.length === 0 || colours.length === 0) return;
    const totalPairs = config.cartons * config.pairs_per_carton;
    const perCell = Math.floor(totalPairs / (colours.length * sizes.length));
    let remainder = totalPairs % (colours.length * sizes.length);

    const newQty: Record<string, Record<number, number>> = {};
    colours.forEach((c) => {
      newQty[c] = {};
      sizes.forEach((s) => {
        let qty = perCell;
        if (remainder > 0) {
          qty += 1;
          remainder -= 1;
        }
        newQty[c][s] = qty;
      });
    });
    onChange({ ...config, quantities: newQty });
  }

  // Calculate sum of pairs currently configured
  const currentTotalPairs = colours.reduce(
    (sum, c) => sum + sizes.reduce((s, sz) => s + (config.quantities[c]?.[sz] ?? 0), 0),
    0
  );

  return (
    <div className="border border-border rounded-lg p-4 space-y-4 bg-white shadow-sm relative">
      <div className="absolute top-4 right-4">
        <button type="button" onClick={onRemove} className="text-text-muted hover:text-danger">
          <X size={16} />
        </button>
      </div>

      <div className="w-3/4">
        <ProductSearch
          selectedProduct={product}
          onSelect={(p) => onChange({
            ...config,
            product: p,
            quantities: {},
            unit_price: (p.wholesale_price && parseFloat(p.wholesale_price) > 0) ? p.wholesale_price : (p.purchase_price && parseFloat(p.purchase_price) > 0) ? p.purchase_price : p.sale_price,
            discount_pct: "0"
          })}
          onClear={() => onChange({ ...config, product: null, quantities: {} })}
        />
      </div>

      {product && sizes.length > 0 && (
        <div className="space-y-4 pt-2">
          {/* Distribution controls */}
          <div className="flex flex-wrap items-end gap-3 p-3 bg-surface border border-border rounded-lg">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Nombre de cartons</label>
              <input
                type="number"
                min="1"
                value={config.cartons}
                onChange={(e) => onChange({ ...config, cartons: parseInt(e.target.value) || 0 })}
                className="form-input text-xs py-1 w-24"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Paires par carton</label>
              <input
                type="number"
                min="1"
                value={config.pairs_per_carton}
                onChange={(e) => onChange({ ...config, pairs_per_carton: parseInt(e.target.value) || 0 })}
                className="form-input text-xs py-1 w-24"
              />
            </div>
            <div className="px-2 py-1 bg-white border border-border rounded text-sm font-medium">
              = {config.cartons * config.pairs_per_carton} paires totales
            </div>
            <button
              type="button"
              onClick={applyEven}
              className="btn btn-outline py-1 text-xs ml-auto"
            >
              Distribuer les quantités
            </button>
          </div>

          {/* Pricing Controls */}
          <div className="flex flex-wrap items-end gap-3 p-3 bg-surface border border-border rounded-lg">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Prix unitaire (DZD)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={config.unit_price}
                onChange={(e) => onChange({ ...config, unit_price: e.target.value })}
                className="form-input text-xs py-1 w-32 font-mono text-end"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Remise (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={config.discount_pct}
                onChange={(e) => onChange({ ...config, discount_pct: e.target.value })}
                className="form-input text-xs py-1 w-24 text-center font-mono"
              />
            </div>
          </div>

          {/* Matrix */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="border border-border p-2 bg-surface text-text-muted text-xs font-medium text-left">Couleur \ Taille</th>
                  {sizes.map((s) => (
                    <th key={s} className="border border-border p-2 bg-surface text-text-muted text-xs font-medium w-24 text-center">
                      EU {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {colours.map((c) => (
                  <tr key={c}>
                    <td className="border border-border p-2 font-medium text-xs bg-surface/30">
                      {c === "N/A" ? "Sans couleur" : c}
                    </td>
                    {sizes.map((s) => {
                      const variant = product.variants.find((v) => (v.colour || "N/A") === c && v.size_eu === s);
                      const requestedQty = config.quantities[c]?.[s] ?? 0;
                      const stockQty = variant?.stock_qty ?? 0;
                      const hasStockError = requestedQty > stockQty;

                      return (
                        <td key={s} className={cn("border border-border p-1 text-center", hasStockError && "bg-danger/10")}>
                          {variant ? (
                            <div className="flex flex-col items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                value={requestedQty || ""}
                                onChange={(e) => updateQty(c, s, parseInt(e.target.value) || 0)}
                                className={cn(
                                  "form-input text-center w-16 text-xs py-1 px-1",
                                  hasStockError && "border-danger text-danger focus:border-danger focus:ring-danger/20"
                                )}
                                placeholder="0"
                              />
                              <div className={cn("text-[10px]", hasStockError ? "text-danger font-medium" : "text-text-muted")}>
                                Stock: {stockQty}
                              </div>
                            </div>
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-text-primary">
              Total facturé pour cet article: {currentTotalPairs} paires
            </div>
            {/* Show an alert if any cell exceeds stock */}
            {colours.some(c => sizes.some(s => {
              const variant = product.variants.find((v) => (v.colour || "N/A") === c && v.size_eu === s);
              const requestedQty = config.quantities[c]?.[s] ?? 0;
              return variant && requestedQty > variant.stock_qty;
            })) && (
              <div className="flex items-center gap-2 text-danger text-sm font-medium bg-danger/10 px-3 py-1.5 rounded">
                <AlertTriangle size={16} /> Quantité supérieure au stock disponible.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
