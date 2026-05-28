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
import { useParams, useNavigate, Link } from "react-router-dom";
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
  type LucideIcon,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Client, ClientLedgerEntry, Cheque, Invoice } from "@/types";
import { cn, whatsappLink, getStatusBadgeClass } from "@/lib/utils";
import { wilayaLabel } from "@/lib/wilayas";

// ── Types ──────────────────────────────────────────────────────────────────

type ActiveTab = "info" | "ledger" | "cheques" | "invoices";

interface PaymentFormState {
  amount: string;
  method: "cash" | "ccp" | "virement" | "cheque";
  notes: string;
  date: string;
}

const PAYMENT_METHODS: { key: PaymentFormState["method"]; label: string }[] = [
  { key: "cash", label: "Espèces" },
  { key: "ccp", label: "CCP" },
  { key: "virement", label: "Virement" },
  { key: "cheque", label: "Chèque" },
];

const TABS: { key: ActiveTab; label: string }[] = [
  { key: "info", label: "Fiche client" },
  { key: "ledger", label: "Relevé de compte" },
  { key: "cheques", label: "Chèques" },
  { key: "invoices", label: "Factures" },
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
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState<PaymentFormState>({
    amount: "",
    method: "cash",
    notes: "",
    date: today,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: PaymentFormState) =>
      api
        .post(`/clients/${clientId}/record-payment/`, {
          amount: payload.amount,
          method: payload.method,
          notes: payload.notes,
          date: payload.date,
        })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client", clientId] });
      queryClient.invalidateQueries({ queryKey: ["client-ledger", clientId] });
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
      setErrorMsg("Le montant doit être supérieur à 0.");
      return;
    }
    mutation.mutate(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="card w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="card-header flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-text-primary">Enregistrer un paiement</h2>
            <p className="text-xs text-text-muted mt-0.5">{clientName}</p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost btn-sm text-text-muted hover:text-text-primary"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="card-body space-y-4">
          {/* Amount */}
          <div>
            <label className="form-label">Montant (DZD) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="form-input"
              placeholder="0.00"
              required
              autoFocus
            />
          </div>

          {/* Method */}
          <div>
            <label className="form-label">Mode de paiement *</label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, method: m.key }))}
                  className={cn(
                    "px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                    form.method === m.key
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-border bg-surface text-text-secondary hover:border-primary-300"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="form-label">Date *</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="form-input"
              required
            />
          </div>

          {/* Notes */}
          <div>
            <label className="form-label">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="form-input resize-none"
              rows={2}
              placeholder="Référence, commentaire..."
            />
          </div>

          {/* Error */}
          {errorMsg && (
            <div className="flex items-center gap-2 text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="flex-shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Annuler
            </button>
            <button
              type="submit"
              className="btn-primary"
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
  const balance = parseFloat(client.cached_balance);
  const creditLimit = parseFloat(client.credit_limit);
  const isOverLimit = client.is_over_credit_limit;

  const whatsappMsg = `Bonjour ${client.name}, votre solde est de ${formatDZD(client.cached_balance)} DZD`;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* Left: Details */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-text-primary">Informations générales</h3>
        </div>
        <div className="card-body divide-y divide-border">
          <InfoField icon={User} label="Nom complet" value={client.name} />
          <InfoField
            icon={Phone}
            label="Téléphone"
            value={
              client.phone ? (
                <a
                  href={whatsappLink(client.phone, whatsappMsg)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-green-600 hover:underline"
                >
                  <MessageCircle size={13} />
                  {client.phone}
                </a>
              ) : null
            }
          />
          <InfoField icon={Mail} label="Email" value={client.email} />
          <InfoField icon={MapPin} label="Adresse" value={client.address} />
          <InfoField icon={MapPin} label="Wilaya" value={wilayaLabel(client.wilaya)} />
          <InfoField icon={Building2} label="NIF" value={client.nif} mono />
          <InfoField icon={Building2} label="RC" value={client.rc} mono />
        </div>
      </div>

      {/* Right: Financial */}
      <div className="space-y-4">
        {/* Balance card */}
        <div className={cn("card border-2", isOverLimit ? "border-danger" : "border-transparent")}>
          <div className="card-body space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-secondary">Solde actuel</span>
              {isOverLimit && (
                <div className="flex items-center gap-1 text-xs text-danger font-medium">
                  <AlertCircle size={13} />
                  Limite dépassée
                </div>
              )}
            </div>

            <div
              className={cn(
                "text-3xl font-bold font-mono",
                isOverLimit
                  ? "text-danger"
                  : balance > 0
                  ? "text-warning"
                  : "text-success"
              )}
            >
              {formatDZD(client.cached_balance)} <span className="text-lg">DZD</span>
            </div>

            {creditLimit > 0 && (
              <div>
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Limite de crédit</span>
                  <span className="font-mono">
                    {formatDZD(client.credit_limit)} DZD
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-border rounded-full h-2">
                  <div
                    className={cn(
                      "h-2 rounded-full transition-all",
                      isOverLimit ? "bg-danger" : balance / creditLimit > 0.8 ? "bg-warning" : "bg-success"
                    )}
                    style={{
                      width: `${Math.min((balance / creditLimit) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <button onClick={onPayment} className="btn-primary w-full">
              <CreditCard size={15} />
              Enregistrer paiement
            </button>
          </div>
        </div>

        {/* Status card */}
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Statut du compte</span>
              <span className={cn("badge", client.is_active ? "badge-success" : "badge-neutral")}>
                {client.is_active ? "Actif" : "Inactif"}
              </span>
            </div>
            {client.notes && (
              <p className="mt-3 text-sm text-text-muted border-t border-border pt-3">
                {client.notes}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Relevé de compte ──────────────────────────────────────────────────

function LedgerTab({ clientId }: { clientId: number }) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<ClientLedgerEntry>>({
    queryKey: ["client-ledger", clientId, page],
    queryFn: () =>
      api
        .get(`/clients/${clientId}/ledger/?page=${page}`)
        .then((r) => r.data),
  });

  const entries = data?.results ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Référence</th>
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
                <td className="font-mono text-xs text-text-muted">
                  {entry.reference_type && entry.reference_id
                    ? `${entry.reference_type} #${entry.reference_id}`
                    : "—"}
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
            Page {data.current_page} / {data.total_pages} · {data.count} entrées
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

// ── Tab: Chèques ───────────────────────────────────────────────────────────

function ChequesTab({ clientId }: { clientId: number }) {
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
              <th>Statut</th>
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
                        title="Marquer encaissé"
                        disabled={depositMutation.isPending}
                      >
                        <CheckCircle size={14} />
                      </button>
                      <button
                        onClick={() => bounceMutation.mutate(cheque.id)}
                        className="btn-ghost btn-sm text-danger"
                        title="Marquer impayé"
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
              <th>Date</th>
              <th>Échéance</th>
              <th>Statut</th>
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
                    title="Télécharger PDF"
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

// ── Main page ──────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clientId = Number(id);

  const [activeTab, setActiveTab] = useState<ActiveTab>("info");
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const { data: client, isLoading, isError } = useQuery<Client>({
    queryKey: ["client", clientId],
    queryFn: () =>
      api.get(`/clients/${clientId}/`).then((r) => r.data),
    enabled: !isNaN(clientId),
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
          {TABS.map((t) => (
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
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/clients")}
              className="btn-ghost btn-sm text-text-muted hover:text-text-primary"
              aria-label="Retour"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-text-primary">{client.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn("badge", client.is_active ? "badge-success" : "badge-neutral")}>
                  {client.is_active ? "Actif" : "Inactif"}
                </span>
                {client.wilaya && (
                  <span className="text-xs text-text-muted">{wilayaLabel(client.wilaya)}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {client.phone && (
              <a
                href={whatsappLink(client.phone, whatsappMsg)}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                <MessageCircle size={15} />
                WhatsApp
              </a>
            )}
            <Link to={`/clients/${clientId}/edit`} className="btn-secondary">
              <Pencil size={15} />
              Modifier
            </Link>
            <button onClick={() => setShowPaymentModal(true)} className="btn-primary">
              <CreditCard size={15} />
              Enregistrer paiement
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                activeTab === tab.key
                  ? "border-primary-500 text-primary-600"
                  : "border-transparent text-text-muted hover:text-text-primary hover:border-border"
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
