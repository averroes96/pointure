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
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Search, X, ChevronDown, Save, ArrowLeft, AlertCircle } from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import { useBranch } from "@/features/auth/BranchContext";
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
          "input w-full flex items-center justify-between gap-2 text-start rounded-xl border-slate-200 text-sm",
          !value && "text-slate-400"
        )}
      >
        <span className="truncate">{value ? value.name : t("invoice.select_client")}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {value && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="p-0.5 hover:text-rose-600 transition-colors"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className={cn("text-slate-400 transition-transform duration-200", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60">
            <div className="relative">
              <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input w-full ps-8 py-1.5 text-xs rounded-lg border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                placeholder={t("common.search")}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {isFetching && (
              <div className="px-3 py-2 text-xs text-slate-400">{t("app.loading")}</div>
            )}
            {!isFetching && clients.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-400">{t("invoice.no_client_found")}</div>
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
                className="w-full text-start px-3.5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                {c.phone && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{c.phone}</div>
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
  const queryClient = useQueryClient();
  const { currentBranch } = useBranch();

  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const { data: invoiceToEdit, isSuccess: isInvoiceLoaded } = useQuery<any>({
    queryKey: ["invoice", id],
    queryFn: () => api.get(`/invoicing/invoices/${id}/`).then((r) => r.data),
    enabled: isEditMode,
  });

  const today = toISODate(new Date());
  const defaultDue = toISODate(addDays(new Date(), 30));

  // ── Form state ──
  const [client, setClient] = useState<Client | null>(null);
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState(defaultDue);
  const [seriesPrefix, setSeriesPrefix] = useState("FA");
  const [isFormal, setIsFormal] = useState(true);
  const [applyTva, setApplyTva] = useState(true);
  const [isPaidInCash, setIsPaidInCash] = useState(false);
  const [notes, setNotes] = useState("");

  // ── Matrices ──
  const [matrices, setMatrices] = useState<MatrixConfig[]>([createEmptyMatrix()]);

  // Hydrate edit state
  useEffect(() => {
    if (isInvoiceLoaded && invoiceToEdit && matrices.length === 1 && !matrices[0].product) {
      setClient({ id: invoiceToEdit.client, name: invoiceToEdit.client_name } as any);
      setDate(invoiceToEdit.date);
      setDueDate(invoiceToEdit.due_date);
      setSeriesPrefix(invoiceToEdit.series_prefix);
      setApplyTva(invoiceToEdit.apply_tva);
      setIsFormal(invoiceToEdit.is_formal);
      setIsPaidInCash(invoiceToEdit.is_paid_in_cash);
      setNotes(invoiceToEdit.notes || "");

      // Rebuild matrices
      const loadMatrices = async () => {
        const productMap = new Map<number, MatrixConfig>();

        for (const line of invoiceToEdit.lines) {
          if (!line.product_id) continue;

          let matrix = productMap.get(line.product_id);
          if (!matrix) {
            // Fetch product details to get variants
            const pRes = await api.get(`/inventory/products/${line.product_id}/`);
            matrix = {
              id: Math.random().toString(36).slice(2, 10),
              product: pRes.data,
              cartons: line.cartons,
              pairs_per_carton: 0, // We will calculate this after gathering all quantities
              unit_price: line.unit_price,
              discount_pct: line.discount_pct,
              quantities: {},
            };
            productMap.set(line.product_id, matrix);
          }

          const colour = line.colour || "Standard";
          const size = parseInt(line.size_eu);
          if (!isNaN(size)) {
            if (!matrix.quantities[colour]) {
              matrix.quantities[colour] = {};
            }
            matrix.quantities[colour][size] = parseFloat(line.quantity as string) || 0;
          }
        }

        const m = Array.from(productMap.values()).map(matrix => {
          // Calculate pairs_per_carton
          let totalPairs = 0;
          for (const c in matrix.quantities) {
            for (const s in matrix.quantities[c]) {
              totalPairs += matrix.quantities[c][s];
            }
          }
          if (matrix.cartons && matrix.cartons > 0) {
            matrix.pairs_per_carton = Math.round(totalPairs / matrix.cartons);
          } else {
            matrix.pairs_per_carton = 10;
          }
          return matrix;
        });

        if (m.length > 0) {
          setMatrices(m);
        }
      };

      loadMatrices();
    }
  }, [isInvoiceLoaded, invoiceToEdit]);

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
            const variant = m.product.variants.find(
              v => ((v.colour || "Standard") === c || (v.colour || "N/A") === c) && v.size_eu.toString() === s
            );
            if (variant) {
              const descSize = s !== "0" && Number(s) > 0 ? ` EU${s}` : "";
              const descCol = c && c !== "N/A" && c !== "Standard" ? ` ${c}` : "";
              flatLines.push({
                description: `${m.product.name}${descSize}${descCol}`.trim(),
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
  function buildPayload(isConfirm: boolean): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      client_id: client?.id ?? null,
      branch_id: currentBranch?.id ?? null,
      date,
      due_date: dueDate,
      series_prefix: seriesPrefix,
      apply_tva: isFormal ? applyTva : false,
      is_formal: isFormal,
      is_paid_in_cash: isPaidInCash,
      notes,
      confirm: isConfirm,
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
    mutationFn: async (vars: { endpoint?: string; isConfirm: boolean }) => {
      const payload = buildPayload(vars.isConfirm);
      if (vars.endpoint) {
        if (isEditMode) {
          return api.put(vars.endpoint, payload).then(r => r.data);
        }
        return api.post(vars.endpoint, payload).then(r => r.data);
      }
      if (isEditMode) {
        return api.put(`/invoicing/invoices/${id}/`, payload).then(r => r.data);
      }
      return api.post("/invoicing/invoices/", payload).then(r => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      navigate("/invoices");
    },
    onError: (err: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseData = (err as any)?.response?.data;
      
      // core/exceptions.py returns { error: { details: { ... } } }
      const details = responseData?.error?.details || responseData;
      
      const errStr = Array.isArray(details?.error) ? details.error[0] : details?.error;
      const codeStr = Array.isArray(details?.code) ? details.code[0] : details?.code;

      if (
        errStr === "credit_limit_exceeded" ||
        codeStr === "credit_limit_exceeded"
      ) {
        setCreditLimitWarning({
          credit_limit: Array.isArray(details.credit_limit) ? details.credit_limit[0] : details.credit_limit,
          current_balance: Array.isArray(details.current_balance) ? details.current_balance[0] : details.current_balance,
          invoice_total: Array.isArray(details.invoice_total) ? details.invoice_total[0] : details.invoice_total,
          would_be_balance: Array.isArray(details.would_be_balance) ? details.would_be_balance[0] : details.would_be_balance,
        });
      } else {
        setFormError(getApiError(err));
      }
    },
  });

  const [pendingConfirmState, setPendingConfirmState] = useState<boolean>(false);

  function handleSubmit(e: React.FormEvent, isConfirm: boolean) {
    e.preventDefault();
    setFormError(null);
    setCreditLimitWarning(null);
    setPendingConfirmState(isConfirm);

    if (!client) {
      setFormError(t("invoice.error_select_client"));
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
            const variant = m.product.variants.find(
              v => ((v.colour || "Standard") === c || (v.colour || "N/A") === c) && v.size_eu.toString() === s
            );
            if (variant && qty > variant.stock_qty) {
              setFormError(t("invoice.error_stock_exceeded"));
              return;
            }
          }
        }
      }
    }

    mutation.mutate({ isConfirm });
  }

  function handleForceSubmit() {
    setCreditLimitWarning(null);
    const forceEndpoint = isEditMode 
      ? `/invoicing/invoices/${id}/?force=true`
      : "/invoicing/invoices/?force=true";
    mutation.mutate({ endpoint: forceEndpoint, isConfirm: pendingConfirmState });
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-6 pb-12">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/invoices")}
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white">{isEditMode ? "Modifier la facture" : t("invoice.new")}</h1>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{t("invoice.fill_info")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/invoices")}
            className="btn-secondary px-3.5 py-2 text-xs font-medium rounded-xl"
          >
            {t("app.cancel")}
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e, false)}
            disabled={mutation.isPending}
            className="btn-secondary px-3.5 py-2 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5"
          >
            <Save size={14} />
            {t("invoice.status_draft")}
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e, true)}
            disabled={mutation.isPending}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl shadow-xs"
          >
            <Save size={15} />
            {mutation.isPending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>

      {/* ── Plan upgrade banner ── */}
      <UpgradeBanner min="pro_wholesale" feature="La facturation (factures, BL, avoirs)" />

      {/* ── Error banner ── */}
      {formError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-start gap-3 shadow-2xs">
          <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{formError}</p>
        </div>
      )}

      {/* ── Credit limit warning banner ── */}
      {creditLimitWarning && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl space-y-3 shadow-2xs">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t("invoice.credit_limit_exceeded")}</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 font-mono">
                {t("invoice.current_balance")}: <strong>{formatDZD(creditLimitWarning.current_balance)} DZD</strong>
                {" | "}
                {t("invoice.invoice_amount")}: <strong>{formatDZD(creditLimitWarning.invoice_total)} DZD</strong>
                {" | "}
                {t("invoice.new_balance")}: <strong>{formatDZD(creditLimitWarning.would_be_balance)} DZD</strong>
                {" | "}
                {t("invoice.credit_limit")}: <strong>{formatDZD(creditLimitWarning.credit_limit)} DZD</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreditLimitWarning(null)}
              className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
            >
              {t("app.cancel")}
            </button>
            <button
              type="button"
              onClick={handleForceSubmit}
              disabled={mutation.isPending}
              className="btn-primary py-1.5 px-3 text-xs rounded-xl"
            >
              Forcer (Manager)
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        {/* ── Left column ── */}
        <div className="space-y-6">
          {/* Client + metadata */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("invoice.general_info")}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Client */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.client")}</label>
                <ClientSelector value={client} onChange={setClient} />
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.date")}</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input w-full rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                />
              </div>

              {/* Due date */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.due_date")}</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="input w-full rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                />
              </div>

              {/* Series prefix */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.series_prefix")}</label>
                <input
                  type="text"
                  value={seriesPrefix}
                  onChange={(e) => setSeriesPrefix(e.target.value.toUpperCase())}
                  className="input w-full font-mono uppercase rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                  maxLength={4}
                  placeholder="FA"
                />
              </div>

              {/* Toggles */}
              <div className="flex flex-col gap-3 sm:col-span-2 pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={isFormal}
                      onChange={(e) => setIsFormal(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-primary-600 transition-colors" />
                    <div className="absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-5" />
                  </div>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {t("invoice.real_mode")}
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
                      <div className="w-10 h-5 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-primary-600 transition-colors" />
                      <div className="absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-5" />
                    </div>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {t("invoice.apply_tva", { rate: TVA_RATE })}
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
                      <div className="w-10 h-5 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-amber-500 transition-colors" />
                      <div className="absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-all peer-checked:translate-x-5" />
                    </div>
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-400">
                      {t("invoice.cash_payment_stamp")}
                    </span>
                  </label>
                )}
              </div>

              {/* Notes */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.notes_optional")}</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input w-full resize-none rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                  rows={2}
                  placeholder={t("invoice.notes_placeholder")}
                />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("invoice.billed_items")}</h2>
              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">{t("invoice.select_products_quantities")}</span>
            </div>

            <div className="space-y-4">
              {matrices.map((m) => (
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
                className="w-full py-2.5 px-3 border border-dashed border-primary-300 dark:border-primary-700/60 hover:border-primary-500 hover:bg-primary-50/50 dark:hover:bg-primary-950/30 text-primary-600 dark:text-primary-400 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus size={15} /> Ajouter un autre produit
              </button>
            </div>
          </div>

          {/* Payment recording */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("invoice.initial_payment")}</h2>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={addPayment}
                  onChange={(e) => setAddPayment(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500/20"
                />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("invoice.record_payment")}</span>
              </label>
            </div>

            {addPayment && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.payment_method")}</label>
                  <select
                    value={payment.method}
                    onChange={(e) =>
                      setPayment((p) => ({
                        ...p,
                        method: e.target.value as PaymentEntry["method"],
                      }))
                    }
                    className="input w-full rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.payment_amount")}</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={payment.amount}
                      onChange={(e) =>
                        setPayment((p) => ({ ...p, amount: e.target.value }))
                      }
                      className="input w-full pe-12 font-mono rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                      min="0"
                      step="100"
                      placeholder="0.00"
                    />
                    <span className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-semibold text-slate-400">
                      DZD
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t("invoice.payment_date")}</label>
                  <input
                    type="date"
                    value={payment.date}
                    onChange={(e) =>
                      setPayment((p) => ({ ...p, date: e.target.value }))
                    }
                    className="input w-full rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Totals sidebar ── */}
        <div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-5 space-y-4 sticky top-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("invoice.summary")}</h2>
            </div>
            <div className="space-y-3">
              {/* Subtotal HT */}
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-medium">{t("invoice.subtotal_ht")}</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatDZD(subtotalHT)} <span className="text-2xs text-slate-400 font-normal">DZD</span>
                </span>
              </div>

              {/* TVA */}
              {(isFormal && applyTva) && (
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-medium">{t("invoice.tva_rate", { rate: TVA_RATE })}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                    {formatDZD(tvaAmount)} <span className="text-2xs text-slate-400 font-normal">DZD</span>
                  </span>
                </div>
              )}

              {/* Timbre Fiscal */}
              {(isFormal && isPaidInCash) && (
                <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
                  <span className="font-medium">{t("invoice.timbre_fiscal")}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {formatDZD(timbreFiscal)} <span className="text-2xs opacity-70">DZD</span>
                  </span>
                </div>
              )}

              {/* Total TTC */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="font-bold text-sm text-slate-900 dark:text-white">
                  {applyTva ? t("invoice.total_ttc") : t("invoice.total_ht")}
                </span>
                <span className="font-mono font-bold text-xl text-primary-600 dark:text-primary-400 tabular-nums">
                  {formatDZD(totalTTC)} <span className="text-xs text-primary-400 font-normal">DZD</span>
                </span>
              </div>

              {/* Paid */}
              {addPayment && paidAmount > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-400">
                    <span className="font-medium">{t("invoice.amount_paid")}</span>
                    <span className="font-mono font-semibold tabular-nums">
                      − {formatDZD(paidAmount)} <span className="text-2xs opacity-70">DZD</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="font-bold text-xs text-slate-900 dark:text-white">{t("invoice.balance_due")}</span>
                    <span
                      className={cn(
                        "font-mono font-bold text-base tabular-nums",
                        balanceDue > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
                      )}
                    >
                      {formatDZD(balanceDue)} <span className="text-2xs font-normal opacity-70">DZD</span>
                    </span>
                  </div>
                </>
              )}

              {/* Lines count */}
              <div className="pt-3 text-2xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
                {t("invoice.lines_count", { count: getFlatLines().length })}
                · {t("invoice.client")}: <span className="font-medium text-slate-600 dark:text-slate-300">{client?.name ?? t("invoice.not_defined")}</span>
              </div>
            </div>

            {/* Action buttons (repeated for convenience) */}
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={(e) => handleSubmit(e, true)}
                disabled={mutation.isPending}
                className="btn-primary w-full justify-center py-2.5 rounded-xl font-semibold shadow-xs"
              >
                <Save size={15} />
                {mutation.isPending ? t("common.saving") : t("invoice.save_invoice")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/invoices")}
                className="btn-secondary w-full justify-center py-2 rounded-xl text-xs"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

