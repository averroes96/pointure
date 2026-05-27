/**
 * CreditNotesPage — Avoirs
 * Lists credit notes fetched from GET /invoicing/invoices/?series_prefix=AV
 * Columns: N°Avoir, Client, Date, Motif, Montant, Statut, Actions
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, FileX } from "lucide-react";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import type { Invoice } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Émis" },
  { value: "partial", label: "Partiel" },
  { value: "paid", label: "Apuré" },
  { value: "cancelled", label: "Annulé" },
];

// French labels for credit note statuses
const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Émis",
  partial: "Partiel",
  paid: "Apuré",
  overdue: "En retard",
  cancelled: "Annulé",
};

export default function CreditNotesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<Invoice>>({
    queryKey: ["credit-notes", { search, status, page }],
    queryFn: () =>
      api
        .get(
          `/invoicing/invoices/?series_prefix=AV&search=${encodeURIComponent(search)}&status=${status}&page=${page}`
        )
        .then((r) => r.data),
  });

  const credits = data?.results ?? [];

  // Extract a "motif" from the notes field (first line) or fall back to "—"
  function getMotif(invoice: Invoice): string {
    if (!invoice.notes) return "—";
    const first = invoice.notes.split("\n")[0].trim();
    return first.length > 60 ? first.slice(0, 60) + "…" : first || "—";
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Avoirs</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} avoir(s)</p>
        </div>
        <a href="/credit-notes/new" className="btn-primary">
          <Plus size={16} />
          Nouvel avoir
        </a>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={16}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="form-input ps-9"
            placeholder="N°Avoir ou client..."
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="form-input max-w-[160px]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>N°Avoir</th>
                <th>{t("invoice.client")}</th>
                <th>{t("invoice.date")}</th>
                <th>Motif</th>
                <th className="text-end">Montant</th>
                <th>Statut</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && credits.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}
              {credits.map((credit) => (
                <tr key={credit.id}>
                  {/* N°Avoir */}
                  <td>
                    <div className="flex items-center gap-2">
                      <FileX size={14} className="text-text-muted flex-shrink-0" />
                      <span className="font-mono font-medium">
                        {credit.number || `AV-${credit.id}`}
                      </span>
                    </div>
                  </td>

                  {/* Client */}
                  <td className="font-medium text-text-primary">
                    {credit.client_name || "—"}
                  </td>

                  {/* Date */}
                  <td className="text-text-muted">{formatDate(credit.date)}</td>

                  {/* Motif */}
                  <td className="text-sm text-text-muted max-w-[200px]">
                    <span className="truncate block" title={credit.notes || undefined}>
                      {getMotif(credit)}
                    </span>
                  </td>

                  {/* Montant (total TTC, displayed as negative for avoir) */}
                  <td className="text-end">
                    <span className="font-mono text-sm text-danger font-medium">
                      − {formatDZD(credit.total_ttc)}{" "}
                      <span className="text-2xs text-text-muted">DZD</span>
                    </span>
                  </td>

                  {/* Statut */}
                  <td>
                    <span className={cn("badge", getStatusBadgeClass(credit.status))}>
                      {STATUS_LABELS[credit.status] ?? credit.status}
                    </span>
                  </td>

                  {/* Actions */}
                  <td>
                    <div className="flex items-center gap-1">
                      <button className="btn-ghost btn-sm text-primary-500">
                        {t("common.view")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Page {data.current_page} / {data.total_pages} · {data.count} avoir(s)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary btn-sm"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.next}
                className="btn-secondary btn-sm"
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
