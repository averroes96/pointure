/**
 * PurchaseOrderListPage — /purchase-orders
 * Lists all purchase orders with status filter tabs.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import type { PurchaseOrder, POStatus } from "@/types";
import { cn } from "@/lib/utils";

const STATUS_TABS: { value: POStatus | ""; label: string }[] = [
  { value: "", label: "Tous" },
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyé" },
  { value: "partial", label: "Partiel" },
  { value: "received", label: "Reçu" },
  { value: "cancelled", label: "Annulé" },
];

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
  partial: "Partiel",
  received: "Reçu",
  cancelled: "Annulé",
};

export default function PurchaseOrderListPage() {
  const [status, setStatus] = useState<POStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<PurchaseOrder>>({
    queryKey: ["purchase-orders", { status, search, page }],
    queryFn: () =>
      api
        .get(
          `/suppliers/purchase-orders/?${status ? `status=${status}&` : ""}search=${encodeURIComponent(search)}&page=${page}`
        )
        .then((r) => r.data),
  });

  const orders = data?.results ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Commandes d'achat</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} commande(s)</p>
        </div>
        <Link to="/purchase-orders/new" className="btn-primary">
          <Plus size={16} />
          Nouvelle commande
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatus(tab.value); setPage(1); }}
            className={cn(
              "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
              status === tab.value
                ? "border-primary-500 text-primary-600"
                : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="form-input ps-9"
          placeholder="Fournisseur, référence..."
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Fournisseur</th>
                <th>Référence</th>
                <th>Date attendue</th>
                <th>Statut</th>
                <th className="text-end">Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">Chargement...</td>
                </tr>
              )}
              {!isLoading && orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">Aucune commande trouvée.</td>
                </tr>
              )}
              {orders.map((po) => (
                <tr key={po.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <ShoppingBag size={13} className="text-text-muted flex-shrink-0" />
                      <span className="font-mono font-medium text-sm">#{po.id}</span>
                    </div>
                  </td>
                  <td className="font-medium text-text-primary">{po.supplier_name}</td>
                  <td className="text-text-muted text-sm">{po.reference || "—"}</td>
                  <td className="text-text-muted">
                    {po.expected_date ? formatDate(po.expected_date) : "—"}
                  </td>
                  <td>
                    <span className={cn("badge", STATUS_BADGE[po.status])}>
                      {STATUS_LABEL[po.status]}
                    </span>
                  </td>
                  <td className="text-end font-mono text-sm">
                    {formatDZD(po.total_amount)}{" "}
                    <span className="text-2xs text-text-muted">DZD</span>
                  </td>
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
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Page {data.current_page} / {data.total_pages} · {data.count} commandes
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary btn-sm"
              >
                Précédent
              </button>
              <button
                onClick={() => setPage(page + 1)}
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
