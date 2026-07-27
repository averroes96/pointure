import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
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
  const [searchParams, setSearchParams] = useSearchParams();
  
  const search = searchParams.get("search") || "";
  const type = searchParams.get("type") || "";
  const fromDate = searchParams.get("from") || "";
  const toDate = searchParams.get("to") || "";

  const { data, isLoading } = useQuery<PaginatedResponse<ClientLedgerEntry & { client_id: string; client_name: string }>>({
    queryKey: ["global-ledger", page, search, type, fromDate, toDate],
    queryFn: () =>
      api
        .get(`/clients/ledger/`, {
          params: { page, search, type, from: fromDate, to: toDate }
        })
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

      {/* Filters */}
      <div className="card p-4 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-text-muted mb-1 block">Recherche</label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Client, description, référence..."
              className="form-input pl-9 w-full"
              value={search}
              onChange={(e) => {
                setSearchParams((prev) => {
                  if (e.target.value) prev.set("search", e.target.value);
                  else prev.delete("search");
                  return prev;
                });
                setPage(1);
              }}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-text-muted mb-1 block">Type</label>
          <select
            className="form-input w-full md:w-auto"
            value={type}
            onChange={(e) => {
              setSearchParams((prev) => {
                if (e.target.value) prev.set("type", e.target.value);
                else prev.delete("type");
                return prev;
              });
              setPage(1);
            }}
          >
            <option value="">Tous</option>
            <option value="debit">Débits (Factures)</option>
            <option value="credit">Crédits (Paiements)</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-text-muted mb-1 block">Du</label>
          <input
            type="date"
            className="form-input w-full md:w-auto"
            value={fromDate}
            onChange={(e) => {
              setSearchParams((prev) => {
                if (e.target.value) prev.set("from", e.target.value);
                else prev.delete("from");
                return prev;
              });
              setPage(1);
            }}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text-muted mb-1 block">Au</label>
          <input
            type="date"
            className="form-input w-full md:w-auto"
            value={toDate}
            onChange={(e) => {
              setSearchParams((prev) => {
                if (e.target.value) prev.set("to", e.target.value);
                else prev.delete("to");
                return prev;
              });
              setPage(1);
            }}
          />
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
