/**
 * DeliveryNotesPage — Bons de Livraison (BL)
 * Lists delivery notes from GET /invoicing/delivery-notes/
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, Truck, Download, Loader2, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { DeliveryNote } from "@/types";
import { cn } from "@/lib/utils";

export default function DeliveryNotesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loadingPdfId, setLoadingPdfId] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const navigate = useNavigate();

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
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function handleRegrouper() {
    if (selectedIds.length === 0) return;
    
    // We assume they selected BLs belonging to the SAME client.
    // In a real app, we'd enforce this via UI.
    const selectedNotes = notes.filter(n => selectedIds.includes(n.id));
    const clientId = (selectedNotes[0] as any)?.client; 
    // note: DeliveryNoteSerializer returns `client` as the ID.

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
      const blob = new Blob([res.data as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!tab) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `bl-${number || noteId}.pdf`;
        a.click();
      }
    } catch (err) {
      setPdfError(getApiError(err));
    } finally {
      setLoadingPdfId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.delivery_notes")}</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} bon(s) de livraison</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button onClick={handleRegrouper} className="btn-secondary text-primary-600 border-primary-600 hover:bg-primary-50">
              <Layers size={16} />
              Regrouper ({selectedIds.length})
            </button>
          )}
          <Link to="/delivery-notes/new" className="btn-primary">
            <Plus size={16} />{t("invoice.new_delivery_note")}</Link>
        </div>
      </div>

      {/* PDF error */}
      {pdfError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
          <span className="flex-1">{pdfError}</span>
          <button onClick={() => setPdfError(null)}>✕</button>
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative max-w-xs">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="form-input ps-9"
          placeholder={t("invoice.search_bl_client")}
        />
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>{t("invoice.bl_number")}</th>
                <th>{t("invoice.client")}</th>
                <th>{t("invoice.delivery_date")}</th>
                <th>{t("invoice.invoice")}</th>
                <th className="text-end">{t("invoice.total_ht")}</th>
                <th>{t("invoice.delivered_by")}</th>
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
              {!isLoading && notes.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}
              {notes.map((note) => (
                <tr key={note.id} className={selectedIds.includes(note.id) ? "bg-primary-50/50" : ""}>
                  <td>
                    <input 
                      type="checkbox" 
                      className="form-checkbox text-primary-600 rounded"
                      disabled={!!note.invoice}
                      checked={selectedIds.includes(note.id)}
                      onChange={() => toggleSelection(note.id)}
                    />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Truck size={14} className="text-text-muted flex-shrink-0" />
                      <span className="font-mono font-medium">
                        {note.number || `BL-${note.id}`}
                      </span>
                    </div>
                  </td>
                  <td className="font-medium text-text-primary">
                    {note.client_name || "—"}
                  </td>
                  <td className="text-text-muted">{formatDate(note.date)}</td>
                  <td>
                    <span className="font-mono text-sm text-primary-500">
                      {note.invoice_number || `#${note.invoice}`}
                    </span>
                  </td>
                  <td className="text-end font-mono text-sm">
                    {formatDZD(note.invoice_total_ht)}{" "}
                    <span className="text-2xs text-text-muted">DZD</span>
                  </td>
                  <td className="text-text-muted text-sm">
                    {note.delivered_by || "—"}
                  </td>
                  <td>
                    <button
                      onClick={() => openPdf(note.id, note.number)}
                      disabled={loadingPdfId === note.id}
                      className="btn-ghost btn-sm text-primary-500 disabled:opacity-50"
                      title={t("invoice.download_pdf")}
                    >
                      {loadingPdfId === note.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Download size={14} />
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Page {data.current_page} / {data.total_pages} · {data.count} BL
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(page - 1)} disabled={!data.previous} className="btn-secondary btn-sm">
                {t("common.previous")}
              </button>
              <button onClick={() => setPage(page + 1)} disabled={!data.next} className="btn-secondary btn-sm">
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
