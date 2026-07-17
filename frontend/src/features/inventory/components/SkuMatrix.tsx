/**
 * SkuMatrix — interactive size × colour grid for editing product variants.
 *
 * Usage:
 *   <SkuMatrix productId={product.id} variants={product.variants} onSave={refetch} />
 *
 * The matrix renders sizes as rows and colours as columns.
 * Each cell shows: stock qty (read-only), alert threshold (editable), barcode.
 * New size/colour combinations can be added; existing ones can be toggled active/inactive.
 */
import { useTranslation } from "react-i18next";
import { useState, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, X, AlertTriangle, Package, Copy, Check, Barcode } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import type { Variant } from "@/types";
import { cn } from "@/lib/utils";
import BarcodeSvg from "@/components/ui/BarcodeSvg";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface NewVariantForm {
  size_eu: string;
  colour: string;
  alert_threshold: string;
}

interface SkuMatrixProps {
  productId: number;
  variants: Variant[];
  /** Called after a successful save so the parent can refetch */
  onSave?: () => void;
  /** Whether the user can edit (cashiers cannot) */
  readOnly?: boolean;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const STANDARD_SIZES = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46];
const STANDARD_COLOURS = ["Noir", "Blanc", "Marron", "Bleu", "Rouge", "Gris", "Beige"];

function stockClass(qty: number, isLowStock: boolean): string {
  if (qty === 0) return "text-danger font-bold";
  if (isLowStock) return "text-warning font-semibold";
  return "text-success font-medium";
}

// ─────────────────────────────────────────────
// BarcodeCell — shows code + copy btn + popover
// ─────────────────────────────────────────────

