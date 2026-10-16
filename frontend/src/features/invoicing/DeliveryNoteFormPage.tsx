/**
 * DeliveryNoteFormPage — /delivery-notes/new
 *
 * Creates a BL (Bon de Livraison) linked to a confirmed invoice.
 * POST /invoicing/delivery-notes/
 *
 * Fields: invoice (searchable select), number (auto-filled), date, delivered_by, notes.
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle,
  X,
  Search,
  Truck,
  FileText,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";
import type { Invoice } from "@/types";

// ── Invoice search dropdown ────────────────────────────────────────────────────

function InvoiceSearchInput({
  value,
  onSelect,
}: {
  value: Invoice | null;
  onSelect: (inv: Invoice) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(value?.number ?? "");
  const [results, setResults] = useState<Invoice[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) setQuery(value.number || `Facture #${value.id}`);
  }, [value?.id]);

  function search(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(
          `/invoicing/invoices/?search=${encodeURIComponent(q)}&page_size=8`
        );
        const confirmed = (res.data.results as Invoice[]).filter(
          (inv) => inv.status !== "draft" && inv.status !== "cancelled"
        );
        setResults(confirmed);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function pick(inv: Invoice) {
    setQuery(inv.number || `Facture #${inv.id}`);
    setResults([]);
    setOpen(false);
    onSelect(inv);
  }

  return (
    <div className="relative">
      <div className="relative">
        {loading
          ? <Loader2 size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
          : <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        }
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="input w-full ps-9 rounded-xl border-slate-200 focus:border-primary-500 focus:ring-primary-500/20 text-sm"
          placeholder={t("invoice.search_placeholder")}
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-20 w-full mt-1.5 bg-white border border-slate-200/80 rounded-xl shadow-xl overflow-hidden divide-y divide-slate-100">
          {results.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onMouseDown={() => pick(inv)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 text-start transition-colors"
            >
              <FileText size={15} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm text-slate-900">
                    {inv.number || `#${inv.id}`}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    {inv.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 truncate mt-0.5">
                  {inv.client_name || t("invoice.no_client")} · {formatDate(inv.date)} · <span className="font-mono font-medium text-slate-700">{formatDZD(inv.total_ttc)} DZD</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface FormState {
  invoice_id: number | null;
  number: string;
  date: string;
  delivered_by: string;
  notes: string;
}

export default function DeliveryNoteFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const today = new Date().toISOString().split("T")[0];
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState<FormState>({
    invoice_id: null,
    number: "",
    date: today,
    delivered_by: "",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Support pre-selecting an invoice via ?invoice=<id> query param
  useEffect(() => {
    const invoiceId = searchParams.get("invoice");
    if (!invoiceId) return;
    api.get(`/invoicing/invoices/${invoiceId}/`).then((r) => {
      const inv: Invoice = r.data;
      setSelectedInvoice(inv);
      setForm((f) => ({
        ...f,
        invoice_id: inv.id,
        number: `BL-${inv.number || inv.id}`,
      }));
    }).catch(() => setFormError(t("invoice.error_load_invoice")));
  }, []);

  function handleInvoiceSelect(inv: Invoice) {
    setSelectedInvoice(inv);
    setForm((f) => ({
      ...f,
      invoice_id: inv.id,
      number: f.number || `BL-${inv.number || inv.id}`,
    }));
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post("/invoicing/delivery-notes/", {
        invoice: form.invoice_id,
        number: form.number,
        date: form.date,
        delivered_by: form.delivered_by,
        notes: form.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      setSaved(true);
      setTimeout(() => navigate("/delivery-notes"), 800);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.invoice_id) { setFormError(t("invoice.error_select_invoice")); return; }
    if (!form.number.trim()) { setFormError(t("invoice.error_bl_number")); return; }
    if (!form.date) { setFormError(t("invoice.error_date")); return; }
    setFormError(null);
    saveMutation.mutate();
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link
          to="/delivery-notes"
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("invoice.new_delivery_note_title")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">{t("invoice.link_bl_desc")}</p>
        </div>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-5">

        {formError && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 shadow-2xs">
            <AlertTriangle size={15} className="shrink-0 text-rose-500" />
            <span className="flex-1 font-medium">{formError}</span>
            <button type="button" onClick={() => setFormError(null)} className="text-rose-500 hover:text-rose-700">
              <X size={15} />
            </button>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 shadow-2xs">
            <CheckCircle size={15} className="text-emerald-500 shrink-0" />
            <span className="font-medium">{t("invoice.bl_created_success")}</span>
          </div>
        )}

        {/* Facture liée */}
        <div className="card bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <FileText size={16} className="text-primary-600" />
            {t("invoice.linked_invoice")}
          </h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t("invoice.invoice")} <span className="text-rose-500">*</span>
            </label>
            <InvoiceSearchInput value={selectedInvoice} onSelect={handleInvoiceSelect} />
          </div>

          {/* Invoice preview card */}
          {selectedInvoice && (
            <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-slate-900">
                  {selectedInvoice.number || `#${selectedInvoice.id}`}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  {selectedInvoice.status}
                </span>
              </div>
              <div className="text-sm text-slate-600">
                Client : <strong className="text-slate-900">{selectedInvoice.client_name || "—"}</strong>
              </div>
              <div className="flex gap-4 text-xs text-slate-500 font-mono">
                <span>Date : <strong className="text-slate-700">{formatDate(selectedInvoice.date)}</strong></span>
                <span>Total TTC : <strong className="text-slate-700">{formatDZD(selectedInvoice.total_ttc)} DZD</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* BL details */}
        <div className="card bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <Truck size={16} className="text-primary-600" />
            Informations du BL
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                N° BL <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                className="input w-full font-mono rounded-xl border-slate-200 text-sm"
                placeholder="BL-FA-2026-00001"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("invoice.delivery_date")} <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="input w-full rounded-xl border-slate-200 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("invoice.delivered_by")}</label>
            <input
              type="text"
              value={form.delivered_by}
              onChange={(e) => setForm((f) => ({ ...f, delivered_by: e.target.value }))}
              className="input w-full rounded-xl border-slate-200 text-sm"
              placeholder="Nom du livreur ou transporteur"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("invoice.notes")}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="input w-full resize-none rounded-xl border-slate-200 text-sm"
              rows={2}
              placeholder="Remarques sur la livraison..."
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            to="/delivery-notes"
            className="btn-secondary px-4 py-2 text-sm font-medium rounded-xl"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={saveMutation.isPending || saved || !form.invoice_id}
            className="btn-primary inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl shadow-xs disabled:opacity-50"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={15} className="animate-spin" /> Création…</>
            ) : (
              <><Save size={15} /> Créer le BL</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
