import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen, Search, FileText, CreditCard } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ClientLedgerEntry } from "@/types";

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="py-3.5 px-4">
          <div className="h-4 bg-slate-100 rounded-md w-full"></div>
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 flex items-center gap-2">
            <BookOpen size={24} className="text-primary-600" />
            {t("nav.global_ledger", "Grand Livre Clients")}
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> {t("common.entries", "écritures enregistrées")}
          </p>
        </div>
      </div>

      {/* Filters Card */}
      <div className="card p-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs flex flex-col md:flex-row items-end gap-3.5">
        <div className="flex-1 w-full">
          <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Recherche</label>
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Client, description, référence..."
              className="form-input ps-9 rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs w-full"
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
        <div className="w-full md:w-44">
          <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Type d'écriture</label>
          <select
            className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs w-full"
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
            <option value="">Tous les types</option>
            <option value="debit">Débits (Factures)</option>
            <option value="credit">Crédits (Paiements)</option>
          </select>
        </div>
        <div className="w-full md:w-36">
          <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Du</label>
          <input
            type="date"
            className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs w-full"
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
        <div className="w-full md:w-36">
          <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Au</label>
          <input
            type="date"
            className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs w-full"
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

      {/* Ledger Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("common.date")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("invoice.client")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("common.description", "Description")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("client.reference")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("client.debit", "Débit (Facturé)")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("client.credit", "Crédit (Versé)")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("client.balance_after", "Solde après")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}

              {!isLoading && entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                    {t("client.no_ledger_entries", "Aucune écriture trouvée.")}
                  </td>
                </tr>
              )}

              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3 text-slate-500 text-xs font-mono whitespace-nowrap">
                    {formatDate(entry.date)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/clients/${entry.client_id}`}
                      className="font-semibold text-slate-900 hover:text-primary-600 transition-colors font-sans text-sm"
                    >
                      {entry.client_name || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-xs text-slate-600 font-medium">
                    {entry.description || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {entry.reference_type === "Invoice" && entry.reference_id ? (
                      <Link 
                        to={`/invoices/${entry.reference_id}/edit`} 
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60 transition-colors"
                        title="Ouvrir la facture"
                      >
                        <FileText size={12} />
                        <span className="font-mono text-xs font-semibold">FA-{entry.reference_id.substring(0,8)}</span>
                      </Link>
                    ) : entry.reference_type && entry.reference_id ? (
                      <div
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200/60"
                        title={entry.reference_type}
                      >
                        <CreditCard size={12} className="text-slate-500" />
                        <span className="font-mono text-xs font-medium">
                          {entry.reference_type === 'InvoicePayment' ? 'PMT' : entry.reference_type.substring(0,3).toUpperCase()}-{entry.reference_id.substring(0,8)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end font-mono">
                    {entry.entry_type === "debit" ? (
                      <span className="text-rose-600 font-semibold tabular-nums text-xs">
                        +{formatDZD(entry.amount)} <span className="text-2xs font-normal text-rose-400">DZD</span>
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end font-mono">
                    {entry.entry_type === "credit" ? (
                      <span className="text-emerald-600 font-semibold tabular-nums text-xs">
                        -{formatDZD(entry.amount)} <span className="text-2xs font-normal text-emerald-400">DZD</span>
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end font-mono font-semibold tabular-nums text-xs">
                    <span
                      className={cn(
                        parseFloat(entry.balance_after) > 0 ? "text-amber-700" : "text-emerald-700"
                      )}
                    >
                      {formatDZD(entry.balance_after)} <span className="text-2xs font-normal text-slate-400">DZD</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.count > 0 && (
          <div className="px-4 py-3.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
            <span className="text-xs font-medium text-slate-500">
              {t("common.page")} <span className="font-semibold text-slate-800">{page}</span> {data.next ? `(${t("common.more_results")})` : ""}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
              >
                {t("common.previous", "Précédent")}
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.next}
                className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
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
