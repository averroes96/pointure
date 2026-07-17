/**
 * CreditNotesPage — Avoirs
 * Lists credit notes from GET /invoicing/credit-notes/
 * Columns: N°Avoir, Client, Facture d'origine, Date, Motif, Montant HT, Montant TTC, Actions
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, FileX } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import type { CreditNote } from "@/types";

export default function CreditNotesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<CreditNote>>({
    queryKey: ["credit-notes", { search, page }],
    queryFn: () =>
      api
        .get(`/invoicing/credit-notes/?search=${encodeURIComponent(search)}&page=${page}`)
        .then((r) => r.data),
  });

  const credits = data?.results ?? [];

  function truncateReason(reason: string): string {
    if (!reason) return "—";
    return reason.length > 60 ? reason.slice(0, 60) + "…" : reason;
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.credit_notes")}</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} avoir(s)</p>
        </div>
        <Link to="/credit-notes/new" className="btn-primary">
          <Plus size={16} />{t("invoice.new_credit_note")}</Link>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-xs">
        <Search
          size={16}
          className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="form-input ps-9"
          placeholder=t("invoice.search_credit_client")
        />
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("invoice.credit_number")}</th>
                <th>{t("invoice.client")}</th>
                <th>{t("invoice.original_invoice")}</th>
                <th>{t("invoice.date")}</th>
                <th>{t("invoice.reason")}</th>
                <th className="text-end">{t("invoice.total_ht")}</th>
                <th className="text-end">{t("invoice.total_ttc")}</th>
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

                  {/* Facture d'origine */}
                  <td>
                    <span className="font-mono text-sm text-primary-500">
                      {credit.original_invoice_number || `#${credit.original_invoice}`}
                    </span>
                  </td>

                  {/* Date */}
                  <td className="text-text-muted">{formatDate(credit.date)}</td>

                  {/* Motif */}
                  <td className="text-sm text-text-muted max-w-[200px]">
                    <span className="truncate block" title={credit.reason || undefined}>
                      {truncateReason(credit.reason)}
                    </span>
                  </td>

                  {/* Montant HT */}
                  <td className="text-end font-mono text-sm">
                    {formatDZD(credit.total_ht)}{" "}
                    <span className="text-2xs text-text-muted">DZD</span>
                  </td>

                  {/* Total TTC (displayed as negative) */}
                  <td className="text-end">
                    <span className="font-mono text-sm text-danger font-medium">
                      − {formatDZD(credit.total_ttc)}{" "}
                      <span className="text-2xs text-text-muted">DZD</span>
                    </span>
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
