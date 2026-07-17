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

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  id: string; // local uuid
  description: string;
  variant_id: number | null;
  variant_label: string; // display only
  quantity: string;
  unit_price: string;
  discount_pct: string;
}

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

function emptyLine(): LineItem {
  return {
    id: localId(),
    description: "",
    variant_id: null,
    variant_label: "",
    quantity: "1",
    unit_price: "",
    discount_pct: "0",
  };
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

/**
 * ProductSearchCell — autocomplete on the Description column.
 * Searches /inventory/products/ as the user types (≥2 chars).
 * On selection it fills both the description text AND the unit price.
 */
function ProductSearchCell({
  description,
  onDescriptionChange,
  onProductSelect,
  lineRef,
  onKeyDown,
  useWholesale,
}: {
  description: string;
  onDescriptionChange: (v: string) => void;
  onProductSelect: (description: string, unitPrice: string) => void;
  lineRef?: (el: HTMLInputElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  useWholesale?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<PaginatedResponse<Product>>({
    queryKey: ["invoice-product-search", description],
    queryFn: () =>
      api
        .get(`/inventory/products/?search=${encodeURIComponent(description)}&page_size=8`)
        .then((r) => r.data),
    enabled: open && description.length >= 2,
  });

  const products = data?.results ?? [];

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
      <input
        ref={lineRef}
        type="text"
        value={description}
        onChange={(e) => {
          onDescriptionChange(e.target.value);
          setOpen(e.target.value.length >= 2);
        }}
        onFocus={() => { if (description.length >= 2) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          onKeyDown(e);
        }}
        className="w-full px-2 py-1 text-sm border border-transparent hover:border-border focus:border-primary-400 focus:outline-none rounded bg-transparent focus:bg-white transition-colors"
        placeholder={t("invoice.search_product")}
      />

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-72 bg-white border border-border rounded-md shadow-lg overflow-hidden">
          <div className="max-h-44 overflow-y-auto divide-y divide-border">
            {description.length >= 2 && isFetching && (
              <div className="px-3 py-2 text-xs text-text-muted">Chargement…</div>
            )}
            {description.length >= 2 && !isFetching && products.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">{t("inventory.no_product_found")}</div>
            )}
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()} // Keep input focused until click
                onClick={() => {
                  onProductSelect(`${p.brand} ${p.name}`, p.sale_price);
                  setOpen(false);
                }}
                className="w-full text-start px-3 py-2 text-xs hover:bg-surface transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{p.brand} {p.name}</span>
                  <span className="font-mono text-primary-600 flex-shrink-0">
                    {formatDZD(p.sale_price)} DZD
                  </span>
                </div>
                <div className="text-text-muted mt-0.5">
                  Stock&nbsp;: {p.total_stock}
                  {p.has_low_stock && (
                    <span className="ml-2 text-warning">⚠ stock bas</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Variant search popup — links a line to a specific size/colour SKU */
function VariantSearchCell({
  value,
  onSelect,
  onClear,
}: {
  value: { id: number; label: string } | null;
  onSelect: (v: { id: number; label: string; unitPrice: string }) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<PaginatedResponse<Variant>>({
    queryKey: ["variants-search", query],
    queryFn: () =>
      api
        .get(`/inventory/variants/?search=${encodeURIComponent(query)}&page_size=15`)
        .then((r) => r.data),
    enabled: open && query.length >= 2,
  });

  const variants = data?.results ?? [];

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
    <div ref={wrapperRef} className="relative min-w-[160px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-start text-xs px-2 py-1 border border-border rounded bg-white hover:border-primary-300 transition-colors flex items-center justify-between gap-1"
      >
        <span className={cn("truncate", !value && "text-text-muted")}>
          {value ? value.label : t("invoice.size_color")}
        </span>
        {value ? (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="text-text-muted hover:text-danger flex-shrink-0"
          >
            <X size={10} />
          </span>
        ) : (
          <Search size={10} className="text-text-muted flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-64 bg-white border border-border rounded-md shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="form-input py-1 text-xs"
              placeholder="Nom, pointure, code-barres…"
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {query.length < 2 && (
              <div className="px-3 py-2 text-xs text-text-muted">{t("common.type_2_chars")}</div>
            )}
            {query.length >= 2 && isFetching && (
              <div className="px-3 py-2 text-xs text-text-muted">Chargement…</div>
            )}
            {query.length >= 2 && !isFetching && variants.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">{t("inventory.no_variant_found")}</div>
            )}
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onSelect({
                    id: v.id,
                    label: `${v.product_name} EU${v.size_eu} ${v.colour === "N/A" ? t("common.na") : v.colour}`,
                    unitPrice: v.product_sale_price,
                  });
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-start px-3 py-1.5 text-xs hover:bg-surface transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{v.product_name}</span>
                    <span className="text-text-muted ml-1">EU{v.size_eu} · {v.colour === "N/A" ? t("common.na") : v.colour}</span>
                  </div>
                  <span className="font-mono text-primary-600 flex-shrink-0 text-2xs">
                    {formatDZD(v.product_sale_price)} DZD
                  </span>
                </div>
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
  const [isFormal, setIsFormal] = useState(true);
  const [applyTva, setApplyTva] = useState(true);
  const [isPaidInCash, setIsPaidInCash] = useState(false);
  const [notes, setNotes] = useState("");

  // ── Lines ──
  const [lines, setLines] = useState<LineItem[]>([emptyLine(), emptyLine(), emptyLine()]);

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

  // ── Refs for keyboard navigation ──
  const lineRefs = useRef<Record<string, Record<string, HTMLInputElement | null>>>({});

  const setLineRef = useCallback(
    (lineId: string, field: string) => (el: HTMLInputElement | null) => {
      if (!lineRefs.current[lineId]) lineRefs.current[lineId] = {};
      lineRefs.current[lineId][field] = el;
    },
    []
  );

  // ── Line operations ──
  function updateLine(id: string, field: keyof LineItem, value: string | number | null) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((l) => l.id !== id);
    });
  }

  // Enter key advances to next line's description
  function handleLineKeyDown(e: React.KeyboardEvent, lineId: string, field: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      const lineIdx = lines.findIndex((l) => l.id === lineId);
      const fields = ["description", "quantity", "unit_price", "discount_pct"];
      const fieldIdx = fields.indexOf(field);

      if (fieldIdx < fields.length - 1) {
        // Next field in same line
        lineRefs.current[lineId]?.[fields[fieldIdx + 1]]?.focus();
      } else if (lineIdx < lines.length - 1) {
        // First field of next line
        const nextLine = lines[lineIdx + 1];
        lineRefs.current[nextLine.id]?.["description"]?.focus();
      } else {
        // Add a new line and focus it
        const newLine = emptyLine();
        setLines((prev) => [...prev, newLine]);
        setTimeout(() => {
          lineRefs.current[newLine.id]?.["description"]?.focus();
        }, 50);
      }
    }
  }

  // ── Totals ──
  function lineTotal(l: LineItem): number {
    const qty = parseFloat(l.quantity) || 0;
    const price = parseFloat(l.unit_price) || 0;
    const disc = parseFloat(l.discount_pct) || 0;
    return qty * price * (1 - disc / 100);
  }

  const subtotalHT = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const tvaAmount = (isFormal && applyTva) ? subtotalHT * (TVA_RATE / 100) : 0;
  const baseTtc = subtotalHT + tvaAmount;
  
  let timbreFiscal = 0;
  if (isFormal && isPaidInCash) {
    timbreFiscal = Math.min(baseTtc * 0.01, 2500);
  }
  
  const totalTTC = baseTtc + timbreFiscal;
  const paidAmount = addPayment ? parseFloat(payment.amount) || 0 : 0;
  const balanceDue = Math.max(0, totalTTC - paidAmount);

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
      // confirm: true — assigns invoice number (FA-2026-00001) immediately
      // and sets status to "sent".  Without this the invoice stays as a
      // numberless draft forever.
      confirm: true,
      lines: lines
        .filter((l) => l.description.trim() || l.variant_id)
        .map((l) => ({
          description: l.description,
          variant: l.variant_id,
          quantity: l.quantity || "1",
          unit_price: l.unit_price || "0",
          discount_pct: l.discount_pct || "0",
        })),
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

    const validLines = lines.filter(
      (l) => l.description.trim() || l.variant_id
    );
    if (validLines.length === 0) {
      setFormError(t("invoice.add_one_line_error"));
      return;
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
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Lignes de facture</h2>
              <span className="text-xs text-text-muted">Appuyez sur Entrée pour passer au champ suivant</span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="min-w-[200px]">Description</th>
                    <th className="min-w-[160px]">Variante</th>
                    <th className="w-20 text-center">Qté</th>
                    <th className="w-28 text-end">P.U. HT</th>
                    <th className="w-20 text-center">Remise %</th>
                    <th className="w-28 text-end">{t("invoice.total_ht")}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      {/* Description — has product autocomplete */}
                      <td>
                        <ProductSearchCell
                          description={line.description}
                          onDescriptionChange={(v) => updateLine(line.id, "description", v)}
                          onProductSelect={(description, unitPrice) => {
                            updateLine(line.id, "description", description);
                            // Only overwrite price when the field is still empty
                            if (!line.unit_price) {
                              updateLine(line.id, "unit_price", unitPrice);
                            }
                          }}
                          lineRef={setLineRef(line.id, "description")}
                          onKeyDown={(e) => handleLineKeyDown(e, line.id, "description")}
                        />
                      </td>

                      {/* Variant — optional SKU link (auto-fills price too) */}
                      <td>
                        <VariantSearchCell
                          value={
                            line.variant_id
                              ? { id: line.variant_id, label: line.variant_label }
                              : null
                          }
                          onSelect={(v) => {
                            updateLine(line.id, "variant_id", v.id);
                            updateLine(line.id, "variant_label", v.label);
                            if (!line.description) {
                              updateLine(line.id, "description", v.label);
                            }
                            // Auto-fill price from variant's product sale_price
                            if (!line.unit_price) {
                              updateLine(line.id, "unit_price", v.unitPrice);
                            }
                          }}
                          onClear={() => {
                            updateLine(line.id, "variant_id", null);
                            updateLine(line.id, "variant_label", "");
                          }}
                        />
                      </td>

                      {/* Quantity */}
                      <td>
                        <input
                          ref={setLineRef(line.id, "quantity")}
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, "quantity", e.target.value)}
                          onKeyDown={(e) => handleLineKeyDown(e, line.id, "quantity")}
                          className="w-full px-2 py-1 text-sm border border-transparent hover:border-border focus:border-primary-400 focus:outline-none rounded bg-transparent focus:bg-white text-center font-mono transition-colors"
                          min="0"
                          step="1"
                        />
                      </td>

                      {/* Unit price */}
                      <td>
                        <input
                          ref={setLineRef(line.id, "unit_price")}
                          type="number"
                          value={line.unit_price}
                          onChange={(e) => updateLine(line.id, "unit_price", e.target.value)}
                          onKeyDown={(e) => handleLineKeyDown(e, line.id, "unit_price")}
                          className="w-full px-2 py-1 text-sm border border-transparent hover:border-border focus:border-primary-400 focus:outline-none rounded bg-transparent focus:bg-white text-end font-mono transition-colors"
                          min="0"
                          step="100"
                          placeholder="0.00"
                        />
                      </td>

                      {/* Discount % */}
                      <td>
                        <input
                          ref={setLineRef(line.id, "discount_pct")}
                          type="number"
                          value={line.discount_pct}
                          onChange={(e) => updateLine(line.id, "discount_pct", e.target.value)}
                          onKeyDown={(e) => handleLineKeyDown(e, line.id, "discount_pct")}
                          className="w-full px-2 py-1 text-sm border border-transparent hover:border-border focus:border-primary-400 focus:outline-none rounded bg-transparent focus:bg-white text-center font-mono transition-colors"
                          min="0"
                          max="100"
                          step="1"
                        />
                      </td>

                      {/* Line total */}
                      <td className="text-end">
                        <span className="font-mono text-sm text-text-primary">
                          {lineTotal(line) > 0 ? formatDZD(lineTotal(line)) : "—"}
                        </span>
                      </td>

                      {/* Remove */}
                      <td>
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          disabled={lines.length <= 1}
                          className="w-7 h-7 rounded flex items-center justify-center text-text-muted hover:text-danger hover:bg-danger-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-border">
              <button
                type="button"
                onClick={addLine}
                className="btn-ghost btn-sm text-primary-500"
              >
                <Plus size={14} />{t("invoice.add_line")}</button>
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
                {lines.filter((l) => l.description.trim() || l.variant_id).length} ligne(s)
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
