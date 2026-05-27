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
import { cn } from "@/lib/utils";

// ── Invoice search dropdown ────────────────────────────────────────────────────

function InvoiceSearchInput({
  value,
  onSelect,
}: {
  value: Invoice | null;
  onSelect: (inv: Invoice) => void;
}) {
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
        // Only search confirmed (non-draft) invoices that don't already have a BL
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
          ? <Loader2 size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
          : <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        }
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="form-input ps-9"
          placeholder="Rechercher par N° ou client..."
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          {results.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onMouseDown={() => pick(inv)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface text-start transition-colors"
            >
              <FileText size={14} className="text-text-muted mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-sm text-text-primary">
                    {inv.number || `#${inv.id}`}
                  </span>
                  <span className="badge badge-info text-xs">{inv.status}</span>
                </div>
                <div className="text-xs text-text-muted truncate">
                  {inv.client_name || "Sans client"} · {formatDate(inv.date)} · {formatDZD(inv.total_ttc)} DZD
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
    }).catch(() => {});
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
    if (!form.invoice_id) { setFormError("Veuillez sélectionner une facture."); return; }
    if (!form.number.trim()) { setFormError("Le numéro du BL est obligatoire."); return; }
    if (!form.date) { setFormError("La date est obligatoire."); return; }
    setFormError(null);
    saveMutation.mutate();
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link to="/delivery-notes" className="text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Nouveau Bon de Livraison</h1>
          <p className="text-sm text-text-muted">Associez un BL à une facture confirmée.</p>
        </div>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4">

        {formError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span className="flex-1">{formError}</span>
            <button type="button" onClick={() => setFormError(null)}><X size={14} /></button>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 px-4 py-3 bg-success/10 border border-success/30 rounded-lg text-sm text-success">
            <CheckCircle size={14} /> BL créé avec succès. Redirection...
          </div>
        )}

        {/* Facture liée */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <FileText size={14} className="text-primary-500" />
            Facture associée
          </h2>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Facture <span className="text-danger">*</span>
            </label>
            <InvoiceSearchInput value={selectedInvoice} onSelect={handleInvoiceSelect} />
          </div>

          {/* Invoice preview card */}
          {selectedInvoice && (
            <div className="rounded-lg border border-primary-200 bg-primary-50/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-text-primary">
                  {selectedInvoice.number || `#${selectedInvoice.id}`}
                </span>
                <span className={cn("badge", "badge-info")}>{selectedInvoice.status}</span>
              </div>
              <div className="text-sm text-text-muted">
                Client : <strong className="text-text-primary">{selectedInvoice.client_name || "—"}</strong>
              </div>
              <div className="flex gap-4 text-xs text-text-muted">
                <span>Date : {formatDate(selectedInvoice.date)}</span>
                <span>Total TTC : {formatDZD(selectedInvoice.total_ttc)} DZD</span>
              </div>
            </div>
          )}
        </div>

        {/* BL details */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <Truck size={14} className="text-primary-500" />
            Informations du BL
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                N° BL <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                className="form-input font-mono"
                placeholder="BL-FA-2026-00001"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Date de livraison <span className="text-danger">*</span>
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="form-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Livré par
            </label>
            <input
              type="text"
              value={form.delivered_by}
              onChange={(e) => setForm((f) => ({ ...f, delivered_by: e.target.value }))}
              className="form-input"
              placeholder="Nom du livreur ou transporteur"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="form-input resize-none"
              rows={2}
              placeholder="Remarques sur la livraison..."
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link to="/delivery-notes" className="btn-secondary">Annuler</Link>
          <button
            type="submit"
            disabled={saveMutation.isPending || saved || !form.invoice_id}
            className="btn-primary"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Création…</>
            ) : (
              <><Save size={14} /> Créer le BL</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
