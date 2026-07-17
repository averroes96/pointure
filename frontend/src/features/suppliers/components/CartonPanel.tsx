import { useTranslation } from "react-i18next";
import { CheckCircle, AlertTriangle, X } from "lucide-react";
import ColourPicker from "@/components/ui/ColourPicker";
import { getColourHex, getColourLabel } from "@/lib/colours";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useState } from "react";

export interface ProductResult {
  id: number;
  name: string;
  brand: string;
  category: string;
  purchase_price: string;
  sale_price: string;
}

export function ProductSearch({
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
}: {
  selectedId: number | null;
  selectedLabel: string | null;
  onSelect: (p: ProductResult) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { data, isFetching } = useQuery<{ results: ProductResult[] }>({
    queryKey: ["products-search", query],
    queryFn: () =>
      api.get(`/inventory/products/?search=${encodeURIComponent(query)}&page_size=8`).then((r) => r.data),
    enabled: query.length >= 2,
  });

  const results = data?.results ?? [];

  if (selectedId) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg text-sm">
        <span className="flex-1 font-medium text-primary-700 truncate">{selectedLabel}</span>
        <button type="button" onClick={onClear} className="text-text-muted hover:text-danger">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          className="form-input pl-8 text-xs py-1.5 w-full"
          placeholder="Rechercher un produit existant (optionnel)…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {isFetching && <div className="p-3 text-xs text-text-muted">Chargement…</div>}
          {!isFetching && results.length === 0 && (
            <div className="p-3 text-xs text-text-muted">Aucun résultat — les champs ci-dessous créeront un nouveau produit.</div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors"
              onMouseDown={() => { onSelect(p); setQuery(""); setOpen(false); }}
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


export interface CartonConfig {
  product_id: number | null;
  product_name: string;
  brand: string;
  category: string;
  purchase_price: string;
  sale_price: string;
  colours: string[];
  size_from: number;
  size_to: number;
  cartons_received: number;
  quantities: Record<string, Record<number, number>>;
}

export const DEFAULT_CARTON: CartonConfig = {
  product_id: null, product_name: "", brand: "", category: "sneakers",
  purchase_price: "", sale_price: "",
  colours: [],
  size_from: 36, size_to: 41,
  cartons_received: 1,
  quantities: {},
};

export const CATEGORIES = [
  { value: "sneakers", label: "Baskets / Sneakers" },
  { value: "boots", label: "Bottes / Bottines" },
  { value: "sandals", label: "Sandales / Mules" },
  { value: "formal", label: "Ville / Classique" },
  { value: "sport", label: "Sport" },
  { value: "kids", label: "Enfant" },
  { value: "slippers", label: "Chaussons" },
  { value: "other", label: "Autre" },
];

export function getSizeRange(from: number, to: number): number[] {
  if (!from || !to || from > to) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function CartonPanel({
  description,
  config,
  onChange,
}: {
  description: string;
  config: CartonConfig;
  onChange: (c: CartonConfig) => void;
}) {
  const sizes = getSizeRange(config.size_from, config.size_to);
  const { colours, quantities, cartons_received } = config;

  const grandTotal = colours.reduce(
    (sum, c) => sum + sizes.reduce((s, sz) => s + (quantities[c]?.[sz] ?? 0), 0),
    0
  );
  const expectedTotal = colours.length * sizes.length * cartons_received;

  function updateField(field: keyof CartonConfig, value: unknown) {
    onChange({ ...config, [field]: value });
  }

  function updateQty(colour: string, size: number, qty: number) {
    onChange({
      ...config,
      quantities: {
        ...quantities,
        [colour]: { ...quantities[colour], [size]: Math.max(0, qty) },
      },
    });
  }

  function addColour(colour: string) {
    if (!colour || colours.includes(colour)) return;
    const row: Record<number, number> = {};
    sizes.forEach((s) => { row[s] = cartons_received; });
    onChange({
      ...config,
      colours: [...colours, colour],
      quantities: { ...quantities, [colour]: row },
    });
  }

  function removeColour(colour: string) {
    const { [colour]: _, ...rest } = quantities;
    onChange({ ...config, colours: colours.filter((c) => c !== colour), quantities: rest });
  }

  function applyEven() {
    const newQty: Record<string, Record<number, number>> = {};
    colours.forEach((c) => {
      newQty[c] = {};
      sizes.forEach((s) => { newQty[c][s] = cartons_received; });
    });
    onChange({ ...config, quantities: newQty });
  }

  function handleCartonCountChange(n: number) {
    const newQty: Record<string, Record<number, number>> = {};
    colours.forEach((c) => {
      newQty[c] = {};
      sizes.forEach((s) => { newQty[c][s] = n; });
    });
    onChange({ ...config, cartons_received: n, quantities: newQty });
  }

  function handleRangeChange(field: "size_from" | "size_to", val: number) {
    const newFrom = field === "size_from" ? val : config.size_from;
    const newTo   = field === "size_to"   ? val : config.size_to;
    const newSizes = getSizeRange(newFrom, newTo);
    const newQty: Record<string, Record<number, number>> = {};
    colours.forEach((c) => {
      newQty[c] = {};
      newSizes.forEach((s) => { newQty[c][s] = quantities[c]?.[s] ?? cartons_received; });
    });
    onChange({ ...config, [field]: val, quantities: newQty });
  }

  const isOk = grandTotal === expectedTotal && expectedTotal > 0;

  return (
    <div className="border border-primary-200 rounded-lg p-3 space-y-3 bg-primary-50/30">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary-400 flex-shrink-0" />
        <span className="text-sm font-medium text-text-primary">{description}</span>
      </div>

      <ProductSearch
        selectedId={config.product_id}
        selectedLabel={config.product_id ? config.product_name : null}
        onSelect={(p: any) => onChange({ ...config, product_id: p.id, product_name: p.name, brand: p.brand, category: p.category, purchase_price: p.purchase_price, sale_price: p.sale_price })}
        onClear={() => onChange({ ...config, product_id: null, product_name: "" })}
      />

      <div className="grid grid-cols-2 gap-2">
        {(["product_name", "brand", "purchase_price", "sale_price"] as const).map((field) => (
          <input key={field}
            type={field.includes("price") ? "number" : "text"}
            placeholder={{ product_name: "Nom du produit *", brand: "Marque", purchase_price: "Prix achat (DZD) *", sale_price: "Prix vente (DZD) *" }[field]}
            value={(config as any)[field]}
            onChange={(e) => updateField(field, e.target.value)}
            className="form-input text-xs py-1.5"
            readOnly={config.product_id != null && field === "product_name"}
          />
        ))}
        <select value={config.category} onChange={(e) => updateField("category", e.target.value)} className="form-input text-xs py-1.5 col-span-2">
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-xs">Cartons</span>
          <input type="number" min={1} value={cartons_received}
            onChange={(e) => handleCartonCountChange(parseInt(e.target.value) || 1)}
            className="form-input py-1 w-14 text-center text-sm font-mono"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-xs">EU</span>
          <input type="number" min={24} max={50} value={config.size_from}
            onChange={(e) => handleRangeChange("size_from", parseInt(e.target.value) || 36)}
            className="form-input py-1 w-12 text-center text-sm font-mono"
          />
          <span className="text-text-muted">→</span>
          <input type="number" min={24} max={50} value={config.size_to}
            onChange={(e) => handleRangeChange("size_to", parseInt(e.target.value) || 41)}
            className="form-input py-1 w-12 text-center text-sm font-mono"
          />
        </div>
        <button type="button" onClick={applyEven}
          disabled={!colours.length || !sizes.length}
          className="btn-secondary btn-sm"
        >
          Répartir (×{cartons_received})
        </button>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Couleurs du carton</span>
        <div className="flex flex-wrap gap-1.5 items-center">
          {colours.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 px-2 py-1 bg-white border border-border rounded-full text-xs font-medium">
              {getColourHex(c) && (
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: getColourHex(c)!, border: c === "white" ? "1px solid #e5e7eb" : "none" }} />
              )}
              {getColourLabel(c)}
              <button type="button" onClick={() => removeColour(c)} className="text-text-muted hover:text-danger ml-0.5"><X size={10} /></button>
            </span>
          ))}
          <div className="w-40">
            <ColourPicker
              value=""
              onChange={addColour}
              placeholder="+ Ajouter couleur"
            />
          </div>
        </div>
      </div>

      {colours.length > 0 && sizes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="text-left py-1 pr-3 text-text-muted font-semibold w-28">Couleur</th>
                {sizes.map((s) => (
                  <th key={s} className="text-center px-1 py-1 text-text-muted font-semibold w-10">EU{s}</th>
                ))}
                <th className="text-right pl-2 py-1 text-text-muted font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {colours.map((colour) => {
                const rowTotal = sizes.reduce((sum, s) => sum + (quantities[colour]?.[s] ?? 0), 0);
                return (
                  <tr key={colour}>
                    <td className="py-1 pr-3">
                      <div className="flex items-center gap-1.5">
                        {getColourHex(colour) && (
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: getColourHex(colour)!, border: colour === "white" ? "1px solid #e5e7eb" : "none" }} />
                        )}
                        <span className="font-medium text-text-primary truncate">{getColourLabel(colour)}</span>
                      </div>
                    </td>
                    {sizes.map((s) => (
                      <td key={s} className="px-0.5 py-0.5">
                        <input
                          type="number" min={0}
                          value={quantities[colour]?.[s] ?? 0}
                          onChange={(e) => updateQty(colour, s, parseInt(e.target.value) || 0)}
                          className="w-10 text-center py-0.5 text-xs font-mono border border-border rounded bg-white focus:outline-none focus:border-primary-400"
                        />
                      </td>
                    ))}
                    <td className="pl-2 text-right font-semibold text-text-primary">{rowTotal}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td className="py-1 pr-3 text-xs text-text-muted font-semibold">Total / taille</td>
                {sizes.map((s) => (
                  <td key={s} className="px-0.5 py-1 text-center text-xs font-semibold text-text-primary">
                    {colours.reduce((sum, c) => sum + (quantities[c]?.[s] ?? 0), 0)}
                  </td>
                ))}
                <td className={`pl-2 text-right text-xs font-bold ${isOk ? "text-success" : "text-warning"}`}>
                  {grandTotal}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className={`flex items-center gap-2 text-sm font-medium ${isOk ? "text-success" : "text-warning"}`}>
        {isOk ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
        {grandTotal} paire{grandTotal !== 1 ? "s" : ""} · {colours.length} couleur{colours.length !== 1 ? "s" : ""} · {sizes.length} pointure{sizes.length !== 1 ? "s" : ""}
        {!isOk && colours.length > 0 && sizes.length > 0 && (
          <span className="text-xs font-normal text-text-muted">
            — attendu {expectedTotal} ({cartons_received} carton{cartons_received > 1 ? "s" : ""} × {colours.length * sizes.length} variantes)
          </span>
        )}
      </div>
    </div>
  );
}
