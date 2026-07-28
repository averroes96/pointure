/**
 * AuditLogPage — /settings/audit-log
 * Owner-only view of the full audit trail.
 * Calls GET /api/v1/core/audit-logs/?page=N&model_name=X&action=Y
 */
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";
import api, { type PaginatedResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AuditLog {
  id: number;
  timestamp: string;
  user: number | null;
  user_name: string;
  action: string;
  model_name: string;
  object_id: string;
  object_repr: string;
  diff: Record<string, unknown> | null;
}

const ACTION_BADGE: Record<string, string> = {
  create: "badge-success",
  update: "badge-warning",
  delete: "badge-danger",
};

const MODEL_LABELS: Record<string, string> = {
  Invoice: "Facture",
  InvoicePayment: "Paiement facture",
  Sale: "Vente",
  Payment: "Paiement vente",
  StockMovement: "Mouvement stock",
  CreditNote: "Avoir",
  Return: "Retour",
  Product: "Produit",
  Variant: "Variante",
  Client: "Client",
  Cheque: "Chèque",
  StoreSettings: "Paramètres boutique",
  User: "Utilisateur",
  Branch: "Succursale",
};

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [modelFilter, setModelFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "25" });
  if (modelFilter) params.set("model_name", modelFilter);
  if (actionFilter) params.set("action", actionFilter);

  const { data, isLoading } = useQuery<PaginatedResponse<AuditLog>>({
    queryKey: ["audit-logs", page, modelFilter, actionFilter],
    queryFn: () => api.get(`/core/audit-logs/?${params}`).then((r) => r.data),
  });

  const logs = data?.results ?? [];
  const totalPages = Math.ceil((data?.count ?? 0) / 25);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Shield size={22} className="text-primary-500" />
        <div>
          <h1 className="text-xl font-bold text-text-primary">Journal d'activité</h1>
          <p className="text-sm text-text-muted">Historique de toutes les modifications du système</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={modelFilter}
          onChange={(e) => { setModelFilter(e.target.value); setPage(1); }}
          className="form-input max-w-[200px] text-sm"
        >
          <option value="">Tous les modèles</option>
          {Object.entries(MODEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="form-input max-w-[160px] text-sm"
        >
          <option value="">Toutes les actions</option>
          <option value="create">Création</option>
          <option value="update">Modification</option>
          <option value="delete">Suppression</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="card-body text-center text-text-muted py-12">Chargement...</div>
        ) : logs.length === 0 ? (
          <div className="card-body text-center text-text-muted py-12">Aucune entrée.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Utilisateur</th>
                  <th>Action</th>
                  <th>Objet</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap text-xs text-text-muted font-mono">
                      {new Date(log.timestamp).toLocaleString("fr-DZ")}
                    </td>
                    <td className="text-sm">{log.user_name}</td>
                    <td>
                      <span className={cn("badge text-xs", ACTION_BADGE[log.action] ?? "badge-neutral")}>
                        {log.action}
                      </span>
                    </td>
                    <td className="text-sm">
                      <span className="text-text-muted text-xs">{MODEL_LABELS[log.model_name] ?? log.model_name}</span>
                      <br />
                      <span className="font-medium">{log.object_repr}</span>
                    </td>
                    <td className="max-w-[300px]">
                      {log.diff && Object.keys(log.diff).length > 0 ? (
                        <details className="text-xs group">
                          <summary className="cursor-pointer text-primary-500 font-medium group-open:mb-2">
                            Voir détails ({Object.keys(log.diff).length} champ{Object.keys(log.diff).length > 1 ? 's' : ''})
                          </summary>
                          <div className="space-y-1.5">
                            {Object.entries(log.diff).map(([field, changes]: [string, any]) => (
                              <div key={field} className="bg-surface p-2 rounded border border-border text-2xs">
                                <span className="font-semibold text-text-primary block mb-1">
                                  {field}
                                </span>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <div className="bg-danger/10 text-danger-700 p-1 rounded break-all decoration-danger/50 line-through">
                                    {String(changes.from ?? "—")}
                                  </div>
                                  <div className="bg-success/10 text-success-700 p-1 rounded break-all">
                                    {String(changes.to ?? "—")}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-text-muted italic">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary btn-sm"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm text-text-muted">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-secondary btn-sm"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