function BarcodeCell({ barcode }: { barcode: string | null | undefined }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!barcode) return;
      navigator.clipboard.writeText(barcode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [barcode]
  );

  if (!barcode) {
    return <span className="text-2xs text-text-muted">—</span>;
  }

  return (
    <div className="relative flex flex-col items-center gap-0.5">
      {/* Barcode number row */}
      <div className="flex items-center gap-1">
        <span
          className="text-xs font-mono text-text-primary leading-none tracking-tight"
          title={barcode}
        >
          {barcode}
        </span>
        <button
          onClick={handleCopy}
          className="text-text-muted hover:text-primary-500 transition-colors flex-shrink-0"
          title="Copier le code-barres"
        >
          {copied ? (
            <Check size={11} className="text-success" />
          ) : (
            <Copy size={11} />
          )}
        </button>
      </div>

      {/* Preview toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); setPopoverOpen((o) => !o); }}
        className="flex items-center gap-0.5 text-2xs text-text-muted hover:text-primary-500 transition-colors"
        title="Aperçu code-barres"
      >
        <Barcode size={11} />
        <span>aperçu</span>
      </button>

      {/* Popover with rendered barcode */}
      {popoverOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPopoverOpen(false)}
          />
          <div className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white border border-border rounded-lg shadow-xl p-3 min-w-[180px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide">Code-barres</span>
              <button
                onClick={() => setPopoverOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </div>
            <BarcodeSvg
              value={barcode}
              height={48}
              showText={true}
              className="w-full text-text-primary"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SkuMatrix component
// ─────────────────────────────────────────────

export default function SkuMatrix({ productId, variants, onSave, readOnly = false }: SkuMatrixProps) {
  const queryClient = useQueryClient();

  // Build unique sorted sizes and colours from existing variants
  const sizes = useMemo(() => {
    const s = new Set(variants.map((v) => v.size_eu));
    STANDARD_SIZES.forEach((sz) => s.add(sz));
    return Array.from(s).sort((a, b) => a - b);
  }, [variants]);

  const colours = useMemo(() => {
    const c = new Set(variants.map((v) => v.colour));
    return Array.from(c).sort();
  }, [variants]);

  // Cell edits: variantId -> threshold value
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New variant form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newForm, setNewForm] = useState<NewVariantForm>({
    size_eu: "",
    colour: "",
    alert_threshold: "3",
  });
  const [newColourInput, setNewColourInput] = useState("");

  // Map for quick lookup: `${size}_${colour}` -> Variant
  const variantMap = useMemo(() => {
    const m = new Map<string, Variant>();
    variants.forEach((v) => m.set(`${v.size_eu}_${v.colour}`, v));
    return m;
  }, [variants]);

  // ── Mutations ──────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(edits).map(([id, threshold]) =>
        api.patch(`/inventory/variants/${id}/`, { alert_threshold: threshold })
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      setEdits({});
      setDirty(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onSave?.();
    },
    onError: (err) => {
      setError(getApiError(err));
    },
  });

  const createVariantMutation = useMutation({
    mutationFn: () =>
      api.post("/inventory/variants/", {
        product: productId,
        size_eu: parseFloat(newForm.size_eu),
        colour: newForm.colour || newColourInput,
        alert_threshold: parseInt(newForm.alert_threshold) || 3,
      }).then((r) => r.data),
    onSuccess: () => {
      setShowAddForm(false);
      setNewForm({ size_eu: "", colour: "", alert_threshold: "3" });
      setNewColourInput("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onSave?.();
    },
    onError: (err) => {
      setError(getApiError(err));
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/inventory/variants/${id}/`, { is_active }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onSave?.();
    },
    onError: (err) => {
      setError(getApiError(err));
    },
  });

  // ── Handlers ──────────────────────────────

  function handleThresholdChange(variantId: number, value: string) {
    const num = parseInt(value) || 0;
    setEdits((prev) => ({ ...prev, [variantId]: num }));
    setDirty(true);
  }

  function handleSave() {
    if (!dirty) return;
    saveMutation.mutate();
  }

  // ── Render ────────────────────────────────

  // If no colours defined yet, show prompt to add
  if (colours.length === 0 && variants.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-sm">
        <Package size={32} className="mx-auto mb-2 opacity-40" />
        <p>Aucune variante définie.</p>
        {!readOnly && (
          <button className="btn-primary mt-4" onClick={() => setShowAddForm(true)}>
            <Plus size={14} />
            Ajouter une variante
          </button>
        )}
        {showAddForm && (
          <AddVariantForm
            form={newForm}
            setForm={setNewForm}
            newColourInput={newColourInput}
            setNewColourInput={setNewColourInput}
            existingColours={STANDARD_COLOURS}
            onSubmit={() => createVariantMutation.mutate()}
            onCancel={() => setShowAddForm(false)}
            isPending={createVariantMutation.isPending}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="btn-secondary btn-sm"
            >
              <Plus size={14} />
              Nouvelle variante
            </button>
          </div>
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="btn-primary btn-sm"
            >
              <Save size={14} />
              {saveMutation.isPending ? "Sauvegarde…" : "Sauvegarder seuils"}
            </button>
          )}
        </div>
      )}

      {/* Add variant form */}
      {showAddForm && !readOnly && (
        <AddVariantForm
          form={newForm}
          setForm={setNewForm}
          newColourInput={newColourInput}
          setNewColourInput={setNewColourInput}
          existingColours={Array.from(new Set([...STANDARD_COLOURS, ...colours]))}
          onSubmit={() => createVariantMutation.mutate()}
          onCancel={() => setShowAddForm(false)}
          isPending={createVariantMutation.isPending}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="text-xs text-danger bg-danger-light px-3 py-2 rounded flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
          <button className="ms-auto" onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface">
              <th className="px-3 py-2 text-start font-semibold text-text-primary border-e border-border whitespace-nowrap">
                Pointure EU
              </th>
              {colours.map((colour) => (
                <th
                  key={colour}
                  className="px-3 py-2 text-center font-semibold text-text-primary border-e border-border last:border-e-0 whitespace-nowrap min-w-[140px]"
                >
                  {colour}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizes.map((size) => (
              <tr key={size} className="border-t border-border hover:bg-surface/50">
                <td className="px-3 py-2 font-mono font-semibold text-text-primary border-e border-border whitespace-nowrap">
                  EU {size}
                </td>
                {colours.map((colour) => {
                  const variant = variantMap.get(`${size}_${colour}`);
                  if (!variant) {
                    return (
                      <td
                        key={colour}
                        className="px-2 py-2 text-center border-e border-border last:border-e-0 bg-surface/30"
                      >
                        {!readOnly && (
                          <button
                            onClick={() => {
                              setNewForm({ size_eu: String(size), colour, alert_threshold: "3" });
                              setShowAddForm(true);
                            }}
                            className="text-2xs text-text-muted hover:text-primary-500 hover:underline"
                            title="Ajouter cette variante"
                          >
                            + ajouter
                          </button>
                        )}
                      </td>
                    );
                  }

                  const currentThreshold =
                    edits[variant.id] !== undefined ? edits[variant.id] : variant.alert_threshold;

                  return (
                    <td
                      key={colour}
                      className={cn(
                        "px-2 py-2 border-e border-border last:border-e-0 transition-colors",
                        !variant.is_active && "opacity-40 bg-surface"
                      )}
                    >
                      <div className="flex flex-col items-center gap-1">
                        {/* Stock qty */}
                        <span
                          className={cn("text-base font-mono leading-none", stockClass(variant.stock_qty, variant.is_low_stock))}
                          title={`Stock: ${variant.stock_qty}`}
                        >
                          {variant.stock_qty}
                        </span>

                        {/* Alert threshold (editable) */}
                        {!readOnly ? (
                          <div className="flex items-center gap-0.5" title="Seuil d'alerte">
                            <span className="text-2xs text-text-muted">min</span>
                            <input
                              type="number"
                              value={currentThreshold}
                              onChange={(e) => handleThresholdChange(variant.id, e.target.value)}
                              className="w-10 text-center text-xs border border-border rounded px-1 py-0.5 font-mono focus:outline-none focus:border-primary-400"
                              min="0"
                              disabled={!variant.is_active}
                            />
                          </div>
                        ) : (
                          <span className="text-2xs text-text-muted">min {variant.alert_threshold}</span>
                        )}

                        {/* Barcode */}
                        <BarcodeCell barcode={variant.barcode} />

                        {/* Active toggle */}
                        {!readOnly && (
                          <button
                            onClick={() =>
                              toggleActiveMutation.mutate({
                                id: variant.id,
                                is_active: !variant.is_active,
                              })
                            }
                            className={cn(
                              "text-2xs px-1.5 py-0.5 rounded transition-colors",
                              variant.is_active
                                ? "text-success hover:bg-danger-light hover:text-danger"
                                : "text-text-muted hover:bg-success/10 hover:text-success"
                            )}
                            title={variant.is_active ? "Désactiver" : "Activer"}
                          >
                            {variant.is_active ? "actif" : "inactif"}
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <span className="font-mono font-bold text-danger">0</span> = Rupture
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono font-semibold text-warning">3</span> = Stock bas
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono font-medium text-success">10</span> = Normal
        </span>
        <span className="ms-auto">
          Les chiffres sous les stocks = seuil d'alerte (modifiable)
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Add variant inline form
// ─────────────────────────────────────────────

interface AddVariantFormProps {
  form: NewVariantForm;
  setForm: (f: NewVariantForm) => void;
  newColourInput: string;
  setNewColourInput: (v: string) => void;
  existingColours: string[];
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function AddVariantForm({
  form,
  setForm,
  newColourInput,
  setNewColourInput,
  existingColours,
  onSubmit,
  onCancel,
  isPending,
}: AddVariantFormProps) {
  const { t } = useTranslation();
  return (
    <div className="card p-4 border-primary-200 bg-primary-50/30">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Nouvelle variante</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Size */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Pointure EU *</label>
          <input
            type="number"
            value={form.size_eu}
            onChange={(e) => setForm({ ...form, size_eu: e.target.value })}
            className="form-input text-sm py-1.5"
            placeholder="42"
            min="30"
            max="50"
          />
        </div>

        {/* Colour — select from existing or type new */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Couleur *</label>
          <select
            value={form.colour}
            onChange={(e) => {
              setForm({ ...form, colour: e.target.value });
              if (e.target.value !== "__new__") setNewColourInput("");
            }}
            className="form-input text-sm py-1.5"
          >
            <option value="">— Choisir —</option>
            {existingColours.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="__new__">+ Autre couleur…</option>
          </select>
        </div>

        {/* New colour text input */}
        {form.colour === "__new__" && (
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Nom couleur</label>
            <input
              type="text"
              value={newColourInput}
              onChange={(e) => setNewColourInput(e.target.value)}
              className="form-input text-sm py-1.5"
              placeholder="Ex: Vert militaire"
              autoFocus
            />
          </div>
        )}

        {/* Alert threshold */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Seuil alerte</label>
          <input
            type="number"
            value={form.alert_threshold}
            onChange={(e) => setForm({ ...form, alert_threshold: e.target.value })}
            className="form-input text-sm py-1.5"
            min="0"
          />
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={onSubmit}
          disabled={
            isPending ||
            !form.size_eu ||
            (!form.colour && !newColourInput) ||
            (form.colour === "__new__" && !newColourInput)
          }
          className="btn-primary btn-sm"
        >
          <Plus size={14} />
          {isPending ? "Création…" : "Créer variante"}
        </button>
        <button onClick={onCancel} className="btn-secondary btn-sm">
          Annuler
        </button>
      </div>
    </div>
  );
}
