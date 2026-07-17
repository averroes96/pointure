import React from "react";
/**
 * PurchaseOrderFormPage — /purchase-orders/new
 *
 * Creates a Purchase Order (Commande d'achat) with line items.
 * POST /suppliers/purchase-orders/
 *
 * Fields: supplier (searchable), reference, expected_date, notes,
 *         lines: description, quantity_ordered, agreed_unit_price
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Save, Loader2, AlertTriangle, CheckCircle,
  X, Search, Plus, Trash2, ShoppingBag, Factory,
} from "lucide-react";
import api, { formatDZD, getApiError } from "@/lib/api";
import type { Supplier } from "@/types";
import { cn } from "@/lib/utils";
import { CartonPanel, CartonConfig, DEFAULT_CARTON, getSizeRange } from "./components/CartonPanel";

// ── Supplier search dropdown ───────────────────────────────────────────────────

function SupplierSearchInput({
  value,
  onSelect,
}: {
  value: Supplier | null;
  onSelect: (s: Supplier) => void;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) setQuery(value.name);
  }, [value?.id]);

  function search(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/suppliers/?search=${encodeURIComponent(q)}&page_size=8`);
        setResults(res.data.results ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function pick(s: Supplier) {
    setQuery(s.name);
    setResults([]);
    setOpen(false);
    onSelect(s);
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
          placeholder=t("supplier.search_supplier")
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={() => pick(s)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface text-start transition-colors"
            >
              <Factory size={14} className="text-text-muted mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-text-primary">{s.name}</div>
                <div className="text-xs text-text-muted">
                  {s.contact_name && `${s.contact_name} · `}
                  {s.origin_country || "—"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Variant search dropdown ────────────────────────────────────────────────────

function VariantSearchInput({
  onSelect,
}: {
  onSelect: (v: any) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/inventory/variants/?search=${encodeURIComponent(q)}&page_size=8`);
        setResults(res.data.results ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function pick(v: any) {
    setQuery("");
    setResults([]);
    setOpen(false);
    onSelect(v);
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
          className="form-input ps-9 py-1.5 text-sm"
          placeholder=t("supplier.search_variant")
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {results.map((v) => (
            <button
              key={v.id}
              type="button"
              onMouseDown={() => pick(v)}
              className="w-full flex items-start gap-3 px-4 py-2 hover:bg-surface text-start transition-colors"
            >
              <ShoppingBag size={14} className="text-text-muted mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-text-primary">{v.product_name || `Variant #${v.id}`}</div>
                <div className="text-xs text-text-muted">
                  EU{v.size_eu} {v.colour ? `· ${v.colour}` : ""} · En stock: {v.stock_qty}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Line item type ────────────────────────────────────────────────────────────

interface LineItem {
  _id: number; // local only
  variant_id: number | null;
  description: string;
  quantity_ordered: string;
  agreed_unit_price: string;
  is_carton: boolean;
  carton_config: CartonConfig;
}

let _lineCounter = 0;
function localId() { return ++_lineCounter; }

function emptyLine(): LineItem {
  return { _id: localId(), variant_id: null, description: "", quantity_ordered: "1", agreed_unit_price: "", is_carton: false, carton_config: { ...DEFAULT_CARTON } };
}

function lineTotal(line: LineItem): number {
  const qty = parseInt(line.quantity_ordered) || 0;
  const price = parseFloat(line.agreed_unit_price) || 0;
  return qty * price;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PurchaseOrderFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Lines pre-filled from Low Stock page via navigate(..., { state: { lines } })
  const prefilledLines: Pick<LineItem, "description" | "quantity_ordered" | "agreed_unit_price">[] =
    location.state?.lines ?? [];

  const today = new Date().toISOString().split("T")[0];
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [reference, setReference] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  
  const [receiveImmediately, setReceiveImmediately] = useState(false);
  const [blReference, setBlReference] = useState("");
  const [lines, setLines] = useState<LineItem[]>(
    prefilledLines.length > 0
      ? prefilledLines.map((l) => ({ _id: localId(), ...l }))
      : [emptyLine()]
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Pre-select supplier from ?supplier=<id>
  useEffect(() => {
    const supplierId = searchParams.get("supplier");
    if (!supplierId) return;
    api.get(`/suppliers/${supplierId}/`).then((r) => {
      setSelectedSupplier(r.data as Supplier);
    }).catch(() => setFormError(t("supplier.error_load_supplier")));
  }, []);

  const grandTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: number) {
    setLines((prev) => prev.filter((l) => l._id !== id));
  }

  function updateLine(id: number, field: keyof Omit<LineItem, "_id">, value: string) {
    setLines((prev) => prev.map((l) => l._id === id ? { ...l, [field]: value } : l));
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        supplier: selectedSupplier!.id,
        reference,
        expected_date: expectedDate || null,
        notes,
        receive_immediately: receiveImmediately,
        bl_reference: receiveImmediately ? blReference : "",
        lines: lines.map((l) => {
          let carton_sizes: any[] = [];
          if (receiveImmediately && l.is_carton) {
            const cfg = l.carton_config;
            const sizes = getSizeRange(cfg.size_from, cfg.size_to);
            carton_sizes = cfg.colours.flatMap((colour) =>
              sizes
                .filter((s) => (cfg.quantities[colour]?.[s] ?? 0) > 0)
                .map((s) => ({
                  size_eu: s,
                  quantity: cfg.quantities[colour][s],
                  new_variant: {
                    product_id: cfg.product_id ?? null,
                    product_name: cfg.product_name,
                    brand: cfg.brand,
                    category: cfg.category,
                    size_eu: s,
                    colour,
                    purchase_price: parseFloat(cfg.purchase_price) || 0,
                    sale_price: parseFloat(cfg.sale_price) || 0,
                  },
                }))
            );
          }
          return {
            variant: l.variant_id,
            description: l.description || (l.is_carton ? `Assortiment ${l.carton_config.product_name}` : ""),
            quantity_ordered: parseInt(l.quantity_ordered) || 1, // backend recalculates in carton mode
            agreed_unit_price: parseFloat(l.agreed_unit_price) || 0,
            carton_sizes: carton_sizes.length > 0 ? carton_sizes : undefined,
          };
        }),
      };
      return api.post("/suppliers/purchase-orders/", payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setSaved(true);
      setTimeout(() => navigate(`/purchase-orders/${res.data.id}`), 800);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSupplier) { setFormError(t("supplier.error_select_supplier")); return; }
    if (lines.length === 0) { setFormError("Ajoutez au moins une ligne."); return; }
    for (const l of lines) {
      if (receiveImmediately && !l.variant_id && !l.is_carton) { setFormError("En mode Réception Directe, chaque ligne doit avoir une variante sélectionnée ou être en Mode Carton."); return; }
      if (!l.is_carton && !l.description.trim()) { setFormError("Chaque ligne (hors carton) doit avoir une description."); return; }
      if (!l.agreed_unit_price || parseFloat(l.agreed_unit_price) <= 0) {
        setFormError("Chaque ligne doit avoir un prix unitaire valide."); return;
      }
      if (!l.quantity_ordered || parseInt(l.quantity_ordered) < 1) {
        setFormError("Chaque ligne doit avoir une quantité ≥ 1."); return;
      }
    }
    setFormError(null);
    saveMutation.mutate();
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/purchase-orders" className="text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Nouvelle commande d'achat</h1>
          <p className="text-sm text-text-muted">Créez un bon de commande fournisseur.</p>
        </div>
      </div>

      <div className="flex p-1 bg-surface border border-border rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setReceiveImmediately(false)}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${!receiveImmediately ? "bg-primary-500 text-white shadow-sm" : "text-text-muted hover:text-text-primary"}`}
        >
          Commande Standard
        </button>
        <button
          type="button"
          onClick={() => setReceiveImmediately(true)}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${receiveImmediately ? "bg-primary-500 text-white shadow-sm" : "text-text-muted hover:text-text-primary"}`}
        >
          Réception Directe
        </button>
      </div>

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
            <CheckCircle size={14} /> Commande créée. Redirection...
          </div>
        )}

        {prefilledLines.length > 0 && !saved && (
          <div className="flex items-center gap-2 px-4 py-3 bg-warning/10 border border-warning/30 rounded-lg text-sm text-warning">
            <AlertTriangle size={14} className="flex-shrink-0" />
            Ligne pré-remplie depuis la page stock bas — vérifiez la quantité et ajoutez le prix unitaire.
          </div>
        )}

        {/* Supplier + Header fields */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <Factory size={14} className="text-primary-500" />{t("supplier.supplier")}</h2>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t("supplier.supplier")}<span className="text-danger">*</span>
            </label>
            <SupplierSearchInput value={selectedSupplier} onSelect={setSelectedSupplier} />
          </div>

          {selectedSupplier && (
            <div className="rounded-lg border border-primary-200 bg-primary-50/30 px-4 py-3">
              <div className="font-semibold text-text-primary text-sm">{selectedSupplier.name}</div>
              <div className="text-xs text-text-muted mt-0.5">
                {selectedSupplier.contact_name && `${selectedSupplier.contact_name} · `}
                {selectedSupplier.origin_country}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">{t("supplier.reference")}</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="form-input font-mono"
                placeholder="CMD-2026-001"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Date de livraison attendue</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          {receiveImmediately && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Référence BL Fournisseur</label>
                <input
                  type="text"
                  value={blReference}
                  onChange={(e) => setBlReference(e.target.value)}
                  className="form-input font-mono"
                  placeholder="Ex: BL-12345"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t("common.notes")}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input resize-none"
              rows={2}
              placeholder="Instructions spéciales, conditions..."
            />
          </div>
        </div>

        {/* Line items */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <ShoppingBag size={14} className="text-primary-500" />{t("supplier.order_lines")}</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start pb-2 text-xs text-text-muted font-medium pr-3">
                    Description <span className="text-danger">*</span>
                  </th>
                  <th className="text-start pb-2 text-xs text-text-muted font-medium w-24 pr-3">{t("supplier.qty")}<span className="text-danger">*</span>
                  </th>
                  <th className="text-start pb-2 text-xs text-text-muted font-medium w-36 pr-3">
                    Prix unitaire <span className="text-danger">*</span>
                  </th>
                  <th className="text-end pb-2 text-xs text-text-muted font-medium w-32">{t("common.total")}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line, idx) => (
                  <React.Fragment key={line._id}>
                    <tr>
                      <td className="py-2 pr-3">
                        {receiveImmediately ? (
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 cursor-pointer text-sm">
                              <input type="checkbox" checked={line.is_carton} onChange={(e) => updateLine(line._id, "is_carton", e.target.checked)} className="rounded border-border text-primary-500 focus:ring-primary-500" />
                              <span className="font-medium text-text-primary">Mode Carton (Assortiment)</span>
                            </label>
                            
                            {!line.is_carton && (
                              line.variant_id ? (
                                <div className="flex items-center justify-between border border-primary-200 bg-primary-50 rounded px-3 py-1.5">
                                  <span className="text-sm text-primary-700 font-medium truncate">{line.description}</span>
                                  <button type="button" onClick={() => { updateLine(line._id, "variant_id", ""); updateLine(line._id, "description", ""); }} className="text-text-muted hover:text-danger"><X size={14}/></button>
                                </div>
                              ) : (
                                <VariantSearchInput onSelect={(v) => {
                                  updateLine(line._id, "variant_id", String(v.id));
                                  updateLine(line._id, "description", `${v.product_name} - EU${v.size_eu}${v.colour ? ` ${v.colour}` : ""}`);
                                  if (!line.agreed_unit_price && v.purchase_price) updateLine(line._id, "agreed_unit_price", v.purchase_price);
                                }} />
                              )
                            )}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={line.description}
                            onChange={(e) => updateLine(line._id, "description", e.target.value)}
                            className="form-input py-1.5 text-sm"
                            placeholder={`Article ${idx + 1}`}
                            required
                          />
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={line.quantity_ordered}
                          onChange={(e) => updateLine(line._id, "quantity_ordered", e.target.value)}
                          className="form-input py-1.5 text-sm w-24 text-center disabled:opacity-50"
                          min="1"
                          step="1"
                          disabled={receiveImmediately && line.is_carton}
                          required={!line.is_carton}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={line.agreed_unit_price}
                          onChange={(e) => updateLine(line._id, "agreed_unit_price", e.target.value)}
                          className="form-input py-1.5 text-sm font-mono"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          required
                        />
                      </td>
                      <td className="py-2 text-end font-mono text-sm text-text-primary">
                        {lineTotal(line) > 0 ? formatDZD(lineTotal(line)) : "—"}
                      </td>
                      <td className="py-2 ps-2">
                        <button
                          type="button"
                          onClick={() => removeLine(line._id)}
                          disabled={lines.length === 1}
                          className="btn-ghost btn-sm text-text-muted hover:text-danger disabled:opacity-30"
                          title="Supprimer la ligne"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                    {receiveImmediately && line.is_carton && (
                      <tr>
                        <td colSpan={5} className="pb-4 pt-1 pr-1">
                          <CartonPanel
                            description={`Article ${idx + 1} (Assortiment)`}
                            config={line.carton_config}
                            onChange={(cfg) => {
                               updateLine(line._id, "carton_config", cfg);
                               // Automatically update quantity and price if possible
                               const sizes = getSizeRange(cfg.size_from, cfg.size_to);
                               const grandTotal = cfg.colours.reduce((sum, c) => sum + sizes.reduce((s, sz) => s + (cfg.quantities[c]?.[sz] ?? 0), 0), 0);
                               updateLine(line._id, "quantity_ordered", String(grandTotal));
                               if (cfg.purchase_price) updateLine(line._id, "agreed_unit_price", cfg.purchase_price);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addLine}
            className="btn-secondary btn-sm w-full"
          >
            <Plus size={14} />{t("supplier.add_line")}</button>

          {/* Grand total */}
          {grandTotal > 0 && (
            <div className="rounded-lg bg-surface border border-border px-4 py-3 flex justify-between items-center">
              <span className="font-semibold text-sm text-text-primary">Total commande</span>
              <span className="font-mono font-bold text-text-primary text-lg">
                {formatDZD(grandTotal)}{" "}
                <span className="text-sm font-normal text-text-muted">DZD</span>
              </span>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link to="/purchase-orders" className="btn-secondary">Annuler</Link>
          <button
            type="submit"
            disabled={saveMutation.isPending || saved || !selectedSupplier}
            className="btn-primary"
          >
            {saveMutation.isPending
              ? <><Loader2 size={14} className="animate-spin" /> Création…</>
              : <><Save size={14} /> Créer la commande</>
            }
          </button>
        </div>
      </form>
    </div>
  );
}
