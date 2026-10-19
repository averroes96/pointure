/**
 * Sales History Page — /sales
 * Paginated list of completed/cancelled sales with filters and receipt download.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Receipt, TrendingUp, ShoppingBag, Plus, Printer, RotateCcw, X, Star, Trophy, Medal, Ban, ArrowLeftRight, AlertTriangle, Bookmark, BookmarkCheck, PackageCheck } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import { printReceipt } from "@/lib/receipt";
import { printBonVersement, printBonReservation } from "@/lib/versement";
import ExchangeModal from "./ExchangeModal";
import type { Sale, SaleItem, StoreSettings, PaymentMethod, LoyaltyTier, DefectReason } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import ManagerPinModal from "@/components/ui/ManagerPinModal";

const TIER_CONFIG: Record<LoyaltyTier, { label: string; className: string; Icon: typeof Star }> = {
  bronze: { label: "Bronze", className: "text-amber-700 bg-amber-100", Icon: Medal },
  silver: { label: "Silver", className: "text-slate-600 bg-slate-100", Icon: Star },
  gold:   { label: "Gold",   className: "text-yellow-600 bg-yellow-100", Icon: Trophy },
};

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; labelKey: string }[] = [
  { value: "cash", labelKey: "payment.cash" },
  { value: "cheque", labelKey: "payment.cheque" },
  { value: "ccp", labelKey: "payment.ccp" },
  { value: "virement", labelKey: "payment.virement" },
  { value: "account", labelKey: "payment.account" },
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
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
                    s.selected && "border-primary-300 bg-primary-50/30"
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
                            className="w-16 px-2 py-1 border border-border rounded text-center font-mono text-sm"
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

                        <label className="flex items-center gap-1.5 text-xs cursor-pointer text-amber-700 font-medium">
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
                        <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg space-y-2 text-xs">
                          <div className="flex items-center gap-1.5 text-amber-800 text-[11px]">
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
                                className="w-full form-input py-1 px-2 text-xs"
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
                                className="w-full form-input py-1 px-2 text-xs"
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
                step={100}
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
              Annuler
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
        reason="Autorisation Responsable requise pour le retour"
        actionDescription="Un code PIN manager est nécessaire pour valider ce retour ou remboursement."
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col">
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
              step={100}
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
            Annuler
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-indigo-50/50">
          <div className="flex items-center gap-2">
            <PackageCheck size={18} className="text-indigo-600" />
            <h3 className="font-bold text-text-primary">
              Retirer la réservation — {sale.receipt_number}
            </h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-surface p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Client / Référence :</span>
              <span className="font-medium">{sale.client_name || sale.notes || "Client de passage"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Total commande :</span>
              <span className="font-mono font-semibold">{formatDZD(sale.total_amount)} DZD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Acompte déjà réglé :</span>
              <span className="font-mono text-emerald-600 font-semibold">{formatDZD(sale.amount_paid)} DZD</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5">
              <span className="text-text-muted font-bold">Solde restant à percevoir :</span>
              <span className="font-mono font-extrabold text-indigo-700 text-sm">{formatDZD(sale.balance_due)} DZD</span>
            </div>
          </div>

          {/* Reserved items mini-list */}
          <div className="border border-border rounded-xl p-3 bg-white">
            <p className="text-2xs font-bold text-text-muted uppercase tracking-wider mb-2">
              Articles consignés à remettre au client ({sale.items?.length ?? 0})
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
                <label className="form-label text-xs">Montant du règlement final (DZD)</label>
                <input
                  type="number"
                  min={balanceDue}
                  step={100}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="form-input font-mono font-bold"
                />
              </div>

              <div>
                <label className="form-label text-xs">Mode de paiement du solde</label>
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
                <label className="form-label text-xs">Notes (optionnel)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="form-input text-xs"
                  placeholder="Ex : Remis en mains propres"
                />
              </div>
            </div>
          )}

          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-2xs text-amber-800 space-y-1">
            <p className="font-bold">⚠️ Consignes de remise :</p>
            <p>Vérifiez le bon de réservation physique et remettez les paires au client. La vente sera marquée complétée.</p>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-border flex gap-2 justify-end bg-surface/50">
          <button onClick={onClose} className="btn-secondary btn-sm" disabled={mutation.isPending}>
            Annuler
          </button>
          <button
            onClick={() => mutation.mutate()}
            className="btn-primary btn-sm bg-indigo-600 hover:bg-indigo-700"
            disabled={mutation.isPending || (balanceDue > 0 && parseFloat(amount) < balanceDue)}
          >
            {mutation.isPending ? t("common.processing") : "Confirmer le retrait & Encaisser"}
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
          title="Code PIN Manager Requis"
          message="L'annulation d'une réservation et la libération du stock exigent une autorisation manager."
          onSuccess={(pin) => {
            setManagerPin(pin);
            setShowPinModal(false);
            mutation.mutate(pin);
          }}
          onClose={() => setShowPinModal(false)}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-red-50/50">
            <div className="flex items-center gap-2">
              <Ban size={18} className="text-red-600" />
              <h3 className="font-bold text-text-primary">
                Annuler la réservation — {sale.receipt_number}
              </h3>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
              <p className="font-semibold text-slate-800">
                Action : Le stock réservé sera automatiquement réintégré en rayon (Libération stock).
              </p>
              <p className="text-text-muted">
                Acompte enregistré sur cette réservation : <strong className="font-mono text-slate-900">{formatDZD(sale.amount_paid)} DZD</strong>
              </p>
            </div>

            {error && (
              <div className="text-xs text-danger bg-danger-light rounded-lg px-3 py-2 font-medium">
                {error}
              </div>
            )}

            {amountPaid > 0 && (
              <div className="space-y-2">
                <label className="form-label font-bold text-slate-800">Gestion de l&apos;acompte perçu :</label>

                <label
                  onClick={() => { setRefundDeposit(true); setDepositForfeited(false); }}
                  className={cn(
                    "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors",
                    refundDeposit && !depositForfeited ? "bg-emerald-50/70 border-emerald-300" : "bg-white border-slate-200 hover:bg-slate-50"
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
                    <p className="font-bold text-emerald-900">Rembourser l&apos;acompte au client ({formatDZD(amountPaid)} DZD)</p>
                    <p className="text-2xs text-emerald-700">Enregistre une sortie d&apos;espèces dans la caisse actuelle.</p>
                  </div>
                </label>

                <label
                  onClick={() => { setRefundDeposit(false); setDepositForfeited(true); }}
                  className={cn(
                    "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors",
                    depositForfeited ? "bg-amber-50/70 border-amber-300" : "bg-white border-slate-200 hover:bg-slate-50"
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
                    <p className="font-bold text-amber-900">Conserver l&apos;acompte (Abandon / Délai expiré)</p>
                    <p className="text-2xs text-amber-700">Aucun remboursement. La boutique conserve l&apos;acompte à titre d&apos;indemnité.</p>
                  </div>
                </label>
              </div>
            )}

            <div>
              <label className="form-label">Motif de l&apos;annulation</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex : Client désisté, délai de 7 jours dépassé sans nouvelles..."
                className="form-input text-xs"
              />
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-border flex gap-2 justify-end bg-surface/50">
            <button onClick={onClose} className="btn-secondary btn-sm" disabled={mutation.isPending}>
              Fermer
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
              {mutation.isPending ? t("common.processing") : "Confirmer l'annulation & Libérer stock"}
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

export default function SalesHistoryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const storeName = user?.tenant?.name ?? "ShoeDZ";
  const isManager = user?.role === "owner" || user?.role === "manager";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [exchangeSale, setExchangeSale] = useState<Sale | null>(null);
  const [addPaymentSale, setAddPaymentSale] = useState<Sale | null>(null);
  const [collectLayawaySale, setCollectLayawaySale] = useState<Sale | null>(null);
  const [cancelLayawaySale, setCancelLayawaySale] = useState<Sale | null>(null);

  const cancelVersementMutation = useMutation({
    mutationFn: (saleId: number) =>
      api.post(`/sales/${saleId}/cancel/`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
    },
  });

  const { data, isLoading } = useQuery<PaginatedResponse<Sale>>({
    queryKey: ["sales", { search, status, dateFrom, dateTo, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("page", String(page));
      return api.get(`/sales/?${params.toString()}`).then((r) => r.data);
    },
  });

  const sales = data?.results ?? [];

  // Summary totals from current page
  const pageTotalRevenue = sales
    .filter((s) => s.status === "completed")
    .reduce((sum, s) => sum + parseFloat(s.total_amount || "0"), 0);
  const partiallyPaidCount = sales.filter((s) => s.status === "partially_paid").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">{t("nav.sales")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {data?.count ?? 0} {t("sales.sale", { count: data?.count ?? 0, defaultValue: "ventes" })} enregistrées
          </p>
        </div>
        <Link to="/sales/new" className="btn-primary shadow-xs">
          <Plus size={16} className="stroke-[2.5]" />
          <span>Nouvelle vente</span>
        </Link>
      </div>

      {/* KPI strip */}
      {!isLoading && sales.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="flex items-center gap-3.5 px-4 py-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
              <TrendingUp size={18} />
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t("sales.page_revenue")}</div>
              <div className="font-mono font-extrabold text-lg text-slate-900 tracking-tight">
                {formatDZD(pageTotalRevenue)} <span className="text-xs text-slate-400 font-bold">DZD</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3.5 px-4 py-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center border border-primary-100 shrink-0">
              <ShoppingBag size={18} />
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t("sales.page_sales")}</div>
              <div className="font-mono font-extrabold text-lg text-slate-900 tracking-tight">
                {sales.filter((s) => s.status === "completed").length}
              </div>
            </div>
          </div>

          {partiallyPaidCount > 0 && (
            <div className="flex items-center gap-3.5 px-4 py-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 shrink-0">
                <Receipt size={18} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t("sales.in_installment")}</div>
                <div className="font-mono font-extrabold text-lg text-amber-700 tracking-tight">
                  {partiallyPaidCount}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5 items-end bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9 py-2 rounded-xl text-xs"
            placeholder={t("sales.search_receipt_cashier")}
          />
        </div>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="form-input max-w-[160px] py-2 rounded-xl text-xs font-medium"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-semibold whitespace-nowrap">{t("common.from")}</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="form-input text-xs py-2 rounded-xl font-medium"
          />
          <label className="text-xs text-slate-500 font-semibold">{t("common.to")}</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="form-input text-xs py-2 rounded-xl font-medium"
          />
        </div>

        {(search || status || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(1); }}
            className="btn-ghost btn-sm text-slate-500 hover:text-slate-900 font-semibold cursor-pointer"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden rounded-2xl border border-slate-200/80 shadow-xs bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("sales.receipt_no")}</th>
                <th>{t("common.date")}</th>
                <th>{t("sales.cashier")}</th>
                <th>{t("sales.client")}</th>
                <th>{t("sales.payment_methods")}</th>
                <th>{t("common.status")}</th>
                <th className="text-end">{t("common.total")}</th>
                <th className="text-end">{t("sales.balance_due")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
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
                      "cursor-pointer transition-colors",
                      sale.status === "cancelled" && "opacity-60",
                      expandedId === sale.id && "bg-primary-50/40"
                    )}
                    onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <Receipt size={14} className="text-slate-400 shrink-0" />
                        <span className="font-mono font-bold text-slate-900">{sale.receipt_number || `#${sale.id}`}</span>
                      </div>
                    </td>
                    <td className="text-slate-500 text-xs font-medium">{formatDate(sale.created_at)}</td>
                    <td className="text-xs font-semibold text-slate-700">{sale.cashier_name || "—"}</td>
                    <td className="text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-slate-800">{sale.client_name ?? (sale.client ? `#${sale.client}` : <span className="text-slate-400 italic font-normal">{t("sales.walk_in")}</span>)}</span>
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
                            {PAYMENT_METHOD_LABELS[p.method] ? t(PAYMENT_METHOD_LABELS[p.method]) : p.method}
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
                            <span className="inline-block px-1.5 py-0.5 rounded text-3xs font-black uppercase tracking-wider bg-red-100 text-red-700 border border-red-200">
                              Expirée
                            </span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded text-3xs font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                              Consignée
                            </span>
                          )}
                          {sale.layaway_expires_at && (
                            <p className={cn(
                              "text-2xs font-mono font-medium",
                              sale.is_layaway_expired ? "text-red-600 font-bold" : "text-indigo-600"
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
                            dueDays < 0 ? "text-red-600 font-semibold" : dueDays < 7 ? "text-amber-600" : "text-slate-500"
                          )}>
                            {dueDays < 0 ? t("sales.overdue_days", { days: Math.abs(dueDays) }) : t("sales.due_on", { date: sale.due_date })}
                          </p>
                        );
                      })()}
                    </td>
                    <td className="text-end font-mono font-bold text-slate-900 text-sm">
                      {formatDZD(sale.total_amount)}
                      <span className="text-2xs text-slate-400 ms-1 font-semibold">DZD</span>
                    </td>
                    <td className="text-end">
                      <span
                        className={cn(
                          "font-mono text-sm",
                          parseFloat(sale.balance_due || "0") > 0 ? "text-red-600 font-bold" : "text-slate-400"
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
                              title="Retirer les articles & solder la réservation"
                              onClick={() => setCollectLayawaySale(sale)}
                            >
                              <PackageCheck size={16} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                              title="Ajouter un acompte intermédiaire"
                              onClick={() => setAddPaymentSale(sale)}
                            >
                              <Plus size={15} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                              title="Annuler la réservation & libérer le stock"
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
                              title="Traiter un retour"
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
                              title="Ajouter un paiement"
                              onClick={() => setAddPaymentSale(sale)}
                            >
                              <Plus size={15} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                              title="Annuler le versement"
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
                    <tr key={`${sale.id}-detail`} className="bg-slate-50/60">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
                          <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">
                            Articles vendus ({sale.items?.length ?? 0})
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400 font-bold border-b border-slate-100">
                                <th className="text-start pb-2">{t("sales.item")}</th>
                                <th className="text-end pb-2">{t("sales.qty")}</th>
                                <th className="text-end pb-2">{t("sales.unit_price")}</th>
                                <th className="text-end pb-2">{t("sales.discount")}</th>
                                <th className="text-end pb-2">{t("sales.subtotal")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {(sale.items ?? []).map((item) => (
                                <tr key={item.id} className="text-slate-700">
                                  <td className="py-2 font-medium">{item.variant_str}</td>
                                  <td className="text-end font-mono font-bold">{item.quantity}</td>
                                  <td className="text-end font-mono">{formatDZD(item.unit_price)}</td>
                                  <td className="text-end font-mono text-slate-400">
                                    {parseFloat(item.discount_amount) > 0
                                      ? `-${formatDZD(item.discount_amount)}`
                                      : "—"}
                                  </td>
                                  <td className="text-end font-mono font-bold text-slate-900">
                                    {formatDZD(item.subtotal)} DZD
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-slate-200">
                                <td colSpan={4} className="text-end pt-3 text-xs font-bold text-slate-800">
                                  Total:
                                </td>
                                <td className="text-end pt-3 font-mono font-black text-sm text-primary-600">
                                  {formatDZD(sale.total_amount)} DZD
                                </td>
                              </tr>
                            </tfoot>
                          </table>

                          {/* Notes */}
                          {sale.notes && (
                            <div className="mt-3 text-xs text-slate-500 italic bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
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
    </div>
  );
}
