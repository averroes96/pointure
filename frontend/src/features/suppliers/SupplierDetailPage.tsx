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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ShoppingBag, Plus, AlertCircle, Loader2,
  Phone, Mail, MapPin, Globe, FileText, CreditCard, X, Save,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Supplier, PurchaseOrder, SupplierInvoice, SupplierPayment } from "@/types";
import { cn } from "@/lib/utils";

// ── Status helpers ────────────────────────────────────────────────────────────

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  partial: "Partiel",
  received: "Reçu",
  cancelled: "Annulé",
};

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
  icon: React.FC<{ size?: number; className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="w-7 h-7 rounded bg-primary-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={13} className="text-primary-500" />
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
      setErrMsg("Le montant doit être supérieur à 0.");
      return;
    }
    setErrMsg(null);
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="card w-full max-w-md shadow-2xl">
        <div className="card-header flex items-center justify-between">
          <h2 className="font-semibold text-text-primary">Enregistrer un paiement fournisseur</h2>
          <button onClick={onClose} className="btn-ghost btn-sm"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="card-body space-y-4">
          {errMsg && (
            <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
              {errMsg}
            </div>
          )}

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

          <div>
            <label className="form-label">Mode de paiement *</label>
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "cheque", "virement"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, method: m }))}
                  className={cn(
                    "px-3 py-2 rounded-lg border text-sm font-medium transition-colors capitalize",
                    form.method === m
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-border bg-surface text-text-secondary hover:border-primary-300"
                  )}
                >
                  {m === "cash" ? "Espèces" : m === "cheque" ? "Chèque" : "Virement"}
                </button>
              ))}
            </div>
          </div>

          {form.method === "cheque" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">N° Chèque</label>
                <input
                  type="text"
                  value={form.cheque_number}
                  onChange={(e) => setForm((f) => ({ ...f, cheque_number: e.target.value }))}
                  className="form-input"
                  placeholder="CHQ-123456"
                />
              </div>
              <div>
                <label className="form-label">Banque</label>
                <input
                  type="text"
                  value={form.bank}
                  onChange={(e) => setForm((f) => ({ ...f, bank: e.target.value }))}
                  className="form-input"
                  placeholder="BNA, CPA..."
                />
              </div>
            </div>
          )}

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

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</> : <><Save size={14} /> Confirmer</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab: Info ─────────────────────────────────────────────────────────────────

