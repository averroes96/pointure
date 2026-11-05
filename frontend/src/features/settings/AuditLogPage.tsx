/**
 * AuditLogPage — /settings/audit-log
 * Owner-only view of the full audit trail.
 * Calls GET /api/v1/core/audit-logs/?page=N&model_name=X&action=Y&user=Z&date_from=D&date_to=D
 */
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
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

interface AuditUser {
  id: string | number;
  email: string;
  full_name?: string;
}

interface AuthorizedBy {
  id: string;
  name: string;
}

const ACTION_BADGE: Record<string, string> = {
  create: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50",
  update: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",
  delete: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50",
};

const MODEL_NAMES = [
  "Invoice", "InvoicePayment", "Sale", "Payment", "StockMovement", "CreditNote",
  "Return", "Product", "Variant", "Client", "Cheque", "StoreSettings", "User", "Branch",
  "CashSession", "CashMovement", "Promotion", "LoyaltyAccount", "StockTransfer",
  "DefectItem", "StocktakeSession", "SupplierPayment", "PurchaseOrder",
];

const FILTER_CLASS =
  "input rounded-xl border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 text-sm";

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [modelFilter, setModelFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const modelLabel = (name: string) => t(`audit.models.${name}`, name);

  const params = new URLSearchParams({ page: String(page), page_size: "25" });
  if (modelFilter) params.set("model_name", modelFilter);
  if (actionFilter) params.set("action", actionFilter);
  if (userFilter) params.set("user", userFilter);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);

  const { data, isLoading } = useQuery<PaginatedResponse<AuditLog>>({
    queryKey: ["audit-logs", page, modelFilter, actionFilter, userFilter, dateFrom, dateTo],
    queryFn: () => api.get(`/core/audit-logs/?${params}`).then((r) => r.data),
  });

  const { data: usersData } = useQuery<PaginatedResponse<AuditUser>>({
    queryKey: ["settings", "users", "audit-filter"],
    queryFn: () => api.get("/core/users/?page_size=100").then((r) => r.data),
  });
  const users = usersData?.results ?? [];

  const logs = data?.results ?? [];
  const totalPages = Math.ceil((data?.count ?? 0) / 25);

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-2xl bg-primary-50 dark:bg-primary-950/40 border border-primary-200 dark:border-primary-900/50 flex items-center justify-center shrink-0 shadow-2xs">
          <Shield size={22} className="text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white">{t("audit.title")}</h1>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t("audit.subtitle")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <select
          value={modelFilter}
          onChange={(e) => { setModelFilter(e.target.value); resetPage(); }}
          className={cn(FILTER_CLASS, "max-w-[220px]")}
          aria-label={t("audit.all_models")}
        >
          <option value="">{t("audit.all_models")}</option>
          {MODEL_NAMES.map((k) => (
            <option key={k} value={k}>{modelLabel(k)}</option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); resetPage(); }}
          className={cn(FILTER_CLASS, "max-w-[180px]")}
          aria-label={t("audit.all_actions")}
        >
          <option value="">{t("audit.all_actions")}</option>
          <option value="create">{t("common.creation")}</option>
          <option value="update">{t("audit.update")}</option>
          <option value="delete">{t("audit.delete")}</option>
        </select>
        <select
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); resetPage(); }}
          className={cn(FILTER_CLASS, "max-w-[220px]")}
          aria-label={t("audit.all_users")}
        >
          <option value="">{t("audit.all_users")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          {t("audit.date_from")}
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => { setDateFrom(e.target.value); resetPage(); }}
            className={cn(FILTER_CLASS, "max-w-[160px]")}
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          {t("audit.date_to")}
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => { setDateTo(e.target.value); resetPage(); }}
            className={cn(FILTER_CLASS, "max-w-[160px]")}
          />
        </label>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 dark:text-slate-500 font-medium">
            <div className="flex items-center justify-center gap-2">
              <div className="h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <span>{t("common.loading")}</span>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 dark:text-slate-500 font-medium">{t("audit.no_logs")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3.5 text-start">{t("invoice.date")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.user")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.action")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.object")}</th>
                  <th className="px-4 py-3.5 text-start">{t("audit.details")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => {
                  const authorizer = (log.diff?._authorized_by ?? null) as AuthorizedBy | null;
                  const fieldEntries = Object.entries(log.diff ?? {}).filter(([k]) => k !== "_authorized_by");
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {new Date(log.timestamp).toLocaleString("fr-DZ")}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900 dark:text-slate-100 text-xs">{log.user_name}</td>
                      <td className="px-4 py-3.5">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold border capitalize",
                          ACTION_BADGE[log.action] ?? "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                        )}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-medium">{modelLabel(log.model_name)}</span>
                        <br />
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{log.object_repr}</span>
                      </td>
                      <td className="px-4 py-3.5 max-w-[320px]">
                        {authorizer && (
                          <div className="mb-1.5 inline-flex items-center gap-1 text-2xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50 rounded-full px-2 py-0.5">
                            <ShieldCheck size={12} />
                            {t("audit.authorized_by")}: {authorizer.name}
                          </div>
                        )}
                        {fieldEntries.length > 0 ? (
                          <details className="text-xs group">
                            <summary className="cursor-pointer text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 font-semibold group-open:mb-2 transition-colors">
                              {t("audit.view_details")} ({t("audit.fields_count", { count: fieldEntries.length })})
                            </summary>
                            <div className="space-y-1.5">
                              {fieldEntries.map(([field, changes]: [string, any]) => (
                                <div key={field} className="bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 text-2xs">
                                  <span className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                                    {field}
                                  </span>
                                  <div className="grid grid-cols-2 gap-1.5 font-mono">
                                    <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 p-1.5 rounded-lg break-all line-through opacity-80">
                                      {String(changes.from ?? "—")}
                                    </div>
                                    <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 p-1.5 rounded-lg break-all font-semibold">
                                      {String(changes.to ?? "—")}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : (
                          !authorizer && <span className="text-xs text-slate-300 dark:text-slate-600 italic">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t("audit.page")} <span className="font-semibold text-slate-900 dark:text-white">{page}</span> / {totalPages}
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
