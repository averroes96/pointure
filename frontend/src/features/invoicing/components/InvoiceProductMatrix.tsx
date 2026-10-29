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
  pairs_per_carton?: number;
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
      <div className="flex items-center gap-2 px-3.5 py-2 bg-primary-50 border border-primary-200 rounded-xl text-sm">
        <span className="flex-1 font-semibold text-primary-700 truncate">{selectedProduct.name}</span>
        <button
          type="button"
          onClick={onClear}
          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 text-sm py-2 w-full rounded-xl border-slate-200"
          placeholder={t("invoice.search_product_min2")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(e.target.value.length >= 2);
          }}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
        />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1.5 bg-white border border-slate-200/80 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
          {isFetching && <div className="p-3 text-xs text-slate-400">{t("common.loading")}</div>}
          {!isFetching && results.length === 0 && (
            <div className="p-3 text-xs text-slate-400">{t("common.no_data")}</div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-start px-3.5 py-2.5 text-sm hover:bg-slate-50 transition-colors"
              onClick={() => { onSelect(p); setQuery(""); setOpen(false); }}
            >
              <span className="font-semibold text-slate-900">{p.name}</span>
              {p.brand && <span className="text-slate-400 ml-1.5 text-xs font-medium">· {p.brand}</span>}
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
  const { t } = useTranslation();
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

  const getDistributedQty = (p: any, cCount: number, ppc: number) => {
    if (!p) return {};
    const c = Array.from(new Set(p.variants.map((v: any) => v.colour || "N/A"))).sort();
    const s = Array.from(new Set(p.variants.map((v: any) => v.size_eu))).sort((a: any, b: any) => (a as number) - (b as number));
    if (c.length === 0 || s.length === 0) return {};
    
    const total = cCount * ppc;
    const perCell = Math.floor(total / (c.length * s.length));
    let remainder = total % (c.length * s.length);
    const newQty: any = {};
    c.forEach((col: any) => {
      newQty[col] = {};
      s.forEach((sz: any) => {
        let qty = perCell;
        if (remainder > 0) { qty++; remainder--; }
        newQty[col][sz] = qty;
      });
    });
    return newQty;
  };

  return (
    <div className="border border-slate-200/80 rounded-2xl p-5 space-y-4 bg-slate-50/40 hover:border-slate-300 transition-colors relative">
      <div className="absolute top-4 right-4">
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
          title={t("invoice.delete_item")}
        >
          <X size={16} />
        </button>
      </div>

      <div className="w-full sm:w-3/4">
        <ProductSearch
          selectedProduct={product}
          onSelect={(p) => {
            const ppc = p.pairs_per_carton ?? 10;
            onChange({
              ...config,
              product: p,
              pairs_per_carton: ppc,
              quantities: getDistributedQty(p, config.cartons, ppc),
              unit_price: (p.wholesale_price && parseFloat(p.wholesale_price) > 0) ? p.wholesale_price : (p.purchase_price && parseFloat(p.purchase_price) > 0) ? p.purchase_price : p.sale_price,
              discount_pct: "0"
            });
          }}
          onClear={() => onChange({ ...config, product: null, quantities: {} })}
        />
      </div>

      {product && sizes.length > 0 && (
        <div className="space-y-4 pt-1">
          {/* Distribution controls */}
          <div className="flex flex-wrap items-end gap-3 p-3.5 bg-white border border-slate-200/80 rounded-xl shadow-2xs">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{t("invoice.cartons_count")}</label>
              <input
                type="number"
                min="1"
                value={config.cartons}
                onChange={(e) => {
                  const c = parseInt(e.target.value) || 0;
                  onChange({ ...config, cartons: c, quantities: getDistributedQty(product, c, config.pairs_per_carton) });
                }}
                className="input text-xs py-1.5 w-24 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{t("invoice.pairs_per_carton")}</label>
              <input
                type="number"
                min="1"
                value={config.pairs_per_carton}
                onChange={(e) => {
                  const ppc = parseInt(e.target.value) || 0;
                  onChange({ ...config, pairs_per_carton: ppc, quantities: getDistributedQty(product, config.cartons, ppc) });
                }}
                className="input text-xs py-1.5 w-24 rounded-lg font-mono"
              />
            </div>
            <div className="px-3 py-1.5 bg-slate-100 border border-slate-200/80 rounded-lg text-xs font-bold text-slate-800 font-mono">
              {t("invoice.total_pairs_calc", { total: config.cartons * config.pairs_per_carton })}
            </div>
          </div>

          {/* Pricing Controls */}
          <div className="flex flex-wrap items-end gap-3 p-3.5 bg-white border border-slate-200/80 rounded-xl shadow-2xs">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{t("invoice.unit_price_dzd")}</label>
              <input
                type="number"
                min="0"
                step="any"
                value={config.unit_price}
                onChange={(e) => onChange({ ...config, unit_price: e.target.value })}
                className="input text-xs py-1.5 w-32 font-mono text-end rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{t("sales.discount")} (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={config.discount_pct}
                onChange={(e) => onChange({ ...config, discount_pct: e.target.value })}
                className="input text-xs py-1.5 w-24 text-center font-mono rounded-lg"
              />
            </div>
          </div>

          {/* Matrix */}
          <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-2xs">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="p-3 text-start">
                    {sizes.length === 1 && sizes[0] <= 0 ? "Article" : t("invoice.size_color")}
                  </th>
                  {sizes.map((s) => (
                    <th key={s} className="p-3 w-24 text-center">
                      {s > 0 ? `EU ${s}` : t("sales.qty")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {colours.map((c) => (
                  <tr key={c} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 font-semibold text-xs text-slate-800 bg-slate-50/30">
                      {c === "N/A" || c === "Standard" ? (sizes.length === 1 && sizes[0] <= 0 ? "Standard" : "Sans couleur") : c}
                    </td>
                    {sizes.map((s) => {
                      const variant = product.variants.find((v) => (v.colour || "N/A") === c && v.size_eu === s);
                      const requestedQty = config.quantities[c]?.[s] ?? 0;
                      const stockQty = variant?.stock_qty ?? 0;
                      const hasStockError = requestedQty > stockQty;

                      return (
                        <td key={s} className={cn("p-2 text-center", hasStockError && "bg-rose-50/60")}>
                          {variant ? (
                            <div className="flex flex-col items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                value={requestedQty || ""}
                                onChange={(e) => updateQty(c, s, parseInt(e.target.value) || 0)}
                                className={cn(
                                  "input text-center w-16 text-xs py-1 px-1 rounded-lg font-mono",
                                  hasStockError && "border-rose-400 text-rose-700 focus:border-rose-500 ring-rose-500/20"
                                )}
                                placeholder="0"
                              />
                              <div className={cn("text-[10px] font-mono", hasStockError ? "text-rose-600 font-semibold" : "text-slate-400")}>
                                {t("invoice.stock_label", { count: stockQty })}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
            <div className="text-xs font-semibold text-slate-700">
              {t("invoice.total_billed_item")} <span className="font-mono font-bold text-slate-900">{config.cartons * config.pairs_per_carton}</span>
            </div>
            {/* Show an alert if any cell exceeds stock */}
            {colours.some(c => sizes.some(s => {
              const variant = product.variants.find((v) => (v.colour || "N/A") === c && v.size_eu === s);
              const requestedQty = config.quantities[c]?.[s] ?? 0;
              return variant && requestedQty > variant.stock_qty;
            })) && (
              <div className="flex items-center gap-2 text-rose-700 text-xs font-semibold bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
                <AlertTriangle size={15} className="shrink-0 text-rose-500" />
                {t("invoice.stock_exceeded_error")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
