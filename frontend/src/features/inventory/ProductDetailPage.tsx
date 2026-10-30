/**
 * ProductDetailPage — /inventory/products/:id
 *
 * Sections:
 *  • Header: breadcrumb, product name/brand, status, Edit button
 *  • Info: image, classification (category/gender/season), description
 *  • Pricing: sale price, purchase price (if can_see_costs), margin
 *  • Stock overview: total stock, variant count, low-stock badge
 *  • SKU Matrix: interactive size × colour grid (embedded SkuMatrix)
 *  • Stock by Branch: per-branch breakdown (collapsible)
 *  • Stock Adjustment modal (manager+ only)
 */
import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Edit2,
  Package,
  Tag,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Plus,
  Minus,
  Barcode,
  MapPin,
  Printer,
  Copy,
  Check,
  Trash2,
} from "lucide-react";
import api, { formatDZD, getApiError } from "@/lib/api";
import type { Product, StoreSettings } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import SkuMatrix from "./components/SkuMatrix";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { viewPdfDocument } from "@/lib/pdfViewer";
import { usePrintLabels } from "@/hooks/usePrintLabels";
import { triggerLabelPrint } from "./components/labelPrintStore";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BranchStockRow {
  branch_id: number;
  branch_name: string;
  variants: { variant_id: number; size_eu: number; colour: string; stock: number }[];
}

interface BulkAdjustForm {
  reason: "adjustment" | "reception" | "damaged" | "return" | "initial";
  notes: string;
  deltas: Record<string, string>; // variant_id -> quantity_delta
}

const ADJUST_REASONS: { value: BulkAdjustForm["reason"]; label: string }[] = [
  { value: "adjustment", label: "Ajustement manuel" },
  { value: "reception", label: "Réception marchandise" },
  { value: "return", label: "Retour client" },
  { value: "damaged", label: "Marchandise endommagée" },
  { value: "initial", label: "Stock initial" },
];

const CATEGORY_LABELS: Record<string, string> = {
  sneakers: "Sneakers",
  boots: "Bottes",
  sandals: "Sandales",
  formal: "Chaussures formelles",
  sport: "Sport",
  kids: "Enfants",
  slippers: "Pantoufles",
  other: "Autre",
};

const GENDER_LABELS: Record<string, string> = {
  M: "Homme",
  F: "Femme",
  K: "Enfant",
  U: "Unisexe",
};

const SEASON_LABELS: Record<string, string> = {
  all: "Toutes saisons",
  summer: "Été",
  winter: "Hiver",
  spring_fall: "Mi-saison",
};

