import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, AlertTriangle, X, Search, Package, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import ColourPicker from "@/components/ui/ColourPicker";
import { getColourHex, getColourLabel } from "@/lib/colours";
import api, { formatDZD } from "@/lib/api";
import type { StoreSettings } from "@/types";

export interface ProductResult {
  id: number;
  name: string;
  reference?: string;
  brand: string;
  category: string;
  purchase_price: string;
  sale_price: string;
  pairs_per_carton?: number;
  total_stock?: number;
  variants?: Array<{
    id: number;
    size_eu: number;
    colour: string;
    barcode?: string;
    stock_qty?: number;
  }>;
}

export function ProductSearch({
  selectedId,
  selectedLabel,
  selectedReference,
  onSelect,
  onClear,
}: {
  selectedId: number | null;
  selectedLabel: string | null;
  selectedReference?: string;
  onSelect: (p: ProductResult) => void;
  onClear: () => void;
}) {
  useTranslation();
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
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-primary-50/80 border border-primary-200 rounded-lg text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Package size={14} className="text-primary-600 flex-shrink-0" />
          <span className="font-semibold text-primary-800 truncate">{selectedLabel}</span>
          {selectedReference && (
            <span className="font-mono text-2xs bg-white border border-primary-200 px-1.5 py-0.5 rounded text-primary-700 font-bold flex-shrink-0">
              RÉF: {selectedReference}
            </span>
          )}
          <span className="text-2xs text-primary-600 bg-primary-100/80 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
            Catalogue lié
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-text-muted hover:text-danger p-0.5 rounded transition-colors"
          title="Dissocier le produit"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          className="form-input pl-9 text-xs py-2 w-full bg-white"
          placeholder="Rechercher un produit existant par nom, référence ou code-barres (optionnel)…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-xl max-h-56 overflow-y-auto divide-y divide-border/60">
          {isFetching && <div className="p-3 text-xs text-text-muted">Recherche en cours…</div>}
          {!isFetching && results.length === 0 && (
            <div className="p-3 text-xs text-text-muted">
              Aucun produit existant trouvé — remplissez les champs ci-dessous pour créer un nouvel article automatiquement.
            </div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-surface flex items-center justify-between gap-3 transition-colors"
              onMouseDown={() => {
                onSelect(p);
                setQuery("");
                setOpen(false);
              }}
            >
              <div className="min-w-0">
                <div className="font-semibold text-text-primary text-sm truncate flex items-center gap-1.5">
                  {p.name}
                  {p.brand && <span className="text-xs text-text-muted font-normal">· {p.brand}</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-text-muted">
                  {p.reference && (
                    <span className="font-mono text-2xs bg-surface border border-border px-1.5 py-0.5 rounded text-text-secondary font-bold">
                      RÉF: {p.reference}
                    </span>
                  )}
                  {p.purchase_price && Number(p.purchase_price) > 0 && (
                    <span>Achat: {formatDZD(p.purchase_price)} DZD</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-mono font-bold text-xs text-text-primary">
                  {formatDZD(p.sale_price)} <span className="text-2xs font-normal text-text-muted">DZD</span>
                </div>
                {typeof p.total_stock === "number" && (
                  <div className={`text-2xs font-semibold mt-0.5 ${p.total_stock > 0 ? "text-success" : "text-danger"}`}>
                    {p.total_stock} en stock
                  </div>
                )}
              </div>
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
  reference?: string;
  brand: string;
  category: string;
  purchase_price: string;
  sale_price: string;
  colours: string[];
  size_from: number;
  size_to: number;
  cartons_received: number;
  pairs_per_carton: number;
  total_quantity?: number;
  quantities: Record<string, Record<number, number>>;
}

export function getSizeRange(from: number, to: number): number[] {
  if (!from || !to || from <= 0 || to <= 0 || from > to) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function distributeCartonQuantities(
  cols: string[],
  szs: number[],
  cCount: number,
  ppc: number
): Record<string, Record<number, number>> {
  const activeCols = cols.length > 0 ? cols : [""];
  if (activeCols.length === 0 || szs.length === 0) return {};
  const total = Math.max(0, cCount * ppc);
  const perCell = Math.floor(total / (activeCols.length * szs.length));
  let remainder = total % (activeCols.length * szs.length);
  const newQty: Record<string, Record<number, number>> = {};
  activeCols.forEach((c) => {
    newQty[c] = {};
    szs.forEach((s) => {
      let qty = perCell;
      if (remainder > 0) {
        qty++;
        remainder--;
      }
      newQty[c][s] = qty;
    });
  });
  return newQty;
}

export const DEFAULT_CARTON: CartonConfig = {
  product_id: null,
  product_name: "",
  reference: "",
  brand: "",
  category: "other",
  purchase_price: "",
  sale_price: "",
  colours: [],
  size_from: 36,
  size_to: 41,
  cartons_received: 1,
  pairs_per_carton: 10,
  total_quantity: 10,
  quantities: distributeCartonQuantities([], getSizeRange(36, 41), 1, 10),
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

export function CartonPanel({
  description,
  line,
  config,
  onChange,
}: {
  description?: string;
  line?: { description: string };
  config: CartonConfig;
  onChange: (c: CartonConfig) => void;
}) {
  const { data: storeSettings } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => api.get("/core/store-settings/current/").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const enableVariants = storeSettings?.enable_variants ?? false;

  const title = description || line?.description || "Article";
  const sizes = getSizeRange(config.size_from, config.size_to);
  const { colours, quantities, cartons_received } = config;
  const effectiveColours = colours.length > 0 ? colours : [""];

  const cartonTotal = Math.max(0, (config.cartons_received || 0) * (config.pairs_per_carton || 0));
  const simpleTotal = config.total_quantity ?? cartonTotal;

  const matrixTotal = effectiveColours.reduce(
    (sum, c) => sum + sizes.reduce((s, sz) => s + (quantities[c]?.[sz] ?? 0), 0),
    0
  );

  const grandTotal = enableVariants ? matrixTotal : simpleTotal;
  const isOk = grandTotal > 0;

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
    const newCols = [...colours, colour];
    onChange({
      ...config,
      colours: newCols,
      quantities: distributeCartonQuantities(newCols, sizes, config.cartons_received, config.pairs_per_carton),
    });
  }

  function removeColour(colour: string) {
    const newCols = colours.filter((c) => c !== colour);
    onChange({
      ...config,
      colours: newCols,
      quantities: distributeCartonQuantities(newCols, sizes, config.cartons_received, config.pairs_per_carton),
    });
  }

  function handleCartonCountChange(n: number) {
    const cCount = Math.max(1, n);
    const total = cCount * (config.pairs_per_carton || 1);
    onChange({
      ...config,
      cartons_received: cCount,
      total_quantity: total,
      quantities: distributeCartonQuantities(colours, sizes, cCount, config.pairs_per_carton),
    });
  }

  function handlePairsPerCartonChange(n: number) {
    const ppc = Math.max(1, n);
    const total = (config.cartons_received || 1) * ppc;
    onChange({
      ...config,
      pairs_per_carton: ppc,
      total_quantity: total,
      quantities: distributeCartonQuantities(colours, sizes, config.cartons_received, ppc),
    });
  }

  function handleSimpleTotalChange(n: number) {
    const total = Math.max(1, n);
    onChange({
      ...config,
      total_quantity: total,
    });
  }

  function handleRangeChange(field: "size_from" | "size_to", val: number) {
    const newFrom = field === "size_from" ? val : config.size_from;
    const newTo = field === "size_to" ? val : config.size_to;
    const newSizes = getSizeRange(newFrom, newTo);
    onChange({
      ...config,
      [field]: val,
      quantities: distributeCartonQuantities(colours, newSizes, config.cartons_received, config.pairs_per_carton),
    });
  }

  return (
    <div className="border border-primary-200/80 rounded-xl p-4 space-y-3.5 bg-gradient-to-b from-primary-50/40 to-white shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-text-primary">{title}</span>
        </div>
        {!enableVariants && (
          <span className="text-2xs font-medium text-primary-700 bg-primary-100/80 border border-primary-200 px-2 py-0.5 rounded-full">
            Mode simple (sans pointures)
          </span>
        )}
      </div>

      <ProductSearch
        selectedId={config.product_id}
        selectedLabel={config.product_id ? config.product_name : null}
        selectedReference={config.reference}
        onSelect={(p: ProductResult) => {
          let newCols = colours;
          let newFrom = config.size_from || 36;
          let newTo = config.size_to || 41;
          const sizedVariants = (p.variants ?? []).filter((v) => v.size_eu > 0);
          if (enableVariants && sizedVariants.length > 0) {
            newCols = Array.from(
              new Set(
                sizedVariants
                  .map((v) => v.colour)
                  .filter((c) => c && c !== "N/A" && c !== "Standard")
              )
            );
            const szs = sizedVariants.map((v) => v.size_eu);
            newFrom = Math.min(...szs);
            newTo = Math.max(...szs);
          }
          const newSizes = getSizeRange(newFrom, newTo);
          const ppc = p.pairs_per_carton && p.pairs_per_carton > 0 ? p.pairs_per_carton : config.pairs_per_carton || 10;
          const total = (config.cartons_received || 1) * ppc;
          onChange({
            ...config,
            product_id: p.id,
            product_name: p.name,
            reference: p.reference ?? "",
            brand: p.brand ?? "",
            category: p.category || "other",
            purchase_price: p.purchase_price && Number(p.purchase_price) > 0 ? String(p.purchase_price) : config.purchase_price,
            sale_price: p.sale_price && Number(p.sale_price) > 0 ? String(p.sale_price) : config.sale_price,
            colours: newCols,
            size_from: newFrom,
            size_to: newTo,
            pairs_per_carton: ppc,
            total_quantity: total,
            quantities: distributeCartonQuantities(newCols, newSizes, config.cartons_received, ppc),
          });
        }}
        onClear={() =>
          onChange({
            ...config,
            product_id: null,
            product_name: "",
            reference: "",
          })
        }
      />

      {/* Product fields */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
        <div className="sm:col-span-2">
          <label className="block text-2xs font-semibold text-text-muted uppercase tracking-wide mb-1">
            Nom / Modèle <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            placeholder="Ex: Mocassin Cuir, BL-HS10…"
            value={config.product_name}
            onChange={(e) => updateField("product_name", e.target.value)}
            className="form-input text-xs py-1.5 bg-white"
            readOnly={config.product_id != null}
          />
        </div>
        <div>
          <label className="block text-2xs font-semibold text-text-muted uppercase tracking-wide mb-1">
            Référence
          </label>
          <input
            type="text"
            placeholder="Ex: BL-HS10"
            value={config.reference ?? ""}
            onChange={(e) => updateField("reference", e.target.value)}
            className="form-input text-xs py-1.5 font-mono bg-white"
            readOnly={config.product_id != null && Boolean(config.reference)}
          />
        </div>
        <div>
          <label className="block text-2xs font-semibold text-text-muted uppercase tracking-wide mb-1">
            Marque
          </label>
          <input
            type="text"
            placeholder="Optionnel"
            value={config.brand}
            onChange={(e) => updateField("brand", e.target.value)}
            className="form-input text-xs py-1.5 bg-white"
          />
        </div>

        <div>
          <label className="block text-2xs font-semibold text-text-muted uppercase tracking-wide mb-1">
            Prix d'achat (DZD) <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={config.purchase_price}
            onChange={(e) => updateField("purchase_price", e.target.value)}
            className="form-input text-xs py-1.5 font-mono bg-white"
          />
        </div>
        <div>
          <label className="block text-2xs font-semibold text-text-muted uppercase tracking-wide mb-1">
            Prix de vente (DZD) <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={config.sale_price}
            onChange={(e) => updateField("sale_price", e.target.value)}
            className="form-input text-xs py-1.5 font-mono bg-white"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-2xs font-semibold text-text-muted uppercase tracking-wide mb-1">
            Catégorie
          </label>
          <select
            value={config.category}
            onChange={(e) => updateField("category", e.target.value)}
            className="form-input text-xs py-1.5 bg-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Quantity / Carton bar */}
      <div className="flex flex-wrap items-center gap-3 p-2.5 bg-white border border-border rounded-lg text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-xs font-medium">Cartons</span>
          <input
            type="number"
            min={1}
            value={cartons_received}
            onChange={(e) => handleCartonCountChange(parseInt(e.target.value) || 1)}
            className="form-input py-1 w-16 text-center text-sm font-mono"
          />
        </div>
        <span className="text-text-muted text-xs">×</span>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-xs font-medium">Paires / Carton</span>
          <input
            type="number"
            min={1}
            value={config.pairs_per_carton}
            onChange={(e) => handlePairsPerCartonChange(parseInt(e.target.value) || 1)}
            className="form-input py-1 w-16 text-center text-sm font-mono"
          />
        </div>

        {enableVariants ? (
          <>
            <div className="flex items-center gap-1.5 border-l border-border pl-3">
              <span className="text-text-muted text-xs font-medium">Pointures EU</span>
              <input
                type="number"
                min={15}
                max={60}
                value={config.size_from}
                onChange={(e) => handleRangeChange("size_from", parseInt(e.target.value) || 36)}
                className="form-input py-1 w-14 text-center text-sm font-mono"
              />
              <span className="text-text-muted">→</span>
              <input
                type="number"
                min={15}
                max={60}
                value={config.size_to}
                onChange={(e) => handleRangeChange("size_to", parseInt(e.target.value) || 41)}
                className="form-input py-1 w-14 text-center text-sm font-mono"
              />
            </div>
            <div className="ms-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    quantities: distributeCartonQuantities(
                      colours,
                      sizes,
                      config.cartons_received,
                      config.pairs_per_carton
                    ),
                  })
                }
                className="btn-secondary btn-sm text-xs py-1 px-2 flex items-center gap-1"
                title="Répartir automatiquement les paires sur les pointures"
              >
                <Sparkles size={12} />
                Auto-répartir
              </button>
              <div className="px-2.5 py-1 bg-primary-50 border border-primary-200 rounded-md text-xs font-semibold text-primary-700 font-mono">
                = {cartonTotal} paires
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 border-l border-border pl-3 ms-auto">
            <span className="text-text-secondary text-xs font-semibold">= Total paires :</span>
            <input
              type="number"
              min={1}
              value={simpleTotal}
              onChange={(e) => handleSimpleTotalChange(parseInt(e.target.value) || 1)}
              className="form-input py-1 w-20 text-center text-sm font-mono font-bold text-primary-700 border-primary-300 bg-primary-50/50"
            />
          </div>
        )}
      </div>

      {/* Variants Mode only: Colours + Size Distribution Matrix */}
      {enableVariants && (
        <>
          <div className="space-y-1.5">
            <span className="text-2xs font-semibold text-text-secondary uppercase tracking-wide">
              Couleurs du carton (optionnel)
            </span>
            <div className="flex flex-wrap gap-1.5 items-center">
              {colours.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-border rounded-full text-xs font-medium"
                >
                  {getColourHex(c) && (
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{
                        background: getColourHex(c)!,
                        border: c === "white" ? "1px solid #e5e7eb" : "none",
                      }}
                    />
                  )}
                  {getColourLabel(c)}
                  <button
                    type="button"
                    onClick={() => removeColour(c)}
                    className="text-text-muted hover:text-danger ml-0.5"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <div className="w-44">
                <ColourPicker value="" onChange={addColour} placeholder="+ Ajouter couleur" />
              </div>
            </div>
          </div>

          {sizes.length > 0 && (
            <div className="overflow-x-auto bg-white border border-border rounded-lg p-2">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr>
                    <th className="text-left py-1 pr-3 text-text-muted font-semibold w-28">Couleur</th>
                    {sizes.map((s) => (
                      <th key={s} className="text-center px-1 py-1 text-text-muted font-semibold w-10">
                        EU{s}
                      </th>
                    ))}
                    <th className="text-right pl-2 py-1 text-text-muted font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveColours.map((colour) => {
                    const rowTotal = sizes.reduce((sum, s) => sum + (quantities[colour]?.[s] ?? 0), 0);
                    return (
                      <tr key={colour}>
                        <td className="py-1 pr-3">
                          <div className="flex items-center gap-1.5">
                            {getColourHex(colour) && (
                              <span
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{
                                  background: getColourHex(colour)!,
                                  border: colour === "white" ? "1px solid #e5e7eb" : "none",
                                }}
                              />
                            )}
                            <span className="font-medium text-text-primary truncate">
                              {colour ? getColourLabel(colour) : "Standard"}
                            </span>
                          </div>
                        </td>
                        {sizes.map((s) => (
                          <td key={s} className="px-0.5 py-0.5">
                            <input
                              type="number"
                              min={0}
                              value={quantities[colour]?.[s] ?? 0}
                              onChange={(e) => updateQty(colour, s, parseInt(e.target.value) || 0)}
                              className="w-14 text-center py-0.5 text-xs font-mono border border-border rounded bg-white focus:outline-none focus:border-primary-400"
                            />
                          </td>
                        ))}
                        <td className="pl-2 text-right font-semibold text-text-primary font-mono">{rowTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td className="py-1 pr-3 text-xs text-text-muted font-semibold">Total / taille</td>
                    {sizes.map((s) => (
                      <td key={s} className="px-0.5 py-1 text-center text-xs font-semibold text-text-primary font-mono">
                        {effectiveColours.reduce((sum, c) => sum + (quantities[c]?.[s] ?? 0), 0)}
                      </td>
                    ))}
                    <td className={`pl-2 text-right text-xs font-bold font-mono ${isOk ? "text-success" : "text-warning"}`}>
                      {grandTotal}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      <div className={`flex items-center gap-2 text-xs font-semibold ${isOk ? "text-success" : "text-warning"}`}>
        {isOk ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
        {enableVariants ? (
          <span>
            {grandTotal} paire{grandTotal !== 1 ? "s" : ""} répartie{grandTotal !== 1 ? "s" : ""} ·{" "}
            {colours.length > 0 ? `${colours.length} couleur${colours.length !== 1 ? "s" : ""}` : "Couleur standard"} ·{" "}
            {sizes.length} pointure{sizes.length !== 1 ? "s" : ""}
          </span>
        ) : (
          <span>
            {grandTotal} paire{grandTotal !== 1 ? "s" : ""} au total ({cartons_received} carton
            {cartons_received !== 1 ? "s" : ""} × {config.pairs_per_carton} paires)
          </span>
        )}
      </div>
    </div>
  );
}
