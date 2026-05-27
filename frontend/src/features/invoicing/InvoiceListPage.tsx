import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, FileText, Download, Loader2 } from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Invoice } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyée" },
  { value: "partial", label: "Partielle" },
  { value: "paid", label: "Payée" },
  { value: "overdue", label: "En retard" },
];

export default function InvoiceListPage() {
  const { t } = useTranslation();
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
      const blob = new Blob([response.data as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      // Revoke after the browser has had time to load the blob
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!tab) {
        // Fallback: trigger a direct download if popup was blocked
        const a = document.createElement("a");
        a.href = url;
        a.download = `facture-${invoiceId}.pdf`;
        a.click();
      }
    } catch (err) {
      setPdfError(getApiError(err));
    } finally {
      setLoadingPdfId(null);
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.invoice_list")}</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} factures</p>
        </div>
        <a href="/invoices/new" className="btn-primary">
          <Plus size={16} />
          {t("invoice.new")}
        </a>
      </div>

      {/* PDF error banner */}
      {pdfError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
          <span className="flex-1">{pdfError}</span>
          <button onClick={() => setPdfError(null)} className="text-danger hover:opacity-70">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9"
            placeholder="N° ou client..."
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="form-input max-w-[160px]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      {totalDue > 0 && (
        <div className="card px-4 py-3 bg-warning-light border-warning">
          <span className="text-sm text-warning font-medium">
            Solde total à percevoir sur cette page:{" "}
            <strong className="font-mono">{formatDZD(totalDue)} DZD</strong>
          </span>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("invoice.number")}</th>
                <th>{t("invoice.client")}</th>
                <th>{t("invoice.date")}</th>
                <th>{t("invoice.due_date")}</th>
                <th>{t("invoice.status")}</th>
                <th className="text-end">Total TTC</th>
                <th className="text-end">{t("invoice.balance_due")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">{t("common.loading")}</td>
                </tr>
              )}
              {!isLoading && invoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">{t("common.no_data")}</td>
                </tr>
              )}
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-text-muted flex-shrink-0" />
                      <span className="font-mono font-medium">{invoice.number || `#${invoice.id}`}</span>
                    </div>
                  </td>
                  <td>{invoice.client_name || "—"}</td>
                  <td className="text-text-muted">{formatDate(invoice.date)}</td>
                  <td>
                    <span
                      className={cn(
                        "text-sm",
                        invoice.status === "overdue" ? "text-danger font-medium" : "text-text-muted"
                      )}
                    >
                      {formatDate(invoice.due_date)}
                    </span>
                  </td>
                  <td>
                    <span className={cn("badge", getStatusBadgeClass(invoice.status))}>
                      {t(`invoice.status_${invoice.status}` as any, { defaultValue: invoice.status })}
                    </span>
                  </td>
                  <td className="text-end font-mono">
                    {formatDZD(invoice.total_ttc)} <span className="text-2xs text-text-muted">DZD</span>
                  </td>
                  <td className="text-end">
                    <span
                      className={cn(
                        "font-mono font-medium",
                        parseFloat(invoice.balance_due) > 0 ? "text-danger" : "text-success"
                      )}
                    >
                      {formatDZD(invoice.balance_due)} DZD
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openPdf(invoice.id)}
                        disabled={loadingPdfId === invoice.id}
                        className="btn-ghost btn-sm text-primary-500 disabled:opacity-50"
                        title="Ouvrir PDF"
                      >
                        {loadingPdfId === invoice.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Download size={14} />
                        }
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Page {data.current_page} / {data.total_pages} · {data.count} factures
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
