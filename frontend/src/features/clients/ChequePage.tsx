import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, AlertTriangle, Clock, Landmark } from "lucide-react";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import type { Cheque } from "@/types";
import { cn } from "@/lib/utils";

export default function ChequePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PaginatedResponse<Cheque>>({
    queryKey: ["cheques"],
    queryFn: () => api.get("/clients/cheques/?ordering=due_date").then((r) => r.data),
  });

  const depositMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/clients/cheques/${id}/mark-deposited/`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });

  const bounceMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/clients/cheques/${id}/mark-bounced/`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });

  const cheques = data?.results ?? [];

  const urgentCount = cheques.filter(
    (c) => c.status === "pending" && c.days_until_due <= 3
  ).length;

  const pendingCheques = cheques.filter((c) => c.status === "pending");
  const pendingTotal = pendingCheques.reduce(
    (acc, c) => acc + parseFloat(c.amount || "0"),
    0
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.cheque_tracker")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{cheques.length}</span> chèque(s) enregistrés
          </p>
        </div>
      </div>

      {/* Upcoming Alert */}
      {urgentCount > 0 && (
        <div className="rounded-2xl border border-amber-200/90 bg-amber-50/70 p-4 flex items-center gap-3.5 shadow-2xs">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-bold text-amber-900 font-sans uppercase tracking-wider">
              Échéances imminentes
            </h4>
            <p className="text-xs text-amber-800 mt-0.5 font-medium">
              <span className="font-bold">{urgentCount} chèque(s)</span> arrivent à échéance dans 3 jours ou moins (ou sont déjà échus). Pensez à les déposer ou vérifier l'encaissement.
            </p>
          </div>
        </div>
      )}

      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="card p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wider block">En attente d'encaissement</span>
            <p className="text-lg font-bold font-mono text-slate-900 mt-1 tabular-nums">
              {formatDZD(pendingTotal)} <span className="text-2xs font-normal text-slate-400">DZD</span>
            </p>
            <span className="text-2xs text-slate-500 font-medium">{pendingCheques.length} chèque(s)</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-amber-200/70 bg-amber-50/40 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-semibold text-amber-700 uppercase tracking-wider block">Échéance Proche / Dépassée</span>
            <p className="text-lg font-bold font-mono text-amber-900 mt-1 tabular-nums">
              {urgentCount} <span className="text-2xs font-normal text-amber-600">chèque(s)</span>
            </p>
            <span className="text-2xs text-amber-700 font-medium">J ≤ 3 jours</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wider block">Chèques Déposés</span>
            <p className="text-lg font-bold font-mono text-emerald-700 mt-1 tabular-nums">
              {cheques.filter((c) => c.status === "deposited").length} <span className="text-2xs font-normal text-slate-400">chèque(s)</span>
            </p>
            <span className="text-2xs text-slate-500 font-medium">Encaissés avec succès</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Landmark size={20} />
          </div>
        </div>
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("cheque.number")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client / Fournisseur</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("cheque.bank")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("cheque.due_date")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Compte à Rebours</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("cheque.amount")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Statut</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">{t("common.loading")}</td>
                </tr>
              )}
              {!isLoading && cheques.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">Aucun chèque enregistré.</td>
                </tr>
              )}
              {cheques.map((cheque) => (
                <tr key={cheque.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3.5 font-mono font-semibold text-slate-900 text-sm">
                    {cheque.number}
                  </td>
                  <td className="px-4 py-3.5 font-sans font-medium text-slate-800 text-sm">
                    {cheque.client_name || cheque.supplier_name || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 text-xs font-medium">
                    {cheque.bank ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                        {cheque.bank}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 text-xs font-mono">
                    {formatDate(cheque.due_date)}
                  </td>
                  <td className="px-4 py-3.5">
                    {cheque.status === "pending" && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                          cheque.days_until_due <= 0
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : cheque.days_until_due <= 3
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        )}
                      >
                        <Clock size={11} />
                        {cheque.days_until_due <= 0
                          ? "Échu"
                          : `J-${cheque.days_until_due}`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 tabular-nums">
                    {formatDZD(cheque.amount)} <span className="text-2xs font-normal text-slate-400">DZD</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold capitalize",
                        cheque.status === "deposited"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : cheque.status === "bounced"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : "bg-amber-50 text-amber-800 border border-amber-200"
                      )}
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          cheque.status === "deposited"
                            ? "bg-emerald-500"
                            : cheque.status === "bounced"
                            ? "bg-rose-500"
                            : "bg-amber-500"
                        )}
                      />
                      {cheque.status === "deposited"
                        ? "Encaissé"
                        : cheque.status === "bounced"
                        ? "Rejeté"
                        : "En attente"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    {cheque.status === "pending" && (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => depositMutation.mutate(cheque.id)}
                          disabled={depositMutation.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-semibold rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                          title={t("cheque.mark_deposited")}
                        >
                          <CheckCircle2 size={12} />
                          Encaisser
                        </button>
                        <button
                          onClick={() => bounceMutation.mutate(cheque.id)}
                          disabled={bounceMutation.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-semibold rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
                          title={t("cheque.mark_bounced")}
                        >
                          <XCircle size={12} />
                          Rejeter
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
    </div>
  );
}
