/**
 * Sales History Page — /sales
 * Paginated list of completed/cancelled sales with filters and receipt download.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Receipt, TrendingUp, ShoppingBag, Plus, Printer, RotateCcw, X, Star, Trophy, Medal, Ban, ArrowLeftRight, AlertTriangle, Bookmark, BookmarkCheck, PackageCheck, Clock, Filter, FileText, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import { printReceipt } from "@/lib/receipt";
import { printBonVersement, printBonReservation } from "@/lib/versement";
import { printTicket } from "@/lib/printerConfig";
import ExchangeModal from "./ExchangeModal";
import type { Sale, SaleItem, StoreSettings, PaymentMethod, LoyaltyTier, DefectReason } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import ManagerPinModal from "@/components/ui/ManagerPinModal";

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const TIER_CONFIG: Record<LoyaltyTier, { label: string; className: string; Icon: typeof Star }> = {
  bronze: { label: "Bronze", className: "text-amber-700 bg-amber-100", Icon: Medal },
  silver: { label: "Silver", className: "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800", Icon: Star },
  gold:   { label: "Gold",   className: "text-yellow-600 bg-yellow-100", Icon: Trophy },
};

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; labelKey: string; fallback: string }[] = [
  { value: "cash", labelKey: "payment.cash", fallback: "Espèces" },
  { value: "tpe", labelKey: "payment.tpe", fallback: "TPE (CIB/Edahabia)" },
  { value: "baridimob", labelKey: "payment.baridimob", fallback: "BaridiMob" },
  { value: "cheque", labelKey: "payment.cheque", fallback: "Chèque" },
  { value: "ccp", labelKey: "payment.ccp", fallback: "CCP" },
  { value: "virement", labelKey: "payment.virement", fallback: "Virement" },
  { value: "account", labelKey: "payment.account", fallback: "À Crédit (Compte)" },
];

const DEFECT_REASONS: { value: DefectReason; labelKey: string }[] = [
  { value: "unstitched_sole", labelKey: "defects.reason_unstitched_sole" },
  { value: "broken_strap", labelKey: "defects.reason_broken_strap" },
  { value: "mismatched_pair", labelKey: "defects.reason_mismatched_pair" },
  { value: "leather_tear", labelKey: "defects.reason_leather_tear" },
  { value: "discoloration", labelKey: "defects.reason_discoloration" },
  { value: "broken_heel", labelKey: "defects.reason_broken_heel" },
  { value: "missing_insole", labelKey: "defects.reason_missing_insole" },
  { value: "other", labelKey: "defects.reason_other" },
];

// ── Return Modal ──────────────────────────────────────────────────────────────

interface ReturnItemState {
  item: SaleItem;
  selected: boolean;
  quantity: number;
  restock: boolean;
  is_defective: boolean;
  defect_reason: DefectReason;
  defect_notes: string;
}

function ReturnModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [managerPin, setManagerPin] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);

  const { data: storeSettings } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => api.get("/core/store-settings/current/").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const [itemStates, setItemStates] = useState<ReturnItemState[]>(
    (sale.items ?? []).map((item) => ({
      item,
      selected: false,
      quantity: item.quantity,
      restock: true,
      is_defective: false,
      defect_reason: "unstitched_sole",
      defect_notes: "",
    }))
  );
  const [reason, setReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(
    parseFloat(sale.total_amount || "0").toFixed(2)
  );
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");

  const selectedItems = itemStates.filter((s) => s.selected);

  const mutation = useMutation({
    mutationFn: (overridePin?: string) => {
      const pinToSend = overridePin || managerPin;
      return api.post(`/sales/${sale.id}/returns/`, {
        items: selectedItems.map((s) => ({
          variant_id: s.item.variant,
          quantity: s.quantity,
          restock: s.is_defective ? false : s.restock,
          is_defective: s.is_defective,
          defect_reason: s.is_defective ? s.defect_reason : "",
          defect_notes: s.is_defective ? s.defect_notes : "",
        })),
        reason,
        refund_amount: refundAmount,
        refund_method: refundMethod,
        ...(pinToSend ? { manager_pin: pinToSend } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["defects"] });
      queryClient.invalidateQueries({ queryKey: ["defect-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["variants"] });
      onClose();
    },
    onError: (err) => {
      const errMsg = getApiError(err);
      setToast(errMsg);
      if (errMsg.toLowerCase().includes("pin")) {
        setShowPinModal(true);
      }
    },
  });

  const handleConfirmReturn = () => {
    const requirePin = storeSettings?.require_manager_pin_for_returns ?? true;
    if (user?.role === "cashier" && !user.can_process_returns && requirePin && !managerPin) {
      setShowPinModal(true);
      return;
    }
    mutation.mutate();
  };

  function updateItem(index: number, patch: Partial<ReturnItemState>) {
    setItemStates((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  const canSubmit =
    selectedItems.length > 0 &&
    reason.trim() &&
    parseFloat(refundAmount) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-text-primary">{t("sales.process_return")}</h2>
            <p className="text-xs text-text-muted">{t('sales.receipt')} {sale.receipt_number || `#${sale.id}`}</p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm text-text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Item selection */}
          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              {t("sales.items_to_return")}
            </p>
            <div className="space-y-2">
              {itemStates.map((s, i) => (
                <div
                  key={s.item.id}
                  className={cn(
                    "border border-border rounded-lg p-3 transition-colors",
                    s.selected && "border-primary-300 dark:border-primary-700 bg-primary-50/30 dark:bg-primary-950/30"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={s.selected}
                      onChange={(e) => updateItem(i, { selected: e.target.checked })}
                      className="mt-0.5 accent-primary-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary">{s.item.variant_str}</div>
                      <div className="text-xs text-text-muted">
                        {s.item.quantity} × {formatDZD(s.item.unit_price)} DZD
                      </div>
                    </div>
                  </div>

                  {s.selected && (
                    <div className="mt-3 ms-7 space-y-2.5">
                      <div className="flex items-center gap-4 flex-wrap">
                        <label className="flex items-center gap-1.5 text-xs">
                          <span className="text-text-muted">{t("sales.qty_returned")}</span>
                          <input
                            type="number"
                            min={1}
                            max={s.item.quantity}
                            value={s.quantity}
                            onChange={(e) =>
                              updateItem(i, {
                                quantity: Math.min(
                                  Math.max(1, parseInt(e.target.value) || 1),
                                  s.item.quantity
                                ),
                              })
                            }
                            className="w-16 px-2 py-1 border border-border dark:border-slate-700 rounded text-center font-mono text-sm dark:bg-slate-800 dark:text-white"
                          />
                          <span className="text-text-muted">/ {s.item.quantity}</span>
                        </label>

                        {!s.is_defective && (
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={s.restock}
                              onChange={(e) => updateItem(i, { restock: e.target.checked })}
                              className="accent-primary-600"
                            />
                            <span className="text-text-muted">{t("sales.restock")}</span>
                          </label>
                        )}

                        <label className="flex items-center gap-1.5 text-xs cursor-pointer text-amber-700 dark:text-amber-400 font-medium">
                          <input
                            type="checkbox"
                            checked={s.is_defective}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              updateItem(i, {
                                is_defective: checked,
                                restock: checked ? false : s.restock,
                              });
                            }}
                            className="accent-amber-600"
                          />
                          <AlertTriangle size={13} className="text-amber-600" />
                          <span>{t("sales.is_defective")}</span>
                        </label>
                      </div>

                      {s.is_defective && (
                        <div className="p-2.5 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-lg space-y-2 text-xs">
                          <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 text-[11px]">
                            <span>ℹ {t("sales.defect_quarantine_hint")}</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-text-muted text-[11px] mb-1 font-medium">
                                {t("sales.defect_reason_label")}
                              </label>
                              <select
                                value={s.defect_reason}
                                onChange={(e) => updateItem(i, { defect_reason: e.target.value as DefectReason })}
                                className="w-full form-input py-1 px-2 text-xs dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                              >
                                {DEFECT_REASONS.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {t(r.labelKey)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-text-muted text-[11px] mb-1 font-medium">
                                {t("sales.defect_notes_label")}
                              </label>
                              <input
                                type="text"
                                value={s.defect_notes}
                                onChange={(e) => updateItem(i, { defect_notes: e.target.value })}
                                placeholder={t("sales.defect_notes_placeholder")}
                                className="w-full form-input py-1 px-2 text-xs dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="form-label">{t("sales.return_reason")}</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="form-input"
              placeholder={t("sales.return_reason_placeholder")}
            />
          </div>

          {/* Refund */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">{t("sales.refund_amount")}</label>
              <input
                type="number"
                min={0}
                step="any"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="form-input font-mono"
              />
            </div>
            <div>
              <label className="form-label">{t("sales.refund_method")}</label>
              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                className="form-input"
              >
                {PAYMENT_METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          {toast && (
            <p className="text-xs text-danger flex-1">{toast}</p>
          )}
          <div className="text-xs text-text-muted">
            {t("sales.items_selected", { count: selectedItems.length })}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary btn-sm" disabled={mutation.isPending}>
              {t("common.cancel")}
            </button>
            <button
              onClick={handleConfirmReturn}
              className="btn-primary btn-sm"
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? t("common.processing") : t("sales.confirm_return")}
            </button>
          </div>
        </div>
      </div>

      <ManagerPinModal
        isOpen={showPinModal}
        reason={t("sales_history.manager_pin_return_title")}
        actionDescription={t("sales_history.manager_pin_return_desc")}
        onSuccess={(pin) => {
          setManagerPin(pin);
          setShowPinModal(false);
          mutation.mutate(pin);
        }}
        onCancel={() => setShowPinModal(false)}
      />
    </div>
  );
}

// ── Add Payment Modal ─────────────────────────────────────────────────────────

function AddPaymentModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(parseFloat(sale.balance_due || "0").toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/sales/${sale.id}/add-payment/`, {
        amount: parseFloat(amount).toFixed(2),
        method,
        notes,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      onClose();
    },
    onError: (err) => {
      setError(getApiError(err));
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-text-primary">{t("sales.add_payment")}</h2>
            <p className="text-xs text-text-muted">{t('sales.versement')} {sale.receipt_number || `#${sale.id}`}</p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm text-text-muted"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Sale summary */}
          <div className="rounded-lg bg-surface p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">{t("sales.sale_total")}</span>
              <span className="font-mono font-semibold">{formatDZD(sale.total_amount)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">{t("sales.already_paid")}</span>
              <span className="font-mono text-success">{formatDZD(sale.amount_paid)} DZD</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1">
              <span className="text-text-muted font-medium">{t("sales.remaining_balance")}</span>
              <span className="font-mono font-bold text-danger">{formatDZD(sale.balance_due)} DZD</span>
            </div>
            {sale.due_date && (
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">{t("sales.due_date")}</span>
                <span>{sale.due_date}</span>
              </div>
            )}
          </div>

          {error && (
            <div className="text-xs text-danger bg-danger-light rounded-lg px-3 py-2">{error}</div>
          )}

          <div>
            <label className="form-label">{t("sales.amount_dzd")}</label>
            <input
              type="number"
              min={0.01}
              step="any"
              max={parseFloat(sale.balance_due || "0")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="form-input font-mono"
            />
          </div>

          <div>
            <label className="form-label">{t("sales.payment_method")}</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="form-input">
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">{t("sales.notes")}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input"
              placeholder={t("common.optional")}
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary btn-sm" disabled={mutation.isPending}>
            {t("common.cancel")}
          </button>
          <button
            onClick={() => mutation.mutate()}
            className="btn-primary btn-sm"
            disabled={mutation.isPending || parseFloat(amount) <= 0}
          >
            {mutation.isPending ? t("common.processing") : t("sales.confirm_payment")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Collect Layaway Modal ─────────────────────────────────────────────────────

function CollectLayawayModal({
  sale,
  onClose,
  storeName,
}: {
  sale: Sale;
  onClose: () => void;
  storeName: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const balanceDue = parseFloat(sale.balance_due || "0");
  const [amount, setAmount] = useState(balanceDue > 0 ? String(balanceDue) : "0");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api
        .post(`/sales/${sale.id}/collect-layaway/`, {
          ...(balanceDue > 0 ? { amount, method, notes } : {}),
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      printReceipt(data, storeName);
      onClose();
    },
    onError: (err) => setError(getApiError(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-indigo-50/50 dark:bg-indigo-950/40">
          <div className="flex items-center gap-2">
            <PackageCheck size={18} className="text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-text-primary">
              {t("sales_history.collect_layaway_title", { receipt: sale.receipt_number })}
            </h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-surface p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">{t("sales_history.client_ref_label")}</span>
              <span className="font-medium">{sale.client_name || sale.notes || t("common.walk_in_customer", "Client de passage")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">{t("sales_history.order_total_label")}</span>
              <span className="font-mono font-semibold">{formatDZD(sale.total_amount)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">{t("sales_history.deposit_paid_label")}</span>
              <span className="font-mono text-emerald-600 font-semibold">{formatDZD(sale.amount_paid)} DZD</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5">
              <span className="text-text-muted font-bold">{t("sales_history.balance_to_collect_label")}</span>
              <span className="font-mono font-extrabold text-indigo-700 dark:text-indigo-400 text-sm">{formatDZD(sale.balance_due)} DZD</span>
            </div>
          </div>

          {/* Reserved items mini-list */}
          <div className="border border-border rounded-xl p-3 bg-white dark:bg-slate-800/60">
            <p className="text-2xs font-bold text-text-muted uppercase tracking-wider mb-2">
              {t("sales_history.reserved_items_to_handover", { count: sale.items?.length ?? 0 })}
            </p>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {sale.items?.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-text-primary truncate max-w-[240px]">{item.variant_str}</span>
                  <span className="font-mono text-text-muted font-bold">×{item.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs text-danger bg-danger-light rounded-lg px-3 py-2 font-medium">
              {error}
            </div>
          )}

          {balanceDue > 0 && (
            <div className="space-y-3 pt-1 border-t border-border">
              <div>
                <label className="form-label text-xs">{t("sales_history.final_payment_amount_label")}</label>
                <input
                  type="number"
                  min={balanceDue}
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="form-input font-mono font-bold"
                />
              </div>

              <div>
                <label className="form-label text-xs">{t("sales_history.final_payment_method_label")}</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="form-input text-xs"
                >
                  {PAYMENT_METHOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label text-xs">{t("sales_history.handover_notes_label")}</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="form-input text-xs"
                  placeholder={t("sales_history.handover_notes_placeholder")}
                />
              </div>
            </div>
          )}

          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-2xs text-amber-800 space-y-1">
            <p className="font-bold">⚠️ {t("sales_history.handover_instructions_title")}</p>
            <p>{t("sales_history.handover_instructions_desc")}</p>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-border flex gap-2 justify-end bg-surface/50">
          <button onClick={onClose} className="btn-secondary btn-sm" disabled={mutation.isPending}>
            {t("common.cancel")}
          </button>
          <button
            onClick={() => mutation.mutate()}
            className="btn-primary btn-sm bg-indigo-600 hover:bg-indigo-700"
            disabled={mutation.isPending || (balanceDue > 0 && parseFloat(amount) < balanceDue)}
          >
            {mutation.isPending ? t("common.processing") : t("sales_history.confirm_collect_and_pay")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cancel Layaway Modal ───────────────────────────────────────────────────────

function CancelLayawayModal({
  sale,
  onClose,
}: {
  sale: Sale;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [refundDeposit, setRefundDeposit] = useState(true);
  const [depositForfeited, setDepositForfeited] = useState(false);
  const [notes, setNotes] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [showPinModal, setShowPinModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountPaid = parseFloat(sale.amount_paid || "0");
  const isCashier = user?.role === "cashier";

  const mutation = useMutation({
    mutationFn: (overridePin?: string) =>
      api
        .post(`/sales/${sale.id}/cancel-layaway/`, {
          refund_deposit: refundDeposit && !depositForfeited,
          deposit_forfeited: depositForfeited,
          notes,
          manager_pin: overridePin || managerPin,
        })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      onClose();
    },
    onError: (err: any) => {
      const msg = getApiError(err);
      if (msg.includes("PIN") && isCashier) {
        setShowPinModal(true);
      } else {
        setError(msg);
      }
    },
  });

  return (
    <>
      {showPinModal && (
        <ManagerPinModal
          title={t("sales_history.manager_pin_cancel_layaway_title")}
          message={t("sales_history.manager_pin_cancel_layaway_desc")}
          onSuccess={(pin) => {
            setManagerPin(pin);
            setShowPinModal(false);
            mutation.mutate(pin);
          }}
          onClose={() => setShowPinModal(false)}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-red-50/50 dark:bg-red-950/40">
            <div className="flex items-center gap-2">
              <Ban size={18} className="text-red-600 dark:text-red-400" />
              <h3 className="font-bold text-text-primary">
                {t("sales_history.cancel_layaway_title", { receipt: sale.receipt_number })}
              </h3>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 space-y-1">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                {t("sales_history.cancel_layaway_action_desc")}
              </p>
              <p className="text-text-muted">
                {t("sales_history.deposit_recorded_desc")}{" "}
                <strong className="font-mono text-slate-900 dark:text-white">{formatDZD(sale.amount_paid)} DZD</strong>
              </p>
            </div>

            {error && (
              <div className="text-xs text-danger bg-danger-light rounded-lg px-3 py-2 font-medium">
                {error}
              </div>
            )}

            {amountPaid > 0 && (
              <div className="space-y-2">
                <label className="form-label font-bold text-slate-800 dark:text-slate-200">{t("sales_history.deposit_management_label")}</label>

                <label
                  onClick={() => { setRefundDeposit(true); setDepositForfeited(false); }}
                  className={cn(
                    "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors",
                    refundDeposit && !depositForfeited
                      ? "bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700"
                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  )}
                >
                  <input
                    type="radio"
                    name="depositAction"
                    checked={refundDeposit && !depositForfeited}
                    onChange={() => { setRefundDeposit(true); setDepositForfeited(false); }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-bold text-emerald-900 dark:text-emerald-300">{t("sales_history.refund_deposit_option", { amount: formatDZD(amountPaid) })}</p>
                    <p className="text-2xs text-emerald-700 dark:text-emerald-400">{t("sales_history.refund_deposit_hint")}</p>
                  </div>
                </label>

                <label
                  onClick={() => { setRefundDeposit(false); setDepositForfeited(true); }}
                  className={cn(
                    "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors",
                    depositForfeited
                      ? "bg-amber-50/70 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700"
                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  )}
                >
                  <input
                    type="radio"
                    name="depositAction"
                    checked={depositForfeited}
                    onChange={() => { setRefundDeposit(false); setDepositForfeited(true); }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-bold text-amber-900 dark:text-amber-300">{t("sales_history.forfeit_deposit_option")}</p>
                    <p className="text-2xs text-amber-700 dark:text-amber-400">{t("sales_history.forfeit_deposit_hint")}</p>
                  </div>
                </label>
              </div>
            )}

            <div>
              <label className="form-label">{t("sales_history.cancel_reason_label")}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("sales_history.cancel_reason_placeholder")}
                className="form-input text-xs"
              />
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-border flex gap-2 justify-end bg-surface/50">
            <button onClick={onClose} className="btn-secondary btn-sm" disabled={mutation.isPending}>
              {t("common.close")}
            </button>
            <button
              onClick={() => {
                if (isCashier && !managerPin) {
                  setShowPinModal(true);
                } else {
                  mutation.mutate();
                }
              }}
              className="btn-danger btn-sm"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t("common.processing") : t("sales_history.confirm_cancel_layaway")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const STATUS_OPTIONS = [
  { value: "", labelKey: "status.all" },
  { value: "completed", labelKey: "status.completed" },
  { value: "partially_paid", labelKey: "status.partially_paid" },
  { value: "layaway", labelKey: "status.layaway" },
  { value: "cancelled", labelKey: "status.cancelled" },
  { value: "refunded", labelKey: "status.refunded" },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHOD_OPTIONS.map((o) => [o.value, o.labelKey])
);

const PAYMENT_METHOD_FALLBACKS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHOD_OPTIONS.map((o) => [o.value, o.fallback])
);

interface DailySummaryResponse {
  date: string;
  branch_id: string | null;
  total_revenue: string | number;
  sale_count: number;
  today_active_revenue?: string | number;
  today_active_count?: number;
  today_items_sold?: number;
  total_refunds: string | number;
  net_revenue: string | number;
  by_payment_method: Record<string, string | number>;
  versement_collected_today: string | number;
  outstanding_versements: number;
}

export default function SalesHistoryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { selectedBranch } = useBranch();
  const queryClient = useQueryClient();
  const storeName = user?.tenant?.name ?? "ShoeDZ";
  const isManager = user?.role === "owner" || user?.role === "manager";

  // Filter states
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [clientFilter, setClientFilter] = useState(""); // "" | "walk_in" | "registered" | "has_balance"
  const [cashierId, setCashierId] = useState("");
  const [ordering, setOrdering] = useState("-created_at");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePreset, setDatePreset] = useState<"all" | "today" | "yesterday" | "week" | "month" | "custom">("all");
  const [page, setPage] = useState(1);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [exchangeSale, setExchangeSale] = useState<Sale | null>(null);
  const [addPaymentSale, setAddPaymentSale] = useState<Sale | null>(null);
  const [collectLayawaySale, setCollectLayawaySale] = useState<Sale | null>(null);
  const [cancelLayawaySale, setCancelLayawaySale] = useState<Sale | null>(null);

  // Detailed Daily Thermal Ticket state
  const [reportDate, setReportDate] = useState(() => toISODate(new Date()));
  const [reportPreview, setReportPreview] = useState<{ title: string; html: string } | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);

  const applyDatePreset = (preset: "all" | "today" | "yesterday" | "week" | "month") => {
    setDatePreset(preset);
    setPage(1);
    const now = new Date();
    if (preset === "all") {
      setDateFrom("");
      setDateTo("");
    } else if (preset === "today") {
      const iso = toISODate(now);
      setDateFrom(iso);
      setDateTo(iso);
      setReportDate(iso);
    } else if (preset === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const iso = toISODate(y);
      setDateFrom(iso);
      setDateTo(iso);
      setReportDate(iso);
    } else if (preset === "week") {
      const w = new Date(now);
      w.setDate(w.getDate() - 6);
      setDateFrom(toISODate(w));
      setDateTo(toISODate(now));
    } else if (preset === "month") {
      const m = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(toISODate(m));
      setDateTo(toISODate(now));
    }
  };

  // Today's global KPI summary (independent of current pagination)
  const { data: dailySummary } = useQuery<DailySummaryResponse>({
    queryKey: ["sales-daily-summary", selectedBranch?.id ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedBranch?.id) params.set("branch_id", String(selectedBranch.id));
      return api.get(`/sales/daily-summary/?${params.toString()}`).then((r) => r.data);
    },
  });

  // Users list for cashier filter
  const { data: usersData } = useQuery<PaginatedResponse<{ id: number; first_name: string; last_name: string; email: string }>>({
    queryKey: ["users-cashiers-filter"],
    queryFn: () => api.get("/auth/users/?page_size=100").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const cashiersList = usersData?.results ?? [];

  const cancelVersementMutation = useMutation({
    mutationFn: (saleId: number) =>
      api.post(`/sales/${saleId}/cancel/`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-daily-summary"] });
    },
  });

  const { data, isLoading } = useQuery<PaginatedResponse<Sale>>({
    queryKey: [
      "sales",
      {
        search,
        status,
        paymentMethod,
        clientFilter,
        cashierId,
        ordering,
        dateFrom,
        dateTo,
        branchId: selectedBranch?.id ?? "all",
        page,
      },
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (paymentMethod) params.set("payment_method", paymentMethod);
      if (clientFilter === "walk_in" || clientFilter === "registered") {
        params.set("client_type", clientFilter);
      } else if (clientFilter === "has_balance") {
        params.set("has_balance", "true");
      }
      if (cashierId) params.set("cashier", cashierId);
      if (ordering) params.set("ordering", ordering);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (selectedBranch?.id) params.set("branch", String(selectedBranch.id));
      params.set("page", String(page));
      return api.get(`/sales/?${params.toString()}`).then((r) => r.data);
    },
  });

  const sales = data?.results ?? [];

  const todayRevenue = parseFloat(
    String(dailySummary?.today_active_revenue ?? dailySummary?.total_revenue ?? "0")
  );
  const todaySalesCount = dailySummary?.today_active_count ?? dailySummary?.sale_count ?? 0;
  const todayItemsSold = dailySummary?.today_items_sold ?? 0;
  const outstandingVersements = dailySummary?.outstanding_versements ?? 0;

  const hasActiveFilters = Boolean(
    search || status || paymentMethod || clientFilter || cashierId || dateFrom || dateTo || ordering !== "-created_at"
  );

  const resetAllFilters = () => {
    setSearch("");
    setStatus("");
    setPaymentMethod("");
    setClientFilter("");
    setCashierId("");
    setOrdering("-created_at");
    setDateFrom("");
    setDateTo("");
    setDatePreset("all");
    setPage(1);
  };

  const handleOpenDetailedReport = async (targetDate?: string) => {
    const chosenDate = targetDate || (dateFrom && (!dateTo || dateTo === dateFrom) ? dateFrom : reportDate);
    setIsLoadingReport(true);
    try {
      const params = new URLSearchParams();
      if (chosenDate) params.set("date", chosenDate);
      if (selectedBranch?.id) params.set("branch_id", String(selectedBranch.id));
      const res = await api.get(`/sales/daily-detailed-report/?${params.toString()}`);
      setReportPreview({
        title: `Rapport Détaillé du Jour (${chosenDate})`,
        html: res.data.report_html,
      });
    } catch {
      alert("Impossible de générer le rapport détaillé du jour.");
    } finally {
      setIsLoadingReport(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">{t("nav.sales")}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {data?.count ?? 0} {t("sales.sale", { count: data?.count ?? 0, defaultValue: "ventes" })} enregistrées
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Print Detailed Daily Sales (Ticket Z style) */}
          <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xs p-1 gap-1.5">
            <div className="flex items-center gap-1.5 ps-2">
              <Calendar size={14} className="text-slate-400 shrink-0" />
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="text-xs font-semibold text-slate-700 dark:text-slate-200 bg-transparent border-none focus:outline-none cursor-pointer"
                title={t("sales_history.detailed_report_date")}
              />
            </div>
            <button
              type="button"
              onClick={() => handleOpenDetailedReport(reportDate)}
              disabled={isLoadingReport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              title={t("sales_history.print_daily_report_tooltip")}
            >
              <Printer size={14} />
              <span>{isLoadingReport ? t("common.loading") : t("sales_history.print_daily_report_btn", "Imprimer Détail du Jour")}</span>
            </button>
          </div>

          <Link to="/sales/new" className="btn-primary shadow-xs">
            <Plus size={16} className="stroke-[2.5]" />
            <span>{t("sales.new_sale")}</span>
          </Link>
        </div>
      </div>

      {/* Today's KPI strip (Always shows Today's Totals & Count instead of paginated slice) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="flex items-center gap-3.5 px-4 py-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/60 shrink-0">
            <TrendingUp size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t("dashboard.today_revenue")}
            </div>
            <div className="font-mono font-extrabold text-lg text-slate-900 dark:text-white tracking-tight truncate">
              {formatDZD(todayRevenue)} <span className="text-xs text-slate-400 font-bold">DZD</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3.5 px-4 py-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 flex items-center justify-center border border-primary-100 dark:border-primary-800/60 shrink-0">
            <ShoppingBag size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t("sales.recent_sales", "VENTES DU JOUR")}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-extrabold text-lg text-slate-900 dark:text-white tracking-tight">
                {todaySalesCount}
              </span>
              {todayItemsSold > 0 && (
                <span className="text-xs font-semibold text-slate-400">
                  ({todayItemsSold} {todayItemsSold > 1 ? t("sales.articles_count", "articles") : t("sales.article_count", "article")})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3.5 px-4 py-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-100 dark:border-amber-800/60 shrink-0">
            <Receipt size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t("sales.in_installment", "Versements en cours")}
            </div>
            <div className="font-mono font-extrabold text-lg text-amber-700 dark:text-amber-400 tracking-tight">
              {outstandingVersements}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Filters Panel */}
      <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
        {/* Row 1: Quick Date Presets + Search + Reset */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Quick Date Pills */}
          <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1 flex-wrap">
            {(
              [
                { id: "all", label: t("status.all") },
                { id: "today", label: t("common.today", "Aujourd'hui") },
                { id: "yesterday", label: t("common.yesterday", "Hier") },
                { id: "week", label: t("common.last_7_days", "7 derniers jours") },
                { id: "month", label: t("common.this_month", "Ce mois") },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyDatePreset(preset.id)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  datePreset === preset.id
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Search box */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="form-input ps-9 py-1.5 rounded-xl text-xs w-full bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
              placeholder={t("sales_history.search_placeholder")}
            />
          </div>
        </div>

        {/* Row 2: Detailed Filter Controls */}
        <div className="flex flex-wrap gap-2.5 items-center pt-1 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 pe-1">
            <Filter size={13} />
            <span>{t("sales_history.filters")}</span>
          </div>

          {/* Status */}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="form-input w-auto min-w-[140px] py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
            title={t("sales_history.filter_status")}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>

          {/* Payment Method */}
          <select
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value);
              setPage(1);
            }}
            className="form-input w-auto min-w-[155px] py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
            title={t("sales_history.filter_payment")}
          >
            <option value="">{t("sales_history.all_payments")}</option>
            {PAYMENT_METHOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey, opt.fallback)}
              </option>
            ))}
          </select>

          {/* Client / Balance Filter */}
          <select
            value={clientFilter}
            onChange={(e) => {
              setClientFilter(e.target.value);
              setPage(1);
            }}
            className="form-input w-auto min-w-[155px] py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
            title={t("sales_history.filter_client")}
          >
            <option value="">{t("sales_history.all_clients")}</option>
            <option value="walk_in">{t("sales_history.walk_in_client")}</option>
            <option value="registered">{t("sales_history.registered_client")}</option>
            <option value="has_balance">{t("sales_history.has_balance_due")}</option>
          </select>

          {/* Cashier Filter */}
          {cashiersList.length > 0 && (
            <select
              value={cashierId}
              onChange={(e) => {
                setCashierId(e.target.value);
                setPage(1);
              }}
              className="form-input w-auto min-w-[145px] py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
              title={t("sales_history.filter_cashier")}
            >
              <option value="">{t("sales_history.all_cashiers")}</option>
              {cashiersList.map((u) => {
                const fullName = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
                return (
                  <option key={u.id} value={String(u.id)}>
                    {fullName}
                  </option>
                );
              })}
            </select>
          )}

          {/* Sort Order */}
          <select
            value={ordering}
            onChange={(e) => {
              setOrdering(e.target.value);
              setPage(1);
            }}
            className="form-input w-auto min-w-[150px] py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
            title={t("sales_history.sort")}
          >
            <option value="-created_at">{t("sales_history.sort_newest")}</option>
            <option value="created_at">{t("sales_history.sort_oldest")}</option>
            <option value="-total_amount">{t("sales_history.sort_amount_desc")}</option>
            <option value="total_amount">{t("sales_history.sort_amount_asc")}</option>
          </select>

          {/* Date Range */}
          <div className="flex items-center gap-1.5 ms-auto">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">{t("common.from")}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setDatePreset("custom");
                if (e.target.value) setReportDate(e.target.value);
                setPage(1);
              }}
              className="form-input text-xs py-1.5 rounded-xl font-medium w-auto bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
            />
            <label className="text-xs text-slate-500 dark:text-slate-400 font-semibold">{t("common.to")}</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setDatePreset("custom");
                setPage(1);
              }}
              className="form-input text-xs py-1.5 rounded-xl font-medium w-auto bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white"
            />
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 font-bold cursor-pointer rounded-xl px-2.5 py-1.5 text-xs"
            >
              {t("common.reset", "Réinitialiser")}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("sales.receipt_no")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("sales_history.datetime_col")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("sales.cashier")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("sales.client")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("sales.payment_methods")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("common.status")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("common.total")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("sales.balance_due")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 font-medium">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && sales.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 font-medium">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}

              {sales.map((sale) => (
                <>
                  <tr
                    key={sale.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50",
                      sale.status === "cancelled" && "opacity-60",
                      expandedId === sale.id && "bg-primary-50/40 dark:bg-primary-950/40"
                    )}
                    onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <Receipt size={14} className="text-slate-400 shrink-0" />
                        <span className="font-mono font-bold text-slate-900 dark:text-white">{sale.receipt_number || `#${sale.id}`}</span>
                      </div>
                    </td>
                    <td className="text-slate-600 dark:text-slate-400 text-xs font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{formatDate(sale.created_at)}</span>
                        {formatTime(sale.created_at) && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[11px] font-bold">
                            <Clock size={10} className="text-slate-400" />
                            {formatTime(sale.created_at)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-xs font-semibold text-slate-700 dark:text-slate-300">{sale.cashier_name || "—"}</td>
                    <td className="text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{sale.client_name ?? (sale.client ? `#${sale.client}` : <span className="text-slate-400 italic font-normal">{t("sales.walk_in")}</span>)}</span>
                        {sale.loyalty_tier && (() => {
                          const { label, className, Icon } = TIER_CONFIG[sale.loyalty_tier];
                          return (
                            <span className="flex items-center gap-1 mt-0.5">
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-2xs font-semibold ${className}`}>
                                <Icon size={9} />
                                {label}
                              </span>
                              <span className="text-2xs text-slate-400 font-mono">
                                {(sale.loyalty_points ?? 0).toLocaleString()} pts
                              </span>
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {sale.payments?.map((p, i) => (
                          <span key={i} className="badge badge-neutral text-2xs">
                            {PAYMENT_METHOD_LABELS[p.method]
                              ? t(PAYMENT_METHOD_LABELS[p.method], PAYMENT_METHOD_FALLBACKS[p.method] || p.method)
                              : p.method}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={cn("badge", getStatusBadgeClass(sale.status))}>
                        {STATUS_OPTIONS.find((o) => o.value === sale.status)?.labelKey ? t(STATUS_OPTIONS.find((o) => o.value === sale.status)!.labelKey) : sale.status}
                      </span>
                      {sale.status === "layaway" && (
                        <div className="mt-1 space-y-0.5">
                          {sale.is_layaway_expired ? (
                            <span className="inline-block px-1.5 py-0.5 rounded text-3xs font-black uppercase tracking-wider bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60">
                              Expirée
                            </span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded text-3xs font-black uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                              Consignée
                            </span>
                          )}
                          {sale.layaway_expires_at && (
                            <p className={cn(
                              "text-2xs font-mono font-medium",
                              sale.is_layaway_expired ? "text-red-600 dark:text-red-400 font-bold" : "text-indigo-600 dark:text-indigo-400"
                            )}>
                              {sale.is_layaway_expired
                                ? `Expirée le ${sale.layaway_expires_at}`
                                : typeof sale.days_until_expiration === "number"
                                  ? `Retrait : J-${sale.days_until_expiration}`
                                  : `Jusqu'au ${sale.layaway_expires_at}`}
                            </p>
                          )}
                        </div>
                      )}
                      {sale.status === "partially_paid" && sale.due_date && (() => {
                        const dueMs = new Date(sale.due_date).getTime() - Date.now();
                        const dueDays = Math.ceil(dueMs / (1000 * 60 * 60 * 24));
                        return (
                          <p className={cn(
                            "text-2xs mt-0.5 font-mono",
                            dueDays < 0 ? "text-red-600 dark:text-red-400 font-semibold" : dueDays < 7 ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"
                          )}>
                            {dueDays < 0 ? t("sales.overdue_days", { days: Math.abs(dueDays) }) : t("sales.due_on", { date: sale.due_date })}
                          </p>
                        );
                      })()}
                    </td>
                    <td className="text-end font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {formatDZD(sale.total_amount)}
                      <span className="text-2xs text-slate-400 ms-1 font-semibold">DZD</span>
                    </td>
                    <td className="text-end">
                      <span
                        className={cn(
                          "font-mono text-sm",
                          parseFloat(sale.balance_due || "0") > 0 ? "text-red-600 dark:text-red-400 font-bold" : "text-slate-400"
                        )}
                      >
                        {parseFloat(sale.balance_due || "0") > 0
                          ? `${formatDZD(sale.balance_due)} DZD`
                          : "—"}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          className="p-1.5 rounded-lg text-primary-600 hover:bg-primary-50 transition-colors cursor-pointer"
                          title={t("common.print")}
                          onClick={() => {
                            if (sale.status === "layaway" || sale.is_layaway) {
                              printBonReservation(sale, storeName);
                            } else if (sale.status === "partially_paid") {
                              printBonVersement(sale, storeName);
                            } else {
                              printReceipt(sale, storeName);
                            }
                          }}
                        >
                          <Printer size={15} />
                        </button>
                        {sale.status === "layaway" && (
                          <>
                            <button
                              className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                              title={t("sales_history.collect_layaway_tooltip")}
                              onClick={() => setCollectLayawaySale(sale)}
                            >
                              <PackageCheck size={16} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                              title={t("sales_history.add_deposit_tooltip")}
                              onClick={() => setAddPaymentSale(sale)}
                            >
                              <Plus size={15} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                              title={t("sales_history.cancel_layaway_tooltip")}
                              onClick={() => setCancelLayawaySale(sale)}
                            >
                              <Ban size={15} />
                            </button>
                          </>
                        )}
                        {isManager && sale.status === "completed" && (
                          <>
                            <button
                              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                              title={t("sales_history.process_return_tooltip")}
                              onClick={() => setReturnSale(sale)}
                            >
                              <RotateCcw size={15} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-primary-600 hover:bg-primary-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title={
                                (sale.exchange_count ?? 0) >= 3
                                  ? t("sales.max_exchanges_reached")
                                  : t("sales.process_exchange")
                              }
                              disabled={(sale.exchange_count ?? 0) >= 3}
                              onClick={() => setExchangeSale(sale)}
                            >
                              <ArrowLeftRight size={15} />
                            </button>
                          </>
                        )}
                        {isManager && sale.status === "partially_paid" && (
                          <>
                            <button
                              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                              title={t("sales_history.add_payment_tooltip")}
                              onClick={() => setAddPaymentSale(sale)}
                            >
                              <Plus size={15} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                              title={t("sales_history.cancel_versement_tooltip")}
                              onClick={() => {
                                if (confirm(t("sales.cancel_versement_confirm", { receipt: sale.receipt_number }))) {
                                  cancelVersementMutation.mutate(sale.id);
                                }
                              }}
                              disabled={cancelVersementMutation.isPending}
                            >
                              <Ban size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded row: sale items */}
                  {expandedId === sale.id && (
                    <tr key={`${sale.id}-detail`} className="bg-slate-50/60 dark:bg-slate-950/40">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
                          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
                            Articles vendus ({sale.items?.length ?? 0})
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400 dark:text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800">
                                <th className="text-start pb-2">{t("sales.item")}</th>
                                <th className="text-end pb-2">{t("sales.qty")}</th>
                                <th className="text-end pb-2">{t("sales.unit_price")}</th>
                                <th className="text-end pb-2">{t("sales.discount")}</th>
                                <th className="text-end pb-2">{t("sales.subtotal")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {(sale.items ?? []).map((item) => (
                                <tr key={item.id} className="text-slate-700 dark:text-slate-300">
                                  <td className="py-2 font-medium">{item.variant_str}</td>
                                  <td className="text-end font-mono font-bold text-slate-900 dark:text-white">{item.quantity}</td>
                                  <td className="text-end font-mono">{formatDZD(item.unit_price)}</td>
                                  <td className="text-end font-mono text-slate-400 dark:text-slate-500">
                                    {parseFloat(item.discount_amount) > 0
                                      ? `-${formatDZD(item.discount_amount)}`
                                      : "—"}
                                  </td>
                                  <td className="text-end font-mono font-bold text-slate-900 dark:text-white">
                                    {formatDZD(item.subtotal)} DZD
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-slate-200 dark:border-slate-800">
                                <td colSpan={4} className="text-end pt-3 text-xs font-bold text-slate-800 dark:text-slate-200">
                                  Total:
                                </td>
                                <td className="text-end pt-3 font-mono font-black text-sm text-primary-600 dark:text-primary-400">
                                  {formatDZD(sale.total_amount)} DZD
                                </td>
                              </tr>
                            </tfoot>
                          </table>

                          {/* Notes */}
                          {sale.notes && (
                            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 italic bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                              Note: {sale.notes}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              {t("sales.page_info", { current: data.current_page, total: data.total_pages, count: data.count })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary btn-sm"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.next}
                className="btn-secondary btn-sm"
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {returnSale && (
        <ReturnModal sale={returnSale} onClose={() => setReturnSale(null)} />
      )}
      {exchangeSale && (
        <ExchangeModal sale={exchangeSale} onClose={() => setExchangeSale(null)} />
      )}
      {addPaymentSale && (
        <AddPaymentModal sale={addPaymentSale} onClose={() => setAddPaymentSale(null)} />
      )}
      {collectLayawaySale && (
        <CollectLayawayModal
          sale={collectLayawaySale}
          onClose={() => setCollectLayawaySale(null)}
          storeName={storeName}
        />
      )}
      {cancelLayawaySale && (
        <CancelLayawayModal
          sale={cancelLayawaySale}
          onClose={() => setCancelLayawaySale(null)}
        />
      )}

      {/* Detailed Daily Report Preview Modal (Ticket Z 80mm format) */}
      {reportPreview && (
        <div
          className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4"
          onClick={() => setReportPreview(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 max-w-md w-full overflow-hidden flex flex-col max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-primary-600 dark:text-primary-400" />
                <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">{reportPreview.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setReportPreview(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-100/70 dark:bg-slate-950/70 flex justify-center">
              <iframe
                title={reportPreview.title}
                srcDoc={reportPreview.html}
                className="bg-white shadow-md border border-slate-200 dark:border-slate-700 rounded-md w-[320px] min-h-[540px]"
              />
            </div>

            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setReportPreview(null)}
                className="btn-secondary btn-sm"
              >
                {t("common.close")}
              </button>
              <button
                type="button"
                onClick={() => printTicket(reportPreview.html)}
                className="btn-primary btn-sm flex items-center gap-1.5"
              >
                <Printer size={14} /> {t("sales_history.print_detailed_ticket_btn", "Imprimer Ticket Détaillé")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
