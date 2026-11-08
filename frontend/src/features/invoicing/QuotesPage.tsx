import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  FileSpreadsheet,
  Download,
  Loader2,
  MessageCircle,
  XCircle,
  Edit2,
  Send,
  CheckCircle2,
  FileText,
  Truck,
  ArrowRight,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Quote, QuoteStatus } from "@/types";
import { cn } from "@/lib/utils";
import { viewPdfDocument } from "@/lib/pdfViewer";

export default function QuotesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [loadingPdfId, setLoadingPdfId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const statusOptions = [
    { value: "", label: t("quote.status_all", "Tous") },
    { value: "draft", label: t("quote.status_draft", "Brouillon") },
    { value: "sent", label: t("quote.status_sent", "Envoyé") },
    { value: "accepted", label: t("quote.status_accepted", "Accepté") },
    { value: "expired", label: t("quote.status_expired", "Expiré") },
    { value: "converted", label: t("quote.status_converted", "Converti") },
    { value: "cancelled", label: t("quote.status_cancelled", "Annulé") },
  ];

  const { data, isLoading } = useQuery<PaginatedResponse<Quote>>({
    queryKey: ["quotes", { search, status: statusFilter, page }],
    queryFn: () =>
      api
        .get(
          `/invoicing/quotes/?search=${encodeURIComponent(search)}&status=${statusFilter}&page=${page}`
        )
        .then((r) => r.data),
  });

  const quotes = data?.results ?? [];

  async function openPdf(quoteId: string, quoteNumber: string) {
    setLoadingPdfId(quoteId);
    setBannerError(null);
    try {
      const response = await api.get(`/invoicing/quotes/${quoteId}/pdf/`, {
        responseType: "blob",
      });
      await viewPdfDocument(response.data, {
        title: `${t("quote.quote", "Devis")} #${quoteNumber || quoteId}`,
        filename: `devis-${quoteNumber || quoteId}`,
      });
    } catch (err) {
      setBannerError(getApiError(err));
    } finally {
      setLoadingPdfId(null);
    }
  }

  function shareWhatsApp(quote: Quote) {
    const msg =
      `*${t("quote.whatsapp_header", "Devis / Facture Proforma")} — ${quote.client_name || t("quote.client_fallback", "Client")}*\n` +
      `N° ${quote.number || quote.id}\n` +
      `${t("quote.date", "Date")} : ${formatDate(quote.date)} · ${t("quote.valid_until", "Validité")} : ${formatDate(quote.valid_until)}\n` +
      `${t("quote.total_ttc", "Total TTC")} : *${formatDZD(quote.total_ttc)} DZD*`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  async function handleSend(quoteId: string) {
    setActionLoadingId(quoteId);
    setBannerError(null);
    try {
      await api.post(`/invoicing/quotes/${quoteId}/send/`);
      setBannerSuccess(t("quote.sent_success", "Devis marqué comme envoyé."));
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (err) {
      setBannerError(getApiError(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleAccept(quoteId: string) {
    setActionLoadingId(quoteId);
    setBannerError(null);
    try {
      await api.post(`/invoicing/quotes/${quoteId}/accept/`);
      setBannerSuccess(t("quote.accepted_success", "Devis accepté par le client."));
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (err) {
      setBannerError(getApiError(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCancel(quoteId: string) {
    if (!window.confirm(t("quote.confirm_cancel", "Êtes-vous sûr de vouloir annuler ce devis ?"))) {
      return;
    }
    setActionLoadingId(quoteId);
    setBannerError(null);
    try {
      await api.post(`/invoicing/quotes/${quoteId}/cancel/`);
      setBannerSuccess(t("quote.cancelled_success", "Devis annulé."));
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (err) {
      setBannerError(getApiError(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleConvertToInvoice(quoteId: string) {
    if (
      !window.confirm(
        t("quote.confirm_convert_invoice", "Créer un brouillon de facture à partir de ce devis ?")
      )
    ) {
      return;
    }
    setActionLoadingId(quoteId);
    setBannerError(null);
    try {
      const resp = await api.post(`/invoicing/quotes/${quoteId}/convert-to-invoice/`);
      setBannerSuccess(
        t("quote.converted_invoice_success", "Facture créée avec succès (N° {{number}}).", {
          number: resp.data.invoice_number,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    } catch (err) {
      setBannerError(getApiError(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleConvertToBL(quoteId: string) {
    if (
      !window.confirm(
        t("quote.confirm_convert_bl", "Créer un bon de livraison à partir de ce devis ?")
      )
    ) {
      return;
    }
    setActionLoadingId(quoteId);
    setBannerError(null);
    try {
      const resp = await api.post(`/invoicing/quotes/${quoteId}/convert-to-delivery-note/`);
      setBannerSuccess(
        t("quote.converted_bl_success", "Bon de livraison créé avec succès (N° {{number}}).", {
          number: resp.data.delivery_note_number,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
    } catch (err) {
      setBannerError(getApiError(err));
    } finally {
      setActionLoadingId(null);
    }
  }

  function getStatusBadge(status: QuoteStatus) {
    switch (status) {
      case "draft":
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
      case "sent":
        return "bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800";
      case "accepted":
        return "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
      case "expired":
        return "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
      case "converted":
        return "bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800";
      case "cancelled":
        return "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
      default:
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="text-primary-600 dark:text-primary-400" size={24} />
            {t("quote.title", "Devis & Proformas")}
          </h1>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
              {data?.count ?? 0}
            </span>{" "}
            {t("quote.count_recorded", "devis enregistrés")}
          </p>
        </div>
        <Link
          to="/quotes/new"
          className="btn-primary rounded-xl shadow-xs shadow-primary-500/20 inline-flex items-center gap-2"
        >
          <Plus size={16} />
          {t("quote.new", "Nouveau Devis")}
        </Link>
      </div>

      {/* Success banner */}
      {bannerSuccess && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs font-medium text-emerald-700 dark:text-emerald-300 animate-in fade-in">
          <CheckCircle2 size={15} />
          <span className="flex-1">{bannerSuccess}</span>
          <button
            onClick={() => setBannerSuccess(null)}
            className="text-emerald-500 hover:text-emerald-800 dark:hover:text-emerald-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error banner */}
      {bannerError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-xs font-medium text-rose-700 dark:text-rose-300 animate-in fade-in">
          <span className="flex-1">{bannerError}</span>
          <button
            onClick={() => setBannerError(null)}
            className="text-rose-500 hover:text-rose-800 dark:hover:text-rose-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            size={15}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("quote.search_placeholder", "Rechercher par N° devis ou client...")}
            className="input w-full ps-9 text-xs rounded-xl border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setStatusFilter(opt.value);
                setPage(1);
              }}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer",
                statusFilter === opt.value
                  ? "bg-primary-600 text-white shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/75 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 text-start">{t("quote.number", "N° Devis")}</th>
                <th className="py-3 px-4 text-start">{t("quote.client", "Client")}</th>
                <th className="py-3 px-4 text-start">{t("quote.date", "Date")}</th>
                <th className="py-3 px-4 text-start">{t("quote.valid_until", "Validité")}</th>
                <th className="py-3 px-4 text-end">{t("quote.total_ttc", "Total TTC")}</th>
                <th className="py-3 px-4 text-center">{t("quote.status", "Statut")}</th>
                <th className="py-3 px-4 text-start">{t("quote.converted_doc", "Conversion")}</th>
                <th className="py-3 px-4 text-end">{t("quote.actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                    {t("app.loading", "Chargement...")}
                  </td>
                </tr>
              )}

              {!isLoading && quotes.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <FileSpreadsheet size={32} className="mx-auto mb-2 opacity-40" />
                    {t("quote.no_quotes_found", "Aucun devis trouvé.")}
                  </td>
                </tr>
              )}

              {!isLoading &&
                quotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                      {quote.number || quote.id.slice(0, 8)}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                      {quote.client_name || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {formatDate(quote.date)}
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {formatDate(quote.valid_until)}
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-bold text-slate-900 dark:text-white">
                      {formatDZD(quote.total_ttc)} DZD
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={cn(
                          "inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide capitalize",
                          getStatusBadge(quote.status)
                        )}
                      >
                        {statusOptions.find((o) => o.value === quote.status)?.label || quote.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {quote.converted_invoice_number && (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                          <FileText size={12} />
                          <span>{quote.converted_invoice_number}</span>
                        </div>
                      )}
                      {quote.converted_delivery_note_number && (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <Truck size={12} />
                          <span>{quote.converted_delivery_note_number}</span>
                        </div>
                      )}
                      {!quote.converted_invoice_number && !quote.converted_delivery_note_number && (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-end">
                      <div className="flex items-center justify-end gap-1">
                        {/* PDF */}
                        <button
                          type="button"
                          onClick={() => openPdf(quote.id, quote.number)}
                          disabled={loadingPdfId === quote.id}
                          className="p-1.5 text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          title={t("quote.open_pdf", "Imprimer / Ouvrir PDF")}
                        >
                          {loadingPdfId === quote.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                        </button>

                        {/* WhatsApp */}
                        <button
                          type="button"
                          onClick={() => shareWhatsApp(quote)}
                          className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors cursor-pointer"
                          title={t("quote.share_whatsapp", "Partager sur WhatsApp")}
                        >
                          <MessageCircle size={14} />
                        </button>

                        {/* Edit (draft or sent only) */}
                        {(quote.status === "draft" || quote.status === "sent") && (
                          <button
                            type="button"
                            onClick={() => navigate(`/quotes/${quote.id}/edit`)}
                            className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title={t("quote.edit", "Modifier")}
                          >
                            <Edit2 size={14} />
                          </button>
                        )}

                        {/* Send (if draft) */}
                        {quote.status === "draft" && (
                          <button
                            type="button"
                            onClick={() => handleSend(quote.id)}
                            disabled={actionLoadingId === quote.id}
                            className="p-1.5 text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title={t("quote.mark_sent", "Marquer comme envoyé")}
                          >
                            <Send size={14} />
                          </button>
                        )}

                        {/* Accept (if sent) */}
                        {quote.status === "sent" && (
                          <button
                            type="button"
                            onClick={() => handleAccept(quote.id)}
                            disabled={actionLoadingId === quote.id}
                            className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title={t("quote.mark_accepted", "Marquer comme accepté")}
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        )}

                        {/* Convert to Invoice */}
                        {quote.status !== "converted" && quote.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => handleConvertToInvoice(quote.id)}
                            disabled={actionLoadingId === quote.id}
                            className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title={t("quote.convert_to_invoice", "Convertir en Facture")}
                          >
                            <FileText size={14} />
                          </button>
                        )}

                        {/* Convert to BL */}
                        {quote.status !== "converted" && quote.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => handleConvertToBL(quote.id)}
                            disabled={actionLoadingId === quote.id}
                            className="p-1.5 text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title={t("quote.convert_to_bl", "Convertir en Bon de Livraison")}
                          >
                            <Truck size={14} />
                          </button>
                        )}

                        {/* Cancel */}
                        {quote.status !== "converted" && quote.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => handleCancel(quote.id)}
                            disabled={actionLoadingId === quote.id}
                            className="p-1.5 text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title={t("quote.cancel", "Annuler le devis")}
                          >
                            <XCircle size={14} />
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {t("app.page", "Page")} {page} / {data.total_pages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-secondary px-3 py-1 text-xs rounded-lg disabled:opacity-40"
              >
                {t("app.previous", "Précédent")}
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                disabled={page >= data.total_pages}
                className="btn-secondary px-3 py-1 text-xs rounded-lg disabled:opacity-40"
              >
                {t("app.next", "Suivant")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

