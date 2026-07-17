/**
 * CreditNoteFormPage — /credit-notes/new
 *
 * Creates a Credit Note (Avoir) linked to an original invoice.
 * POST /invoicing/credit-notes/
 *
 * Fields: original_invoice (searchable), date, reason, total_ht,
 *         tva_amount (auto-calc), total_ttc (auto-calc).
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
  FileX,
  FileText,
  Info,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";
import type { Invoice } from "@/types";
import { cn } from "@/lib/utils";

// ── Invoice search input (reused pattern from DeliveryNoteFormPage) ────────────

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
        const eligible = (res.data.results as Invoice[]).filter(
          (inv) => !["draft", "cancelled"].includes(inv.status)
        );
        setResults(eligible);
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
          placeholder={t("invoice.search_placeholder")}
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
                  {inv.client_name || t("invoice.no_client")} · {formatDate(inv.date)} · {formatDZD(inv.total_ttc)} DZD
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
  date: string;
  reason: string;
  total_ht: string;
}

export default function CreditNoteFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const today = new Date().toISOString().split("T")[0];
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState<FormState>({
    invoice_id: null,
    date: today,
    reason: "",
    total_ht: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Support pre-selecting via ?invoice=<id>
  useEffect(() => {
    const invoiceId = searchParams.get("invoice");
    if (!invoiceId) return;
    api.get(`/invoicing/invoices/${invoiceId}/`).then((r) => {
      handleInvoiceSelect(r.data as Invoice);
    }).catch(() => setFormError("Impossible de charger la facture sélectionnée."));
  }, []);

  function handleInvoiceSelect(inv: Invoice) {
    setSelectedInvoice(inv);
    setForm((f) => ({
      ...f,
      invoice_id: inv.id,
      // Default to full HT amount of the invoice
      total_ht: f.total_ht || inv.total_ht,
    }));
  }

  // ── Derived: TVA & TTC auto-calculation ───────────────────────────────────

  const tvaRate = selectedInvoice?.apply_tva
    ? parseFloat(selectedInvoice.tva_rate ?? "19")
    : 0;
  const totalHtNum = parseFloat(form.total_ht) || 0;
  const tvaAmount = selectedInvoice?.apply_tva
    ? Math.round((totalHtNum * tvaRate / 100) * 100) / 100
    : 0;
  const totalTtc = totalHtNum + tvaAmount;

  const maxHt = selectedInvoice ? parseFloat(selectedInvoice.total_ht) : Infinity;

  // ── Mutation ──────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post("/invoicing/credit-notes/", {
        original_invoice: form.invoice_id,
        date: form.date,
        reason: form.reason,
        total_ht: totalHtNum.toFixed(2),
        tva_amount: tvaAmount.toFixed(2),
        total_ttc: totalTtc.toFixed(2),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-notes"] });
      setSaved(true);
      setTimeout(() => navigate("/credit-notes"), 800);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.invoice_id) { setFormError(t("invoice.error_select_original")); return; }
    if (!form.reason.trim()) { setFormError("Le motif de l'avoir est obligatoire."); return; }
    if (!form.total_ht || totalHtNum <= 0) { setFormError(t("invoice.error_ht_positive")); return; }
    if (totalHtNum > maxHt) { setFormError(`Le montant HT ne peut pas dépasser celui de la facture (${formatDZD(maxHt)} DZD).`); return; }
    setFormError(null);
    saveMutation.mutate();
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link to="/credit-notes" className="text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Nouvel Avoir</h1>
          <p className="text-sm text-text-muted">{t("invoice.credit_note_desc")}</p>
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
            <CheckCircle size={14} />{t("invoice.credit_created_success")}</div>
        )}

        {/* Facture d'origine */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <FileText size={14} className="text-primary-500" />{t("invoice.original_invoice")}</h2>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Facture <span className="text-danger">*</span>
            </label>
            <InvoiceSearchInput value={selectedInvoice} onSelect={handleInvoiceSelect} />
          </div>

          {selectedInvoice && (
            <div className="rounded-lg border border-primary-200 bg-primary-50/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-text-primary">
                  {selectedInvoice.number || `#${selectedInvoice.id}`}
                </span>
                <span className="text-xs text-text-muted">
                  TVA {selectedInvoice.apply_tva ? `${selectedInvoice.tva_rate}%` : t("invoice.exempt")}
                </span>
              </div>
              <div className="text-sm text-text-muted">
                Client : <strong className="text-text-primary">{selectedInvoice.client_name || "—"}</strong>
              </div>
              <div className="flex gap-4 text-xs text-text-muted">
                <span>Total HT : {formatDZD(selectedInvoice.total_ht)} DZD</span>
                <span>Total TTC : {formatDZD(selectedInvoice.total_ttc)} DZD</span>
              </div>
            </div>
          )}
        </div>

        {/* Avoir details */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <FileX size={14} className="text-primary-500" />{t("invoice.credit_details")}</h2>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t("invoice.date")}<span className="text-danger">*</span>
            </label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="form-input max-w-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t("invoice.reason")}<span className="text-danger">*</span>
            </label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="form-input resize-none"
              rows={3}
              placeholder={t("invoice.credit_reason_placeholder")}
            />
          </div>

          {/* Amount section */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Montant HT (DZD) <span className="text-danger">*</span>
              </label>
              <input
                type="number"
                value={form.total_ht}
                onChange={(e) => setForm((f) => ({ ...f, total_ht: e.target.value }))}
                className={cn(
                  "form-input max-w-xs",
                  totalHtNum > maxHt && "border-danger focus:border-danger"
                )}
                placeholder="0.00"
                min="0.01"
                step="0.01"
                max={maxHt}
              />
              {selectedInvoice && (
                <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1">
                  <Info size={10} />
                  Maximum : {formatDZD(maxHt)} DZD (total HT de la facture)
                </p>
              )}
            </div>

            {/* Auto-computed summary */}
            {totalHtNum > 0 && (
              <div className="rounded-lg bg-surface border border-border divide-y divide-border overflow-hidden">
                <div className="flex justify-between items-center px-4 py-2 text-sm">
                  <span className="text-text-muted">{t("invoice.total_ht")}</span>
                  <span className="font-mono">{formatDZD(totalHtNum)} DZD</span>
                </div>
                {tvaRate > 0 && (
                  <div className="flex justify-between items-center px-4 py-2 text-sm">
                    <span className="text-text-muted">TVA ({tvaRate}%)</span>
                    <span className="font-mono">{formatDZD(tvaAmount)} DZD</span>
                  </div>
                )}
                <div className="flex justify-between items-center px-4 py-2 bg-primary-50/40">
                  <span className="font-semibold text-sm text-text-primary">Total TTC avoir</span>
                  <span className="font-mono font-bold text-danger">
                    − {formatDZD(totalTtc)} DZD
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link to="/credit-notes" className="btn-secondary">Annuler</Link>
          <button
            type="submit"
            disabled={saveMutation.isPending || saved || !form.invoice_id}
            className="btn-primary"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" />{t("common.creating")}</>
            ) : (
              <><Save size={14} />{t("invoice.issue_credit")}</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
