import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  PauseCircle,
  PlayCircle,
  Trash2,
  X,
  AlertTriangle,
  ShoppingBag,
  User as UserIcon,
  Check,
  AlertCircle,
  Tag,
  ArrowRight,
  Info,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { formatDZD } from "@/lib/api";
import type { Client, Product, Variant, HeldSale, HeldSaleResumeResponse, HeldSaleChange } from "@/types";

interface CartItemData {
  variant: Variant;
  product: Product;
  quantity: number;
  unit_price: number;
  discount: number;
}

interface HeldSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCart: CartItemData[];
  currentCartDiscount: number;
  currentClient: Client | null;
  currentNotes: string;
  currentBranchId: string | number | null;
  onParkSuccess: () => void;
  onResumeSale: (resumeData: HeldSaleResumeResponse) => void;
}

export default function HeldSalesModal({
  isOpen,
  onClose,
  currentCart,
  currentCartDiscount,
  currentClient,
  currentNotes,
  currentBranchId,
  onParkSuccess,
  onResumeSale,
}: HeldSalesModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"park" | "list">("list");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [pendingResume, setPendingResume] = useState<HeldSaleResumeResponse | null>(null);
  const [showReplaceWarning, setShowReplaceWarning] = useState<HeldSale | null>(null);

  const labelInputRef = useRef<HTMLInputElement>(null);

  // Set default tab on open
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setDeleteConfirmId(null);
      setPendingResume(null);
      setShowReplaceWarning(null);
      setLabel("");
      setNotes(currentNotes || "");
      if (currentCart.length > 0) {
        setActiveTab("park");
        setTimeout(() => labelInputRef.current?.focus(), 80);
      } else {
        setActiveTab("list");
      }
    }
  }, [isOpen, currentCart.length, currentNotes]);

  // Fetch held sales list
  const {
    data: heldSales = [],
    isLoading: isListLoading,
    refetch,
  } = useQuery<HeldSale[]>({
    queryKey: ["held-sales", currentBranchId],
    queryFn: async () => {
      const params: Record<string, any> = {};
      if (currentBranchId) {
        params.branch = currentBranchId;
      }
      const res = await api.get<{ results?: HeldSale[] } | HeldSale[]>("/sales/held/", { params });
      if (Array.isArray(res.data)) {
        return res.data;
      }
      return res.data.results || [];
    },
    enabled: isOpen,
  });

  // Park mutation
  const parkMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        branch: currentBranchId || null,
        client: currentClient?.id || null,
        label: label.trim(),
        notes: notes.trim(),
        cart_discount: Number(currentCartDiscount || 0).toFixed(2),
        cart: currentCart.map((item) => ({
          variant_id: item.variant.id,
          quantity: item.quantity,
          unit_price: Number(item.unit_price).toFixed(2),
          discount_amount: Number(item.discount || 0).toFixed(2),
        })),
      };
      const res = await api.post<HeldSale>("/sales/held/", payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["held-sales"] });
      onParkSuccess();
      onClose();
    },
    onError: (err: any) => {
      setError(getApiError(err));
    },
  });

  // Resume mutation
  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<HeldSaleResumeResponse>(`/sales/held/${id}/resume/`);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.changes && data.changes.length > 0) {
        setPendingResume(data);
      } else {
        queryClient.invalidateQueries({ queryKey: ["held-sales"] });
        onResumeSale(data);
        onClose();
      }
    },
    onError: (err: any) => {
      setError(getApiError(err));
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sales/held/${id}/`);
      return id;
    },
    onSuccess: () => {
      setDeleteConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["held-sales"] });
    },
    onError: (err: any) => {
      setError(getApiError(err));
    },
  });

  if (!isOpen) return null;

  const currentCartTotal = Math.max(
    0,
    currentCart.reduce((s, i) => s + i.unit_price * i.quantity - i.discount, 0) - currentCartDiscount
  );
  const currentCartItemsCount = currentCart.reduce((s, i) => s + i.quantity, 0);

  const handleStartResume = (held: HeldSale) => {
    setError(null);
    if (currentCart.length > 0) {
      setShowReplaceWarning(held);
    } else {
      resumeMutation.mutate(held.id);
    }
  };

  const handleConfirmReplaceAndResume = () => {
    if (showReplaceWarning) {
      const id = showReplaceWarning.id;
      setShowReplaceWarning(null);
      resumeMutation.mutate(id);
    }
  };

  const handleConfirmChanges = () => {
    if (pendingResume) {
      queryClient.invalidateQueries({ queryKey: ["held-sales"] });
      onResumeSale(pendingResume);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-xs">
              <PauseCircle size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight">
                  {t("held_sales.modal_title", "Ventes en attente (Mise en attente & Reprise)")}
                </h2>
                <span className="px-2 py-0.5 text-2xs font-bold rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300">
                  POS Alt+H
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(
                  "held_sales.modal_subtitle",
                  "Mettez un panier en pause pour servir un autre client ou reprenez un ticket."
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 px-6 pt-2">
          {currentCart.length > 0 && (
            <button
              type="button"
              onClick={() => { setActiveTab("park"); setError(null); }}
              className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
                activeTab === "park"
                  ? "border-amber-500 text-amber-600 dark:text-amber-400"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <PauseCircle size={15} />
              <span>{t("held_sales.tab_park", "Mettre en attente ce ticket")}</span>
              <span className="px-1.5 py-0.5 rounded-full text-3xs font-mono bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                {currentCartItemsCount}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => { setActiveTab("list"); setError(null); refetch(); }}
            className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
              activeTab === "list"
                ? "border-amber-500 text-amber-600 dark:text-amber-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
            }`}
          >
            <Clock size={15} />
            <span>{t("held_sales.tab_list", "Tickets en attente")}</span>
            <span className="px-1.5 py-0.5 rounded-full text-3xs font-mono bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {heldSales.length}
            </span>
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="flex-1 font-medium">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-200"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* ── Sub-view A: Review Changes Dialog ── */}
          {pendingResume && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={20} />
                  <div>
                    <h3 className="text-sm font-extrabold text-amber-900 dark:text-amber-200">
                      {t("held_sales.changes_detected_title", "Changements détectés lors de la reprise")}
                    </h3>
                    <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-1">
                      {t(
                        "held_sales.changes_detected_desc",
                        "Depuis la mise en attente, les stocks ou les prix de certains articles ont été modifiés :"
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {pendingResume.changes.map((change: HeldSaleChange, idx: number) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-start gap-3"
                  >
                    <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {change.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPendingResume(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t("common.cancel", "Annuler")}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmChanges}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 transition-all flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <PlayCircle size={15} />
                  <span>{t("held_sales.confirm_resume", "Charger le panier avec ces ajustements")}</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Sub-view B: Replace Active Cart Confirmation Warning ── */}
          {!pendingResume && showReplaceWarning && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={20} />
                  <div>
                    <h3 className="text-sm font-extrabold text-amber-900 dark:text-amber-200">
                      {t("held_sales.replace_cart_warning_title", "Remplacer le panier actif ?")}
                    </h3>
                    <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-1">
                      {t(
                        "held_sales.replace_cart_warning_desc",
                        "Votre panier actuel contient déjà des articles. Reprendre cette vente en attente remplacera les articles actuellement en caisse."
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowReplaceWarning(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t("common.cancel", "Annuler")}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReplaceAndResume}
                  disabled={resumeMutation.isPending}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 transition-all flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <PlayCircle size={15} />
                  <span>{t("held_sales.replace_and_resume", "Remplacer et reprendre")}</span>
                </button>
              </div>
            </div>
          )}

          {/* ── View 1: Park Current Cart ── */}
          {!pendingResume && !showReplaceWarning && activeTab === "park" && (
            <div className="space-y-6">
              {/* Summary Card */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 flex items-center justify-center">
                    <ShoppingBag size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {currentCartItemsCount} {currentCartItemsCount > 1 ? t("sales.articles_count", "articles") : t("sales.article_count", "article")}
                    </h3>
                    {currentClient && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                        <UserIcon size={12} />
                        <span>{currentClient.name}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-end">
                  <span className="text-2xs text-slate-400 uppercase font-bold tracking-wider">
                    {t("common.total", "Total")}
                  </span>
                  <p className="text-lg font-black font-mono text-slate-900 dark:text-white">
                    {formatDZD(currentCartTotal)} DA
                  </p>
                </div>
              </div>

              {/* Form Inputs */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t("held_sales.label_field", "Libellé ou description repère (optionnel)")}
                  </label>
                  <div className="relative">
                    <Tag size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      ref={labelInputRef}
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !parkMutation.isPending) {
                          e.preventDefault();
                          parkMutation.mutate();
                        }
                      }}
                      placeholder={t("held_sales.label_placeholder", "Ex: Dame robe rouge, Client veste en cuir...")}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 dark:focus:ring-amber-400"
                    />
                  </div>
                  <p className="text-2xs text-slate-500 dark:text-slate-400 mt-1">
                    {t("held_sales.label_help", "Aide à identifier rapidement le client quand il revient à la caisse.")}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t("held_sales.notes_field", "Notes internes (optionnel)")}
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("held_sales.notes_placeholder", "Ex: Parti chercher sa carte CIB...")}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs focus:outline-hidden focus:ring-2 focus:ring-amber-500 dark:focus:ring-amber-400"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t("common.cancel", "Annuler")}
                </button>
                <button
                  type="button"
                  onClick={() => parkMutation.mutate()}
                  disabled={parkMutation.isPending}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 transition-all flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <PauseCircle size={16} />
                  <span>
                    {parkMutation.isPending
                      ? t("common.saving", "Enregistrement...")
                      : t("held_sales.confirm_park_btn", "Mettre en attente (Entrée)")}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ── View 2: List of Held Sales ── */}
          {!pendingResume && !showReplaceWarning && activeTab === "list" && (
            <div>
              {isListLoading ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  {t("common.loading", "Chargement...")}
                </div>
              ) : heldSales.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
                    <Clock size={24} />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {t("held_sales.empty_title", "Aucune vente en attente")}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
                    {t(
                      "held_sales.empty_desc",
                      "Les tickets mis en pause à la caisse apparaîtront ici pour être repris ultérieurement."
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {heldSales.map((held) => {
                    const isConfirmingDelete = deleteConfirmId === held.id;
                    const dateFormatted = new Date(held.created_at).toLocaleString("fr-DZ", {
                      dateStyle: "short",
                      timeStyle: "short",
                    });

                    return (
                      <div
                        key={held.id}
                        className="p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-800/40 hover:border-amber-300 dark:hover:border-amber-800/60 transition-all shadow-2xs flex items-center justify-between gap-4"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {held.label || t("held_sales.unlabeled_sale", "Vente sans libellé")}
                            </h4>
                            <span className="px-2 py-0.5 rounded-full text-3xs font-mono font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50 shrink-0">
                              {held.item_count} {held.item_count > 1 ? t("sales.articles_count", "articles") : t("sales.article_count", "article")}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 mt-1.5 text-2xs text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1 font-mono">
                              <Clock size={11} />
                              {dateFormatted}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <UserIcon size={11} />
                              {held.cashier_name}
                            </span>
                            {held.client_name && (
                              <>
                                <span>•</span>
                                <span className="font-semibold text-primary-600 dark:text-primary-400 truncate">
                                  {held.client_name}
                                </span>
                              </>
                            )}
                          </div>

                          {held.notes && (
                            <p className="text-2xs text-slate-400 dark:text-slate-500 italic mt-1 truncate">
                              "{held.notes}"
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-end">
                            <span className="text-3xs text-slate-400 uppercase font-bold tracking-wider">
                              {t("common.total", "Total")}
                            </span>
                            <p className="text-sm font-black font-mono text-slate-900 dark:text-white">
                              {formatDZD(held.total_amount)} DA
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/60 p-1 rounded-xl border border-rose-200 dark:border-rose-800">
                                <button
                                  type="button"
                                  onClick={() => deleteMutation.mutate(held.id)}
                                  disabled={deleteMutation.isPending}
                                  className="px-2 py-1 rounded-lg text-2xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer"
                                  title={t("common.confirm", "Confirmer")}
                                >
                                  {t("common.delete", "Supprimer")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                  title={t("common.cancel", "Annuler")}
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(held.id)}
                                className="p-2 rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                                title={t("common.delete", "Supprimer")}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleStartResume(held)}
                              disabled={resumeMutation.isPending}
                              className="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                            >
                              <PlayCircle size={14} />
                              <span>{t("held_sales.resume_btn", "Reprendre")}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