function InfoTab({ supplier }: { supplier: Supplier }) {
  const balance = parseFloat(supplier.outstanding_balance);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-text-primary">Informations</h3></div>
        <div className="card-body divide-y divide-border">
          <InfoRow icon={Phone} label="Téléphone" value={supplier.phone} />
          <InfoRow icon={Mail} label="Email" value={supplier.email} />
          <InfoRow icon={MapPin} label="Adresse" value={supplier.address} />
          <InfoRow icon={Globe} label="Pays d'origine" value={supplier.origin_country} />
          <InfoRow icon={FileText} label="Conditions de paiement" value={supplier.payment_terms} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="card">
          <div className="card-body">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Solde dû</p>
            <p className={cn("text-3xl font-bold font-mono", balance > 0 ? "text-danger" : "text-success")}>
              {formatDZD(supplier.outstanding_balance)}{" "}
              <span className="text-lg font-normal text-text-muted">DZD</span>
            </p>
          </div>
        </div>

        {supplier.notes && (
          <div className="card">
            <div className="card-header"><h3 className="text-sm font-semibold text-text-primary">Notes</h3></div>
            <div className="card-body">
              <p className="text-sm text-text-muted whitespace-pre-wrap">{supplier.notes}</p>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-body">
            <p className="text-xs text-text-muted">
              Client depuis le{" "}
              {new Date(supplier.created_at).toLocaleDateString("fr-DZ", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            </p>
            <span className={cn("badge mt-2", supplier.is_active ? "badge-success" : "badge-neutral")}>
              {supplier.is_active ? "Actif" : "Inactif"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Purchase Orders ──────────────────────────────────────────────────────

function OrdersTab({ supplierId }: { supplierId: number }) {
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
          <Plus size={14} />
          Nouvelle commande
        </Link>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Référence</th>
                <th>Date attendue</th>
                <th>Statut</th>
                <th className="text-end">Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="text-center py-8 text-text-muted">Chargement...</td></tr>
              )}
              {!isLoading && orders.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-text-muted">Aucune commande.</td></tr>
              )}
              {orders.map((po) => (
                <tr key={po.id}>
                  <td className="font-mono text-sm">#{po.id}</td>
                  <td className="font-medium">{po.reference || "—"}</td>
                  <td className="text-text-muted">{po.expected_date ? formatDate(po.expected_date) : "—"}</td>
                  <td>
                    <span className={cn("badge", PO_STATUS_BADGE[po.status])}>
                      {PO_STATUS_LABELS[po.status] ?? po.status}
                    </span>
                  </td>
                  <td className="text-end font-mono text-sm">{formatDZD(po.total_amount)} DZD</td>
                  <td>
                    <Link to={`/purchase-orders/${po.id}`} className="btn-ghost btn-sm text-primary-500">
                      Voir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex gap-2 justify-end">
            <button onClick={() => setPage(page - 1)} disabled={!data.previous} className="btn-secondary btn-sm">Préc.</button>
            <button onClick={() => setPage(page + 1)} disabled={!data.next} className="btn-secondary btn-sm">Suiv.</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Supplier Invoices ────────────────────────────────────────────────────

function InvoicesTab({ supplierId }: { supplierId: number }) {
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
              <th>N° Facture</th>
              <th>Date</th>
              <th>Échéance</th>
              <th>Commande liée</th>
              <th className="text-end">Montant</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="text-center py-8 text-text-muted">Chargement...</td></tr>
            )}
            {!isLoading && invoices.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-text-muted">Aucune facture fournisseur.</td></tr>
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
  const { data, isLoading } = useQuery<PaginatedResponse<SupplierPayment>>({
    queryKey: ["supplier-payments", supplierId],
    queryFn: () =>
      api.get(`/suppliers/payments/?supplier=${supplierId}`).then((r) => r.data),
  });
  const payments = data?.results ?? [];

  const METHOD_LABELS: Record<string, string> = {
    cash: "Espèces",
    cheque: "Chèque",
    virement: "Virement",
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={onNewPayment} className="btn-primary btn-sm">
          <Plus size={14} />
          Enregistrer paiement
        </button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Référence</th>
                <th className="text-end">Montant</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} className="text-center py-8 text-text-muted">Chargement...</td></tr>
              )}
              {!isLoading && payments.length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-text-muted">Aucun paiement enregistré.</td></tr>
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

const TABS: { key: Tab; label: string }[] = [
  { key: "info", label: "Fiche fournisseur" },
  { key: "orders", label: "Commandes" },
  { key: "invoices", label: "Factures" },
  { key: "payments", label: "Paiements" },
];

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const supplierId = Number(id);
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [showPayment, setShowPayment] = useState(false);

  const { data: supplier, isLoading, isError } = useQuery<Supplier>({
    queryKey: ["supplier", supplierId],
    queryFn: () => api.get(`/suppliers/${supplierId}/`).then((r) => r.data),
    enabled: !isNaN(supplierId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Chargement...</span>
      </div>
    );
  }

  if (isError || !supplier) {
    return (
      <div className="card px-6 py-10 text-center space-y-3">
        <AlertCircle size={32} className="text-danger mx-auto" />
        <p className="font-semibold text-text-primary">Fournisseur introuvable</p>
        <button onClick={() => navigate("/suppliers")} className="btn-secondary">
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/suppliers")}
              className="btn-ghost btn-sm text-text-muted hover:text-text-primary"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-text-primary">{supplier.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn("badge", supplier.is_active ? "badge-success" : "badge-neutral")}>
                  {supplier.is_active ? "Actif" : "Inactif"}
                </span>
                {supplier.origin_country && (
                  <span className="text-xs text-text-muted">{supplier.origin_country}</span>
                )}
                {supplier.contact_name && (
                  <span className="text-xs text-text-muted">· {supplier.contact_name}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to={`/purchase-orders/new?supplier=${supplierId}`}
              className="btn-secondary"
            >
              <ShoppingBag size={15} />
              Nouvelle commande
            </Link>
            <button onClick={() => setShowPayment(true)} className="btn-primary">
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
