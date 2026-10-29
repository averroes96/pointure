/**
 * SupplierFormPage — /suppliers/new  and  /suppliers/:id/edit
 *
 * Creates or updates a supplier. Redirects to the supplier detail page on success.
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Load existing supplier when editing ───────────────────────────────────

  const { isLoading: loadingSupplier } = useQuery<Supplier>({
    queryKey: ["supplier", id],
    queryFn: () => api.get(`/suppliers/${id}/`).then((r) => r.data),
    enabled: isEditing,
    staleTime: 0,
  });

  const { data: existingSupplier } = useQuery<Supplier>({
    queryKey: ["supplier", id],
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
      const savedId = res.data.id ?? id!;
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier", savedId] });
      navigate(`/suppliers/${savedId}`);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError(t("supplier.error_name_required"));
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
        <span className="text-sm">{t("supplier.loading_supplier")}</span>
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
          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">
            {isEditing ? t("supplier.edit_supplier") : t("supplier.new_supplier")}
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            {isEditing
              ? t("supplier.edit_supplier_desc")
              : t("supplier.new_supplier_desc")}
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Error banner */}
        {formError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium animate-in fade-in">
            <span className="flex-1">{formError}</span>
            <button type="button" onClick={() => setFormError(null)} className="text-rose-500 hover:text-rose-800">
              ✕
            </button>
          </div>
        )}

        {/* Main card */}
        <div className="card p-6 rounded-2xl border border-slate-200/80 bg-white shadow-xs space-y-4">
          {/* Nom du fournisseur */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t("supplier.name")} <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={set("name")}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
              placeholder={t("supplier.name_placeholder")}
              autoFocus
              required
            />
          </div>

          {/* Contact */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.contact")}</label>
            <input
              type="text"
              value={form.contact_name}
              onChange={set("contact_name")}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
              placeholder={t("supplier.contact_placeholder")}
            />
          </div>

          {/* Téléphone & Email */}
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.phone")}</label>
              <input
                type="tel"
                value={form.phone}
                onChange={set("phone")}
                className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                placeholder="0550 000 000"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.email")}</label>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                placeholder="fournisseur@example.com"
              />
            </div>
          </div>

          {/* Pays d'origine */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.origin_country")}</label>
            <input
              type="text"
              value={form.origin_country}
              onChange={set("origin_country")}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
              placeholder={t("supplier.origin_placeholder")}
            />
          </div>

          {/* Conditions de paiement */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.payment_terms")}</label>
            <input
              type="text"
              value={form.payment_terms}
              onChange={set("payment_terms")}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
              placeholder={t("supplier.terms_placeholder")}
            />
          </div>

          {/* Adresse */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("supplier.address")}</label>
            <textarea
              value={form.address}
              onChange={set("address")}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs resize-none"
              rows={2}
              placeholder={t("supplier.address_placeholder")}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("common.notes")}</label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs resize-none"
              rows={2}
              placeholder={t("supplier.notes_placeholder")}
            />
          </div>

          {/* Actif (edit only) */}
          {isEditing && (
            <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="is_active" className="text-xs font-semibold text-slate-800 cursor-pointer">{t("supplier.active")}</label>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={() => navigate(isEditing ? `/suppliers/${id}` : "/suppliers")}
            className="btn-secondary rounded-xl"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="btn-primary rounded-xl shadow-xs shadow-primary-500/20"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> {t("common.saving")}</>
            ) : (
              <><Save size={14} /> {isEditing ? t("common.save") : t("supplier.new_supplier")}</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
