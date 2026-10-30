/**
 * SupplierDetailPage — /suppliers/:id
 *
 * Tabs:
 *   info      → Fiche fournisseur
 *   orders    → Commandes d'achat (POs)
 *   invoices  → Factures fournisseur
 *   payments  → Paiements
 */
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ShoppingBag, Plus, AlertCircle, Loader2,
  Phone, Mail, MapPin, Globe, FileText, CreditCard, X, Save, Pencil, FileDown,
  type LucideIcon,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Supplier, PurchaseOrder, SupplierInvoice, SupplierPayment } from "@/types";
import { cn } from "@/lib/utils";

// ── Status helpers ────────────────────────────────────────────────────────────

const getPOStatusLabels = (t: (key: string) => string): Record<string, string> => ({
  draft: t("supplier.draft"),
  sent: t("supplier.sent"),
  partial: t("supplier.partial"),
  received: t("supplier.received"),
  cancelled: t("supplier.cancelled"),
});

const PO_STATUS_BADGE: Record<string, string> = {
  draft: "badge-neutral",
  sent: "badge-info",
  partial: "badge-warning",
  received: "badge-success",
  cancelled: "badge",
};

// ── Info field helper ─────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="w-7 h-7 rounded bg-primary-50 dark:bg-primary-950/40 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={13} className="text-primary-500 dark:text-primary-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-muted">{label}</div>
        <div className="text-sm font-medium text-text-primary break-words">{value || "—"}</div>
      </div>
    </div>
  );
}

// ── Payment modal ─────────────────────────────────────────────────────────────

