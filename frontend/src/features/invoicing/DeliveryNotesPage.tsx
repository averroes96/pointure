/**
 * DeliveryNotesPage — Bons de Livraison (BL)
 * Lists delivery notes fetched from GET /invoicing/delivery-notes/
 * Columns: N°BL, Client, Date, Statut, Total HT, Actions
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, Truck, Download } from "lucide-react";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import type { Invoice } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";

// Delivery notes share the Invoice shape (series_prefix = "BL")
// The backend may expose /invoicing/delivery-notes/ or filter invoices by prefix.

const STATUS_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyé" },
  { value: "delivered", label: "Livré" },
  { value: "cancelled", label: "Annulé" },
];

// Map status values to French labels for delivery notes
const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  delivered: "Livré",
  partial: "Partiel",
  paid: "Payé",
  overdue: "En retard",
  cancelled: "Annulé",
};

export default function DeliveryNotesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<Invoice>>({
    queryKey: ["delivery-notes", { search, status, page }],
    queryFn: () =>
      api
        .get(
          `/invoicing/delivery-notes/?search=${encodeURIComponent(search)}&status=${status}&page=${page}`
        )
        .then((r) => r.data),
  });

  const notes = data?.results ?? [];

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Bons de Livraison</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} bon(s) de livraison</p>
        </div>
        <a href="/delivery-notes/new" className="btn-primary">
          <Plus size={16} />
          Nouveau BL
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
            placeholder="N°BL ou client..."
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
                <th>N°BL</th>
                <th>{t("invoice.client")}</th>
                <th>{t("invoice.date")}</th>
                <th>Statut</th>
                <th className="text-end">Total HT</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-text-muted">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && notes.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-text-muted">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}
              {notes.map((note) => (
                <tr key={note.id}>
                  {/* N°BL */}
                  <td>
                    <div className="flex items-center gap-2">
                      <Truck size={14} className="text-text-muted flex-shrink-0" />
                      <span className="font-mono font-medium">
                        {note.number || `BL-${note.id}`}
                      </span>
                    </div>
                  </td>

                  {/* Client */}
                  <td className="font-medium text-text-primary">
                    {note.client_name || "—"}
                  </td>

                  {/* Date */}
                  <td className="text-text-muted">{formatDate(note.date)}</td>

                  {/* Status */}
                  <td>
                    <span className={cn("badge", getStatusBadgeClass(note.status))}>
                      {STATUS_LABELS[note.status] ?? note.status}
                    </span>
                  </td>

                  {/* Total HT */}
                  <td className="text-end">
                    <span className="font-mono text-sm">
                      {formatDZD(note.total_ht)}{" "}
                      <span className="text-2xs text-text-muted">DZD</span>
                    </span>
                  </td>

                  {/* Actions */}
                  <td>
                    <div className="flex items-center gap-1">
                      <a
                        href={`/api/v1/invoicing/delivery-notes/${note.id}/pdf/`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost btn-sm text-primary-500"
                        title="Télécharger PDF"
                      >
                        <Download size={14} />
                      </a>
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
              Page {data.current_page} / {data.total_pages} · {data.count} BL
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
