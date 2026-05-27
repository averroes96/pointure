/**
 * ProductFormPage — /inventory/products/new  and  /inventory/products/:id/edit
 *
 * Handles both creation (POST) and editing (PATCH).
 * Image upload uses multipart/form-data; all other saves use JSON.
 */
import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Upload,
  Package,
  Loader2,
  Save,
  AlertTriangle,
  X,
  CheckCircle,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import type { Product, Category, Gender, Season } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "sneakers", label: "Sneakers" },
  { value: "boots", label: "Bottes" },
  { value: "sandals", label: "Sandales" },
  { value: "formal", label: "Chaussures formelles" },
  { value: "sport", label: "Sport" },
  { value: "kids", label: "Enfants" },
  { value: "slippers", label: "Pantoufles" },
  { value: "other", label: "Autre" },
];

const GENDERS: { value: Gender; label: string }[] = [
  { value: "M", label: "Homme" },
  { value: "F", label: "Femme" },
  { value: "K", label: "Enfant" },
  { value: "U", label: "Unisexe" },
];

const SEASONS: { value: Season; label: string }[] = [
  { value: "all", label: "Toutes saisons" },
  { value: "summer", label: "Été" },
  { value: "winter", label: "Hiver" },
  { value: "spring_fall", label: "Mi-saison" },
];

// ── Form state type ────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  brand: string;
  reference: string;
  description: string;
  category: Category;
  gender: Gender;
  season: Season;
  sale_price: string;
  purchase_price: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  brand: "",
  reference: "",
  description: "",
  category: "sneakers",
  gender: "U",
  season: "all",
  sale_price: "",
  purchase_price: "",
  is_active: true,
};

