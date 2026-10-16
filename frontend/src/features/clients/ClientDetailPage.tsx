/**
 * ClientDetailPage — /clients/:id
 *
 * Tabs:
 *   "info"     → Fiche client (card with all client fields)
 *   "ledger"   → Relevé de compte (paginated ledger table)
 *   "cheques"  → Chèques liés au client
 *   "invoices" → Factures du client
 *
 * Payment modal: POST /clients/clients/{id}/payment/
 */
import { useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  MessageCircle,
  CreditCard,
  AlertCircle,
  FileText,
  CheckCircle,
  XCircle,
  User,
  Phone,
  Mail,
  MapPin,
  Building2,
  X,
  Pencil,
  Gift,
  Trophy,
  Star,
  Medal,
  TrendingUp,
  Search,
  type LucideIcon,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Client, ClientLedgerEntry, Cheque, Invoice, LoyaltyAccount, LoyaltyTransaction } from "@/types";
import { cn, whatsappLink, getStatusBadgeClass } from "@/lib/utils";
import { wilayaLabel } from "@/lib/wilayas";
import { useAuth } from "@/features/auth/AuthContext";
import { usePlan } from "@/hooks/usePlan";
import i18n from "@/lib/i18n";
const t = i18n.t.bind(i18n);

// ── Types ──────────────────────────────────────────────────────────────────

type ActiveTab = "info" | "ledger" | "cheques" | "invoices" | "loyalty";

interface PaymentFormState {
  amount: string;
  method: "cash" | "ccp" | "virement" | "cheque";
  notes: string;
  date: string;
  invoice_id?: string;
}

// PAYMENT_METHODS populated dynamically

// Tabs definition
const TABS = [
  { key: "info", label: "Informations" },
  { key: "ledger", label: "Grand Livre" },
  { key: "cheques", label: "Chèques" },
  { key: "invoices", label: "Factures" },
  { key: "loyalty", label: "Fidélité" },
];
// ── Info Field helper ──────────────────────────────────────────────────────

