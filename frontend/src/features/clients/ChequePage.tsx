import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import type { Cheque } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";

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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-text-primary">{t("nav.cheque_tracker")}</h1>

      {/* Upcoming alert */}
      {cheques.filter((c) => c.status === "pending" && c.days_until_due <= 3).length > 0 && (
        <div className="card border-warning bg-warning-light px-4 py-3 flex items-center gap-3">
          <AlertCircle size={18} className="text-warning flex-shrink-0" />
          <div className="text-sm text-warning">
            <strong>Attention:</strong>{" "}
            {cheques.filter((c) => c.status === "pending" && c.days_until_due <= 3).length} chèque(s)
            arrivent à échéance dans 3 jours ou moins.
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("cheque.number")}</th>
                <th>Client / Fournisseur</th>
                <th>{t("cheque.bank")}</th>
                <th>{t("cheque.due_date")}</th>
                <th>Échéance</th>
                <th className="text-end">{t("cheque.amount")}</th>
                <th>{t("cheque.status")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">{t("common.loading")}</td>
                </tr>
              )}
              {cheques.map((cheque) => (
                <tr key={cheque.id}>
                  <td className="font-mono font-medium">{cheque.number}</td>
                  <td>{cheque.client_name || cheque.supplier_name || "—"}</td>
                  <td className="text-text-muted">{cheque.bank || "—"}</td>
                  <td>{formatDate(cheque.due_date)}</td>
                  <td>
                    {cheque.status === "pending" && (
                      <span
                        className={cn(
                          "badge",
                          cheque.days_until_due <= 0 ? "badge-danger"
                          : cheque.days_until_due <= 3 ? "badge-warning"
                          : "badge-info"
                        )}
                      >
                        {cheque.days_until_due <= 0
                          ? "Échu"
                          : `J-${cheque.days_until_due}`}
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
                          title={t("cheque.mark_deposited")}
                        >
                          <CheckCircle size={14} />
                        </button>
                        <button
                          onClick={() => bounceMutation.mutate(cheque.id)}
                          className="btn-ghost btn-sm text-danger"
                          title={t("cheque.mark_bounced")}
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
    </div>
  );
}
