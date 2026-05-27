/**
 * PurchaseOrderDetailPage — /purchase-orders/:id
 *
 * Displays PO details with lines. Allows:
 *   - Receive lines: POST /suppliers/purchase-orders/{id}/receive/
 *   - Update status: PATCH /suppliers/purchase-orders/{id}/update-status/
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle, AlertTriangle, X,
  ShoppingBag, Factory, Calendar, FileText, Truck, ChevronDown,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";
import type { PurchaseOrder, POStatus } from "@/types";
import { cn } from "@/lib/utils";

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<POStatus, string> = {
  draft: "badge-neutral",
  sent: "badge-info",
  partial: "badge-warning",
  received: "badge-success",
  cancelled: "badge",
};

const STATUS_LABEL: Record<POStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  partial: "Partiellement reçu",
  received: "Reçu",
  cancelled: "Annulé",
};

// Status transitions the user can manually trigger
const STATUS_TRANSITIONS: Partial<Record<POStatus, { to: POStatus; label: string; variant: string }[]>> = {
  draft: [
    { to: "sent", label: "Marquer comme envoyé", variant: "btn-primary" },
    { to: "cancelled", label: "Annuler la commande", variant: "btn-secondary text-danger" },
  ],
  sent: [
    { to: "draft", label: "Repasser en brouillon", variant: "btn-secondary" },
    { to: "cancelled", label: "Annuler la commande", variant: "btn-secondary text-danger" },
  ],
  partial: [
    { to: "cancelled", label: "Annuler la commande", variant: "btn-secondary text-danger" },
  ],
};

// ── Receive form ──────────────────────────────────────────────────────────────

function ReceiveForm({ po, onSuccess }: { po: PurchaseOrder; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<number, number>>(
    Object.fromEntries(po.lines.map((l) => [l.id, l.quantity_received]))
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Sync if po.lines change (refetch after successful mutation)
  useEffect(() => {
    setQuantities(Object.fromEntries(po.lines.map((l) => [l.id, l.quantity_received])));
  }, [po.lines.map((l) => `${l.id}:${l.quantity_received}`).join(",")]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/suppliers/purchase-orders/${po.id}/receive/`, {
        lines: po.lines.map((l) => ({
          id: l.id,
          quantity_received: quantities[l.id] ?? l.quantity_received,
        })),
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order", po.id] });
      setOk(true);
      setTimeout(() => { setOk(false); onSuccess(); }, 1000);
    },
    onError: (err) => setErrMsg(getApiError(err)),
  });

  const canReceive = po.status !== "cancelled" && po.status !== "received";

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck size={15} className="text-primary-500" />
          <h3 className="font-semibold text-text-primary">Lignes de commande</h3>
        </div>
        {canReceive && (
          <span className="text-xs text-text-muted">Saisissez les quantités reçues puis confirmez</span>
        )}
      </div>

      {errMsg && (
        <div className="mx-5 mt-4 flex items-center gap-2 px-3 py-2 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
          <AlertTriangle size={13} />
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setErrMsg(null)}><X size={13} /></button>
        </div>
      )}

      {ok && (
        <div className="mx-5 mt-4 flex items-center gap-2 px-3 py-2 bg-success/10 border border-success/30 rounded-lg text-sm text-success">
          <CheckCircle size={13} /> Réception enregistrée.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="text-center">Commandé</th>
              <th className="text-center">Reçu</th>
              <th className="text-end">Prix unit.</th>
              <th className="text-end">Total ligne</th>
              <th className="text-center">Statut</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((line) => {
              const qtyReceived = quantities[line.id] ?? line.quantity_received;
              const isDone = qtyReceived >= line.quantity_ordered;
              return (
                <tr key={line.id}>
                  <td className="font-medium">{line.description}</td>
                  <td className="text-center font-mono text-sm">{line.quantity_ordered}</td>
                  <td className="text-center">
                    {canReceive ? (
                      <input
                        type="number"
                        value={qtyReceived}
                        min={0}
                        max={line.quantity_ordered}
                        onChange={(e) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [line.id]: Math.min(
                              parseInt(e.target.value) || 0,
                              line.quantity_ordered
                            ),
                          }))
                        }
                        className="form-input py-1 text-sm text-center w-20 mx-auto font-mono"
                      />
                    ) : (
                      <span className="font-mono text-sm">{line.quantity_received}</span>
                    )}
                  </td>
                  <td className="text-end font-mono text-sm text-text-muted">
                    {formatDZD(line.agreed_unit_price)} DZD
                  </td>
                  <td className="text-end font-mono text-sm">
                    {formatDZD(line.line_total)} DZD
                  </td>
                  <td className="text-center">
                    {isDone ? (
                      <span className="badge badge-success text-xs">Reçu</span>
                    ) : qtyReceived > 0 ? (
                      <span className="badge badge-warning text-xs">Partiel</span>
                    ) : (
                      <span className="badge badge-neutral text-xs">En attente</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canReceive && (
        <div className="card-body border-t border-border flex justify-end">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending
              ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
              : <><CheckCircle size={14} /> Confirmer la réception</>
            }
          </button>
        </div>
      )}
    </div>
  );
}

// ── Status action menu ────────────────────────────────────────────────────────

function StatusActions({ po }: { po: PurchaseOrder }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const transitions = STATUS_TRANSITIONS[po.status] ?? [];

  const mutation = useMutation({
    mutationFn: (newStatus: POStatus) =>
      api.patch(`/suppliers/purchase-orders/${po.id}/update-status/`, { status: newStatus }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order", po.id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setOpen(false);
    },
    onError: (err) => setErrMsg(getApiError(err)),
  });

  if (transitions.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-secondary flex items-center gap-1.5"
      >
        Changer statut
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute end-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg min-w-[200px] overflow-hidden">
          {errMsg && (
            <div className="px-3 py-2 text-xs text-danger">{errMsg}</div>
          )}
          {transitions.map((t) => (
            <button
              key={t.to}
              onClick={() => mutation.mutate(t.to)}
              disabled={mutation.isPending}
              className={cn(
                "w-full text-start px-4 py-2.5 text-sm hover:bg-surface transition-colors",
                t.to === "cancelled" ? "text-danger" : "text-text-primary"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const poId = Number(id);

  const { data: po, isLoading, isError } = useQuery<PurchaseOrder>({
    queryKey: ["purchase-order", poId],
    queryFn: () => api.get(`/suppliers/purchase-orders/${poId}/`).then((r) => r.data),
    enabled: !isNaN(poId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Chargement...</span>
      </div>
    );
  }

  if (isError || !po) {
    return (
      <div className="card px-6 py-10 text-center space-y-3">
        <AlertCircle size={32} className="text-danger mx-auto" />
        <p className="font-semibold text-text-primary">Commande introuvable</p>
        <button onClick={() => navigate("/purchase-orders")} className="btn-secondary">
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/purchase-orders")}
            className="btn-ghost btn-sm text-text-muted hover:text-text-primary"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-text-primary">
                Commande #{po.id}
              </h1>
              <span className={cn("badge", STATUS_BADGE[po.status])}>
                {STATUS_LABEL[po.status]}
              </span>
            </div>
            <p className="text-sm text-text-muted mt-0.5">
              {formatDate(po.created_at)}
            </p>
          </div>
        </div>

        <StatusActions po={po} />
      </div>

      {/* Info row */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <Factory size={16} className="text-primary-500 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-text-muted">Fournisseur</div>
            <Link
              to={`/suppliers/${po.supplier}`}
              className="text-sm font-semibold text-primary-600 hover:underline truncate block"
            >
              {po.supplier_name}
            </Link>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <FileText size={16} className="text-primary-500 flex-shrink-0" />
          <div>
            <div className="text-xs text-text-muted">Référence</div>
            <div className="text-sm font-medium font-mono">{po.reference || "—"}</div>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <Calendar size={16} className="text-primary-500 flex-shrink-0" />
          <div>
            <div className="text-xs text-text-muted">Livraison attendue</div>
            <div className="text-sm font-medium">
              {po.expected_date ? formatDate(po.expected_date) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {po.notes && (
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">Notes</p>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{po.notes}</p>
        </div>
      )}

      {/* Lines */}
      {po.lines.length > 0 ? (
        <ReceiveForm
          po={po}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] })}
        />
      ) : (
        <div className="card px-6 py-8 text-center text-text-muted text-sm">
          Aucune ligne dans cette commande.
        </div>
      )}

      {/* Total */}
      <div className="flex justify-end">
        <div className="card p-4 flex items-center gap-6">
          <span className="text-sm text-text-muted">Total commande</span>
          <span className="text-xl font-bold font-mono text-text-primary">
            {formatDZD(po.total_amount)}{" "}
            <span className="text-sm font-normal text-text-muted">DZD</span>
          </span>
        </div>
      </div>
    </div>
  );
}