function InfoField({
  icon: Icon,
  label,
  value,
  mono = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="w-8 h-8 rounded-md bg-primary-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={15} className="text-primary-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-muted mb-0.5">{label}</div>
        <div className={cn("text-sm font-medium text-text-primary break-words", mono && "font-mono", className)}>
          {value || "—"}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className="h-4 bg-border rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

// ── Payment Modal ──────────────────────────────────────────────────────────

function PaymentModal({
  clientId,
  clientName,
  onClose,
}: {
  clientId: number;
  clientName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState<PaymentFormState>({
    amount: "",
    method: "cash",
    notes: "",
    date: today,
    invoice_id: "",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch open invoices for target selection
  const { data: openInvoices = [] } = useQuery<Invoice[]>({
    queryKey: ["client-open-invoices", clientId],
    queryFn: () =>
      api.get(`/invoicing/invoices/?client_id=${clientId}`).then((r) => {
        const list = Array.isArray(r.data) ? r.data : r.data.results ?? [];
        return list.filter((inv: Invoice) => inv.status === "sent" || inv.status === "partial" || inv.status === "overdue");
      }),
  });

  const mutation = useMutation({
    mutationFn: (payload: PaymentFormState) =>
      api
        .post(`/clients/${clientId}/record-payment/`, {
          amount: payload.amount,
          method: payload.method,
          notes: payload.notes,
          date: payload.date,
          invoice_id: payload.invoice_id || undefined,
        })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client", clientId] });
      queryClient.invalidateQueries({ queryKey: ["client-ledger", clientId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      onClose();
    },
    onError: (error) => {
      setErrorMsg(getApiError(error));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setErrorMsg(t("client.amount_greater_than_0"));
      return;
    }
    mutation.mutate(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/60">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-sans">{t("payment.record")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{clientName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Target Invoice (optional) */}
          {openInvoices.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("payment.target_invoice", "Facture concernée (optionnel)")}</label>
              <select
                value={form.invoice_id || ""}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const targetInv = openInvoices.find((i) => String(i.id) === selectedId);
                  setForm((f) => ({
                    ...f,
                    invoice_id: selectedId,
                    amount: targetInv ? String(targetInv.balance_due) : f.amount,
                  }));
                }}
                className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
              >
                <option value="">{t("payment.all_open_invoices", "Toutes les factures en cours (par ancienneté)")}</option>
                {openInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    Facture #{inv.number || inv.id} — {formatDZD(inv.balance_due)} DZD restant
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("payment.amount")}</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
              placeholder="0.00"
              required
              autoFocus
            />
          </div>

          {/* Method */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("payment.method")}</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ key: "cash", label: t("payment.cash") }, { key: "ccp", label: t("payment.ccp") }, { key: "virement", label: t("payment.transfer") }, { key: "cheque", label: t("payment.cheque") }].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, method: m.key as any }))}
                  className={cn(
                    "px-3 py-2 rounded-xl border text-xs font-semibold transition-all",
                    form.method === m.key
                      ? "border-primary-500 bg-primary-50/80 text-primary-700 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("common.date")}</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
              required
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notes & Référence</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs resize-none"
              rows={2}
              placeholder={t("client.reference_comment")}
            />
          </div>

          {/* Error */}
          {errorMsg && (
            <div className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 font-medium">
              <AlertCircle size={15} className="shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="btn-secondary rounded-xl">
              Annuler
            </button>
            <button
              type="submit"
              className="btn-primary rounded-xl shadow-xs shadow-primary-500/20"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Enregistrement..." : "Confirmer le paiement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab: Fiche client ──────────────────────────────────────────────────────

function ClientInfoTab({
  client,
  onPayment,
}: {
  client: Client;
  onPayment: () => void;
}) {
  const { t } = useTranslation();
  const balance = parseFloat(client.cached_balance);
  const creditLimit = parseFloat(client.credit_limit);
  const isOverLimit = client.is_over_credit_limit;

  const whatsappMsg = `Bonjour ${client.name}, votre solde est de ${formatDZD(client.cached_balance)} DZD`;

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      {/* Left: Details */}
      <div className="card rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-sans">{t("client.general_info")}</h3>
        </div>
        <div className="px-5 divide-y divide-slate-100">
          <InfoField icon={User} label="Nom complet" value={client.name} />
          <InfoField
            icon={Phone}
            label={t("client.phone_label")}
            value={
              client.phone ? (
                <a
                  href={whatsappLink(client.phone, whatsappMsg)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 hover:underline font-mono"
                >
                  <MessageCircle size={13} />
                  {client.phone}
                </a>
              ) : null
            }
          />
          <InfoField icon={Mail} label={t("client.email")} value={client.email} mono />
          <InfoField icon={MapPin} label={t("client.address")} value={client.address} />
          <InfoField icon={MapPin} label="Wilaya" value={wilayaLabel(client.wilaya)} />
          <InfoField icon={Building2} label="NIF" value={client.nif} mono />
          <InfoField icon={Building2} label="RC" value={client.rc} mono />
        </div>
      </div>

      {/* Right: Financial */}
      <div className="space-y-4">
        {/* Balance card */}
        <div className={cn(
          "card rounded-2xl border bg-white shadow-xs p-6 space-y-4",
          isOverLimit ? "border-rose-400 ring-2 ring-rose-500/10" : "border-slate-200/80"
        )}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Solde actuel</span>
            {isOverLimit && (
              <div className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-bold border border-rose-200">
                <AlertCircle size={12} />
                Limite dépassée
              </div>
            )}
          </div>

          <div
            className={cn(
              "text-3xl font-bold font-mono tabular-nums tracking-tight",
              isOverLimit
                ? "text-rose-600"
                : balance > 0
                ? "text-amber-600"
                : "text-emerald-600"
            )}
          >
            {formatDZD(client.cached_balance)} <span className="text-sm font-normal text-slate-400">DZD</span>
          </div>

          {creditLimit > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xs text-slate-500">
                <span className="font-medium">{t("client.credit_limit")}</span>
                <span className="font-mono font-semibold text-slate-700">
                  {formatDZD(client.credit_limit)} DZD
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all duration-300",
                    isOverLimit ? "bg-rose-500" : balance / creditLimit > 0.8 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{
                    width: `${Math.min((balance / creditLimit) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          <button onClick={onPayment} className="btn-primary w-full rounded-xl shadow-xs shadow-primary-500/20 py-2.5">
            <CreditCard size={15} />
            Enregistrer paiement
          </button>
        </div>

        {/* Status card */}
        <div className="card rounded-2xl border border-slate-200/80 bg-white shadow-xs p-6 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Statut du compte</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                client.is_active
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-slate-100 text-slate-600 border border-slate-200"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", client.is_active ? "bg-emerald-500" : "bg-slate-400")} />
              {client.is_active ? "Actif" : "Inactif"}
            </span>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <span className="text-xs font-semibold text-slate-600">Type de client</span>
            <span className={cn(
              "text-2xs font-semibold px-2.5 py-0.5 rounded-full border",
              client.client_type === "wholesale"
                ? "bg-purple-50 text-purple-700 border-purple-200"
                : "bg-blue-50 text-blue-700 border-blue-200"
            )}>
              {client.client_type === "wholesale" ? t("client.wholesale_full") : t("client.retail_full")}
            </span>
          </div>
          {client.notes && (
            <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
              {client.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Relevé de compte ──────────────────────────────────────────────────

function LedgerTab({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  
  const search = searchParams.get("search") || "";
  const type = searchParams.get("type") || "";
  const fromDate = searchParams.get("from") || "";
  const toDate = searchParams.get("to") || "";

  const { data, isLoading } = useQuery<PaginatedResponse<ClientLedgerEntry>>({
    queryKey: ["client-ledger", clientId, page, search, type, fromDate, toDate],
    queryFn: () =>
      api
        .get(`/clients/${clientId}/ledger/`, {
          params: { page, search, type, from: fromDate, to: toDate }
        })
        .then((r) => r.data),
  });

  const entries = data?.results ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="card p-4 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-text-muted mb-1 block">Recherche</label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Description ou référence..."
              className="form-input pl-9 w-full"
              value={search}
              onChange={(e) => {
                setSearchParams((prev) => {
                  if (e.target.value) prev.set("search", e.target.value);
                  else prev.delete("search");
                  return prev;
                });
                setPage(1);
              }}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-text-muted mb-1 block">Type</label>
          <select
            className="form-input w-full md:w-auto"
            value={type}
            onChange={(e) => {
              setSearchParams((prev) => {
                if (e.target.value) prev.set("type", e.target.value);
                else prev.delete("type");
                return prev;
              });
              setPage(1);
            }}
          >
            <option value="">Tous</option>
            <option value="debit">Débits (Factures)</option>
            <option value="credit">Crédits (Paiements)</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-text-muted mb-1 block">Du</label>
          <input
            type="date"
            className="form-input w-full md:w-auto"
            value={fromDate}
            onChange={(e) => {
              setSearchParams((prev) => {
                if (e.target.value) prev.set("from", e.target.value);
                else prev.delete("from");
                return prev;
              });
              setPage(1);
            }}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text-muted mb-1 block">Au</label>
          <input
            type="date"
            className="form-input w-full md:w-auto"
            value={toDate}
            onChange={(e) => {
              setSearchParams((prev) => {
                if (e.target.value) prev.set("to", e.target.value);
                else prev.delete("to");
                return prev;
              });
              setPage(1);
            }}
          />
        </div>
      </div>

    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("common.date")}</th>
              <th>Description</th>
              <th>{t("client.reference")}</th>
              <th className="text-end">Débit</th>
              <th className="text-end">Crédit</th>
              <th className="text-end">Solde</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}

            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-text-muted">
                  Aucune écriture trouvée.
                </td>
              </tr>
            )}

            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="text-text-muted whitespace-nowrap">
                  {formatDate(entry.date)}
                </td>
                <td className="max-w-xs truncate">{entry.description || "—"}</td>
                <td>
                  {entry.reference_type === "Invoice" && entry.reference_id ? (
                    <Link 
                      to={`/invoices/${entry.reference_id}/edit`} 
                      className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                      title="Ouvrir la facture"
                    >
                      <FileText size={14} />
                      <span className="font-mono text-xs">FA-{entry.reference_id.substring(0,8)}</span>
                    </Link>
                  ) : entry.reference_type && entry.reference_id ? (
                    <div className="inline-flex items-center gap-1 text-text-muted" title={entry.reference_type}>
                      <CreditCard size={14} />
                      <span className="font-mono text-xs">
                        {entry.reference_type === 'InvoicePayment' ? 'PMT' : entry.reference_type.substring(0,3).toUpperCase()}-{entry.reference_id.substring(0,8)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="text-end font-mono">
                  {entry.entry_type === "debit" ? (
                    <span className="text-danger font-medium">
                      {formatDZD(entry.amount)} DZD
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="text-end font-mono">
                  {entry.entry_type === "credit" ? (
                    <span className="text-success font-medium">
                      {formatDZD(entry.amount)} DZD
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="text-end font-mono font-medium">
                  <span
                    className={cn(
                      parseFloat(entry.balance_after) > 0 ? "text-warning" : "text-success"
                    )}
                  >
                    {formatDZD(entry.balance_after)} DZD
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total_pages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
              {t("client.page_info_entries", { current: data.current_page, total: data.total_pages, count: data.count })}
            </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={!data.previous}
              className="btn-secondary btn-sm"
            >
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.next}
              className="btn-secondary btn-sm"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// ── Tab: Chèques ───────────────────────────────────────────────────────────

function ChequesTab({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PaginatedResponse<Cheque>>({
    queryKey: ["client-cheques", clientId],
    queryFn: () =>
      api
        .get(`/clients/cheques/?client=${clientId}&ordering=due_date`)
        .then((r) => r.data),
  });

  const depositMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/clients/cheques/${id}/mark-deposited/`).then((r) => r.data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["client-cheques", clientId] }),
  });

  const bounceMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/clients/cheques/${id}/mark-bounced/`).then((r) => r.data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["client-cheques", clientId] }),
  });

  const cheques = data?.results ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Banque</th>
              <th>Échéance</th>
              <th>Délai</th>
              <th className="text-end">Montant</th>
              <th>{t("common.status")}</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}

            {!isLoading && cheques.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-text-muted">
                  Aucun chèque trouvé pour ce client.
                </td>
              </tr>
            )}

            {cheques.map((cheque) => (
              <tr key={cheque.id}>
                <td className="font-mono font-medium">{cheque.number}</td>
                <td className="text-text-muted">{cheque.bank || "—"}</td>
                <td>{formatDate(cheque.due_date)}</td>
                <td>
                  {cheque.status === "pending" && (
                    <span
                      className={cn(
                        "badge",
                        cheque.days_until_due <= 0
                          ? "badge-danger"
                          : cheque.days_until_due <= 3
                          ? "badge-warning"
                          : "badge-info"
                      )}
                    >
                      {cheque.days_until_due <= 0 ? "Échu" : `J-${cheque.days_until_due}`}
                    </span>
                  )}
                </td>
                <td className="text-end font-mono font-medium">
                  {formatDZD(cheque.amount)} DZD
                </td>
                <td>
                  <span className={cn("badge", getStatusBadgeClass(cheque.status))}>
                    {cheque.status}
                  </span>
                </td>
                <td>
                  {cheque.status === "pending" && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => depositMutation.mutate(cheque.id)}
                        className="btn-ghost btn-sm text-success"
                        title={t("client.mark_deposited_title")}
                        disabled={depositMutation.isPending}
                      >
                        <CheckCircle size={14} />
                      </button>
                      <button
                        onClick={() => bounceMutation.mutate(cheque.id)}
                        className="btn-ghost btn-sm text-danger"
                        title={t("client.mark_bounced_title")}
                        disabled={bounceMutation.isPending}
                      >
                        <XCircle size={14} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Factures ──────────────────────────────────────────────────────────

function InvoicesTab({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<Invoice>>({
    queryKey: ["client-invoices", clientId, page],
    queryFn: () =>
      api
        .get(`/invoicing/invoices/?client=${clientId}&page=${page}`)
        .then((r) => r.data),
  });

  const invoices = data?.results ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>{t("common.date")}</th>
              <th>Échéance</th>
              <th>{t("common.status")}</th>
              <th className="text-end">Total TTC</th>
              <th className="text-end">Reste dû</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}

            {!isLoading && invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-text-muted">
                  Aucune facture trouvée pour ce client.
                </td>
              </tr>
            )}

            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <FileText size={13} className="text-text-muted flex-shrink-0" />
                    <span className="font-mono font-medium">
                      {invoice.number || `#${invoice.id}`}
                    </span>
                  </div>
                </td>
                <td className="text-text-muted whitespace-nowrap">
                  {formatDate(invoice.date)}
                </td>
                <td>
                  <span
                    className={cn(
                      "text-sm",
                      invoice.status === "overdue"
                        ? "text-danger font-medium"
                        : "text-text-muted"
                    )}
                  >
                    {formatDate(invoice.due_date)}
                  </span>
                </td>
                <td>
                  <span className={cn("badge", getStatusBadgeClass(invoice.status))}>
                    {invoice.status}
                  </span>
                </td>
                <td className="text-end font-mono">
                  {formatDZD(invoice.total_ttc)}{" "}
                  <span className="text-2xs text-text-muted">DZD</span>
                </td>
                <td className="text-end">
                  <span
                    className={cn(
                      "font-mono font-medium",
                      parseFloat(invoice.balance_due) > 0 ? "text-danger" : "text-success"
                    )}
                  >
                    {formatDZD(invoice.balance_due)} DZD
                  </span>
                </td>
                <td>
                  <a
                    href={`/api/v1/invoicing/invoices/${invoice.id}/pdf/`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost btn-sm text-primary-500"
                    title={t("client.download_pdf")}
                  >
                    PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total_pages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            Page {data.current_page} / {data.total_pages} · {data.count} factures
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={!data.previous}
              className="btn-secondary btn-sm"
            >
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.next}
              className="btn-secondary btn-sm"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Loyalty Tab ───────────────────────────────────────────────────────────

const TIER_CONFIG = {
  bronze: { label: "Bronze", colour: "text-amber-700 bg-amber-50 border-amber-200", icon: Medal, bar: "bg-amber-500" },
  silver: { label: "Argent", colour: "text-slate-600 bg-slate-50 border-slate-200", icon: Star, bar: "bg-slate-500" },
  gold: { label: "Or", colour: "text-yellow-700 bg-yellow-50 border-yellow-300", icon: Trophy, bar: "bg-yellow-500" },
} as const;

const TX_CONFIG: Record<string, { label: string; colour: string }> = {
  earn:   { label: "Gain",          colour: "text-success" },
  redeem: { label: "Rachat",        colour: "text-primary-600" },
  adjust: { label: "Ajustement",    colour: "text-text-muted" },
  expire: { label: "Expiration",    colour: "text-danger" },
};

function LoyaltyTab({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isManager = user?.role === "owner" || user?.role === "manager";

  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustToast, setAdjustToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { data: account, isLoading, isError } = useQuery<LoyaltyAccount>({
    queryKey: ["loyalty-account", clientId],
    queryFn: () =>
      api.get(`/loyalty/accounts/by-client/?client_id=${clientId}`).then((r) => {
        // by-client returns summary; fetch full account with transactions
        return api.get(`/loyalty/accounts/${r.data.id}/`).then((r2) => r2.data);
      }),
    retry: 1,
  });

  const adjustMutation = useMutation({
    mutationFn: () =>
      api.post(`/loyalty/accounts/${account!.id}/adjust/`, {
        points: parseInt(adjustPoints),
        description: adjustNote || "Ajustement manuel",
      }).then((r) => r.data),
    onSuccess: () => {
      setAdjustToast({ msg: t("client.adjustment_recorded"), type: "success" });
      setAdjustPoints("");
      setAdjustNote("");
      qc.invalidateQueries({ queryKey: ["loyalty-account", clientId] });
    },
    onError: (err) => setAdjustToast({ msg: getApiError(err), type: "error" }),
  });

  if (isLoading) {
    return (
      <div className="card p-6 space-y-3 animate-pulse">
        <div className="h-20 bg-border rounded-xl" />
        <div className="h-40 bg-border rounded-xl" />
      </div>
    );
  }

  if (isError || !account) {
    return (
      <div className="card p-8 text-center">
        <Gift size={36} className="mx-auto text-text-muted mb-3 opacity-40" />
        <p className="text-sm font-medium text-text-primary">{t("client.no_loyalty_account")}</p>
        <p className="text-xs text-text-muted mt-1">
          Un compte est créé automatiquement lors de sa première vente avec un programme de fidélité actif.
        </p>
      </div>
    );
  }

  const tierCfg = TIER_CONFIG[account.tier];
  const TierIcon = tierCfg.icon;
  const nextTierPts = account.points_to_next_tier;
  const progressPct = nextTierPts
    ? Math.round(((account.total_earned % (account.total_earned + nextTierPts)) / (account.total_earned + nextTierPts)) * 100)
    : 100;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center border-2", tierCfg.colour)}>
            <TierIcon size={26} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("text-xs font-bold px-2.5 py-0.5 rounded-full border", tierCfg.colour)}>
                {tierCfg.label}
              </span>
              {account.next_tier && (
                <span className="text-xs text-text-muted">
                  → {TIER_CONFIG[account.next_tier as keyof typeof TIER_CONFIG]?.label}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-text-primary">
              {account.points_balance.toLocaleString()} pts
            </p>
            <p className="text-xs text-text-muted">{t("client.total_pts_earned", { pts: account.total_earned.toLocaleString() })}</p>
          </div>
          {account.next_tier && nextTierPts && (
            <div className="text-right text-xs text-text-muted">
              <p className="font-medium text-text-primary">{nextTierPts.toLocaleString()} pts</p>
              <p>pour passer {TIER_CONFIG[account.next_tier as keyof typeof TIER_CONFIG]?.label}</p>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {account.next_tier && (
          <div className="mt-4">
            <div className="h-2 bg-border rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", tierCfg.bar)}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-2xs text-text-muted">
              <span>{account.tier}</span>
              <span>{account.next_tier}</span>
            </div>
          </div>
        )}
      </div>

      {/* Manual adjustment (manager+) */}
      {isManager && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <TrendingUp size={15} />
            Ajustement manuel
          </h3>
          {adjustToast && (
            <div className={cn(
              "mb-3 rounded-lg px-3 py-2 text-xs font-medium",
              adjustToast.type === "success" ? "bg-success-light text-success" : "bg-danger-light text-danger"
            )}>
              {adjustToast.msg}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="number"
              value={adjustPoints}
              onChange={(e) => setAdjustPoints(e.target.value)}
              placeholder="Points (ex: +100 ou -50)"
              className="form-input flex-1 text-sm"
            />
            <input
              type="text"
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              placeholder="Motif (optionnel)"
              className="form-input flex-1 text-sm"
            />
            <button
              onClick={() => adjustMutation.mutate()}
              disabled={!adjustPoints || adjustMutation.isPending}
              className="btn-primary btn-sm"
            >
              Appliquer
            </button>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Historique des points</h3>
        </div>
        {account.transactions.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-muted">Aucune transaction.</div>
        ) : (
          <div className="divide-y divide-border">
            {account.transactions.map((tx: LoyaltyTransaction) => {
              const cfg = TX_CONFIG[tx.transaction_type] ?? { label: tx.transaction_type, colour: "" };
              return (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={cn(
                    "text-sm font-bold font-mono w-16 text-right flex-shrink-0",
                    tx.points > 0 ? "text-success" : "text-danger"
                  )}>
                    {tx.points > 0 ? "+" : ""}{tx.points}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{tx.description || cfg.label}</p>
                    <p className="text-xs text-text-muted">{formatDate(tx.created_at)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-text-muted">Solde</p>
                    <p className="text-sm font-mono font-medium">{tx.balance_after.toLocaleString()}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clientId = id;
  const { canAccess } = usePlan();
  const hasLoyalty = canAccess("pro_retail");

  const [activeTab, setActiveTab] = useState<ActiveTab>("info");
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const { data: client, isLoading, isError } = useQuery<Client>({
    queryKey: ["client", clientId],
    queryFn: () =>
      api.get(`/clients/${clientId}/`).then((r) => r.data),
    enabled: Boolean(clientId),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* Header skeleton */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-border rounded-lg animate-pulse" />
          <div>
            <div className="h-5 w-48 bg-border rounded animate-pulse mb-1" />
            <div className="h-3 w-24 bg-border rounded animate-pulse" />
          </div>
        </div>
        {/* Tab skeleton */}
        <div className="flex gap-2">
          {[{ key: "info", label: t("client.info_tab") }, { key: "ledger", label: t("client.ledger_tab") }, { key: "cheques", label: t("client.cheques") }, { key: "invoices", label: t("client.invoices_tab") }, { key: "loyalty", label: t("client.loyalty_tab") }].map((t) => (
            <div key={t.key} className="h-9 w-32 bg-border rounded-lg animate-pulse" />
          ))}
        </div>
        {/* Content skeleton */}
        <div className="card">
          <div className="card-body space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 bg-border rounded animate-pulse" style={{ width: `${60 + i * 5}%` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !client) {
    return (
      <div className="card px-6 py-10 text-center space-y-3">
        <AlertCircle size={32} className="text-danger mx-auto" />
        <p className="text-text-primary font-semibold">Client introuvable</p>
        <p className="text-sm text-text-muted">
          Le client demandé n&apos;existe pas ou une erreur est survenue.
        </p>
        <button onClick={() => navigate("/clients")} className="btn-secondary">
          Retour à la liste
        </button>
      </div>
    );
  }

  const whatsappMsg = `Bonjour ${client.name}, votre solde est de ${formatDZD(client.cached_balance)} DZD`;

  return (
    <>
      <div className="space-y-4">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/clients")}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Retour"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{client.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                    client.is_active
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-slate-100 text-slate-600 border border-slate-200"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", client.is_active ? "bg-emerald-500" : "bg-slate-400")} />
                  {client.is_active ? "Actif" : "Inactif"}
                </span>
                <span className={cn(
                  "text-2xs font-semibold px-2 py-0.5 rounded-full border",
                  client.client_type === "wholesale"
                    ? "bg-purple-50 text-purple-700 border-purple-200"
                    : "bg-blue-50 text-blue-700 border-blue-200"
                )}>
                  {client.client_type === "wholesale" ? "Gros" : "Détail"}
                </span>
                {client.wilaya && (
                  <span className="text-xs text-slate-500 font-medium">{wilayaLabel(client.wilaya)}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {client.phone && (
              <a
                href={whatsappLink(client.phone, whatsappMsg)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 transition-colors shadow-2xs"
              >
                <MessageCircle size={15} />
                WhatsApp
              </a>
            )}
            <Link to={`/clients/${clientId}/edit`} className="btn-secondary rounded-xl">
              <Pencil size={15} />
              Modifier
            </Link>
            <button onClick={() => setShowPaymentModal(true)} className="btn-primary rounded-xl shadow-xs shadow-primary-500/20">
              <CreditCard size={15} />
              Enregistrer paiement
            </button>
          </div>
        </div>

        {/* Segmented Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl max-w-fit overflow-x-auto border border-slate-200/80">
          {TABS.filter((t) => t.key !== "loyalty" || hasLoyalty).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap",
                activeTab === tab.key
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "info" && (
          <ClientInfoTab client={client} onPayment={() => setShowPaymentModal(true)} />
        )}
        {activeTab === "ledger" && <LedgerTab clientId={clientId} />}
        {activeTab === "cheques" && <ChequesTab clientId={clientId} />}
        {activeTab === "invoices" && <InvoicesTab clientId={clientId} />}
        {activeTab === "loyalty" && hasLoyalty && <LoyaltyTab clientId={clientId} />}
      </div>

      {/* Payment modal */}
      {showPaymentModal && (
        <PaymentModal
          clientId={clientId}
          clientName={client.name}
          onClose={() => setShowPaymentModal(false)}
        />
      )}
    </>
  );
}
