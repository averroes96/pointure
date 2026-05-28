/**
 * SupplierFormPage — /suppliers/new  and  /suppliers/:id/edit
 *
 * Creates or updates a supplier. Redirects to the supplier detail page on success.
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import type { Supplier } from "@/types";

interface FormState {
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  origin_country: string;
  payment_terms: string;
  address: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  contact_name: "",
  phone: "",
  email: "",
  origin_country: "",
  payment_terms: "",
  address: "",
  notes: "",
  is_active: true,
};

export default function SupplierFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Load existing supplier when editing ───────────────────────────────────

  const { isLoading: loadingSupplier } = useQuery<Supplier>({
    queryKey: ["supplier", Number(id)],
    queryFn: () => api.get(`/suppliers/${id}/`).then((r) => r.data),
    enabled: isEditing,
    staleTime: 0,
  });

  const { data: existingSupplier } = useQuery<Supplier>({
    queryKey: ["supplier", Number(id)],
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existingSupplier) return;
    setForm({
      name: existingSupplier.name ?? "",
      contact_name: existingSupplier.contact_name ?? "",
      phone: existingSupplier.phone ?? "",
      email: existingSupplier.email ?? "",
      origin_country: existingSupplier.origin_country ?? "",
      payment_terms: existingSupplier.payment_terms ?? "",
      address: existingSupplier.address ?? "",
      notes: existingSupplier.notes ?? "",
      is_active: existingSupplier.is_active,
    });
  }, [existingSupplier?.id]);

  // ── Save mutation ─────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isEditing) return api.put(`/suppliers/${id}/`, form);
      return api.post("/suppliers/", form);
    },
    onSuccess: (res) => {
      const savedId: number = res.data.id ?? parseInt(id!);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier", savedId] });
      navigate(`/suppliers/${savedId}`);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Le nom du fournisseur est obligatoire.");
      return;
    }
    setFormError(null);
    saveMutation.mutate();
  }

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  if (isEditing && loadingSupplier && !existingSupplier) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Chargement du fournisseur...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(isEditing ? `/suppliers/${id}` : "/suppliers")}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            {isEditing ? "Modifier fournisseur" : "Nouveau fournisseur"}
          </h1>
          <p className="text-sm text-text-muted">
            {isEditing
              ? "Modifiez les informations du fournisseur."
              : "Remplissez les informations pour créer un nouveau fournisseur."}
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Error banner */}
        {formError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
            <span className="flex-1">{formError}</span>
            <button type="button" onClick={() => setFormError(null)} className="text-danger hover:text-danger/70">
              ✕
            </button>
          </div>
        )}

        {/* Main card */}
        <div className="card p-5 space-y-4">
          {/* Nom du fournisseur */}
          <div>
            <label className="form-label">
              Nom du fournisseur <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={set("name")}
              className="form-input"
              placeholder="Ex: SARL Chaussures Import"
              autoFocus
              required
            />
          </div>

          {/* Contact */}
          <div>
            <label className="form-label">Contact</label>
            <input
              type="text"
              value={form.contact_name}
              onChange={set("contact_name")}
              className="form-input"
              placeholder="Nom du responsable"
            />
          </div>

          {/* Téléphone & Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Téléphone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={set("phone")}
                className="form-input"
                placeholder="0550 000 000"
              />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                className="form-input"
                placeholder="fournisseur@example.com"
              />
            </div>
          </div>

          {/* Pays d'origine */}
          <div>
            <label className="form-label">Pays d'origine</label>
            <input
              type="text"
              value={form.origin_country}
              onChange={set("origin_country")}
              className="form-input"
              placeholder="Chine, Turquie, Italie..."
            />
          </div>

          {/* Conditions de paiement */}
          <div>
            <label className="form-label">Conditions de paiement</label>
            <input
              type="text"
              value={form.payment_terms}
              onChange={set("payment_terms")}
              className="form-input"
              placeholder="30 jours net"
            />
          </div>

          {/* Adresse */}
          <div>
            <label className="form-label">Adresse</label>
            <textarea
              value={form.address}
              onChange={set("address")}
              className="form-input resize-none"
              rows={2}
              placeholder="Adresse complète du fournisseur"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="form-label">Notes</label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              className="form-input resize-none"
              rows={2}
              placeholder="Remarques, conditions spéciales..."
            />
          </div>

          {/* Actif (edit only) */}
          {isEditing && (
            <div className="flex items-center gap-3 pt-1">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-border text-primary-500"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-text-primary cursor-pointer">
                Actif
              </label>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(isEditing ? `/suppliers/${id}` : "/suppliers")}
            className="btn-secondary"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="btn-primary"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={14} /> {isEditing ? "Enregistrer les modifications" : "Créer le fournisseur"}</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