// ── Field wrapper component ────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted mb-1">
        {label}
        {required && <span className="text-danger ms-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [clearImage, setClearImage] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load existing product when editing ──────────────────────────────────────

  const { data: existingProduct, isLoading: loadingProduct } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn: () => api.get(`/inventory/products/${id}/`).then((r) => r.data),
    enabled: isEditing,
    staleTime: 0,
  });

  // Populate form once the product data loads (only run when product id changes)
  useEffect(() => {
    if (!existingProduct) return;
    setForm({
      name: existingProduct.name,
      brand: existingProduct.brand ?? "",
      reference: existingProduct.reference ?? "",
      description: existingProduct.description ?? "",
      category: existingProduct.category,
      gender: existingProduct.gender,
      season: existingProduct.season,
      sale_price: existingProduct.sale_price ?? "",
      purchase_price: existingProduct.purchase_price ?? "",
      is_active: existingProduct.is_active,
    });
    if (existingProduct.image) setImagePreview(existingProduct.image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingProduct?.id]);

  // ── Image selection handler ──────────────────────────────────────────────────

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    setClearImage(false);
    if (file) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    }
  }

  function handleClearImage() {
    setImageFile(null);
    setClearImage(true);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Validate ─────────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!form.name.trim()) return "Le nom du produit est obligatoire.";
    if (!form.sale_price || isNaN(parseFloat(form.sale_price)) || parseFloat(form.sale_price) <= 0)
      return "Le prix de vente doit être un nombre positif.";
    if (
      form.purchase_price &&
      (isNaN(parseFloat(form.purchase_price)) || parseFloat(form.purchase_price) < 0)
    )
      return "Le prix d'achat doit être un nombre positif.";
    return null;
  }

  // ── Save mutation ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Use FormData only when there's an image to upload
      if (imageFile) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
        fd.append("image", imageFile);
        if (isEditing) {
          return api.patch(`/inventory/products/${id}/`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }
        return api.post("/inventory/products/", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      // JSON payload (no new image)
      const payload: Record<string, unknown> = { ...form };
      if (clearImage) payload.image = null;
      if (isEditing) {
        return api.patch(`/inventory/products/${id}/`, payload);
      }
      return api.post("/inventory/products/", payload);
    },
    onSuccess: (res) => {
      const savedId: number = res.data.id ?? parseInt(id!);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product", String(savedId)] });
      setSaved(true);
      // Navigate to the detail page after a short flash
      setTimeout(() => navigate(`/inventory/products/${savedId}`), 800);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setFormError(err); return; }
    setFormError(null);
    saveMutation.mutate();
  }

  // ── Skeleton while loading product for edit ──────────────────────────────────

  if (isEditing && loadingProduct) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Chargement du produit...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link
          to={isEditing ? `/inventory/products/${id}` : "/inventory/products"}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            {isEditing ? "Modifier le produit" : "Nouveau produit"}
          </h1>
          <p className="text-sm text-text-muted">
            {isEditing
              ? "Modifiez les informations du produit."
              : "Remplissez les champs ci-dessous pour créer un article."}
          </p>
        </div>
      </div>

      {/* ── Form ────────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Error banner */}
        {formError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
            <AlertTriangle size={14} />
            <span className="flex-1">{formError}</span>
            <button type="button" onClick={() => setFormError(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Success flash */}
        {saved && (
          <div className="flex items-center gap-2 px-4 py-3 bg-success/10 border border-success/30 rounded-lg text-sm text-success">
            <CheckCircle size={14} />
            Produit enregistré avec succès. Redirection...
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* ── Left column: Identity ────────────────────────────────────────── */}
          <div className="lg:col-span-3 card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
              Identité du produit
            </h2>

            <Field label="Nom" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="form-input"
                placeholder="Ex: Air Max 90"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Marque">
                <input
                  type="text"
                  value={form.brand}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                  className="form-input"
                  placeholder="Ex: Nike"
                />
              </Field>
              <Field label="Référence / SKU">
                <input
                  type="text"
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  className="form-input"
                  placeholder="Ex: AM90-BLK"
                />
              </Field>
            </div>

            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="form-input resize-none"
                rows={3}
                placeholder="Description courte du produit..."
              />
            </Field>

            {/* Active toggle */}
            <div className="flex items-center justify-between py-2 border-t border-border">
              <div>
                <p className="text-sm font-medium text-text-primary">Produit actif</p>
                <p className="text-xs text-text-muted">Les produits inactifs ne sont pas affichés en caisse.</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                className={cn(
                  "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                  form.is_active ? "bg-primary-500" : "bg-border"
                )}
                role="switch"
                aria-checked={form.is_active}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform",
                    form.is_active ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>

          {/* ── Right column: Classification + Pricing + Image ───────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* Classification */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Classification
              </h2>

              <Field label="Catégorie" required>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value as Category }))
                  }
                  className="form-input"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Genre">
                  <select
                    value={form.gender}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, gender: e.target.value as Gender }))
                    }
                    className="form-input"
                  >
                    {GENDERS.map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Saison">
                  <select
                    value={form.season}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, season: e.target.value as Season }))
                    }
                    className="form-input"
                  >
                    {SEASONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {/* Pricing */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Prix
              </h2>

              <Field label="Prix de vente (DZD)" required>
                <input
                  type="number"
                  value={form.sale_price}
                  onChange={(e) => setForm((f) => ({ ...f, sale_price: e.target.value }))}
                  className="form-input"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </Field>

              {user?.can_see_costs && (
                <Field
                  label="Prix d'achat (DZD)"
                  hint="Visible uniquement par les managers."
                >
                  <input
                    type="number"
                    value={form.purchase_price}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, purchase_price: e.target.value }))
                    }
                    className="form-input"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </Field>
              )}

              {/* Margin preview */}
              {user?.can_see_costs &&
                form.sale_price &&
                form.purchase_price &&
                parseFloat(form.sale_price) > 0 &&
                parseFloat(form.purchase_price) >= 0 && (
                  <div className="text-xs text-text-muted bg-surface rounded-md px-3 py-2 flex justify-between">
                    <span>Marge estimée</span>
                    <span
                      className={cn(
                        "font-semibold font-mono",
                        ((parseFloat(form.sale_price) - parseFloat(form.purchase_price)) /
                          parseFloat(form.sale_price)) *
                          100 >=
                          20
                          ? "text-success"
                          : "text-warning"
                      )}
                    >
                      {(
                        ((parseFloat(form.sale_price) - parseFloat(form.purchase_price)) /
                          parseFloat(form.sale_price)) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                )}
            </div>

            {/* Image upload */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Photo
              </h2>

              {/* Preview */}
              <div className="flex items-center justify-center bg-surface rounded-lg h-32 overflow-hidden relative">
                {imagePreview ? (
                  <>
                    <img
                      src={imagePreview}
                      alt="Aperçu"
                      className="max-h-28 max-w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={handleClearImage}
                      className="absolute top-2 end-2 bg-danger text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-danger/80"
                      title="Supprimer l'image"
                    >
                      <X size={10} />
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-text-muted opacity-40">
                    <Package size={32} />
                    <span className="text-xs">Pas d'image</span>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                id="product-image-input"
              />
              <label
                htmlFor="product-image-input"
                className="btn-secondary btn-sm w-full flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Upload size={13} />
                {imagePreview ? "Changer l'image" : "Télécharger une image"}
              </label>
            </div>
          </div>
        </div>

        {/* ── Submit ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            to={isEditing ? `/inventory/products/${id}` : "/inventory/products"}
            className="btn-secondary"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={saveMutation.isPending || saved}
            className="btn-primary"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={14} /> {isEditing ? "Enregistrer les modifications" : "Créer le produit"}</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
