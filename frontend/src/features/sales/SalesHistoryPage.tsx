/**
 * Sales History Page — /sales
 * Paginated list of completed/cancelled sales with filters and receipt download.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Receipt, TrendingUp, ShoppingBag, Plus, Printer, RotateCcw, X, Star, Trophy, Medal, Ban, ArrowLeftRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import { printReceipt } from "@/lib/receipt";
import { printBonVersement } from "@/lib/versement";
import ExchangeModal from "./ExchangeModal";
import type { Sale, SaleItem, PaymentMethod, LoyaltyTier, DefectReason } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

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
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

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
    mutationFn: () =>
      api.post(`/sales/${sale.id}/returns/`, {
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
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["defects"] });
      queryClient.invalidateQueries({ queryKey: ["defect-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["variants"] });
      onClose();
    },
    onError: (err) => {
      setToast(getApiError(err));
    },
  });

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
              onClick={() => mutation.mutate()}
              className="btn-primary btn-sm"
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? t("common.processing") : t("sales.confirm_return")}
            </button>
          </div>
        </div>
      </div>
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

const STATUS_OPTIONS = [
  { value: "", labelKey: "status.all" },
  { value: "completed", labelKey: "status.completed" },
  { value: "partially_paid", labelKey: "status.partially_paid" },
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.sales")}</h1>
          <p className="text-sm text-text-muted">
            {data?.count ?? 0} {t("sales.sale", { count: data?.count ?? 0, defaultValue: "ventes" })}
          </p>
        </div>
        <Link to="/sales/new" className="btn-primary">
          <Plus size={16} />
          Nouvelle vente
        </Link>
      </div>

      {/* KPI strip */}
      {!isLoading && sales.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-success/10 rounded-lg border border-success/20">
            <TrendingUp size={16} className="text-success" />
            <span className="text-sm text-text-muted">{t("sales.page_revenue")}</span>
            <span className="font-mono font-semibold text-success">{formatDZD(pageTotalRevenue)} DZD</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-primary-50 rounded-lg border border-primary-200">
            <ShoppingBag size={16} className="text-primary-500" />
            <span className="text-sm text-text-muted">{t("sales.page_sales")}</span>
            <span className="font-mono font-semibold text-primary-600">{sales.filter((s) => s.status === "completed").length}</span>
          </div>
          {partiallyPaidCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-warning-light rounded-lg border border-warning/30">
              <Receipt size={16} className="text-warning" />
              <span className="text-sm text-text-muted">{t("sales.in_installment")}</span>
              <span className="font-mono font-semibold text-warning">{partiallyPaidCount}</span>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9"
            placeholder={t("sales.search_receipt_cashier")}
          />
        </div>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="form-input max-w-[160px]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted whitespace-nowrap">{t("common.from")}</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="form-input text-sm py-1.5"
          />
          <label className="text-xs text-text-muted">{t("common.to")}</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="form-input text-sm py-1.5"
          />
        </div>

        {(search || status || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(1); }}
            className="btn-ghost btn-sm text-text-muted"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
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
                  <td colSpan={9} className="text-center py-8 text-text-muted">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && sales.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-text-muted">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}

              {sales.map((sale) => (
                <>
                  <tr
                    key={sale.id}
                    className={cn(
                      "cursor-pointer",
                      sale.status === "cancelled" && "opacity-60",
                      expandedId === sale.id && "bg-primary-50/40"
                    )}
                    onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <Receipt size={14} className="text-text-muted flex-shrink-0" />
                        <span className="font-mono font-medium">{sale.receipt_number || `#${sale.id}`}</span>
                      </div>
                    </td>
                    <td className="text-text-muted text-sm">{formatDate(sale.created_at)}</td>
                    <td className="text-sm">{sale.cashier_name || "—"}</td>
                    <td className="text-sm">
                      <div className="flex flex-col gap-0.5">
                        <span>{sale.client_name ?? (sale.client ? `#${sale.client}` : <span className="text-text-muted italic">{t("sales.walk_in")}</span>)}</span>
                        {sale.loyalty_tier && (() => {
                          const { label, className, Icon } = TIER_CONFIG[sale.loyalty_tier];
                          return (
                            <span className="flex items-center gap-1">
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-2xs font-semibold ${className}`}>
                                <Icon size={9} />
                                {label}
                              </span>
                              <span className="text-2xs text-text-muted font-mono">
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
                      {sale.status === "partially_paid" && sale.due_date && (() => {
                        const dueMs = new Date(sale.due_date).getTime() - Date.now();
                        const dueDays = Math.ceil(dueMs / (1000 * 60 * 60 * 24));
                        return (
                          <p className={cn(
                            "text-2xs mt-0.5 font-mono",
                            dueDays < 0 ? "text-danger font-semibold" : dueDays < 7 ? "text-warning" : "text-text-muted"
                          )}>
                            {dueDays < 0 ? t("sales.overdue_days", { days: Math.abs(dueDays) }) : t("sales.due_on", { date: sale.due_date })}
                          </p>
                        );
                      })()}
                    </td>
                    <td className="text-end font-mono">
                      {formatDZD(sale.total_amount)}
                      <span className="text-2xs text-text-muted ms-1">DZD</span>
                    </td>
                    <td className="text-end">
                      <span
                        className={cn(
                          "font-mono text-sm",
                          parseFloat(sale.balance_due || "0") > 0 ? "text-danger font-semibold" : "text-text-muted"
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
                          className="btn-ghost btn-sm text-primary-500"
                          title={t("common.print")}
                          onClick={() =>
                            sale.status === "partially_paid"
                              ? printBonVersement(sale, storeName)
                              : printReceipt(sale, storeName)
                          }
                        >
                          <Printer size={14} />
                        </button>
                        {isManager && sale.status === "completed" && (
                          <>
                            <button
                              className="btn-ghost btn-sm text-warning"
                              title="Traiter un retour"
                              onClick={() => setReturnSale(sale)}
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              className="btn-ghost btn-sm text-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={
                                (sale.exchange_count ?? 0) >= 3
                                  ? t("sales.max_exchanges_reached")
                                  : t("sales.process_exchange")
                              }
                              disabled={(sale.exchange_count ?? 0) >= 3}
                              onClick={() => setExchangeSale(sale)}
                            >
                              <ArrowLeftRight size={14} />
                            </button>
                          </>
                        )}
                        {isManager && sale.status === "partially_paid" && (
                          <>
                            <button
                              className="btn-ghost btn-sm text-amber-600"
                              title="Ajouter un paiement"
                              onClick={() => setAddPaymentSale(sale)}
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              className="btn-ghost btn-sm text-danger"
                              title="Annuler le versement"
                              onClick={() => {
                                if (confirm(t("sales.cancel_versement_confirm", { receipt: sale.receipt_number }))) {
                                  cancelVersementMutation.mutate(sale.id);
                                }
                              }}
                              disabled={cancelVersementMutation.isPending}
                            >
                              <Ban size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded row: sale items */}
                  {expandedId === sale.id && (
                    <tr key={`${sale.id}-detail`} className="bg-primary-50/20">
                      <td colSpan={9} className="px-6 py-3">
                        <div className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">
                          Articles ({sale.items?.length ?? 0})
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-text-muted">
                              <th className="text-start pb-1 font-medium">{t("sales.item")}</th>
                              <th className="text-end pb-1 font-medium">{t("sales.qty")}</th>
                              <th className="text-end pb-1 font-medium">{t("sales.unit_price")}</th>
                              <th className="text-end pb-1 font-medium">{t("sales.discount")}</th>
                              <th className="text-end pb-1 font-medium">{t("sales.subtotal")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {(sale.items ?? []).map((item) => (
                              <tr key={item.id}>
                                <td className="py-1">{item.variant_str}</td>
                                <td className="text-end font-mono">{item.quantity}</td>
                                <td className="text-end font-mono">{formatDZD(item.unit_price)}</td>
                                <td className="text-end font-mono text-text-muted">
                                  {parseFloat(item.discount_amount) > 0
                                    ? `-${formatDZD(item.discount_amount)}`
                                    : "—"}
                                </td>
                                <td className="text-end font-mono font-medium">
                                  {formatDZD(item.subtotal)} DZD
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-border">
                              <td colSpan={4} className="text-end pt-2 text-sm font-semibold">
                                Total:
                              </td>
                              <td className="text-end pt-2 font-mono font-bold text-primary-600">
                                {formatDZD(sale.total_amount)} DZD
                              </td>
                            </tr>
                          </tfoot>
                        </table>

                        {/* Notes */}
                        {sale.notes && (
                          <div className="mt-2 text-xs text-text-muted italic">
                            Note: {sale.notes}
                          </div>
                        )}
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
    </div>
  );
}
