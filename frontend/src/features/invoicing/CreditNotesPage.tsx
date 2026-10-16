/**
 * CreditNotesPage — Avoirs
 * Lists credit notes from GET /invoicing/credit-notes/
 * Columns: N°Avoir, Client, Facture d'origine, Date, Motif, Montant HT, Montant TTC
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
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.credit_notes")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> avoir(s) émis
          </p>
        </div>
        <Link
          to="/credit-notes/new"
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl shadow-xs"
        >
          <Plus size={16} />
          {t("invoice.new_credit_note")}
        </Link>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-sm">
        <Search
          size={16}
          className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input w-full ps-9 rounded-xl border-slate-200 focus:border-primary-500 focus:ring-primary-500/20 text-sm"
          placeholder={t("invoice.search_credit_client")}
        />
      </div>

      {/* ── Table ── */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3.5 text-start">{t("invoice.credit_number")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.client")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.original_invoice")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.date")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.reason")}</th>
                <th className="px-4 py-3.5 text-end">{t("invoice.total_ht")}</th>
                <th className="px-4 py-3.5 text-end">{t("invoice.total_ttc")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span>{t("common.loading")}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && credits.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 font-medium">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}
              {credits.map((credit) => (
                <tr key={credit.id} className="hover:bg-slate-50/70 transition-colors">
                  {/* N°Avoir */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <FileX size={15} className="text-slate-400 shrink-0" />
                      <span className="font-mono font-semibold text-slate-900">
                        {credit.number || `AV-${credit.id}`}
                      </span>
                    </div>
                  </td>

                  {/* Client */}
                  <td className="px-4 py-3.5 font-medium text-slate-900">
                    {credit.client_name || "—"}
                  </td>

                  {/* Facture d'origine */}
                  <td className="px-4 py-3.5">
                    <span className="font-mono text-xs font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md">
                      {credit.original_invoice_number || `#${credit.original_invoice}`}
                    </span>
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3.5 text-slate-500 text-xs font-mono">{formatDate(credit.date)}</td>

                  {/* Motif */}
                  <td className="px-4 py-3.5 text-sm text-slate-500 max-w-[200px]">
                    <span className="truncate block" title={credit.reason || undefined}>
                      {truncateReason(credit.reason)}
                    </span>
                  </td>

                  {/* Montant HT */}
                  <td className="px-4 py-3.5 text-end font-mono font-semibold text-sm text-slate-800 tabular-nums">
                    {formatDZD(credit.total_ht)}{" "}
                    <span className="text-2xs text-slate-400 font-normal">DZD</span>
                  </td>

                  {/* Total TTC (displayed as negative) */}
                  <td className="px-4 py-3.5 text-end">
                    <span className="font-mono text-sm text-rose-600 font-bold tabular-nums">
                      − {formatDZD(credit.total_ttc)}{" "}
                      <span className="text-2xs font-normal opacity-70">DZD</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
            <span className="text-xs font-medium text-slate-500">
              Page <span className="font-semibold text-slate-800">{data.current_page}</span> / {data.total_pages} · {data.count} avoir(s)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.next}
                className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
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
