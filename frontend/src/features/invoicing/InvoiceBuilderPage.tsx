/**
 * InvoiceBuilderPage — Nouvelle Facture
 * Full invoice builder with:
 * - Client searchable dropdown
 * - Invoice metadata (date, due_date, series_prefix, apply_tva)
 * - Line items table (description, variant, qty, unit_price, discount_pct, line_total)
 * - Totals sidebar (HT, TVA, TTC, paid, balance_due)
 * - Payment recording
 * - POST /invoicing/invoices/ on submit
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Search, X, ChevronDown, Save, ArrowLeft, AlertCircle } from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Client, Product, Variant } from "@/types";
import { cn } from "@/lib/utils";
import { UpgradeBanner } from "@/components/ui/PlanGate";
import { InvoiceProductMatrix, type MatrixConfig, createEmptyMatrix } from "./components/InvoiceProductMatrix";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentEntry {
  method: "cash" | "ccp" | "virement" | "cheque";
  amount: string;
  date: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const TVA_RATE = 19;

const PAYMENT_METHODS = [
  { value: "cash", label: "Espèces" },
  { value: "ccp", label: "CCP" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
] as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Searchable client dropdown */
function ClientSelector({
  value,
  onChange,
}: {
  value: Client | null;
  onChange: (c: Client | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<PaginatedResponse<Client>>({
    queryKey: ["clients-search", query],
    queryFn: () =>
      api
        .get(`/clients/?search=${encodeURIComponent(query)}&page_size=10`)
        .then((r) => r.data),
    enabled: open,
  });

  const clients = data?.results ?? [];

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "form-input flex items-center justify-between gap-2 text-start",
          !value && "text-text-muted"
        )}
      >
        <span className="truncate">{value ? value.name : t("invoice.select_client")}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {value && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="hover:text-danger transition-colors"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-border rounded-md shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="form-input ps-8 py-1.5 text-sm"
                placeholder={t("common.search")}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {isFetching && (
              <div className="px-3 py-2 text-xs text-text-muted">Chargement...</div>
            )}
            {!isFetching && clients.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">{t("invoice.no_client_found")}</div>
            )}
            {clients.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-start px-3 py-2 text-sm hover:bg-surface transition-colors"
              >
                <div className="font-medium text-text-primary">{c.name}</div>
                {c.phone && (
                  <div className="text-xs text-text-muted">{c.phone}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InvoiceBuilderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const today = toISODate(new Date());
  const defaultDue = toISODate(addDays(new Date(), 30));

  // ── Form state ──
  const [client, setClient] = useState<Client | null>(null);
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState(defaultDue);
  const [seriesPrefix, setSeriesPrefix] = useState("FA");
  const [isFormal, setIsFormal] = useState(false);
  const [applyTva, setApplyTva] = useState(true);
  const [isPaidInCash, setIsPaidInCash] = useState(false);
  const [notes, setNotes] = useState("");

  // ── Matrices ──
  const [matrices, setMatrices] = useState<MatrixConfig[]>([createEmptyMatrix()]);

  // ── Payment ──
  const [payment, setPayment] = useState<PaymentEntry>({
    method: "cash",
    amount: "",
    date: today,
  });
  const [addPayment, setAddPayment] = useState(false);

  // ── Error ──
  const [formError, setFormError] = useState<string | null>(null);

  // ── Credit limit warning ──
  const [creditLimitWarning, setCreditLimitWarning] = useState<{
    credit_limit: string;
    current_balance: string;
    invoice_total: string;
    would_be_balance: string;
  } | null>(null);

  // ── Totals ──
  const subtotalHT = matrices.reduce((sum, m) => {
    if (!m.product) return sum;
    let pairs = 0;
    Object.values(m.quantities).forEach(sizes => {
      Object.values(sizes).forEach(qty => pairs += qty);
    });
    const price = parseFloat(m.unit_price) || 0;
    const disc = parseFloat(m.discount_pct) || 0;
    return sum + (pairs * price * (1 - disc / 100));
  }, 0);

  const tvaAmount = (isFormal && applyTva) ? subtotalHT * (TVA_RATE / 100) : 0;
  const baseTtc = subtotalHT + tvaAmount;
  
  let timbreFiscal = 0;
  if (isFormal && isPaidInCash) {
    timbreFiscal = Math.min(baseTtc * 0.01, 2500);
  }
  
  const totalTTC = baseTtc + timbreFiscal;
  const paidAmount = addPayment ? parseFloat(payment.amount) || 0 : 0;
  const balanceDue = Math.max(0, totalTTC - paidAmount);

  // ── Extract Lines ──
  function getFlatLines() {
    const flatLines = [];
    for (const m of matrices) {
      if (!m.product) continue;
      for (const c in m.quantities) {
        for (const s in m.quantities[c]) {
          const qty = m.quantities[c][s];
          if (qty > 0) {
            const variant = m.product.variants.find(v => (v.colour || "N/A") === c && v.size_eu.toString() === s);
            if (variant) {
              flatLines.push({
                description: `${m.product.name} EU${s} ${c === "N/A" ? "" : c}`.trim(),
                variant: variant.id,
                quantity: qty.toString(),
                unit_price: m.unit_price || "0",
                discount_pct: m.discount_pct || "0",
                cartons: m.cartons || 0,
              });
            }
          }
        }
      }
    }
    return flatLines;
  }

  // ── Build payload ──
  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      client_id: client?.id ?? null,
      date,
      due_date: dueDate,
      series_prefix: seriesPrefix,
      apply_tva: isFormal ? applyTva : false,
      is_formal: isFormal,
      is_paid_in_cash: isPaidInCash,
      notes,
      confirm: true,
      lines: getFlatLines(),
    };
    if (addPayment && paidAmount > 0) {
      payload.payment = {
        method: payment.method,
        amount: payment.amount,
        date: payment.date,
      };
    }
    return payload;
  }

  // ── Mutation ──
  const mutation = useMutation({
    mutationFn: (url?: string) =>
      api.post(url ?? "/invoicing/invoices/", buildPayload()).then((r) => r.data),
    onSuccess: () => {
      navigate("/invoices");
    },
    onError: (err: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (err as any)?.response?.data;
      if (
        data?.error === "credit_limit_exceeded" ||
        data?.code === "credit_limit_exceeded"
      ) {
        setCreditLimitWarning({
          credit_limit: data.credit_limit,
          current_balance: data.current_balance,
          invoice_total: data.invoice_total,
          would_be_balance: data.would_be_balance,
        });
      } else {
        setFormError(getApiError(err));
      }
    },
  });

  function handleForceSubmit() {
    setCreditLimitWarning(null);
    mutation.mutate("/invoicing/invoices/?force=true");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreditLimitWarning(null);

    if (!client) {
      setFormError("Veuillez sélectionner un client.");
      return;
    }

    const flatLines = getFlatLines();
    if (flatLines.length === 0) {
      setFormError(t("invoice.add_one_line_error"));
      return;
    }

    // Validate stock
    for (const m of matrices) {
      if (!m.product) continue;
      for (const c in m.quantities) {
        for (const s in m.quantities[c]) {
          const qty = m.quantities[c][s];
          if (qty > 0) {
            const variant = m.product.variants.find(v => (v.colour || "N/A") === c && v.size_eu.toString() === s);
            if (variant && qty > variant.stock_qty) {
              setFormError("La quantité demandée pour un ou plusieurs articles dépasse le stock disponible.");
              return;
            }
          }
        }
      }
    }

    mutation.mutate(undefined);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-12">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/invoices")}
            className="btn-ghost btn-sm"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-text-primary">{t("invoice.new")}</h1>
            <p className="text-sm text-text-muted">Remplissez les informations ci-dessous</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/invoices")}
            className="btn-secondary"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary"
          >
            <Save size={16} />
            {mutation.isPending ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </div>

      {/* ── Plan upgrade banner ── */}
      <UpgradeBanner min="pro_wholesale" feature="La facturation (factures, BL, avoirs)" />

      {/* ── Error banner ── */}
      {formError && (
        <div className="card px-4 py-3 bg-danger-light border-danger flex items-start gap-2">
          <AlertCircle size={16} className="text-danger mt-0.5 flex-shrink-0" />
          <p className="text-sm text-danger">{formError}</p>
        </div>
      )}

      {/* ── Credit limit warning banner ── */}
      {creditLimitWarning && (
        <div className="card px-4 py-4 bg-warning-light border border-warning space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-warning mt-0.5 flex-shrink-0" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold text-warning">⚠️ Plafond de crédit dépassé</p>
              <p className="text-xs text-text-muted">
                Solde actuel: <strong>{formatDZD(creditLimitWarning.current_balance)} DZD</strong>
                {" | "}
                Facture: <strong>{formatDZD(creditLimitWarning.invoice_total)} DZD</strong>
                {" | "}
                Nouveau solde: <strong>{formatDZD(creditLimitWarning.would_be_balance)} DZD</strong>
                {" | "}
                Plafond: <strong>{formatDZD(creditLimitWarning.credit_limit)} DZD</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreditLimitWarning(null)}
              className="btn-secondary btn-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleForceSubmit}
              disabled={mutation.isPending}
              className="btn-primary btn-sm"
            >
              Forcer (Manager)
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        {/* ── Left column ── */}
        <div className="space-y-5">
          {/* Client + metadata */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Informations générales</h2>
            </div>
            <div className="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Client */}
              <div className="sm:col-span-2">
                <label className="form-label">Client</label>
                <ClientSelector value={client} onChange={setClient} />
              </div>

              {/* Date */}
              <div>
                <label className="form-label">Date de facture</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="form-input"
                />
              </div>

              {/* Due date */}
              <div>
                <label className="form-label">{t("invoice.due_date")}</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="form-input"
                />
              </div>

              {/* Series prefix */}
              <div>
                <label className="form-label">Préfixe série</label>
                <input
                  type="text"
                  value={seriesPrefix}
                  onChange={(e) => setSeriesPrefix(e.target.value.toUpperCase())}
                  className="form-input font-mono uppercase"
                  maxLength={4}
                  placeholder="FA"
                />
              </div>

              {/* Toggles */}
              <div className="flex flex-col gap-3 sm:col-span-2 pt-1 border-t border-border mt-2">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={isFormal}
                      onChange={(e) => setIsFormal(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-primary-500 transition-colors" />
                    <div className="absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-5" />
                  </div>
                  <span className="text-sm font-medium text-text-primary">
                    Mode Réel (Facture Officielle)
                  </span>
                </label>

                {isFormal && (
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={applyTva}
                        onChange={(e) => setApplyTva(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-primary-500 transition-colors" />
                      <div className="absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-5" />
                    </div>
                    <span className="text-sm font-medium text-text-primary">
                      Appliquer TVA ({TVA_RATE}%)
                    </span>
                  </label>
                )}

                {isFormal && (
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={isPaidInCash}
                        onChange={(e) => setIsPaidInCash(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-amber-500 transition-colors" />
                      <div className="absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-5" />
                    </div>
                    <span className="text-sm font-medium text-amber-700">
                      Paiement en espèces (Timbre Fiscal 1%)
                    </span>
                  </label>
                )}
              </div>

              {/* Notes */}
              <div className="sm:col-span-2">
                <label className="form-label">Notes (optionnel)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="form-input resize-none"
                  rows={2}
                  placeholder="Notes internes ou informations complémentaires..."
                />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="card overflow-visible">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Articles facturés</h2>
              <span className="text-xs text-text-muted">Sélectionnez les produits et spécifiez les quantités</span>
            </div>
            
            <div className="p-4 space-y-4">
              {matrices.map((m, i) => (
                <InvoiceProductMatrix
                  key={m.id}
                  config={m}
                  onChange={(newConfig) => setMatrices(prev => prev.map(old => old.id === m.id ? newConfig : old))}
                  onRemove={() => setMatrices(prev => prev.length > 1 ? prev.filter(old => old.id !== m.id) : prev)}
                />
              ))}
              
              <button
                type="button"
                onClick={() => setMatrices(prev => [...prev, createEmptyMatrix()])}
                className="btn-ghost btn-sm text-primary-500 w-full justify-center border border-dashed border-primary-200"
              >
                <Plus size={14} /> Ajouter un autre produit
              </button>
            </div>
          </div>

          {/* Payment recording */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Paiement initial</h2>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={addPayment}
                  onChange={(e) => setAddPayment(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-primary-500 focus:ring-primary-300"
                />
                <span className="text-sm text-text-muted">Enregistrer un paiement</span>
              </label>
            </div>

            {addPayment && (
              <div className="card-body grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="form-label">Mode de paiement</label>
                  <select
                    value={payment.method}
                    onChange={(e) =>
                      setPayment((p) => ({
                        ...p,
                        method: e.target.value as PaymentEntry["method"],
                      }))
                    }
                    className="form-input"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Montant</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={payment.amount}
                      onChange={(e) =>
                        setPayment((p) => ({ ...p, amount: e.target.value }))
                      }
                      className="form-input pe-12 font-mono"
                      min="0"
                      step="100"
                      placeholder="0.00"
                    />
                    <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                      DZD
                    </span>
                  </div>
                </div>
                <div>
                  <label className="form-label">Date du paiement</label>
                  <input
                    type="date"
                    value={payment.date}
                    onChange={(e) =>
                      setPayment((p) => ({ ...p, date: e.target.value }))
                    }
                    className="form-input"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Totals sidebar ── */}
        <div className="space-y-4">
          <div className="card sticky top-20">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Récapitulatif</h2>
            </div>
            <div className="card-body space-y-3">
              {/* Subtotal HT */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Sous-total HT</span>
                <span className="font-mono text-sm text-text-primary">
                  {formatDZD(subtotalHT)} DZD
                </span>
              </div>

              {/* TVA */}
              {(isFormal && applyTva) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-muted">TVA ({TVA_RATE}%)</span>
                  <span className="font-mono text-sm text-text-primary">
                    {formatDZD(tvaAmount)} DZD
                  </span>
                </div>
              )}
              
              {/* Timbre Fiscal */}
              {(isFormal && isPaidInCash) && (
                <div className="flex items-center justify-between text-amber-700">
                  <span className="text-sm">Timbre Fiscal (1% max 2500)</span>
                  <span className="font-mono text-sm">
                    {formatDZD(timbreFiscal)} DZD
                  </span>
                </div>
              )}

              {/* Total TTC */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="font-semibold text-text-primary">
                  Total {applyTva ? "TTC" : "HT"}
                </span>
                <span className="font-mono font-bold text-lg text-primary-500">
                  {formatDZD(totalTTC)} DZD
                </span>
              </div>

              {/* Paid */}
              {addPayment && paidAmount > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-muted">Montant payé</span>
                    <span className="font-mono text-sm text-success">
                      − {formatDZD(paidAmount)} DZD
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="font-semibold text-text-primary">{t("invoice.balance_due")}</span>
                    <span
                      className={cn(
                        "font-mono font-bold text-base",
                        balanceDue > 0 ? "text-danger" : "text-success"
                      )}
                    >
                      {formatDZD(balanceDue)} DZD
                    </span>
                  </div>
                </>
              )}

              {/* Lines count */}
              <div className="pt-2 text-xs text-text-muted border-t border-border">
                {getFlatLines().length} ligne(s)
                · Client: {client?.name ?? <em>non défini</em>}
              </div>
            </div>

            {/* Action buttons (repeated for convenience) */}
            <div className="px-5 pb-4 space-y-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="btn-primary w-full justify-center"
              >
                <Save size={15} />
                {mutation.isPending ? "Enregistrement..." : t("invoice.save_invoice")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/invoices")}
                className="btn-secondary w-full justify-center"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
