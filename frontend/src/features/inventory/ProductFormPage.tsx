/**
 * ProductFormPage — /inventory/products/new  and  /inventory/products/:id/edit
 *
 * Handles both creation (POST) and editing (PATCH).
 * Image upload uses multipart/form-data; all other saves use JSON.
 *
 * During **creation**, an inline variant generator lets users pick sizes × colours
 * so the product and all its variants are created atomically in one save.
 */
import { useState, useRef, useEffect, useMemo } from "react";
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
  Grid3X3,
  Plus,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import type { Product, Category, Gender, Season } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import { cn } from "@/lib/utils";
import { COLOURS, type Colour } from "@/lib/colours";

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

const ALL_SIZES = Array.from({ length: 20 }, (_, i) => 28 + i); // EU 28–47

// Frequently used colours shown as quick-pick buttons
const QUICK_COLOURS = COLOURS.filter((c) =>
  ["black", "white", "brown", "beige", "grey", "blue", "navy", "red", "camel", "dark_brown"].includes(c.value)
);

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
  wholesale_price: string;
  purchase_price: string;
  is_active: boolean;
  alert_threshold: number;
  location: string;
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
  wholesale_price: "",
  purchase_price: "",
  is_active: true,
  alert_threshold: 10,
  location: "",
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
  const { user, tenant } = useAuth();
  const { currentBranch } = useBranch();
  const canUseLocation = tenant?.plan !== "free";
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [clearImage, setClearImage] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Variant generator state (creation only) ──────────────────────────────
  const [selectedSizes, setSelectedSizes] = useState<number[]>([]);
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
  const [customColour, setCustomColour] = useState("");
  const [alertThreshold, setAlertThreshold] = useState(3);
  const [showColourDropdown, setShowColourDropdown] = useState(false);
  const [colourSearch, setColourSearch] = useState("");

  const variantCount = useMemo(
    () => selectedSizes.length * selectedColours.length,
    [selectedSizes, selectedColours]
  );

  // Filtered colours for the dropdown
  const filteredColours = useMemo(() => {
    if (!colourSearch) return COLOURS;
    const q = colourSearch.toLowerCase();
    return COLOURS.filter(
      (c) => c.label.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)
    );
  }, [colourSearch]);

  // ── Load existing product when editing ──────────────────────────────────────

  const { data: existingProduct, isLoading: loadingProduct } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn: () => api.get(`/inventory/products/${id}/`, { params: { branch_id: currentBranch?.id } }).then((r) => r.data),
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
      location: existingProduct.location ?? "",
      description: existingProduct.description ?? "",
      category: existingProduct.category,
      gender: existingProduct.gender,
      season: existingProduct.season,
      sale_price: existingProduct.sale_price ?? "",
      wholesale_price: existingProduct.wholesale_price ?? "",
      purchase_price: existingProduct.purchase_price ?? "",
      is_active: existingProduct.is_active,
      alert_threshold: existingProduct.alert_threshold ?? 10,
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

  // ── Size toggle helpers ──────────────────────────────────────────────────────

  function toggleSize(size: number) {
    setSelectedSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size].sort((a, b) => a - b)
    );
  }

  function selectSizeRange(from: number, to: number) {
    const range = ALL_SIZES.filter((s) => s >= from && s <= to);
    setSelectedSizes((prev) => {
      const asSet = new Set([...prev, ...range]);
      return Array.from(asSet).sort((a, b) => a - b);
    });
  }

  // ── Colour toggle helpers ────────────────────────────────────────────────────

  function toggleColour(label: string) {
    setSelectedColours((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label]
    );
  }

  function addCustomColour() {
    const trimmed = customColour.trim();
    if (!trimmed || selectedColours.includes(trimmed)) return;
    setSelectedColours((prev) => [...prev, trimmed]);
    setCustomColour("");
  }

  function addColourFromDropdown(colour: Colour) {
    if (!selectedColours.includes(colour.label)) {
      setSelectedColours((prev) => [...prev, colour.label]);
    }
    setShowColourDropdown(false);
    setColourSearch("");
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
      if (isEditing) {
        // ── Edit mode: same as before ──
        if (imageFile) {
          const fd = new FormData();
          Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
          if (currentBranch) fd.append("branch_id", String(currentBranch.id));
          fd.append("image", imageFile);
          return api.patch(`/inventory/products/${id}/`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }
        const payload: Record<string, unknown> = { ...form };
        if (currentBranch) payload.branch_id = currentBranch.id;
        if (clearImage) payload.image = null;
        return api.patch(`/inventory/products/${id}/`, payload);
      }

      // ── Creation mode: include variants ──
      const hasVariants = selectedSizes.length > 0 && selectedColours.length > 0;

      if (imageFile) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
        if (currentBranch) fd.append("branch_id", String(currentBranch.id));
        fd.append("image", imageFile);
        if (hasVariants) {
          // FormData can't natively handle nested JSON, so we serialize variants as a JSON string
          // and the backend will parse it from request.data (DRF's JSONParser handles this via
          // the ProductCreateSerializer, but for multipart we need to structure it differently).
          // Instead, we'll do a two-step: create product with image via multipart, then generate variants.
          const res = await api.post("/inventory/products/", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          // Now generate variants
          await api.post(`/inventory/products/${res.data.id}/generate-variants/`, {
            sizes: selectedSizes,
            colours: selectedColours,
            alert_threshold: alertThreshold,
          });
          return res;
        }
        return api.post("/inventory/products/", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      // JSON payload with inline variants
      const payload: Record<string, unknown> = { ...form };
      if (currentBranch) payload.branch_id = currentBranch.id;
      if (hasVariants) {
        payload.variants = {
          sizes: selectedSizes,
          colours: selectedColours,
          alert_threshold: alertThreshold,
        };
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
              : "Remplissez les champs ci-dessous pour créer un article et ses variantes."}
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

            <Field label="Rayonnage / Emplacement" hint={canUseLocation ? "Lieu de stockage pour l'agence actuelle" : "Disponible à partir du plan PRO"}>
              <div className="relative">
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  className={cn("form-input", !canUseLocation && "bg-bg-muted opacity-60 cursor-not-allowed")}
                  placeholder="Ex: Rayon 3, Étagère B"
                  disabled={!canUseLocation}
                />
                {!canUseLocation && (
                   <span className="absolute right-3 top-1/2 -translate-y-1/2 badge badge-neutral text-[10px]">
                     PRO
                   </span>
                )}
              </div>
            </Field>

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

            {/* Classification & Alertes */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Classification & Alertes
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

              <div className="pt-2">
                <Field label="Seuil d'alerte global" hint="Alerte de stock bas sur l'ensemble du produit.">
                  <input
                    type="number"
                    min="0"
                    value={form.alert_threshold}
                    onChange={(e) => setForm((f) => ({ ...f, alert_threshold: parseInt(e.target.value) || 0 }))}
                    className="form-input"
                  />
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

              <Field label="Prix de gros (DZD)">
                <input
                  type="number"
                  value={form.wholesale_price}
                  onChange={(e) => setForm((f) => ({ ...f, wholesale_price: e.target.value }))}
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

        {/* ── Variant Generator (creation only) ──────────────────────────────── */}
        {!isEditing && (
          <div className="card p-5 space-y-5">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Grid3X3 size={16} className="text-primary-500" />
              <h2 className="text-sm font-semibold text-text-primary">
                Variantes (Taille × Couleur)
              </h2>
              {variantCount > 0 && (
                <span className="badge badge-info ms-auto font-mono">
                  {variantCount} variante{variantCount > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Size picker */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-text-muted">
                  Pointures EU
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => selectSizeRange(35, 42)}
                    className="text-2xs text-primary-500 hover:underline"
                  >
                    35–42
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSizeRange(39, 46)}
                    className="text-2xs text-primary-500 hover:underline"
                  >
                    39–46
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSizeRange(28, 35)}
                    className="text-2xs text-primary-500 hover:underline"
                  >
                    28–35 (enfant)
                  </button>
                  {selectedSizes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedSizes([])}
                      className="text-2xs text-danger hover:underline"
                    >
                      Tout effacer
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_SIZES.map((size) => {
                  const selected = selectedSizes.includes(size);
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => toggleSize(size)}
                      className={cn(
                        "w-10 h-9 rounded-md text-xs font-mono font-semibold border transition-all",
                        selected
                          ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                          : "bg-surface text-text-muted border-border hover:border-primary-300 hover:text-text-primary"
                      )}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Colour picker */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-text-muted">
                  Couleurs
                </label>
                {selectedColours.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedColours([])}
                    className="text-2xs text-danger hover:underline"
                  >
                    Tout effacer
                  </button>
                )}
              </div>

              {/* Quick-pick colour buttons */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_COLOURS.map((colour) => {
                  const selected = selectedColours.includes(colour.label);
                  return (
                    <button
                      key={colour.value}
                      type="button"
                      onClick={() => toggleColour(colour.label)}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-all",
                        selected
                          ? "bg-primary-50 text-primary-700 border-primary-300 shadow-sm"
                          : "bg-surface text-text-muted border-border hover:border-primary-300"
                      )}
                    >
                      {colour.hex && (
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-border/40 flex-shrink-0"
                          style={{ backgroundColor: colour.hex }}
                        />
                      )}
                      {colour.label}
                    </button>
                  );
                })}

                {/* More colours dropdown trigger */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowColourDropdown(!showColourDropdown)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-dashed border-border text-text-muted hover:border-primary-300 hover:text-primary-500 transition-all"
                  >
                    <Plus size={12} />
                    Plus de couleurs…
                  </button>

                  {showColourDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => { setShowColourDropdown(false); setColourSearch(""); }}
                      />
                      <div className="absolute z-50 top-full mt-1 start-0 w-64 bg-white border border-border rounded-lg shadow-xl max-h-64 overflow-hidden">
                        <div className="p-2 border-b border-border">
                          <input
                            type="text"
                            value={colourSearch}
                            onChange={(e) => setColourSearch(e.target.value)}
                            className="form-input text-xs py-1.5"
                            placeholder="Rechercher une couleur…"
                            autoFocus
                          />
                        </div>
                        <div className="overflow-y-auto max-h-48">
                          {filteredColours.map((colour) => {
                            const alreadySelected = selectedColours.includes(colour.label);
                            return (
                              <button
                                key={colour.value}
                                type="button"
                                onClick={() => addColourFromDropdown(colour)}
                                disabled={alreadySelected}
                                className={cn(
                                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-start hover:bg-surface transition-colors",
                                  alreadySelected && "opacity-40 cursor-not-allowed"
                                )}
                              >
                                {colour.hex ? (
                                  <span
                                    className="w-3.5 h-3.5 rounded-full border border-border/40 flex-shrink-0"
                                    style={{ backgroundColor: colour.hex }}
                                  />
                                ) : (
                                  <span className="w-3.5 h-3.5 rounded-full border border-dashed border-border flex-shrink-0" />
                                )}
                                <span className="font-medium text-text-primary">{colour.label}</span>
                                <span className="text-text-muted ms-auto">{colour.value}</span>
                                {alreadySelected && (
                                  <CheckCircle size={12} className="text-success ms-1" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Custom colour input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customColour}
                  onChange={(e) => setCustomColour(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomColour(); } }}
                  className="form-input text-xs flex-1"
                  placeholder="Couleur personnalisée…"
                />
                <button
                  type="button"
                  onClick={addCustomColour}
                  disabled={!customColour.trim()}
                  className="btn-secondary btn-sm"
                >
                  <Plus size={12} />
                  Ajouter
                </button>
              </div>

              {/* Selected colours tags */}
              {selectedColours.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedColours.map((label) => {
                    const colourObj = COLOURS.find((c) => c.label === label);
                    return (
                      <span
                        key={label}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200"
                      >
                        {colourObj?.hex && (
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-primary-300/40"
                            style={{ backgroundColor: colourObj.hex }}
                          />
                        )}
                        {label}
                        <button
                          type="button"
                          onClick={() => toggleColour(label)}
                          className="hover:text-danger transition-colors ms-0.5"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Alert threshold */}
            <div className="flex items-center gap-3">
              <Field label="Seuil d'alerte stock" hint="Appliqué à toutes les variantes générées.">
                <input
                  type="number"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(parseInt(e.target.value) || 0)}
                  className="form-input w-24 text-center font-mono"
                  min="0"
                />
              </Field>
            </div>

            {/* Preview summary */}
            {variantCount > 0 && (
              <div className="bg-surface rounded-lg px-4 py-3 flex items-center gap-3">
                <Grid3X3 size={16} className="text-primary-500 flex-shrink-0" />
                <div className="text-sm text-text-primary">
                  <span className="font-semibold">{selectedSizes.length}</span> pointure{selectedSizes.length > 1 ? "s" : ""}{" "}
                  × <span className="font-semibold">{selectedColours.length}</span> couleur{selectedColours.length > 1 ? "s" : ""}{" "}
                  = <span className="font-bold text-primary-600">{variantCount}</span> variante{variantCount > 1 ? "s" : ""} à créer
                </div>
              </div>
            )}

            {variantCount === 0 && (
              <p className="text-xs text-text-muted">
                Sélectionnez au moins une pointure et une couleur pour générer les variantes.
                Vous pouvez aussi les ajouter plus tard depuis la fiche produit.
              </p>
            )}
          </div>
        )}

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
              <>
                <Save size={14} />
                {isEditing
                  ? "Enregistrer les modifications"
                  : variantCount > 0
                    ? `Créer le produit (${variantCount} variantes)`
                    : "Créer le produit"
                }
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
