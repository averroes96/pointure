import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, FileText, Download, Loader2, MessageCircle, XCircle, Edit2 } from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Invoice } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { viewPdfDocument } from "@/lib/pdfViewer";
import i18n from "@/lib/i18n";
const t = i18n.t.bind(i18n);

const STATUS_OPTIONS = [
  { value: "", label: t("invoice.status_all") },
  { value: "draft", label: t("invoice.status_draft") },
  { value: "sent", label: t("invoice.status_sent") },
  { value: "partial", label: t("invoice.status_partial") },
  { value: "paid", label: t("invoice.status_paid") },
  { value: "overdue", label: t("invoice.status_overdue") },
];

export default function InvoiceListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  // Track which invoice PDF is currently being fetched (shows spinner)
  const [loadingPdfId, setLoadingPdfId] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  /**
   * Fetch the PDF via the authenticated Axios instance (so the JWT token is
   * included), create a temporary blob URL, and open it in a new tab.
   * A plain <a href> navigation can't send custom headers — that's why the
   * old approach got a 401.
   */
  async function openPdf(invoiceId: number) {
    setLoadingPdfId(invoiceId);
    setPdfError(null);
    try {
      const response = await api.get(
        `/invoicing/invoices/${invoiceId}/pdf/`,
        { responseType: "blob" }
      );
      await viewPdfDocument(response.data, {
        title: `${t("invoice.invoice")} #${invoiceId}`,
        filename: `facture-${invoiceId}`,
      });
    } catch (err) {
      setPdfError(getApiError(err));
    } finally {
      setLoadingPdfId(null);
    }
  }

  const queryClient = useQueryClient();

  async function cancelInvoice(invoiceId: number) {
    if (!window.confirm(t("Êtes-vous sûr de vouloir annuler cette facture ?"))) return;
    try {
      await api.post(`/invoicing/invoices/${invoiceId}/cancel/`);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    } catch (err) {
      alert(getApiError(err));
    }
  }

  const { data, isLoading } = useQuery<PaginatedResponse<Invoice>>({
    queryKey: ["invoices", { search, status, page }],
    queryFn: () =>
      api.get(
        `/invoicing/invoices/?search=${search}&status=${status}&page=${page}`
      ).then((r) => r.data),
  });

  const invoices = data?.results ?? [];
  const totalDue = invoices.reduce((sum, inv) => sum + parseFloat(inv.balance_due || "0"), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.invoice_list")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> factures enregistrées
          </p>
        </div>
        <a href="/invoices/new" className="btn-primary rounded-xl shadow-xs shadow-primary-500/20">
          <Plus size={16} />
          {t("invoice.new")}
        </a>
      </div>

      {/* PDF error banner */}
      {pdfError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-medium text-rose-700 animate-in fade-in">
          <span className="flex-1">{pdfError}</span>
          <button onClick={() => setPdfError(null)} className="text-rose-500 hover:text-rose-800">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            data-shortcut-search="true"
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9 pe-12 bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20 text-xs"
            placeholder={t("invoice.search_placeholder")}
          />
          <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md shadow-2xs pointer-events-none">
            F2
          </kbd>
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="form-input max-w-[170px] bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20 text-xs"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      {totalDue > 0 && (
        <div className="rounded-2xl border border-amber-200/90 bg-amber-50/70 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            {t("invoice.total_balance_due_page")}
          </div>
          <span className="font-mono font-bold text-base text-amber-900 tabular-nums">
            {formatDZD(totalDue)} <span className="text-xs font-normal text-amber-700">DZD</span>
          </span>
        </div>
      )}

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("invoice.number")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("invoice.client")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("common.creation")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("invoice.date")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("invoice.due_date")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("invoice.status")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("invoice.total_ttc")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("invoice.balance_due")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 text-sm">{t("common.loading")}</td>
                </tr>
              )}
              {!isLoading && invoices.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 text-sm">{t("common.no_data")}</td>
                </tr>
              )}
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-slate-400 shrink-0" />
                      <span className="font-mono font-semibold text-xs text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60">
                        {invoice.number || `#${invoice.id}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-slate-900 font-sans text-sm">
                    {invoice.client_name ? (
                      <Link to={`/clients/${invoice.client}`} className="hover:text-primary-600 transition-colors">
                        {invoice.client_name}
                      </Link>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-500 text-xs font-mono">
                    {new Date(invoice.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' })}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 text-xs font-mono">{formatDate(invoice.date)}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "text-xs font-mono",
                        invoice.status === "overdue" ? "text-rose-600 font-semibold" : "text-slate-500"
                      )}
                    >
                      {formatDate(invoice.due_date)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-semibold border capitalize",
                        invoice.status === "paid"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : invoice.status === "partial"
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : invoice.status === "overdue"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : invoice.status === "sent"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : invoice.status === "cancelled"
                          ? "bg-slate-100 text-slate-400 border-slate-200 line-through"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      )}
                    >
                      {t(`invoice.status_${invoice.status}` as any, { defaultValue: invoice.status })}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 tabular-nums">
                    {formatDZD(invoice.total_ttc)} <span className="text-2xs text-slate-400 font-normal">DZD</span>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <span
                      className={cn(
                        "font-mono font-bold text-sm tabular-nums",
                        parseFloat(invoice.balance_due) > 0 ? "text-rose-600" : "text-emerald-600"
                      )}
                    >
                      {formatDZD(invoice.balance_due)} <span className="text-2xs font-normal opacity-70">DZD</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <div className="flex items-center gap-1 justify-end">
                      {parseFloat(invoice.total_paid) === 0 && invoice.status !== "cancelled" && (
                        <button
                          onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          title={t("invoice.edit_invoice", "Modifier la facture")}
                        >
                          <Edit2 size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => openPdf(invoice.id)}
                        disabled={loadingPdfId === invoice.id}
                        className="p-1.5 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
                        title={t("invoice.open_pdf")}
                      >
                        {loadingPdfId === invoice.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Download size={13} />
                        }
                      </button>
                      <button
                        onClick={() => {
                          const balanceLine = parseFloat(invoice.balance_due) > 0
                            ? `\nSolde dû : *${formatDZD(invoice.balance_due)} DZD*`
                            : "\n✅ Facture réglée";
                          const msg =
                            `*Facture — ${invoice.client_name || "Client"}*\n` +
                            `N° ${invoice.number || invoice.id}\n` +
                            `Date : ${formatDate(invoice.date)} · Échéance : ${formatDate(invoice.due_date)}\n` +
                            `Total TTC : *${formatDZD(invoice.total_ttc)} DZD*` +
                            balanceLine;
                          window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
                        }}
                        className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                        title={t("invoice.share_whatsapp")}
                      >
                        <MessageCircle size={13} />
                      </button>
                      {(invoice.status === "draft" || invoice.status === "sent") && parseFloat(invoice.total_ttc) === parseFloat(invoice.balance_due) && (
                        <button
                          onClick={() => cancelInvoice(invoice.id)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
                          title={t("invoice.cancel_invoice")}
                        >
                          <XCircle size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
            <span className="text-xs font-medium text-slate-500">
              Page <span className="font-semibold text-slate-800">{data.current_page}</span> / {data.total_pages} · {data.count} factures
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
