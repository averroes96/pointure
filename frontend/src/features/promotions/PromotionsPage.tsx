/**
 * PromotionsPage — /promotions
 *
 * Lists all promotions with create / edit / toggle-active actions.
 * A promotion defines: conditions (category, product, min qty, min amount)
 * and an effect (discount % or fixed DZD per unit).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Tag, Calendar, ToggleLeft, ToggleRight,
  AlertTriangle, X, Save, Loader2, Trash2,
} from "lucide-react";
import api, { formatDate, getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Promotion {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  start_date: string;
  end_date: string | null;
  category: string;
  product: number | null;
  product_name: string | null;
  min_quantity: number | null;
  min_amount: string | null;
  discount_pct: string | null;
  discount_amount: string | null;
  priority: number;
  max_uses: number | null;
  uses_count: number;
}

const CATEGORIES = [
  { value: "", label: "Toutes catégories" },
  { value: "sneakers", label: "Sneakers" },
  { value: "boots", label: "Boots" },
  { value: "sandals", label: "Sandales" },
  { value: "formal", label: "Chaussures formelles" },
  { value: "sport", label: "Sport" },
  { value: "kids", label: "Enfants" },
  { value: "slippers", label: "Chaussons" },
  { value: "other", label: "Autre" },
];

const EMPTY: Omit<Promotion, "id" | "uses_count" | "product_name"> = {
  name: "",
  description: "",
  is_active: true,
  start_date: new Date().toISOString().split("T")[0],
  end_date: null,
  category: "",
  product: null,
  min_quantity: null,
  min_amount: null,
  discount_pct: null,
  discount_amount: null,
  priority: 0,
  max_uses: null,
};

// ── Condition summary pill ────────────────────────────────────────────────────

function ConditionSummary({ promo }: { promo: Promotion }) {
  const parts: string[] = [];
  if (promo.product_name) parts.push(promo.product_name);
  else if (promo.category) parts.push(promo.category);
  else parts.push("Tous articles");
  if (promo.min_quantity) parts.push(`≥ ${promo.min_quantity} unités`);
  if (promo.min_amount) parts.push(`≥ ${promo.min_amount} DZD`);
  return <span className="text-sm text-text-muted">{parts.join(" · ")}</span>;
}

function EffectBadge({ promo }: { promo: Promotion }) {
  if (promo.discount_pct)
    return <span className="badge badge-success font-mono">−{promo.discount_pct}%</span>;
  if (promo.discount_amount)
    return <span className="badge badge-info font-mono">−{promo.discount_amount} DZD/u</span>;
  return null;
}

// ── Form modal ────────────────────────────────────────────────────────────────

type FormState = typeof EMPTY & { id?: number };

function PromotionModal({
  initial,
  onClose,
}: {
  initial: FormState;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!form.id;

  const set = (k: keyof FormState, v: unknown) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        min_quantity: form.min_quantity || null,
        min_amount: form.min_amount || null,
        discount_pct: form.discount_pct || null,
        discount_amount: form.discount_amount || null,
        max_uses: form.max_uses || null,
        end_date: form.end_date || null,
        product: form.product || null,
      };
      return isEdit
        ? api.patch(`/promotions/${form.id}/`, payload)
        : api.post("/promotions/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      onClose();
    },
    onError: (err) => setError(getApiError(err)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Le nom est obligatoire."); return; }
    if (!form.discount_pct && !form.discount_amount) {
      setError("Définissez au moins un effet (% ou montant fixe)."); return;
    }
    if (form.discount_pct && form.discount_amount) {
      setError("Choisissez soit % soit montant fixe, pas les deux."); return;
    }
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border">
          <h2 className="font-bold text-text-primary">
            {isEdit ? "Modifier la promotion" : "Nouvelle promotion"}
          </h2>
          <button onClick={onClose} className="btn-ghost btn-sm"><X size={16} /></button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
              <AlertTriangle size={13} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Nom <span className="text-danger">*</span>
            </label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ex : Soldes été 2026"
              required
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Début <span className="text-danger">*</span>
              </label>
              <input
                type="date"
                className="form-input"
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Fin (optionnel)</label>
              <input
                type="date"
                className="form-input"
                value={form.end_date ?? ""}
                onChange={(e) => set("end_date", e.target.value || null)}
              />
            </div>
          </div>

          {/* Conditions */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              Conditions (cumulables)
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Catégorie</label>
              <select
                className="form-input"
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Qté minimum</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.min_quantity ?? ""}
                  onChange={(e) => set("min_quantity", parseInt(e.target.value) || null)}
                  min={1}
                  placeholder="ex: 3"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Montant min (DZD)</label>
                <input
                  type="number"
                  className="form-input"
                  value={form.min_amount ?? ""}
                  onChange={(e) => set("min_amount", e.target.value || null)}
                  min={0}
                  placeholder="ex: 10000"
                />
              </div>
            </div>
          </div>

          {/* Effect */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              Remise (choisir l'un ou l'autre)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">% remise</label>
                <input
                  type="number"
                  className="form-input font-mono"
                  value={form.discount_pct ?? ""}
                  onChange={(e) => {
                    set("discount_pct", e.target.value || null);
                    if (e.target.value) set("discount_amount", null);
                  }}
                  min={0.01}
                  max={100}
                  step={0.01}
                  placeholder="ex: 15"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Montant fixe / unité (DZD)</label>
                <input
                  type="number"
                  className="form-input font-mono"
                  value={form.discount_amount ?? ""}
                  onChange={(e) => {
                    set("discount_amount", e.target.value || null);
                    if (e.target.value) set("discount_pct", null);
                  }}
                  min={0.01}
                  step={0.01}
                  placeholder="ex: 500"
                />
              </div>
            </div>
          </div>

          {/* Priority + max uses */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Priorité</label>
              <input
                type="number"
                className="form-input"
                value={form.priority}
                onChange={(e) => set("priority", parseInt(e.target.value) || 0)}
                min={0}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Max utilisations</label>
              <input
                type="number"
                className="form-input"
                value={form.max_uses ?? ""}
                onChange={(e) => set("max_uses", parseInt(e.target.value) || null)}
                min={1}
                placeholder="Illimité"
              />
            </div>
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
              className="w-4 h-4 rounded border-border"
            />
            <span className="text-sm text-text-primary">Promotion active</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending
                ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
                : <><Save size={14} /> {isEdit ? "Modifier" : "Créer"}</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PromotionsPage() {
  const qc = useQueryClient();
  const [modalData, setModalData] = useState<FormState | null>(null);

  const { data, isLoading } = useQuery<{ results: Promotion[] }>({
    queryKey: ["promotions"],
    queryFn: () => api.get("/promotions/").then((r) => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/promotions/${id}/`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotions"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/promotions/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotions"] }),
  });

  const promotions = data?.results ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Tag size={20} />
            Promotions
          </h1>
          <p className="text-sm text-text-muted">
            Remises automatiques appliquées au caisse selon des conditions.
          </p>
        </div>
        <button
          onClick={() => setModalData({ ...EMPTY })}
          className="btn-primary"
        >
          <Plus size={16} />
          Nouvelle promotion
        </button>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Conditions</th>
              <th>Remise</th>
              <th>Période</th>
              <th className="text-end">Utilisations</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-text-muted">Chargement...</td>
              </tr>
            )}
            {!isLoading && promotions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-text-muted">
                  <Tag size={32} className="mx-auto mb-2 opacity-30" />
                  <p>Aucune promotion. Créez-en une pour commencer.</p>
                </td>
              </tr>
            )}
            {promotions.map((promo) => (
              <tr key={promo.id} className={cn(!promo.is_active && "opacity-50")}>
                <td>
                  <div className="font-medium text-text-primary">{promo.name}</div>
                  {promo.description && (
                    <div className="text-xs text-text-muted truncate max-w-[180px]">{promo.description}</div>
                  )}
                </td>
                <td><ConditionSummary promo={promo} /></td>
                <td><EffectBadge promo={promo} /></td>
                <td>
                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    <Calendar size={12} />
                    {formatDate(promo.start_date)}
                    {promo.end_date ? ` → ${formatDate(promo.end_date)}` : " →  ∞"}
                  </div>
                  {promo.priority > 0 && (
                    <div className="text-2xs text-primary-500 mt-0.5">Priorité {promo.priority}</div>
                  )}
                </td>
                <td className="text-end font-mono text-sm">
                  {promo.uses_count}
                  {promo.max_uses != null && (
                    <span className="text-text-muted"> / {promo.max_uses}</span>
                  )}
                </td>
                <td>
                  <button
                    onClick={() => toggleMutation.mutate({ id: promo.id, is_active: !promo.is_active })}
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium",
                      promo.is_active ? "text-success" : "text-text-muted"
                    )}
                    title={promo.is_active ? "Désactiver" : "Activer"}
                  >
                    {promo.is_active
                      ? <ToggleRight size={18} />
                      : <ToggleLeft size={18} />
                    }
                    {promo.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setModalData({ ...promo })}
                      className="btn-ghost btn-sm text-text-muted hover:text-primary-500"
                      title="Modifier"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Supprimer « ${promo.name} » ?`)) {
                          deleteMutation.mutate(promo.id);
                        }
                      }}
                      className="btn-ghost btn-sm text-text-muted hover:text-danger"
                      title="Supprimer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalData && (
        <PromotionModal
          initial={modalData}
          onClose={() => setModalData(null)}
        />
      )}
    </div>
  );
}
