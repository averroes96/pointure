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
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Save, Loader2, AlertTriangle, CheckCircle,
  X, Search, Plus, Trash2, ShoppingBag, Factory,
} from "lucide-react";
import api, { formatDZD, getApiError } from "@/lib/api";
import type { Supplier } from "@/types";
import { cn } from "@/lib/utils";

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
          placeholder="Rechercher un fournisseur..."
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

// ── Line item type ────────────────────────────────────────────────────────────

interface LineItem {
  _id: number; // local only
  description: string;
  quantity_ordered: string;
  agreed_unit_price: string;
}

let _lineCounter = 0;
function localId() { return ++_lineCounter; }

function emptyLine(): LineItem {
  return { _id: localId(), description: "", quantity_ordered: "1", agreed_unit_price: "" };
}

function lineTotal(line: LineItem): number {
  const qty = parseInt(line.quantity_ordered) || 0;
  const price = parseFloat(line.agreed_unit_price) || 0;
  return qty * price;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const today = new Date().toISOString().split("T")[0];
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [reference, setReference] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Pre-select supplier from ?supplier=<id>
  useEffect(() => {
    const supplierId = searchParams.get("supplier");
    if (!supplierId) return;
    api.get(`/suppliers/${supplierId}/`).then((r) => {
      setSelectedSupplier(r.data as Supplier);
    }).catch(() => setFormError("Impossible de charger le fournisseur sélectionné."));
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
        lines: lines.map((l) => ({
          description: l.description,
          quantity_ordered: parseInt(l.quantity_ordered),
          agreed_unit_price: parseFloat(l.agreed_unit_price).toFixed(2),
        })),
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
    if (!selectedSupplier) { setFormError("Veuillez sélectionner un fournisseur."); return; }
    if (lines.length === 0) { setFormError("Ajoutez au moins une ligne."); return; }
    for (const l of lines) {
      if (!l.description.trim()) { setFormError("Chaque ligne doit avoir une description."); return; }
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

        {/* Supplier + Header fields */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
            <Factory size={14} className="text-primary-500" />
            Fournisseur
          </h2>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Fournisseur <span className="text-danger">*</span>
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
              <label className="block text-xs font-medium text-text-muted mb-1">Référence</label>
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

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Notes</label>
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
            <ShoppingBag size={14} className="text-primary-500" />
            Lignes de commande
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start pb-2 text-xs text-text-muted font-medium pr-3">
                    Description <span className="text-danger">*</span>
                  </th>
                  <th className="text-start pb-2 text-xs text-text-muted font-medium w-24 pr-3">
                    Qté <span className="text-danger">*</span>
                  </th>
                  <th className="text-start pb-2 text-xs text-text-muted font-medium w-36 pr-3">
                    Prix unitaire <span className="text-danger">*</span>
                  </th>
                  <th className="text-end pb-2 text-xs text-text-muted font-medium w-32">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line, idx) => (
                  <tr key={line._id}>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => updateLine(line._id, "description", e.target.value)}
                        className="form-input py-1.5 text-sm"
                        placeholder={`Article ${idx + 1}`}
                        required
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        value={line.quantity_ordered}
                        onChange={(e) => updateLine(line._id, "quantity_ordered", e.target.value)}
                        className="form-input py-1.5 text-sm w-24 text-center"
                        min="1"
                        step="1"
                        required
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
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addLine}
            className="btn-secondary btn-sm w-full"
          >
            <Plus size={14} />
            Ajouter une ligne
          </button>

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
