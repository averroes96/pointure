import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Percent,
  Coins,
  Tag,
  Printer,
  Sparkles,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Sliders,
} from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";

export type PriceUpdateType = "percentage" | "fixed_delta" | "fixed_set";
export type RoundingType = "none" | "nearest_10" | "nearest_50" | "nearest_100" | "end_90";
export type TargetField = "sale_price" | "wholesale_price";

interface BulkPriceUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: (number | string)[];
  selectedProducts: Product[];
  onSuccess: (updatedIds: (number | string)[], autoReprint: boolean) => void;
}

export default function BulkPriceUpdateModal({
  isOpen,
  onClose,
  selectedIds,
  selectedProducts,
  onSuccess,
}: BulkPriceUpdateModalProps) {
  const { t } = useTranslation();

  const [targetField, setTargetField] = useState<TargetField>("sale_price");
  const [updateType, setUpdateType] = useState<PriceUpdateType>("percentage");
  const [valueInput, setValueInput] = useState<string>("10");
  const [rounding, setRounding] = useState<RoundingType>("nearest_100");
  const [reprintShelfLabels, setReprintShelfLabels] = useState<boolean>(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericValue = useMemo(() => {
    const val = parseFloat(valueInput);
    return isNaN(val) ? 0 : val;
  }, [valueInput]);

  // Preview calculations for visible products
  const previewList = useMemo(() => {
    return selectedProducts.map((p) => {
      const oldPrice = parseFloat(
        targetField === "sale_price"
          ? p.sale_price
          : p.wholesale_price || p.sale_price
      ) || 0;

      let rawNewPrice = oldPrice;
      if (updateType === "percentage") {
        rawNewPrice = oldPrice * (1 + numericValue / 100);
      } else if (updateType === "fixed_delta") {
        rawNewPrice = oldPrice + numericValue;
      } else if (updateType === "fixed_set") {
        rawNewPrice = numericValue;
      }

      let newPrice = rawNewPrice;
      if (rounding === "nearest_10") {
        newPrice = Math.round(newPrice / 10) * 10;
      } else if (rounding === "nearest_50") {
        newPrice = Math.round(newPrice / 50) * 50;
      } else if (rounding === "nearest_100") {
        newPrice = Math.round(newPrice / 100) * 100;
      } else if (rounding === "end_90") {
        newPrice = Math.max(0, Math.round(newPrice / 100) * 100 - 10);
      } else {
        newPrice = Math.round(newPrice * 100) / 100;
      }

      newPrice = Math.max(0, newPrice);
      const diff = newPrice - oldPrice;

      return {
        id: p.id,
        name: p.name,
        reference: p.reference,
        brand: p.brand,
        oldPrice,
        newPrice,
        diff,
      };
    });
  }, [selectedProducts, targetField, updateType, numericValue, rounding]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0 || loading) return;

    setError(null);
    setLoading(true);

    try {
      const response = await api.post("/inventory/products/bulk-price-update/", {
        product_ids: selectedIds,
        update_type: updateType,
        target_field: targetField,
        value: numericValue,
        rounding,
      });

      const updatedIds = response.data?.product_ids || selectedIds;
      onSuccess(updatedIds, reprintShelfLabels);
      onClose();
    } catch (err: any) {
      const errData = err?.response?.data;
      setError(
        errData?.error ||
          errData?.detail ||
          "Erreur lors de la mise à jour des prix."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="card w-full max-w-2xl bg-white dark:bg-slate-900 shadow-2xl rounded-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 flex items-center justify-center shadow-xs">
              <Tag size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Mise à jour des prix en masse
                <span className="inline-flex items-center text-xs font-mono font-bold bg-primary-100 dark:bg-primary-950 text-primary-800 dark:text-primary-300 px-2 py-0.5 rounded-full">
                  {selectedIds.length} article{selectedIds.length > 1 ? "s" : ""}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Ajustez les prix par pourcentage ou montant fixe, puis réimprimez les étiquettes de rayon.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Target Field Selection */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-2">
              1. Prix à modifier
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setTargetField("sale_price")}
                className={cn(
                  "p-3 rounded-xl border text-start transition-all flex flex-col justify-between",
                  targetField === "sale_price"
                    ? "border-primary-600 bg-primary-50/50 ring-2 ring-primary-500/20 text-slate-900"
                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">Prix de vente détail (TTC)</span>
                  {targetField === "sale_price" && <CheckCircle2 size={16} className="text-primary-600" />}
                </div>
                <span className="text-2xs text-slate-500 mt-1">
                  Prix affiché au magasin et imprimé sur l'étiquette de rayon
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTargetField("wholesale_price")}
                className={cn(
                  "p-3 rounded-xl border text-start transition-all flex flex-col justify-between",
                  targetField === "wholesale_price"
                    ? "border-primary-600 bg-primary-50/50 ring-2 ring-primary-500/20 text-slate-900"
                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">Prix de gros (B2B)</span>
                  {targetField === "wholesale_price" && <CheckCircle2 size={16} className="text-primary-600" />}
                </div>
                <span className="text-2xs text-slate-500 mt-1">
                  Prix appliqué pour les commandes par cartons / clients gros
                </span>
              </button>
            </div>
          </div>

          {/* Calculation Type */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-2">
              2. Mode de calcul
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setUpdateType("percentage");
                  setValueInput("10");
                }}
                className={cn(
                  "py-2.5 px-3 rounded-xl border text-center font-medium text-xs transition-all flex items-center justify-center gap-1.5",
                  updateType === "percentage"
                    ? "border-primary-600 bg-primary-50 text-primary-800 font-semibold shadow-2xs"
                    : "border-slate-200 hover:bg-slate-50 text-slate-700"
                )}
              >
                <Percent size={14} />
                Pourcentage (%)
              </button>

              <button
                type="button"
                onClick={() => {
                  setUpdateType("fixed_delta");
                  setValueInput("500");
                }}
                className={cn(
                  "py-2.5 px-3 rounded-xl border text-center font-medium text-xs transition-all flex items-center justify-center gap-1.5",
                  updateType === "fixed_delta"
                    ? "border-primary-600 bg-primary-50 text-primary-800 font-semibold shadow-2xs"
                    : "border-slate-200 hover:bg-slate-50 text-slate-700"
                )}
              >
                <Coins size={14} />
                Montant fixe (± DZD)
              </button>

              <button
                type="button"
                onClick={() => {
                  setUpdateType("fixed_set");
                  setValueInput("2500");
                }}
                className={cn(
                  "py-2.5 px-3 rounded-xl border text-center font-medium text-xs transition-all flex items-center justify-center gap-1.5",
                  updateType === "fixed_set"
                    ? "border-primary-600 bg-primary-50 text-primary-800 font-semibold shadow-2xs"
                    : "border-slate-200 hover:bg-slate-50 text-slate-700"
                )}
              >
                <Sliders size={14} />
                Fixer prix exact
              </button>
            </div>
          </div>

          {/* Value Input & Quick Presets */}
          <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/70 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {updateType === "percentage"
                    ? "Variation en % (ex: 10 pour +10%, -15 pour -15%)"
                    : updateType === "fixed_delta"
                    ? "Variation en DZD (ex: 500 pour +500 DA, -200 pour -200 DA)"
                    : "Nouveau prix fixe (DZD)"}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step={updateType === "percentage" ? "0.1" : "1"}
                    value={valueInput}
                    onChange={(e) => setValueInput(e.target.value)}
                    required
                    className="form-input text-lg font-bold font-mono py-2 ps-3.5 pe-16 w-full rounded-xl border-slate-300 focus:ring-primary-500/20"
                    placeholder="0"
                  />
                  <div className="absolute end-3.5 top-1/2 -translate-y-1/2 text-xs font-bold font-mono text-slate-500 pointer-events-none">
                    {updateType === "percentage" ? "%" : "DZD"}
                  </div>
                </div>
              </div>

              {/* Visual preview pill */}
              <div className="text-end pt-5">
                <div
                  className={cn(
                    "inline-flex items-center gap-1 px-3 py-1.5 rounded-xl font-bold font-mono text-sm",
                    updateType === "fixed_set"
                      ? "bg-blue-100 text-blue-800"
                      : numericValue > 0
                      ? "bg-emerald-100 text-emerald-800"
                      : numericValue < 0
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-200 text-slate-700"
                  )}
                >
                  {updateType === "fixed_set" ? (
                    <Tag size={14} />
                  ) : numericValue > 0 ? (
                    <TrendingUp size={14} />
                  ) : numericValue < 0 ? (
                    <TrendingDown size={14} />
                  ) : null}
                  {updateType === "percentage"
                    ? `${numericValue > 0 ? "+" : ""}${numericValue}%`
                    : updateType === "fixed_delta"
                    ? `${numericValue > 0 ? "+" : ""}${formatDZD(numericValue)}`
                    : formatDZD(numericValue)}
                </div>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-2xs font-semibold text-slate-400 me-1">Préréglages :</span>
              {updateType === "percentage" && (
                <>
                  {[5, 10, 15, 20].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setValueInput(String(pct))}
                      className="btn-xs py-1 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono text-xs font-semibold"
                    >
                      +{pct}%
                    </button>
                  ))}
                  {[-5, -10, -20, -30].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setValueInput(String(pct))}
                      className="btn-xs py-1 px-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-mono text-xs font-semibold"
                    >
                      {pct}%
                    </button>
                  ))}
                </>
              )}

              {updateType === "fixed_delta" && (
                <>
                  {[100, 200, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setValueInput(String(amt))}
                      className="btn-xs py-1 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono text-xs font-semibold"
                    >
                      +{amt} DA
                    </button>
                  ))}
                  {[-100, -200, -500].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setValueInput(String(amt))}
                      className="btn-xs py-1 px-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-mono text-xs font-semibold"
                    >
                      {amt} DA
                    </button>
                  ))}
                </>
              )}

              {updateType === "fixed_set" && (
                <>
                  {[1500, 2000, 2500, 3000, 4500].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setValueInput(String(amt))}
                      className="btn-xs py-1 px-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-mono text-xs font-semibold"
                    >
                      {formatDZD(amt)}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Algerian Retail Rounding Options */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                3. Arrondi de vente (Pratique retail algérienne)
              </label>
              <span className="text-2xs text-slate-400 font-medium">Évite les centimes et pièces rares</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { id: "none", label: "Aucun arrondi", desc: "Valeur brute exacte" },
                { id: "nearest_10", label: "À 10 DA près", desc: "ex: 2 453 → 2 450 DA" },
                { id: "nearest_50", label: "À 50 DA près", desc: "ex: 2 470 → 2 450 DA" },
                { id: "nearest_100", label: "À 100 DA près", desc: "ex: 2 460 → 2 500 DA" },
                { id: "end_90", label: "Prix attractif (.90 DA)", desc: "ex: 2 500 → 2 490 DA" },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRounding(r.id as RoundingType)}
                  className={cn(
                    "p-2.5 rounded-xl border text-start transition-all",
                    rounding === r.id
                      ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/15"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  )}
                >
                  <div className="font-semibold text-xs text-slate-900">{r.label}</div>
                  <div className="text-2xs text-slate-500 mt-0.5">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                4. Aperçu en temps réel
              </label>
              <span className="text-2xs text-slate-500">
                {previewList.length} aperçu(s) affiché(s)
              </span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs max-h-44 overflow-y-auto divide-y divide-slate-100">
              {previewList.map((item) => (
                <div
                  key={item.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{item.name}</p>
                    <p className="text-2xs text-slate-400 font-mono">
                      {item.brand ? `${item.brand} · ` : ""}
                      {item.reference || "Sans réf"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="font-mono text-slate-400 line-through text-xs">
                      {formatDZD(item.oldPrice)}
                    </span>
                    <ArrowRight size={13} className="text-slate-300" />
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      {formatDZD(item.newPrice)}
                    </span>

                    <span
                      className={cn(
                        "font-mono text-2xs font-bold px-1.5 py-0.5 rounded-md",
                        item.diff > 0
                          ? "bg-emerald-100 text-emerald-800"
                          : item.diff < 0
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {item.diff > 0 ? `+${formatDZD(item.diff)}` : formatDZD(item.diff)}
                    </span>
                  </div>
                </div>
              ))}

              {selectedIds.length > previewList.length && (
                <div className="px-3.5 py-2 bg-slate-50 text-slate-500 text-2xs text-center font-medium">
                  + {selectedIds.length - previewList.length} autre(s) produit(s) sélectionné(s) non affichés sur cette page
                </div>
              )}
            </div>
          </div>

          {/* Shelf Label Auto-Reprint Option */}
          <div className="p-3.5 bg-amber-50/70 border border-amber-200/90 rounded-xl flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
              <Printer size={16} />
            </div>
            <label className="flex-1 cursor-pointer select-none">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reprintShelfLabels}
                  onChange={(e) => setReprintShelfLabels(e.target.checked)}
                  className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <span className="font-bold text-xs text-amber-950">
                  Réimprimer immédiatement les étiquettes de rayon (45mm × 35mm)
                </span>
              </div>
              <p className="text-2xs text-amber-800 mt-1 ps-5">
                Génère directement le PDF thermique pour réétiqueter les rayons ou boîtes de chaussures modifiées.
              </p>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary"
            >
              Annuler
            </button>

            <button
              type="submit"
              disabled={loading || selectedIds.length === 0}
              className="btn-primary flex items-center gap-2 shadow-xs"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Mise à jour en cours…
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Appliquer la mise à jour ({selectedIds.length})
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
