import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, ShoppingCart, Package, PlusCircle, CheckCircle2,
  X, Boxes, Minus, Plus, Loader2,
} from "lucide-react";
import api, { type PaginatedResponse } from "@/lib/api";
import type { Variant, Product } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";
import { cn } from "@/lib/utils";

// ── Quick Restock Modal ───────────────────────────────────────────────────────

interface QuickRestockModalProps {
  variant: Variant | null;
  product: Product | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

function QuickRestockModal({ variant, product, onClose, onSuccess }: QuickRestockModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Single variant restock quantity
  const [singleQty, setSingleQty] = useState<number>(() => {
    if (variant) {
      return Math.max(6, (variant.alert_threshold ?? 3) * 2 - variant.stock_qty);
    }
    return 12;
  });

  // Bulk product restock quantities per variant ID
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    if (product && product.variants?.length) {
      const init: Record<number, number> = {};
      product.variants.forEach((v) => {
        if (v.stock_qty <= v.alert_threshold) {
          init[v.id] = Math.max(6, (v.alert_threshold ?? 3) * 2 - v.stock_qty);
        } else {
          init[v.id] = 0;
        }
      });
      return init;
    }
    return {};
  });

  const [reason, setReason] = useState<"reception" | "adjustment">("reception");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Esc key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const singleMutation = useMutation({
    mutationFn: (data: { variant: number; quantity_delta: number; reason: string; notes?: string }) =>
      api.post("/inventory/movements/adjust/", data).then((r) => r.data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["variants", "low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["products", "low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onSuccess(
        variant
          ? `+${vars.quantity_delta} paires ajoutées pour ${variant.product_name} (T.${variant.size_eu})`
          : t("inventory.restock_success", "Stock réapprovisionné avec succès !")
      );
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error?.message || "Erreur lors du réapprovisionnement.");
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (data: {
      adjustments: { variant: number; quantity_delta: number }[];
      reason: string;
      notes?: string;
    }) => api.post("/inventory/movements/bulk-adjust/", data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["variants", "low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["products", "low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      const total = Object.values(quantities).reduce((acc, q) => acc + (q || 0), 0);
      onSuccess(`+${total} paires ajoutées pour ${product?.name}`);
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error?.message || "Erreur lors du réapprovisionnement groupé.");
    },
  });

  const isPending = singleMutation.isPending || bulkMutation.isPending;

  const handleApplyPresetAll = (qty: number) => {
    if (!product?.variants) return;
    const updated: Record<number, number> = {};
    product.variants.forEach((v) => {
      updated[v.id] = qty;
    });
    setQuantities(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (variant) {
      if (singleQty <= 0) {
        setError("Veuillez saisir une quantité supérieure à 0.");
        return;
      }
      singleMutation.mutate({
        variant: variant.id,
        quantity_delta: singleQty,
        reason,
        notes: notes || "Réapprovisionnement express",
      });
    } else if (product) {
      const adjustments = Object.entries(quantities)
        .map(([vid, q]) => ({ variant: Number(vid), quantity_delta: Number(q) }))
        .filter((a) => a.quantity_delta > 0);

      if (!adjustments.length) {
        setError("Veuillez spécifier au moins une quantité à ajouter.");
        return;
      }
      bulkMutation.mutate({
        adjustments,
        reason,
        notes: notes || `Réapprovisionnement modèle: ${product.name}`,
      });
    }
  };

  const totalBulkQty = Object.values(quantities).reduce((acc, q) => acc + (Number(q) || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/90 dark:border-slate-800 w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 flex items-center justify-center shrink-0">
              {variant ? <PlusCircle size={18} /> : <Boxes size={18} />}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {variant
                  ? t("inventory.quick_restock_title", "Réapprovisionnement rapide")
                  : t("inventory.bulk_restock_title", "Réapprovisionner le modèle")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {variant
                  ? `${variant.product_name} · Pointure EU${variant.size_eu}`
                  : `${product?.name} · ${product?.brand || ""}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 text-xs font-semibold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl">
              {error}
            </div>
          )}

          {/* Single Variant View */}
          {variant && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 flex items-center justify-between">
                <div>
                  <div className="text-2xs uppercase tracking-wider font-semibold text-slate-400">Stock actuel</div>
                  <div className={cn("text-xl font-bold font-mono mt-0.5", variant.stock_qty === 0 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>
                    {variant.stock_qty} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">paires</span>
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-2xs uppercase tracking-wider font-semibold text-slate-400">Seuil d'alerte</div>
                  <div className="text-xl font-bold font-mono text-slate-700 dark:text-slate-200 mt-0.5">
                    {variant.alert_threshold} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">paires</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  {t("inventory.restock_quantity", "Quantité à ajouter (paires)")}
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSingleQty((q) => Math.max(1, q - 1))}
                    className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={singleQty}
                    onChange={(e) => setSingleQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 text-center font-mono font-bold text-2xl py-2 px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setSingleQty((q) => q + 1)}
                    className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                {/* Carton pills */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">Cartons :</span>
                  {[6, 12, 24, 36].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setSingleQty(num)}
                      className={cn(
                        "px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer",
                        singleQty === num
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      )}
                    >
                      +{num}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Product Bulk Variants View */}
          {product && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Remplissage rapide :</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyPresetAll(6)}
                    className="px-2.5 py-1 text-2xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    +6 à tous
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetAll(12)}
                    className="px-2.5 py-1 text-2xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    +12 à tous
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetAll(0)}
                    className="px-2.5 py-1 text-2xs font-semibold rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    Vider
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto border border-slate-200/80 dark:border-slate-700 rounded-xl">
                {product.variants?.map((v) => (
                  <div key={v.id} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                          T. {v.size_eu}
                        </span>
                        {v.colour && v.colour !== "N/A" && v.colour !== "Standard" && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{v.colour}</span>
                        )}
                      </div>
                      <div className="text-2xs text-slate-400 mt-1">
                        Stock actuel:{" "}
                        <span className={cn("font-bold font-mono", v.stock_qty === 0 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>
                          {v.stock_qty}
                        </span>{" "}
                        (seuil: {v.alert_threshold})
                      </div>
                    </div>

                    <div className="w-24 shrink-0">
                      <input
                        type="number"
                        min="0"
                        value={quantities[v.id] ?? 0}
                        onChange={(e) => {
                          const val = Math.max(0, parseInt(e.target.value) || 0);
                          setQuantities((prev) => ({ ...prev, [v.id]: val }));
                        }}
                        className="w-full text-center font-mono font-bold text-sm py-1 px-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300 font-semibold">
                <span>{t("inventory.total_pairs_to_add", { count: totalBulkQty })}</span>
                <span className="font-mono text-sm font-bold">+{totalBulkQty}</span>
              </div>
            </div>
          )}

          {/* Reason & Notes */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t("inventory.restock_reason", "Motif de l'entrée")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReason("reception")}
                  className={cn(
                    "px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center cursor-pointer",
                    reason === "reception"
                      ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 shadow-2xs"
                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  )}
                >
                  {t("inventory.restock_reception", "Réception marchandise")}
                </button>
                <button
                  type="button"
                  onClick={() => setReason("adjustment")}
                  className={cn(
                    "px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center cursor-pointer",
                    reason === "adjustment"
                      ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 shadow-2xs"
                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  )}
                >
                  {t("inventory.restock_adjustment", "Ajustement manuel")}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("inventory.restock_notes", "Note / N° BL (optionnel)")}
              </label>
              <input
                type="text"
                placeholder="Ex: BL-2026-042 ou Réapprovisionnement express"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full text-xs py-2 px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="btn-secondary px-4 py-2 text-xs font-semibold rounded-xl"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs hover:shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {isPending && <Loader2 size={14} className="animate-spin" />}
              <span>{t("inventory.restock_confirm", "Confirmer l'entrée en stock")}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tables ────────────────────────────────────────────────────────────────────

interface VariantTableProps {
  variants: Variant[];
  isLoading: boolean;
  canRestock: boolean;
  onOrder: (variant: Variant) => void;
  onRestock: (variant: Variant) => void;
}

function VariantTable({ variants, isLoading, canRestock, onOrder, onRestock }: VariantTableProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.product")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.size")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.colour")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("inventory.current_stock")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("inventory.alert_threshold")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("common.status")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
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
                  <Package size={32} className="text-slate-300 dark:text-slate-600 stroke-[1.5]" />
                  <span className="text-sm">{t("common.no_data")}</span>
                </div>
              </td>
            </tr>
          )}
          {variants.map((variant) => (
            <tr key={variant.id} className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
              <td className="py-3.5 px-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0 text-slate-400 group-hover:bg-primary-50 dark:group-hover:bg-primary-950/50 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors border border-slate-200/60 dark:border-slate-700">
                    <Package size={14} />
                  </div>
                  <span className="font-semibold text-slate-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">{variant.product_name}</span>
                </div>
              </td>
              <td className="py-3.5 px-4">
                {variant.size_eu > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                    T. {variant.size_eu}
                  </span>
                ) : (
                  <span className="text-slate-400 font-mono text-xs">—</span>
                )}
              </td>
              <td className="py-3.5 px-4 text-sm text-slate-600 dark:text-slate-300 font-medium">
                {variant.colour === "N/A" || variant.colour === "Standard"
                  ? (variant.size_eu > 0 ? t("common.na") : "—")
                  : variant.colour}
              </td>
              <td className="py-3.5 px-4 text-end">
                <span
                  className={cn(
                    "font-mono font-bold tabular-nums text-sm",
                    variant.stock_qty === 0 ? "text-red-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {variant.stock_qty}
                </span>
              </td>
              <td className="py-3.5 px-4 text-end font-mono text-slate-500 dark:text-slate-400 tabular-nums text-sm">{variant.alert_threshold}</td>
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
                <div className="flex items-center justify-end gap-2">
                  {canRestock && (
                    <button
                      onClick={() => onRestock(variant)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 hover:text-emerald-800 dark:hover:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                      title={t("inventory.quick_restock_title", "Réapprovisionnement rapide")}
                    >
                      <PlusCircle size={13} />
                      <span>{t("inventory.quick_restock", "Réapprovisionner")}</span>
                    </button>
                  )}
                  <button
                    onClick={() => onOrder(variant)}
                    className="btn-secondary btn-sm flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-300 rounded-lg cursor-pointer"
                    title={t("inventory.order", "Commander")}
                  >
                    <ShoppingCart size={13} />
                    <span>{t("inventory.order", "Commander")}</span>
                  </button>
                </div>
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
  canRestock: boolean;
  onOrder: (product: Product) => void;
  onRestock: (product: Product) => void;
}

function ProductTable({ products, isLoading, canRestock, onOrder, onRestock }: ProductTableProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.product")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.reference")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("inventory.total_stock")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("inventory.global_threshold")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("common.status")}</th>
            <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
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
                  <Package size={32} className="text-slate-300 dark:text-slate-600 stroke-[1.5]" />
                  <span className="text-sm">{t("common.no_data")}</span>
                </div>
              </td>
            </tr>
          )}
          {products.map((product) => (
            <tr key={product.id} className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
              <td className="py-3.5 px-4">
                <Link to={`/inventory/products/${product.id}`} className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0 text-slate-400 group-hover:bg-primary-50 dark:group-hover:bg-primary-950/50 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors border border-slate-200/60 dark:border-slate-700">
                    <Package size={14} />
                  </div>
                  <span className="font-semibold text-slate-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">{product.name}</span>
                </Link>
              </td>
              <td className="py-3.5 px-4 font-mono text-2xs text-slate-500 dark:text-slate-400">{product.reference || "—"}</td>
              <td className="py-3.5 px-4 text-end">
                <span
                  className={cn(
                    "font-mono font-bold tabular-nums text-sm",
                    product.total_stock === 0 ? "text-red-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {product.total_stock}
                </span>
              </td>
              <td className="py-3.5 px-4 text-end font-mono text-slate-500 dark:text-slate-400 tabular-nums text-sm">{product.alert_threshold}</td>
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
                <div className="flex items-center justify-end gap-2">
                  {canRestock && (
                    <button
                      onClick={() => onRestock(product)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 hover:text-emerald-800 dark:hover:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                      title={t("inventory.bulk_restock_title", "Réapprovisionner le modèle")}
                    >
                      <Boxes size={13} />
                      <span>{t("inventory.quick_restock", "Réapprovisionner")}</span>
                    </button>
                  )}
                  <button
                    onClick={() => onOrder(product)}
                    className="btn-secondary btn-sm flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-300 rounded-lg cursor-pointer"
                    title={t("inventory.order", "Commander")}
                  >
                    <ShoppingCart size={13} />
                    <span>{t("inventory.order", "Commander")}</span>
                  </button>
                </div>
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
  const { user } = useAuth();
  const canRestock = user?.role !== "cashier";

  const [activeTab, setActiveTab] = useState<"products" | "variants">("products");
  const [restockVariant, setRestockVariant] = useState<Variant | null>(null);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

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

  function handleRestockVariant(variant: Variant) {
    setRestockProduct(null);
    setRestockVariant(variant);
  }

  function handleRestockProduct(product: Product) {
    setRestockVariant(null);
    setRestockProduct(product);
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
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white">{t("inventory.low_stock_title")}</h1>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t("inventory.low_stock_desc")}</p>
        </div>
        <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab("products")}
            className={cn(
              "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
              activeTab === "products" ? "bg-white dark:bg-slate-900 shadow-xs text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {t("inventory.products_tab", "Produits")}
          </button>
          <button
            onClick={() => setActiveTab("variants")}
            className={cn(
              "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
              activeTab === "variants" ? "bg-white dark:bg-slate-900 shadow-xs text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {t("inventory.variants_tab", "Variantes")}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("inventory.out_of_stock_title")} ({activeTab === "products" ? t("inventory.products_tab", "Produits") : t("inventory.variants_tab", "Variantes")})
            </div>
            <div className="text-3xl font-bold font-mono text-red-600 dark:text-rose-400 mt-1 tabular-nums">
              {currentLoading ? "..." : currentOutOfStockLength}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{t("inventory.stock_zero")}</div>
          </div>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-red-50 dark:bg-rose-950/40 text-red-600 dark:text-rose-400 border border-red-100 dark:border-rose-900/50 flex-shrink-0">
            <AlertTriangle size={22} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              En alerte ({activeTab === "products" ? t("inventory.products_tab", "Produits") : t("inventory.variants_tab", "Variantes")})
            </div>
            <div className="text-3xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
              {currentLoading ? "..." : currentLowStockLength}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Sous le seuil d'alerte</div>
          </div>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/50 flex-shrink-0">
            <AlertTriangle size={22} />
          </div>
        </div>
      </div>

      {/* Out of stock section */}
      <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden bg-white dark:bg-slate-900">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/60">
          <div className="flex items-center gap-2.5">
            <span className="badge badge-danger font-mono font-bold">
              {currentOutOfStockLength}
            </span>
            <h2 className="font-bold text-slate-900 dark:text-white text-sm">En rupture de stock</h2>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("inventory.stock_zero")}</span>
        </div>
        {activeTab === "products" ? (
          <ProductTable
            products={outOfStockProducts}
            isLoading={productsLoading}
            canRestock={canRestock}
            onOrder={handleOrderProduct}
            onRestock={handleRestockProduct}
          />
        ) : (
          <VariantTable
            variants={outOfStockVariants}
            isLoading={variantsLoading}
            canRestock={canRestock}
            onOrder={handleOrderVariant}
            onRestock={handleRestockVariant}
          />
        )}
      </div>

      {/* Low stock section */}
      <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden bg-white dark:bg-slate-900">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/60">
          <div className="flex items-center gap-2.5">
            <span className="badge badge-warning font-mono font-bold">
              {currentLowStockLength}
            </span>
            <h2 className="font-bold text-slate-900 dark:text-white text-sm">{t("inventory.low_stock_status")}</h2>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Sous le seuil d'alerte</span>
        </div>
        {activeTab === "products" ? (
          <ProductTable
            products={lowStockProducts}
            isLoading={productsLoading}
            canRestock={canRestock}
            onOrder={handleOrderProduct}
            onRestock={handleRestockProduct}
          />
        ) : (
          <VariantTable
            variants={lowStockVariants}
            isLoading={variantsLoading}
            canRestock={canRestock}
            onOrder={handleOrderVariant}
            onRestock={handleRestockVariant}
          />
        )}
      </div>

      {/* Quick Restock Modal */}
      {(restockVariant || restockProduct) && (
        <QuickRestockModal
          variant={restockVariant}
          product={restockProduct}
          onClose={() => {
            setRestockVariant(null);
            setRestockProduct(null);
          }}
          onSuccess={(msg) => setToastMessage(msg)}
        />
      )}

      {/* Toast feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-xl border border-slate-800 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={16} />
          </div>
          <p className="text-xs font-semibold">{toastMessage}</p>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