function PaymentModal({
  supplierId,
  onClose,
}: {
  supplierId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    amount: "",
    method: "virement" as "cash" | "cheque" | "virement",
    date: today,
    cheque_number: "",
    bank: "",
    notes: "",
  });
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/suppliers/payments/", {
        supplier: supplierId,
        ...form,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-payments", supplierId] });
      queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] });
      onClose();
    },
    onError: (err) => setErrMsg(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setErrMsg(t("client.amount_greater_than_0"));
      return;
    }
    setErrMsg(null);
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/60">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white font-sans">{t("supplier.record_supplier_payment_title")}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("supplier.payment_terms")}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errMsg && (
            <div className="text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl px-3.5 py-2.5 font-medium">
              {errMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("payment.amount")}</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="form-input bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white rounded-xl shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
              placeholder="0.00"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("payment.method")}</label>
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "cheque", "virement"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, method: m }))}
                  className={cn(
                    "px-3 py-2 rounded-xl border text-xs font-semibold transition-all capitalize cursor-pointer",
                    form.method === m
                      ? "border-primary-500 bg-primary-50/80 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300 shadow-2xs"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                  )}
                >
                  {m === "cash" ? t("payment.cash") : m === "cheque" ? t("payment.cheque") : t("payment.transfer")}
                </button>
              ))}
            </div>
          </div>

          {form.method === "cheque" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("cheque.number")}</label>
                <input
                  type="text"
                  value={form.cheque_number}
                  onChange={(e) => setForm((f) => ({ ...f, cheque_number: e.target.value }))}
                  className="form-input bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white rounded-xl shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                  placeholder="CHQ-123456"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("cheque.bank")}</label>
                <input
                  type="text"
                  value={form.bank}
                  onChange={(e) => setForm((f) => ({ ...f, bank: e.target.value }))}
                  className="form-input bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white rounded-xl shadow-2xs focus:ring-primary-500/20 text-xs"
                  placeholder="BNA, CPA..."
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("common.date")} *</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="form-input bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white rounded-xl shadow-2xs focus:ring-primary-500/20 text-xs"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("common.notes")}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="form-input bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 dark:text-white rounded-xl shadow-2xs focus:ring-primary-500/20 text-xs resize-none"
              rows={2}
              placeholder={t("client.reference_comment")}
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={onClose} className="btn-secondary rounded-xl">{t("common.cancel")}</button>
            <button type="submit" className="btn-primary rounded-xl shadow-xs shadow-primary-500/20" disabled={mutation.isPending}>
              {mutation.isPending ? <><Loader2 size={14} className="animate-spin" /> {t("common.saving")}</> : <><Save size={14} /> {t("common.save")}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab: Info ─────────────────────────────────────────────────────────────────

function InfoTab({ supplier }: { supplier: Supplier }) {
  const { t } = useTranslation();
  const balance = parseFloat(supplier.outstanding_balance);

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/60">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-sans">{t("client.general_info")}</h3>
        </div>
        <div className="px-5 divide-y divide-slate-100 dark:divide-slate-800">
          <InfoRow icon={Phone} label={t("supplier.phone")} value={supplier.phone} />
          <InfoRow icon={Mail} label={t("supplier.email")} value={supplier.email} />
          <InfoRow icon={MapPin} label={t("supplier.address")} value={supplier.address} />
          <InfoRow icon={Globe} label={t("supplier.origin_country")} value={supplier.origin_country} />
          <InfoRow icon={FileText} label={t("supplier.payment_terms")} value={supplier.payment_terms} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-6">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t("supplier.supplier_balance_due")}</p>
          <p className={cn("text-3xl font-bold font-mono tabular-nums tracking-tight", balance > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
            {formatDZD(supplier.outstanding_balance)}{" "}
            <span className="text-sm font-normal text-slate-400 dark:text-slate-500">DZD</span>
          </p>
        </div>

        {supplier.notes && (
          <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-6 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">{t("common.notes")}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{supplier.notes}</p>
          </div>
        )}

        <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t("supplier.supplier_since")}{" "}
              {new Date(supplier.created_at).toLocaleDateString("fr-DZ", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
              supplier.is_active
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", supplier.is_active ? "bg-emerald-500" : "bg-slate-400")} />
            {supplier.is_active ? t("common.active") : t("common.inactive")}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Purchase Orders ──────────────────────────────────────────────────────

function OrdersTab({ supplierId }: { supplierId: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<PurchaseOrder>>({
    queryKey: ["supplier-orders", supplierId, page],
    queryFn: () =>
      api.get(`/suppliers/purchase-orders/?supplier=${supplierId}&page=${page}`).then((r) => r.data),
  });

  const orders = data?.results ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to={`/purchase-orders/new?supplier=${supplierId}`} className="btn-primary btn-sm">
          <Plus size={14} />{t("supplier.new_order")}</Link>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("supplier.reference")}</th>
                <th>{t("supplier.expected_date")}</th>
                <th>{t("supplier.status")}</th>
                <th className="text-end">{t("common.total")}</th>
                <th className="text-end">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="text-center py-8 text-text-muted">{t("common.loading")}</td></tr>
              )}
              {!isLoading && orders.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-text-muted">{t("common.no_data")}</td></tr>
              )}
              {orders.map((po) => (
                <tr key={po.id}>
                  <td>
                    {po.reference ? (
                      <span className="font-medium text-text-primary">{po.reference}</span>
                    ) : (
                      <span className="text-text-muted text-xs italic">{t("supplier.unspecified_reference")}</span>
                    )}
                  </td>
                  <td className="text-text-muted">{po.expected_date ? formatDate(po.expected_date) : "—"}</td>
                  <td>
                    <span className={cn("badge", PO_STATUS_BADGE[po.status])}>
                      {getPOStatusLabels(t)[po.status] ?? po.status}
                    </span>
                  </td>
                  <td className="text-end font-mono text-sm">{formatDZD(po.total_amount)} DZD</td>
                  <td className="text-end">
                    <Link to={`/purchase-orders/${po.id}`} className="btn-ghost btn-sm text-primary-500">
                      {t("common.view")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex gap-2 justify-end">
            <button onClick={() => setPage(page - 1)} disabled={!data.previous} className="btn-secondary btn-sm">{t("common.previous")}</button>
            <button onClick={() => setPage(page + 1)} disabled={!data.next} className="btn-secondary btn-sm">{t("common.next")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Supplier Invoices ────────────────────────────────────────────────────

function InvoicesTab({ supplierId }: { supplierId: number }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<PaginatedResponse<SupplierInvoice>>({
    queryKey: ["supplier-invoices", supplierId],
    queryFn: () =>
      api.get(`/suppliers/invoices/?supplier=${supplierId}`).then((r) => r.data),
  });
  const invoices = data?.results ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("invoice.number")}</th>
              <th>{t("common.date")}</th>
              <th>{t("invoice.due_date")}</th>
              <th>{t("invoice.linked_invoice", "Commande liée")}</th>
              <th className="text-end">{t("payment.amount")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-8 text-text-muted">{t("common.loading")}</td></tr>
            )}
            {!isLoading && invoices.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-text-muted">{t("common.no_data")}</td></tr>
            )}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="font-mono font-medium">{inv.invoice_number}</td>
                <td className="text-text-muted">{formatDate(inv.date)}</td>
                <td className="text-text-muted">{formatDate(inv.due_date)}</td>
                <td>
                  {inv.purchase_order ? (
                    <Link to={`/purchase-orders/${inv.purchase_order}`} className="text-primary-500 hover:underline text-sm font-mono">
                      #{inv.purchase_order}
                    </Link>
                  ) : "—"}
                </td>
                <td className="text-end font-mono text-sm">{formatDZD(inv.total_amount)} DZD</td>
                <td>
                  <a
                    href={`/api/v1/suppliers/invoices/${inv.id}/pdf/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost btn-sm flex items-center gap-1 text-text-muted hover:text-primary-500"
                    title={t("invoice.download_pdf")}
                  >
                    <FileDown size={14} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Payments ─────────────────────────────────────────────────────────────

function PaymentsTab({
  supplierId,
  onNewPayment,
}: {
  supplierId: number;
  onNewPayment: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<PaginatedResponse<SupplierPayment>>({
    queryKey: ["supplier-payments", supplierId],
    queryFn: () =>
      api.get(`/suppliers/payments/?supplier=${supplierId}`).then((r) => r.data),
  });
  const payments = data?.results ?? [];

  const METHOD_LABELS: Record<string, string> = {
    cash: t("payment.cash"),
    cheque: t("payment.cheque"),
    virement: t("payment.transfer"),
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={onNewPayment} className="btn-primary btn-sm">
          <Plus size={14} />
          {t("supplier.record_payment")}
        </button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("payment.method")}</th>
                <th>{t("supplier.reference")}</th>
                <th className="text-end">{t("payment.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} className="text-center py-8 text-text-muted">{t("common.loading")}</td></tr>
              )}
              {!isLoading && payments.length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-text-muted">{t("common.no_data")}</td></tr>
              )}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="text-text-muted">{formatDate(p.date)}</td>
                  <td>
                    <span className="badge badge-neutral">{METHOD_LABELS[p.method] ?? p.method}</span>
                  </td>
                  <td className="text-sm text-text-muted">
                    {p.cheque_number || p.notes || "—"}
                  </td>
                  <td className="text-end font-mono text-sm text-success font-medium">
                    {formatDZD(p.amount)} DZD
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

type Tab = "info" | "orders" | "invoices" | "payments";

export default function SupplierDetailPage() {
  const { t } = useTranslation();
  const tabs: { key: Tab; label: string }[] = [
    { key: "info", label: t("supplier.info_tab") },
    { key: "orders", label: t("supplier.orders_tab") },
    { key: "invoices", label: t("supplier.invoices_tab") },
    { key: "payments", label: t("supplier.payments_tab") },
  ];
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const supplierId = id;
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [showPayment, setShowPayment] = useState(false);

  const { data: supplier, isLoading, isError } = useQuery<Supplier>({
    queryKey: ["supplier", supplierId],
    queryFn: () => api.get(`/suppliers/${supplierId}/`).then((r) => r.data),
    enabled: Boolean(supplierId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">{t("common.loading")}</span>
      </div>
    );
  }

  if (isError || !supplier) {
    return (
      <div className="card px-6 py-10 text-center space-y-3">
        <AlertCircle size={32} className="text-danger mx-auto" />
        <p className="font-semibold text-text-primary">{t("supplier.supplier_not_found")}</p>
        <button onClick={() => navigate("/suppliers")} className="btn-secondary">
          {t("supplier.back_to_list")}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/suppliers")}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white">{supplier.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                    supplier.is_active
                      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", supplier.is_active ? "bg-emerald-500" : "bg-slate-400")} />
                  {supplier.is_active ? t("common.active") : t("common.inactive")}
                </span>
                {supplier.origin_country && (
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-700">
                    {supplier.origin_country}
                  </span>
                )}
                {supplier.contact_name && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">· {supplier.contact_name}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <Link
              to={`/suppliers/${supplierId}/edit`}
              className="btn-secondary rounded-xl"
            >
              <Pencil size={15} />
              {t("common.edit")}
            </Link>
            <Link
              to={`/purchase-orders/new?supplier=${supplierId}`}
              className="btn-secondary rounded-xl"
            >
              <ShoppingBag size={15} />
              {t("supplier.new_order")}
            </Link>
            <button onClick={() => setShowPayment(true)} className="btn-primary rounded-xl shadow-xs shadow-primary-500/20 cursor-pointer">
              <CreditCard size={15} />
              {t("supplier.record_payment")}
            </button>
          </div>
        </div>

        {/* Segmented Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 dark:bg-slate-800/80 rounded-xl max-w-fit overflow-x-auto border border-slate-200/80 dark:border-slate-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer",
                activeTab === tab.key
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === "info" && <InfoTab supplier={supplier} />}
        {activeTab === "orders" && <OrdersTab supplierId={supplierId} />}
        {activeTab === "invoices" && <InvoicesTab supplierId={supplierId} />}
        {activeTab === "payments" && (
          <PaymentsTab supplierId={supplierId} onNewPayment={() => setShowPayment(true)} />
        )}
      </div>

      {showPayment && (
        <PaymentModal supplierId={supplierId} onClose={() => setShowPayment(false)} />
      )}
    </>
  );
}
