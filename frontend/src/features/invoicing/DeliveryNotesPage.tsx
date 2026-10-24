/**
 * DeliveryNotesPage — Bons de Livraison (BL)
 * Lists delivery notes from GET /invoicing/delivery-notes/
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, Truck, Download, Loader2, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { DeliveryNote } from "@/types";
import { cn } from "@/lib/utils";
import { viewPdfDocument } from "@/lib/pdfViewer";

export default function DeliveryNotesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loadingPdfId, setLoadingPdfId] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data, isLoading } = useQuery<PaginatedResponse<DeliveryNote>>({
    queryKey: ["delivery-notes", { search, page }],
    queryFn: () =>
      api
        .get(`/invoicing/delivery-notes/?search=${encodeURIComponent(search)}&page=${page}`)
        .then((r) => r.data),
  });

  const notes = data?.results ?? [];

  function toggleSelection(id: number) {
    setSelectedIds((prev) => 
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleRegrouper() {
    if (selectedIds.length === 0) return;
    
    const selectedNotes = notes.filter((n) => selectedIds.includes(n.id));
    const clientId = (selectedNotes[0] as any)?.client; 

    const today = new Date().toISOString().slice(0, 10);
    try {
      const res = await api.post("/invoicing/invoices/regrouper/", {
        client_id: clientId,
        delivery_note_ids: selectedIds,
        date: today,
        due_date: today,
      });
      alert("Facture générée : " + res.data.number);
      setSelectedIds([]);
      setPage(1);
    } catch (err) {
      alert("Erreur: " + getApiError(err));
    }
  }

  async function openPdf(noteId: number, number: string) {
    setLoadingPdfId(noteId);
    setPdfError(null);
    try {
      const res = await api.get(`/invoicing/delivery-notes/${noteId}/pdf/`, {
        responseType: "blob",
      });
      await viewPdfDocument(res.data, {
        title: `Bon de Livraison #${number || noteId}`,
        filename: `bl-${number || noteId}`,
      });
    } catch (err) {
      setPdfError(getApiError(err));
    } finally {
      setLoadingPdfId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.delivery_notes")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> bon(s) de livraison
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {selectedIds.length > 0 && (
            <button
              onClick={handleRegrouper}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors shadow-2xs"
            >
              <Layers size={15} />
              Regrouper ({selectedIds.length})
            </button>
          )}
          <Link
            to="/delivery-notes/new"
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl shadow-xs"
          >
            <Plus size={16} />
            {t("invoice.new_delivery_note")}
          </Link>
        </div>
      </div>

      {/* PDF error */}
      {pdfError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 shadow-2xs">
          <span className="flex-1 font-medium">{pdfError}</span>
          <button onClick={() => setPdfError(null)} className="text-rose-500 hover:text-rose-700 font-bold">✕</button>
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          data-shortcut-search="true"
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input w-full ps-9 pe-12 rounded-xl border-slate-200 focus:border-primary-500 focus:ring-primary-500/20 text-sm"
          placeholder={t("invoice.search_bl_client")}
        />
        <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded shadow-2xs pointer-events-none">
          F2
        </kbd>
      </div>

      {/* ── Table ── */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="w-10 px-4 py-3.5 text-center"></th>
                <th className="px-4 py-3.5 text-start">{t("invoice.bl_number")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.client")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.delivery_date")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.invoice")}</th>
                <th className="px-4 py-3.5 text-end">{t("invoice.total_ht")}</th>
                <th className="px-4 py-3.5 text-start">{t("invoice.delivered_by")}</th>
                <th className="px-4 py-3.5 text-end">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span>{t("common.loading")}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && notes.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 font-medium">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}
              {notes.map((note) => {
                const isSelected = selectedIds.includes(note.id);
                return (
                  <tr
                    key={note.id}
                    className={cn(
                      "transition-colors",
                      isSelected ? "bg-primary-50/60" : "hover:bg-slate-50/70"
                    )}
                  >
                    <td className="px-4 py-3.5 text-center">
                      <input 
                        type="checkbox" 
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500/20 cursor-pointer"
                        disabled={!!note.invoice}
                        checked={isSelected}
                        onChange={() => toggleSelection(note.id)}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Truck size={15} className="text-slate-400 shrink-0" />
                        <span className="font-mono font-semibold text-slate-900">
                          {note.number || `BL-${note.id}`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-slate-900">
                      {note.client_name || "—"}
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs font-mono">{formatDate(note.date)}</td>
                    <td className="px-4 py-3.5">
                      {note.invoice_number || note.invoice ? (
                        <span className="font-mono text-xs font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md">
                          {note.invoice_number || `#${note.invoice}`}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Non facturé</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 tabular-nums">
                      {formatDZD(note.invoice_total_ht)}{" "}
                      <span className="text-2xs text-slate-400 font-normal">DZD</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 text-xs font-medium">
                      {note.delivered_by || "—"}
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      <button
                        onClick={() => openPdf(note.id, note.number)}
                        disabled={loadingPdfId === note.id}
                        className="p-1.5 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center"
                        title={t("invoice.download_pdf")}
                      >
                        {loadingPdfId === note.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Download size={14} />
                        }
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data && data.total_pages > 1 && (
          <div className="px-4 py-3.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
            <span className="text-xs font-medium text-slate-500">
              Page <span className="font-semibold text-slate-800">{data.current_page}</span> / {data.total_pages} · {data.count} BL
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
