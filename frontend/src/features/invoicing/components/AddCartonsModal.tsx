import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { X, Layers, AlertTriangle, CheckCircle2, Loader2, Package } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { unitPriceStringFor } from "@/lib/pricing";
import type { PriceTier } from "@/types";
import { type MatrixConfig, type ProductResult, localId } from "./InvoiceProductMatrix";

interface AddCartonsModalProps {
  isOpen: boolean;
  onClose: () => void;
  priceTier?: PriceTier;
  onAddCartons: (matrix: MatrixConfig) => void;
}

export function AddCartonsModal({
  isOpen,
  onClose,
  priceTier = "gros",
  onAddCartons,
}: AddCartonsModalProps) {
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null);
  const [selectedColour, setSelectedColour] = useState<string>("Standard");
  const [cartons, setCartons] = useState<number>(1);
  const [loadingExpand, setLoadingExpand] = useState<boolean>(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<{
    total_pairs: number;
    all_stock_sufficient: boolean;
    lines: Array<{
      size_eu: number;
      quantity: number;
      available_stock: number;
      is_sufficient_stock: boolean;
    }>;
  } | null>(null);

  // Search products
  const { data: searchData, isFetching: isSearching } = useQuery<{ results: ProductResult[] }>({
    queryKey: ["products-carton-search", searchQuery],
    queryFn: () =>
      api
        .get(`/inventory/products/?search=${encodeURIComponent(searchQuery)}&page_size=8`)
        .then((r) => r.data),
    enabled: searchQuery.length >= 2,
  });

  if (!isOpen) return null;

  const products = searchData?.results ?? [];

  async function checkCartons(product: ProductResult, colour: string, cCount: number) {
    setLoadingExpand(true);
    setExpandError(null);
    try {
      const res = await api.post(`/inventory/products/${product.id}/expand-cartons/`, {
        colour,
        cartons: cCount,
      });
      setExpandedResult(res.data);
    } catch (err) {
      setExpandError(getApiError(err));
      setExpandedResult(null);
    } finally {
      setLoadingExpand(false);
    }
  }

  function handleSelectProduct(p: ProductResult) {
    setSelectedProduct(p);
    const availableColours = Array.from(
      new Set((p.variants || []).map((v) => v.colour || "Standard"))
    ).sort();
    const colour = availableColours[0] || "Standard";
    setSelectedColour(colour);
    checkCartons(p, colour, cartons);
  }

  function handleColourChange(c: string) {
    setSelectedColour(c);
    if (selectedProduct) {
      checkCartons(selectedProduct, c, cartons);
    }
  }

  function handleCartonsChange(c: number) {
    const val = Math.max(1, c);
    setCartons(val);
    if (selectedProduct) {
      checkCartons(selectedProduct, selectedColour, val);
    }
  }

  function handleConfirm() {
    if (!selectedProduct) return;

    const ppc = selectedProduct.pairs_per_carton || 10;
    const quantities: Record<string, Record<number, number>> = {
      [selectedColour]: {},
    };

    if (expandedResult && expandedResult.lines.length > 0) {
      expandedResult.lines.forEach((l) => {
        quantities[selectedColour][l.size_eu] = l.quantity;
      });
    } else if (selectedProduct.carton_breakdown) {
      Object.entries(selectedProduct.carton_breakdown).forEach(([sizeStr, perCtn]) => {
        quantities[selectedColour][Number(sizeStr)] = Number(perCtn) * cartons;
      });
    }

    const newMatrix: MatrixConfig = {
      id: localId(),
      product: selectedProduct,
      cartons,
      pairs_per_carton: ppc,
      unit_price: unitPriceStringFor(selectedProduct, priceTier),
      discount_pct: "0",
      quantities,
    };

    onAddCartons(newMatrix);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="text-primary-600 dark:text-primary-400" size={20} />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {t("carton.add_cartons_title", "Ajouter des cartons (Série)")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Step 1: Search product */}
          {!selectedProduct ? (
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t("carton.select_product", "Rechercher l'article")}
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("invoice.search_product", "Rechercher un produit...")}
                className="input w-full text-xs rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                autoFocus
              />

              {isSearching && (
                <div className="text-xs text-slate-400 py-3 text-center">
                  <Loader2 size={16} className="animate-spin inline mr-1.5" />
                  {t("app.loading", "Chargement...")}
                </div>
              )}

              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectProduct(p)}
                    className="w-full text-start px-3.5 py-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{p.name}</div>
                      <div className="text-slate-500 text-2xs">{p.brand}</div>
                    </div>
                    {p.carton_breakdown && Object.keys(p.carton_breakdown).length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-2xs font-medium">
                        {t("carton.has_breakdown", "Série configurée")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected product banner */}
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-xl">
                <div className="flex items-center gap-2">
                  <Package className="text-primary-600 dark:text-primary-400" size={18} />
                  <div>
                    <div className="font-bold text-xs text-slate-900 dark:text-white">
                      {selectedProduct.name}
                    </div>
                    <div className="text-2xs text-slate-500">
                      {selectedProduct.brand} · {selectedProduct.pairs_per_carton || 10} paires/carton
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProduct(null);
                    setExpandedResult(null);
                    setExpandError(null);
                  }}
                  className="text-2xs text-primary-600 dark:text-primary-400 font-medium hover:underline"
                >
                  {t("common.change", "Changer")}
                </button>
              </div>

              {/* Controls: Colour and Cartons count */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("product.colour", "Couleur")}
                  </label>
                  <select
                    value={selectedColour}
                    onChange={(e) => handleColourChange(e.target.value)}
                    className="input w-full text-xs rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {Array.from(
                      new Set((selectedProduct.variants || []).map((v) => v.colour || "Standard"))
                    ).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t("invoice.cartons_count", "Nombre de cartons")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={cartons}
                    onChange={(e) => handleCartonsChange(parseInt(e.target.value) || 1)}
                    className="input w-full text-xs rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                  />
                </div>
              </div>

              {/* Loading spinner */}
              {loadingExpand && (
                <div className="py-4 text-center text-xs text-slate-400">
                  <Loader2 size={16} className="animate-spin inline mr-1.5" />
                  {t("carton.checking_stock", "Vérification des disponibilités...")}
                </div>
              )}

              {/* Error if no breakdown */}
              {expandError && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{expandError}</span>
                </div>
              )}

              {/* Expanded Breakdown Preview */}
              {expandedResult && (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span>{t("carton.preview_title", "Détail des paires à ajouter")}</span>
                    <span className="font-mono text-primary-600 dark:text-primary-400">
                      {expandedResult.total_pairs} paires au total
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                    {expandedResult.lines.map((l) => (
                      <div
                        key={l.size_eu}
                        className={`p-2 rounded-xl border text-xs flex flex-col justify-between ${
                          l.is_sufficient_stock
                            ? "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
                            : "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                        }`}
                      >
                        <div className="flex justify-between items-center font-mono">
                          <span className="font-bold">EU {l.size_eu}</span>
                          <span className="font-bold">{l.quantity} paires</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                          <span>Dispo : {l.available_stock}</span>
                          {l.is_sufficient_stock ? (
                            <CheckCircle2 size={11} className="text-emerald-500" />
                          ) : (
                            <span className="text-rose-500 font-bold">Manque</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {!expandedResult.all_stock_sufficient && (
                    <p className="text-2xs text-rose-600 dark:text-rose-400 font-medium">
                      ⚠️ {t("carton.stock_warning", "Le stock disponible est inférieur à la quantité demandée pour certaines pointures.")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary px-3.5 py-2 text-xs rounded-xl"
          >
            {t("app.cancel", "Annuler")}
          </button>
          <button
            type="button"
            disabled={!selectedProduct}
            onClick={handleConfirm}
            className="btn-primary px-4 py-2 text-xs rounded-xl shadow-xs inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Layers size={14} />
            {t("carton.insert_cartons", "Insérer les cartons")}
          </button>
        </div>
      </div>
    </div>
  );
}

