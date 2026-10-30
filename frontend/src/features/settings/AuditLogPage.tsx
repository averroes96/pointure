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
  create: "bg-emerald-50 text-emerald-700 border-emerald-200",
  update: "bg-amber-50 text-amber-800 border-amber-200",
  delete: "bg-rose-50 text-rose-700 border-rose-200",
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
    <div className="space-y-6">
      <div className="flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-2xl bg-primary-50 border border-primary-200 flex items-center justify-center shrink-0 shadow-2xs">
          <Shield size={22} className="text-primary-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("audit.title")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">{t("audit.subtitle")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={modelFilter}
          onChange={(e) => { setModelFilter(e.target.value); setPage(1); }}
          className="input max-w-[220px] rounded-xl border-slate-200 text-sm"
        >
          <option value="">{t("audit.all_models")}</option>
          {Object.entries(MODEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="input max-w-[180px] rounded-xl border-slate-200 text-sm"
        >
          <option value="">{t("audit.all_actions")}</option>
          <option value="create">{t("common.creation")}</option>
          <option value="update">{t("audit.update")}</option>
          <option value="delete">{t("audit.delete")}</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 font-medium">
            <div className="flex items-center justify-center gap-2">
              <div className="h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <span>{t("common.loading")}</span>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 font-medium">{t("audit.no_logs")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3.5 text-start">{t("invoice.date")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.user")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.action")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.object")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.details")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500 font-mono">
                      {new Date(log.timestamp).toLocaleString("fr-DZ")}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-900 text-xs">{log.user_name}</td>
                    <td className="px-4 py-3.5">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold border capitalize",
                        ACTION_BADGE[log.action] ?? "bg-slate-100 text-slate-700 border-slate-200"
                      )}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span className="text-slate-400 font-medium">{MODEL_LABELS[log.model_name] ?? log.model_name}</span>
                      <br />
                      <span className="font-semibold text-slate-800">{log.object_repr}</span>
                    </td>
                    <td className="px-4 py-3.5 max-w-[320px]">
                      {log.diff && Object.keys(log.diff).length > 0 ? (
                        <details className="text-xs group">
                          <summary className="cursor-pointer text-primary-600 hover:text-primary-800 font-semibold group-open:mb-2 transition-colors">
                            Voir détails ({Object.keys(log.diff).length} champ{Object.keys(log.diff).length > 1 ? 's' : ''})
                          </summary>
                          <div className="space-y-1.5">
                            {Object.entries(log.diff).map(([field, changes]: [string, any]) => (
                              <div key={field} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-2xs">
                                <span className="font-bold text-slate-800 block mb-1">
                                  {field}
                                </span>
                                <div className="grid grid-cols-2 gap-1.5 font-mono">
                                  <div className="bg-rose-50 border border-rose-200 text-rose-700 p-1.5 rounded-lg break-all line-through opacity-80">
                                    {String(changes.from ?? "—")}
                                  </div>
                                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-1.5 rounded-lg break-all font-semibold">
                                    {String(changes.to ?? "—")}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-slate-300 italic">—</span>
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
            className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-medium text-slate-500">
            Page <span className="font-semibold text-slate-900">{page}</span> / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