// ── InfoBadge helper ──────────────────────────────────────────────────────────

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs text-slate-400 dark:text-slate-400 font-bold uppercase tracking-wider">{label}</span>
      <span className="text-sm font-semibold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const queryClient = useQueryClient();
  const isManager = user?.role !== "cashier";
  const { printLabels } = usePrintLabels();

  // UI state
  const [branchOpen, setBranchOpen] = useState(false);
  const [barcodesOpen, setBarcodesOpen] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<BulkAdjustForm>({
    reason: "adjustment",
    notes: "",
    deltas: {},
  });
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // ── Store settings (Simple Mode vs Variants Mode) ────────────────────────
  const { data: storeSettings } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => api.get("/core/store-settings/current/").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const enableVariants = storeSettings?.enable_variants ?? false;
  const [showMatrixOverride, setShowMatrixOverride] = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: product, isLoading, error } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn: () => api.get(`/inventory/products/${id}/`, { params: { branch_id: currentBranch?.id } }).then((r) => r.data),
    enabled: !!id,
  });

  const { data: branchStock, isLoading: branchLoading } = useQuery<BranchStockRow[]>({
    queryKey: ["product-branch-stock", id],
    queryFn: () =>
      api.get(`/inventory/products/${id}/stock-by-branch/`).then((r) => r.data),
    enabled: !!id && branchOpen,
  });

  // ── Adjust mutation ──────────────────────────────────────────────────────────

  const adjustMutation = useMutation({
    mutationFn: () => {
      const adjustments = Object.entries(adjustForm.deltas)
        .map(([id, delta]) => ({ variant: id, quantity_delta: parseInt(delta) }))
        .filter((adj) => !isNaN(adj.quantity_delta) && adj.quantity_delta !== 0);

      return api.post("/inventory/movements/bulk-adjust/", {
        adjustments,
        reason: adjustForm.reason,
        notes: adjustForm.notes,
        branch: currentBranch?.id ?? null,
      });
    },
    onSuccess: () => {
      // Capture before clearing so auto-print can use them
      const positiveAdjustments = Object.entries(adjustForm.deltas)
        .map(([id, delta]) => ({ variantId: id, delta: parseInt(delta) }))
        .filter((adj) => !isNaN(adj.delta) && adj.delta > 0);

      queryClient.invalidateQueries({ queryKey: ["product", id] });
      queryClient.invalidateQueries({ queryKey: ["product-branch-stock", id] });
      setAdjustOpen(false);
      setAdjustForm({ reason: "adjustment", notes: "", deltas: {} });
      setAdjustError(null);

      // Auto-print barcode labels when stock is added (positive delta only).
      positiveAdjustments.forEach(({ variantId, delta }) => {
        printLabels(variantId, delta);
      });
    },
    onError: (err) => setAdjustError(getApiError(err)),
  });

  function copyBarcode(variantId: number, barcode: string) {
    navigator.clipboard.writeText(barcode).then(() => {
      setCopiedId(variantId);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  async function handlePrintLabels() {
    if (!id || printLoading) return;
    setPrintLoading(true);
    try {
      await triggerLabelPrint({
        title: `Étiquettes — ${product?.name || "Produit"}`,
        defaultCopies: 1,
        fetchHtml: async ({ w, h }) => {
          const res = await api.get(
            `/inventory/products/${id}/barcode-labels/?output=html&w=${w}&h=${h}`,
            { responseType: "text" }
          );
          return res.data;
        },
      });
    } catch {
      // silently ignore
    } finally {
      setPrintLoading(false);
    }
  }

  const [shelfLabelLoading, setShelfLabelLoading] = useState(false);
  async function handlePrintShelfLabel(copies = 1) {
    if (!id || shelfLabelLoading) return;
    setShelfLabelLoading(true);
    try {
      await triggerLabelPrint({
        title: `Étiquette Rayon — ${product?.name || "Produit"}`,
        defaultCopies: copies,
        fetchHtml: async ({ w, h, copies: n }) => {
          const res = await api.get(
            `/inventory/products/${id}/shelf-labels/?output=html&w=${w}&h=${h}&copies=${n}`,
            { responseType: "text" }
          );
          return res.data;
        },
      });
    } catch {
      alert("Erreur lors de la génération de l'étiquette rayon.");
    } finally {
      setShelfLabelLoading(false);
    }
  }

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteForce, setDeleteForce] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteProduct() {
    if (!id || deleteLoading) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.delete(`/inventory/products/${id}/`, {
        params: { force: deleteForce ? "true" : "false" },
      });
      navigate("/inventory/products");
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.has_transactions) {
        setDeleteError(
          data?.detail || "Ce produit possède des historiques de ventes ou factures. Cochez l'option 'Forcer la suppression' pour continuer."
        );
        setDeleteForce(true);
      } else {
        setDeleteError(data?.detail || data?.error || getApiError(err));
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  function submitAdjust() {
    const hasValidDeltas = Object.values(adjustForm.deltas).some(
      (d) => d && !isNaN(parseInt(d)) && parseInt(d) !== 0
    );
    if (!hasValidDeltas) {
      setAdjustError("Aucune quantité n'a été modifiée.");
      return;
    }
    setAdjustError(null);
    adjustMutation.mutate();
  }

  // ── Loading / Error ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Chargement...</span>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-text-muted">
        <XCircle size={32} className="text-danger opacity-50" />
        <p className="text-sm">Produit introuvable.</p>
        <Link to="/inventory/products" className="btn-secondary btn-sm">
          <ArrowLeft size={14} /> Retour
        </Link>
      </div>
    );
  }

  const activeVariants = product.variants.filter((v) => v.is_active);
  const outOfStock = product.total_stock === 0;
  const defaultVariant = product.variants.find((v) => v.size_eu <= 0) || product.variants[0];
  const hasMultipleVariants = product.variants.length > 1;
  const hasRealSizes = product.variants.some((v) => v.size_eu > 0);
  const isSimpleProduct = !enableVariants ? (!hasRealSizes || !hasMultipleVariants) : (!hasRealSizes && !hasMultipleVariants);

  return (
    <div className="space-y-5">
      {/* ── Breadcrumb / Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/inventory/products"
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shadow-2xs"
            title="Retour aux produits"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white">{product.name}</h1>
              {product.brand && (
                <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">· {product.brand}</span>
              )}
              {product.reference && (
                <span className="badge badge-neutral font-mono text-2xs">{product.reference}</span>
              )}
              <span
                className={cn(
                  "badge",
                  product.is_active ? "badge-success" : "badge-neutral"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", product.is_active ? "bg-emerald-500" : "bg-slate-400")} />
                {product.is_active ? "Actif" : "Inactif"}
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
              <span>{CATEGORY_LABELS[product.category] ?? product.category}</span>
              <span>&middot;</span>
              <span>{GENDER_LABELS[product.gender] ?? product.gender}</span>
              <span>&middot;</span>
              <span>{SEASON_LABELS[product.season] ?? product.season}</span>
              {product.location && (
                <>
                  <span>&middot;</span>
                  <span className="inline-flex items-center gap-1 text-primary-600 font-medium">
                    <MapPin size={12} />
                    {product.location}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap flex-shrink-0 self-start sm:self-auto">
          <button
            onClick={() => handlePrintShelfLabel()}
            disabled={shelfLabelLoading}
            className="btn-secondary btn-sm flex items-center gap-1.5"
            title="Imprimer l'étiquette rayon pour ce produit (nom, prix de vente, emplacement)"
          >
            {shelfLabelLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Tag size={13} className="text-amber-600" />
            )}
            Étiquette Rayon
          </button>
          {isManager && (
            <>
              <button
                onClick={() => setAdjustOpen(true)}
                className="btn-secondary btn-sm"
                title="Ajuster le stock"
              >
                <BarChart3 size={14} />
                Ajuster stock
              </button>
              <Link
                to={`/inventory/products/${id}/edit`}
                className="btn-primary btn-sm"
              >
                <Edit2 size={14} />
                Modifier
              </Link>
              <button
                onClick={() => {
                  setDeleteError(null);
                  setDeleteForce(false);
                  setDeleteModalOpen(true);
                }}
                className="btn-ghost btn-sm text-red-600 hover:bg-red-50 hover:text-red-700"
                title="Supprimer définitivement ce produit"
              >
                <Trash2 size={14} />
                Supprimer
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Main grid (image + info + pricing + stock) ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Image Card */}
        <div className="card rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-center min-h-[220px] bg-slate-50/50 dark:bg-slate-900">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="max-h-52 max-w-full object-contain rounded-xl"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <Package size={56} className="text-slate-300 dark:text-slate-600 stroke-[1.5]" />
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Pas d'image</span>
            </div>
          )}
        </div>

        {/* Classification + Description Card */}
        <div className="card rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 bg-white dark:bg-slate-900">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Informations produit</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <InfoBadge label="Catégorie" value={CATEGORY_LABELS[product.category] ?? product.category} />
            <InfoBadge label="Genre" value={GENDER_LABELS[product.gender] ?? product.gender} />
            <InfoBadge label="Saison" value={SEASON_LABELS[product.season] ?? product.season} />
            <InfoBadge label={t("product.pairs_per_carton")} value={String(product.pairs_per_carton ?? 10)} />
          </div>
          {product.description && (
            <p className="text-sm text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-3 leading-relaxed">
              {product.description}
            </p>
          )}
        </div>

        {/* Pricing + Stock KPIs */}
        <div className="flex flex-col gap-4">
          {/* Pricing Card */}
          <div className="card rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3.5 bg-white dark:bg-slate-900">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.pricing_card_title")}</h3>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("inventory.sale_price")}</span>
              <span className="font-mono font-bold text-xl text-slate-900 dark:text-white tabular-nums">
                {formatDZD(product.sale_price)} <span className="text-xs font-sans text-slate-400 font-normal">DZD</span>
              </span>
            </div>
            {parseFloat(product.wholesale_price || "0") > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("inventory.wholesale_price")}</span>
                <span className="font-mono font-bold text-base text-primary-600 dark:text-primary-400 tabular-nums">
                  {formatDZD(product.wholesale_price)} <span className="text-xs font-sans text-slate-400 font-normal">DZD</span>
                </span>
              </div>
            )}
            {user?.can_see_costs && product.purchase_price && (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("inventory.last_purchase_price", "Dernier prix d'achat")}</span>
                  <span className="font-mono text-sm text-slate-600 dark:text-slate-300 tabular-nums">
                    {formatDZD(product.purchase_price)} <span className="text-2xs font-sans text-slate-400">DZD</span>
                  </span>
                </div>
                {product.pamp && parseFloat(product.pamp) > 0 && (
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400" title={t("inventory.pamp_tooltip")}>
                      {t("inventory.pamp", "PAMP (Coût moyen)")}
                    </span>
                    <span className="font-mono text-sm text-amber-600 dark:text-amber-400 font-semibold tabular-nums">
                      {formatDZD(product.pamp)} <span className="text-2xs font-sans text-slate-400">DZD</span>
                    </span>
                  </div>
                )}
                {product.margin_pct != null && (
                  <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2.5">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("inventory.gross_margin")}</span>
                    <span
                      className={cn(
                        "font-mono font-bold text-xs px-2 py-0.5 rounded-full border tabular-nums",
                        parseFloat(product.margin_pct) >= 20
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60"
                          : parseFloat(product.margin_pct) >= 10
                          ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60"
                          : "bg-red-50 dark:bg-rose-950/40 text-red-700 dark:text-rose-400 border-red-200 dark:border-rose-800/60"
                      )}
                    >
                      {parseFloat(product.margin_pct).toFixed(1)}%
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Stock KPI Card */}
          <div
            className={cn(
              "card rounded-2xl p-5 border shadow-xs bg-white dark:bg-slate-900",
              outOfStock
                ? "border-red-200 dark:border-rose-900/50 bg-red-50/20 dark:bg-rose-950/20"
                : product.is_total_low_stock || product.has_low_stock
                ? "border-amber-200 dark:border-amber-900/50 bg-amber-50/20 dark:bg-amber-950/20"
                : "border-slate-200/80 dark:border-slate-800"
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xs text-slate-400 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">
                  {t("inventory.total_stock")}
                </p>
                <p
                  className={cn(
                    "text-3xl font-mono font-black tabular-nums",
                    outOfStock ? "text-red-600 dark:text-rose-400" : product.is_total_low_stock ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {product.total_stock}
                </p>
              </div>
              <div className="text-end">
                {outOfStock ? (
                  <div className="inline-flex items-center gap-1 text-red-600 dark:text-rose-400 text-xs font-bold bg-red-50 dark:bg-rose-950/40 px-2.5 py-1 rounded-full border border-red-200 dark:border-rose-900/50">
                    <XCircle size={14} />
                    Rupture de stock
                  </div>
                ) : product.is_total_low_stock ? (
                  <div className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-bold bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-900/50">
                    <AlertTriangle size={14} />
                    Stock global bas
                  </div>
                ) : product.has_low_stock ? (
                  <div className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-bold bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-900/50">
                    <AlertTriangle size={14} />
                    Variantes basses
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-900/50">
                    <CheckCircle size={14} />
                    Disponible
                  </div>
                )}
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 font-medium">
                  {activeVariants.length} variante(s) active(s)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Single-Product Stock & Barcode Card (Simple Mode) ──────────────── */}
      {isSimpleProduct && !showMatrixOverride ? (
        <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs bg-white dark:bg-slate-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 border border-primary-100 dark:border-primary-800/60 flex items-center justify-center">
                <Package size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">Stock & Code-barres</h2>
                  <span className="badge badge-neutral text-2xs">Article Unique</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Gestion directe du stock et étiquette pour cet article</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handlePrintShelfLabel()}
                disabled={shelfLabelLoading}
                className="btn-secondary btn-sm flex items-center gap-1.5 font-medium"
                title="Imprimer une étiquette rayon (nom, prix de vente, emplacement)"
              >
                {shelfLabelLoading ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} className="text-amber-600 dark:text-amber-400" />}
                Étiquette Rayon
              </button>
              {defaultVariant?.barcode && (
                <button
                  type="button"
                  onClick={() => printLabels(defaultVariant.id, 1)}
                  className="btn-secondary btn-sm flex items-center gap-1.5 font-medium"
                  title="Imprimer une étiquette code-barres"
                >
                  <Printer size={13} />
                  Code-barres
                </button>
              )}
              {isManager && (
                <button
                  type="button"
                  onClick={() => {
                    if (defaultVariant) {
                      setAdjustForm({
                        reason: "adjustment",
                        notes: "",
                        deltas: { [defaultVariant.id]: "" },
                      });
                    }
                    setAdjustOpen(true);
                  }}
                  className="btn-secondary btn-sm flex items-center gap-1.5 font-medium"
                >
                  <BarChart3 size={13} />
                  Ajuster stock
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowMatrixOverride(true)}
                className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors ms-1 cursor-pointer"
              >
                Passer en vue détaillée
              </button>
            </div>
          </div>

          {/* 3-column overview grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            {/* 1. Stock quantity & quick adjust */}
            <div className="bg-slate-50/70 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200/70 dark:border-slate-700/60 flex flex-col justify-between">
              <div>
                <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                  Quantité en rayon
                </span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span
                    className={cn(
                      "text-3xl font-mono font-black tabular-nums",
                      outOfStock ? "text-red-600 dark:text-rose-400" : product.is_total_low_stock ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {defaultVariant?.stock_qty ?? product.total_stock}
                  </span>
                  <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{t("inventory.units")}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">Seuil d'alerte : {product.alert_threshold || 3}</span>
                {isManager && defaultVariant && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustForm({
                          reason: "adjustment",
                          notes: "Ajustement rapide -1",
                          deltas: { [defaultVariant.id]: "-1" },
                        });
                        setAdjustOpen(true);
                      }}
                      className="w-7 h-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:text-red-600 dark:hover:text-rose-400 text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                      title="-1 unité"
                    >
                      <Minus size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustForm({
                          reason: "reception",
                          notes: "Réception rapide +1",
                          deltas: { [defaultVariant.id]: "1" },
                        });
                        setAdjustOpen(true);
                      }}
                      className="w-7 h-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                      title="+1 unité"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Barcode & Live SVG */}
            <div className="bg-slate-50/70 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200/70 dark:border-slate-700/60 flex flex-col justify-between">
              <div>
                <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                  Code-barres de l'article
                </span>
                <div className="flex items-center justify-between mt-2">
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {defaultVariant?.barcode || product.barcode || "Non généré"}
                  </span>
                  {defaultVariant?.barcode && (
                    <button
                      type="button"
                      onClick={() => copyBarcode(defaultVariant.id, defaultVariant.barcode!)}
                      className="p-1 text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 rounded-md hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                      title="Copier le code-barres"
                    >
                      {copiedId === defaultVariant.id ? (
                        <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center min-h-[48px] bg-white dark:bg-slate-900 rounded-lg p-2 border border-slate-100 dark:border-slate-700">
                {defaultVariant?.barcode ? (
                  <BarcodeSvg
                    value={defaultVariant.barcode}
                    height={38}
                    showText={false}
                    className="max-w-full text-slate-900 dark:text-slate-100"
                  />
                ) : (
                  <span className="text-xs text-slate-400 dark:text-slate-500">{t("inventory.no_barcode_assigned")}</span>
                )}
              </div>
            </div>

            {/* 3. Emplacement & Informations carton */}
            <div className="bg-slate-50/70 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200/70 dark:border-slate-700/60 flex flex-col justify-between">
              <div>
                <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                  {t("inventory.storage_and_location")}
                </span>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">{t("inventory.shelf_location")}</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {product.location ? (
                        <span className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 font-medium">
                          <MapPin size={11} /> {product.location}
                        </span>
                      ) : (
                        t("inventory.not_specified")
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">{t("product.pairs_per_carton", "Pièces par carton")} :</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                      {product.pairs_per_carton ?? 10}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">{t("inventory.sku_ref")}</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {product.reference || "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-2xs text-slate-400 dark:text-slate-500">
                <span>Créé le {new Date(product.created_at).toLocaleDateString("fr-FR")}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── SKU Matrix (Multi-variants or override) ────────────────────────── */
        <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-xs bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag size={16} className="text-primary-600" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Variantes (Taille × Couleur)</h2>
            </div>
            {isSimpleProduct && showMatrixOverride && (
              <button
                type="button"
                onClick={() => setShowMatrixOverride(false)}
                className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer"
              >
                Revenir à la vue simple
              </button>
            )}
          </div>
          <SkuMatrix
            productId={product.id}
            variants={product.variants}
            onSave={() => queryClient.invalidateQueries({ queryKey: ["product", id] })}
            readOnly={!isManager}
          />
        </div>
      )}

      {/* ── Stock by Branch (collapsible) ────────────────────────────────────── */}
      <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden bg-white dark:bg-slate-900">
        <button
          onClick={() => setBranchOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-50/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BarChart3 size={15} className="text-primary-600" />
            Stock par succursale
          </div>
          {branchOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {branchOpen && (
          <div className="border-t border-slate-200/80 dark:border-slate-800 px-5 py-4">
            {branchLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4 justify-center">
                <Loader2 size={16} className="animate-spin text-primary-500" /> {t("common.loading")}
              </div>
            ) : !branchStock || branchStock.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">{t("inventory.no_branch_configured")}</p>
            ) : isSimpleProduct ? (
              <div className="overflow-x-auto">
                <table className="data-table text-xs">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
                      <th className="py-3 px-4 font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.branch_col")}</th>
                      <th className="py-3 px-4 font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("inventory.available_stock_col")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {branchStock.map((branch) => {
                      const branchTotal = branch.variants.reduce((s, v) => s + v.stock, 0);
                      return (
                        <tr key={branch.branch_id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">{branch.branch_name}</td>
                          <td className="py-3 px-4 text-end font-mono font-bold tabular-nums">
                            <span
                              className={cn(
                                branchTotal === 0 ? "text-red-600 dark:text-rose-400" : branchTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                              )}
                            >
                              {branchTotal}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table text-xs">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
                      <th className="py-3 px-4 font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.branch_col")}</th>
                      {/* Collect unique sizes across all branches */}
                      {Array.from(
                        new Set(branchStock.flatMap((b) => b.variants.map((v) => `${v.size_eu}_${v.colour === "N/A" ? t("common.na") : v.colour}`)))
                      )
                        .slice(0, 12)
                        .map((key) => {
                          const [size, colour] = key.split("_");
                          return (
                            <th key={key} className="py-3 px-2 text-center whitespace-nowrap font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              EU {size}<br />
                              <span className="text-2xs font-normal text-slate-400 dark:text-slate-500">{colour}</span>
                            </th>
                          );
                        })}
                      <th className="py-3 px-4 font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">{t("common.total")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {branchStock.map((branch) => {
                      const variantKeys = Array.from(
                        new Set(branchStock.flatMap((b) => b.variants.map((v) => `${v.size_eu}_${v.colour === "N/A" ? t("common.na") : v.colour}`)))
                      ).slice(0, 12);
                      const branchTotal = branch.variants.reduce((s, v) => s + v.stock, 0);
                      return (
                        <tr key={branch.branch_id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">{branch.branch_name}</td>
                          {variantKeys.map((key) => {
                            const [sizeStr, colour] = key.split("_");
                            const v = branch.variants.find(
                              (bv) => bv.size_eu === parseInt(sizeStr) && bv.colour === colour
                            );
                            return (
                              <td key={key} className="py-3 px-2 text-center font-mono tabular-nums">
                                <span
                                  className={cn(
                                    "font-bold",
                                    v?.stock === 0 ? "text-red-600 dark:text-rose-400" : v?.stock && v.stock > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                                  )}
                                >
                                  {v?.stock ?? "—"}
                                </span>
                              </td>
                            );
                          })}
                          <td className="py-3 px-4 text-end font-mono font-bold text-slate-900 dark:text-white tabular-nums">{branchTotal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Codes-barres (collapsible for multi-variants) ───────────────────── */}
      {(!isSimpleProduct || showMatrixOverride) && (
        <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden bg-white dark:bg-slate-900">
          <button
            onClick={() => setBarcodesOpen((o) => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-50/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Barcode size={15} className="text-primary-600" />
              Codes-barres des variantes
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                ({product.variants.filter((v) => v.barcode).length} codes)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {barcodesOpen && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePrintShelfLabel(); }}
                    disabled={shelfLabelLoading}
                    className="btn-secondary btn-sm flex items-center gap-1.5"
                    title="Imprimer l'étiquette rayon (nom, prix, emplacement)"
                  >
                    {shelfLabelLoading ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} className="text-amber-600" />}
                    Étiquette Rayon
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePrintLabels(); }}
                    disabled={printLoading}
                    className="btn-secondary btn-sm"
                    title="Imprimer les étiquettes codes-barres"
                  >
                    {printLoading
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Printer size={13} />}
                    Codes-barres
                  </button>
                </>
              )}
              {barcodesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          {barcodesOpen && (
            <div className="border-t border-slate-200/80 dark:border-slate-800 px-5 py-4">
              <div className="overflow-x-auto">
                <table className="data-table text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60">
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.size")}</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.colour")}</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.barcode")}</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Aperçu</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {product.variants
                      .filter((v) => v.is_active)
                      .sort((a, b) => a.size_eu - b.size_eu || a.colour.localeCompare(b.colour))
                      .map((v) => (
                        <tr key={v.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3.5 px-4">
                            {v.size_eu > 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                                T. {v.size_eu}
                              </span>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-400 font-medium">Standard</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 font-medium text-sm">{v.colour === "N/A" ? t("common.na") : v.colour}</td>
                          <td className="py-3.5 px-4">
                            {v.barcode ? (
                              <span className="font-mono font-semibold text-slate-900 dark:text-white">{v.barcode}</span>
                            ) : (
                              <span className="text-slate-400 text-xs">Non généré</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {v.barcode && (
                              <BarcodeSvg
                                value={v.barcode}
                                height={36}
                                showText={false}
                                className="inline-block text-slate-900 dark:text-slate-100"
                              />
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-end">
                            {v.barcode && (
                              <button
                                onClick={() => copyBarcode(v.id, v.barcode!)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Copier"
                              >
                                {copiedId === v.id ? (
                                  <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Stock Adjustment Modal ────────────────────────────────────────────── */}
      {adjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="card rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between font-bold text-slate-900 dark:text-white bg-slate-50/50 dark:bg-slate-800/60 flex-shrink-0">
              <h2>{t("inventory.multi_stock_adjust_title")}</h2>
              <button
                onClick={() => {
                  setAdjustOpen(false);
                  setAdjustError(null);
                  setAdjustForm({ reason: "adjustment", notes: "", deltas: {} });
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-5 overflow-y-auto min-h-0">
              {adjustError && (
                <div className="flex items-center gap-2 text-xs text-red-600 dark:text-rose-400 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-900/60 px-3.5 py-2.5 rounded-xl flex-shrink-0">
                  <AlertTriangle size={14} />
                  {adjustError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 flex-shrink-0">
                {/* Reason */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">{t("inventory.adjust_reason")}</label>
                  <select
                    value={adjustForm.reason}
                    onChange={(e) =>
                      setAdjustForm((f) => ({
                        ...f,
                        reason: e.target.value as BulkAdjustForm["reason"],
                      }))
                    }
                    className="form-input bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white shadow-2xs rounded-xl focus:ring-primary-500/20"
                  >
                    {ADJUST_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">{t("common.notes")}</label>
                  <input
                    type="text"
                    value={adjustForm.notes}
                    onChange={(e) =>
                      setAdjustForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    className="form-input bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white shadow-2xs rounded-xl focus:ring-primary-500/20"
                    placeholder={t("inventory.optional_comment")}
                  />
                </div>
              </div>

              {/* Variants table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex-shrink-0">
                <table className="data-table text-sm w-full">
                  <thead className="bg-slate-50/90 dark:bg-slate-800/90 sticky top-0 z-10 border-b border-slate-200/80 dark:border-slate-800">
                    <tr>
                      <th className="w-1/3 py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{isSimpleProduct ? t("inventory.product") : t("inventory.variant", "Variante")}</th>
                      <th className="w-1/4 py-3 px-4 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.current_stock")}</th>
                      <th className="w-5/12 py-3 px-4 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t("inventory.adjust_diff")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {product.variants
                      .filter((v) => v.is_active)
                      .sort((a, b) => a.size_eu - b.size_eu || a.colour.localeCompare(b.colour))
                      .map((v) => {
                        const deltaStr = adjustForm.deltas[v.id] ?? "";
                        const deltaVal = parseInt(deltaStr) || 0;
                        const newStock = v.stock_qty + deltaVal;

                        const variantLabel = v.size_eu > 0
                          ? `EU ${v.size_eu} · ${v.colour === "N/A" ? t("common.na") : v.colour}`
                          : (v.colour && v.colour !== "Standard" && v.colour !== "N/A"
                              ? `${product.name} (${v.colour})`
                              : product.name);

                        return (
                          <tr key={v.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                              {variantLabel}
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-slate-600 dark:text-slate-400 tabular-nums">
                              {v.stock_qty}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAdjustForm((f) => ({
                                      ...f,
                                      deltas: { ...f.deltas, [v.id]: String(deltaVal - 1) },
                                    }))
                                  }
                                  className="btn-secondary btn-sm w-8 h-8 p-0 flex items-center justify-center flex-shrink-0 rounded-lg font-bold"
                                >
                                  <Minus size={14} />
                                </button>
                                <input
                                  type="number"
                                  value={deltaStr}
                                  onChange={(e) =>
                                    setAdjustForm((f) => ({
                                      ...f,
                                      deltas: { ...f.deltas, [v.id]: e.target.value },
                                    }))
                                  }
                                  className={cn(
                                    "form-input text-center font-mono font-bold w-20 py-1.5 rounded-lg border tabular-nums dark:bg-slate-800 dark:text-white",
                                    deltaVal > 0 ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800" :
                                    deltaVal < 0 ? "text-red-700 dark:text-rose-400 bg-red-50 dark:bg-rose-950/40 border-red-300 dark:border-rose-800" : "border-slate-200 dark:border-slate-700"
                                  )}
                                  placeholder="0"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAdjustForm((f) => ({
                                      ...f,
                                      deltas: { ...f.deltas, [v.id]: String(deltaVal + 1) },
                                    }))
                                  }
                                  className="btn-secondary btn-sm w-8 h-8 p-0 flex items-center justify-center flex-shrink-0 rounded-lg font-bold"
                                >
                                  <Plus size={14} />
                                </button>
                                <span className="text-xs font-mono font-bold w-10 text-end tabular-nums">
                                  {deltaVal !== 0 ? (
                                    <span className={newStock < 0 ? "text-red-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-400"}>→ {newStock}</span>
                                  ) : null}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60 flex-shrink-0">
              <button
                onClick={() => {
                  setAdjustOpen(false);
                  setAdjustError(null);
                  setAdjustForm({ reason: "adjustment", notes: "", deltas: {} });
                }}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button
                onClick={submitAdjust}
                disabled={
                  adjustMutation.isPending ||
                  !Object.values(adjustForm.deltas).some(
                    (d) => d && !isNaN(parseInt(d)) && parseInt(d) !== 0
                  )
                }
                className="btn-primary"
              >
                {adjustMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
                ) : (
                  "Confirmer les ajustements"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Hard Delete Confirmation ───────────────────────────────── */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="card max-w-md w-full p-6 space-y-4 bg-white dark:bg-slate-900 shadow-xl rounded-2xl animate-in fade-in zoom-in-95 border border-red-100 dark:border-rose-900/60">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-rose-950/60 text-red-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Supprimer définitivement ce produit ?
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Le produit <strong className="text-slate-800 dark:text-slate-200">{product.name}</strong> ainsi que toutes ses déclinaisons et mouvements de stock seront supprimés de manière irréversible.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-900/60 rounded-xl text-xs text-red-700 dark:text-rose-300 flex items-start gap-2">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 rounded-xl space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-amber-900 dark:text-amber-300 font-medium">
                <input
                  type="checkbox"
                  checked={deleteForce}
                  onChange={(e) => setDeleteForce(e.target.checked)}
                  className="rounded border-amber-400 text-red-600 focus:ring-red-500 mt-0.5"
                />
                <span>
                  <strong>Forcer la suppression</strong> : Supprimer même si ce produit figure dans d'anciennes ventes, retours ou factures archivées.
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setDeleteError(null);
                  setDeleteForce(false);
                }}
                disabled={deleteLoading}
                className="btn-secondary btn-sm"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDeleteProduct}
                disabled={deleteLoading}
                className="btn-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl px-4 py-2 flex items-center gap-1.5 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                {deleteLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Suppression…
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    Supprimer définitivement
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
