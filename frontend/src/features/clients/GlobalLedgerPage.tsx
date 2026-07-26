import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ClientLedgerEntry } from "@/types";

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
        </td>
      ))}
    </tr>
  );
}

export default function GlobalLedgerPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<ClientLedgerEntry & { client_id: string; client_name: string }>>({
    queryKey: ["global-ledger", page],
    queryFn: () =>
      api
        .get(`/clients/ledger/?page=${page}`)
        .then((r) => r.data),
  });

  const entries = data?.results ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <BookOpen size={20} className="text-primary-500" />
            {t("nav.global_ledger", "Grand Livre Clients")}
          </h1>
          <p className="text-sm text-text-muted">
            {data?.count ?? 0} {t("common.entries", "écritures")}
          </p>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("invoice.client")}</th>
                <th>{t("common.description", "Description")}</th>
                <th>{t("client.reference")}</th>
                <th className="text-end">{t("client.debit", "Débit")}</th>
                <th className="text-end">{t("client.credit", "Crédit")}</th>
                <th className="text-end">{t("client.balance_after", "Solde (Après)")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}

              {!isLoading && entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-text-muted">
                    {t("client.no_ledger_entries", "Aucune écriture trouvée.")}
                  </td>
                </tr>
              )}

              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-text-muted whitespace-nowrap">
                    {formatDate(entry.date)}
                  </td>
                  <td>
                    <Link to={`/clients/${entry.client_id}`} className="font-medium text-primary-600 hover:underline">
                      {entry.client_name || "—"}
                    </Link>
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

        {/* Pagination */}
        {data && data.count > 0 && (
          <div className="p-4 border-t border-border flex items-center justify-between bg-surface-50">
            <span className="text-sm text-text-muted">
              {t("common.page")} {page} {data.next ? `(${t("common.more_results")})` : ""}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary btn-sm"
              >
                {t("common.previous", "Précédent")}
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.next}
                className="btn-secondary btn-sm"
              >
                {t("common.next", "Suivant")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
