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
} from "lucide-react";
import api, { formatDZD, getApiError } from "@/lib/api";
import type { Product, StoreSettings } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import SkuMatrix from "./components/SkuMatrix";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { usePrintLabels } from "@/hooks/usePrintLabels";

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
      <span className="text-2xs text-slate-400 font-bold uppercase tracking-wider">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
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
      const res = await api.get(`/inventory/products/${id}/barcode-labels/`, {
        responseType: "arraybuffer",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      // Revoke the blob URL after the tab has loaded
      if (win) win.addEventListener("load", () => URL.revokeObjectURL(url));
    } catch {
      // silently ignore — extremely unlikely given the user is already authenticated
    } finally {
      setPrintLoading(false);
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
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors shadow-2xs"
            title="Retour aux produits"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{product.name}</h1>
              {product.brand && (
                <span className="text-sm text-slate-500 font-medium">· {product.brand}</span>
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
            <p className="text-xs font-medium text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
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

        <div className="flex items-center gap-2.5 flex-shrink-0 self-start sm:self-auto">
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
            </>
          )}
        </div>
      </div>

      {/* ── Main grid (image + info + pricing + stock) ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Image Card */}
        <div className="card rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-center min-h-[220px] bg-slate-50/50">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="max-h-52 max-w-full object-contain rounded-xl"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <Package size={56} className="text-slate-300 stroke-[1.5]" />
              <span className="text-xs font-medium text-slate-400">Pas d'image</span>
            </div>
          )}
        </div>

        {/* Classification + Description Card */}
        <div className="card rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4 bg-white">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Informations produit</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <InfoBadge label="Catégorie" value={CATEGORY_LABELS[product.category] ?? product.category} />
            <InfoBadge label="Genre" value={GENDER_LABELS[product.gender] ?? product.gender} />
            <InfoBadge label="Saison" value={SEASON_LABELS[product.season] ?? product.season} />
            <InfoBadge label={t("product.pairs_per_carton")} value={String(product.pairs_per_carton ?? 10)} />
          </div>
          {product.description && (
            <p className="text-sm text-slate-600 border-t border-slate-100 pt-3 leading-relaxed">
              {product.description}
            </p>
          )}
        </div>

        {/* Pricing + Stock KPIs */}
        <div className="flex flex-col gap-4">
          {/* Pricing Card */}
          <div className="card rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-3.5 bg-white">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tarification</h3>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-slate-500">Prix de vente</span>
              <span className="font-mono font-bold text-xl text-slate-900 tabular-nums">
                {formatDZD(product.sale_price)} <span className="text-xs font-sans text-slate-400 font-normal">DZD</span>
              </span>
            </div>
            {parseFloat(product.wholesale_price || "0") > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-500">Prix de gros</span>
                <span className="font-mono font-bold text-base text-primary-600 tabular-nums">
                  {formatDZD(product.wholesale_price)} <span className="text-xs font-sans text-slate-400 font-normal">DZD</span>
                </span>
              </div>
            )}
            {user?.can_see_costs && product.purchase_price && (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-slate-500">{t("inventory.last_purchase_price", "Dernier prix d'achat")}</span>
                  <span className="font-mono text-sm text-slate-600 tabular-nums">
                    {formatDZD(product.purchase_price)} <span className="text-2xs font-sans text-slate-400">DZD</span>
                  </span>
                </div>
                {product.pamp && parseFloat(product.pamp) > 0 && (
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-500" title={t("inventory.pamp_tooltip")}>
                      {t("inventory.pamp", "PAMP (Coût moyen)")}
                    </span>
                    <span className="font-mono text-sm text-amber-600 font-semibold tabular-nums">
                      {formatDZD(product.pamp)} <span className="text-2xs font-sans text-slate-400">DZD</span>
                    </span>
                  </div>
                )}
                {product.margin_pct != null && (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                    <span className="text-xs font-medium text-slate-500">Marge brute</span>
                    <span
                      className={cn(
                        "font-mono font-bold text-xs px-2 py-0.5 rounded-full border tabular-nums",
                        parseFloat(product.margin_pct) >= 20
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : parseFloat(product.margin_pct) >= 10
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-red-50 text-red-700 border-red-200"
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
              "card rounded-2xl p-5 border shadow-xs bg-white",
              outOfStock
                ? "border-red-200 bg-red-50/20"
                : product.is_total_low_stock || product.has_low_stock
                ? "border-amber-200 bg-amber-50/20"
                : "border-slate-200/80"
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xs text-slate-400 font-bold uppercase tracking-wider mb-1">
                  Stock total
                </p>
                <p
                  className={cn(
                    "text-3xl font-mono font-black tabular-nums",
                    outOfStock ? "text-red-600" : product.is_total_low_stock ? "text-amber-600" : "text-emerald-600"
                  )}
                >
                  {product.total_stock}
                </p>
              </div>
              <div className="text-end">
                {outOfStock ? (
                  <div className="inline-flex items-center gap-1 text-red-600 text-xs font-bold bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                    <XCircle size={14} />
                    Rupture de stock
                  </div>
                ) : product.is_total_low_stock ? (
                  <div className="inline-flex items-center gap-1 text-amber-600 text-xs font-bold bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                    <AlertTriangle size={14} />
                    Stock global bas
                  </div>
                ) : product.has_low_stock ? (
                  <div className="inline-flex items-center gap-1 text-amber-600 text-xs font-bold bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                    <AlertTriangle size={14} />
                    Variantes basses
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    <CheckCircle size={14} />
                    Disponible
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-1.5 font-medium">
                  {activeVariants.length} variante(s) active(s)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Single-Product Stock & Barcode Card (Simple Mode) ──────────────── */}
      {isSimpleProduct && !showMatrixOverride ? (
        <div className="card rounded-2xl border border-slate-200/80 p-5 shadow-xs bg-white space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-50 text-primary-600 border border-primary-100 flex items-center justify-center">
                <Package size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">Stock & Code-barres</h2>
                  <span className="badge badge-neutral text-2xs">Article Unique</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Gestion directe du stock et étiquette pour cet article</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {defaultVariant?.barcode && (
                <button
                  type="button"
                  onClick={() => printLabels(defaultVariant.id, 1)}
                  className="btn-secondary btn-sm flex items-center gap-1.5 font-medium"
                  title="Imprimer une étiquette"
                >
                  <Printer size={13} />
                  Imprimer étiquette
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
                className="text-xs font-medium text-slate-500 hover:text-primary-600 transition-colors ms-1"
              >
                Passer en vue détaillée
              </button>
            </div>
          </div>

          {/* 3-column overview grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            {/* 1. Stock quantity & quick adjust */}
            <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/70 flex flex-col justify-between">
              <div>
                <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                  Quantité en rayon
                </span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span
                    className={cn(
                      "text-3xl font-mono font-black tabular-nums",
                      outOfStock ? "text-red-600" : product.is_total_low_stock ? "text-amber-600" : "text-emerald-600"
                    )}
                  >
                    {defaultVariant?.stock_qty ?? product.total_stock}
                  </span>
                  <span className="text-xs font-medium text-slate-400">unités</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between">
                <span className="text-xs text-slate-500">Seuil d'alerte : {product.alert_threshold || 3}</span>
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
                      className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600 hover:text-red-600 text-xs font-bold transition-colors shadow-2xs"
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
                      className="w-7 h-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600 hover:text-emerald-600 text-xs font-bold transition-colors shadow-2xs"
                      title="+1 unité"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Barcode & Live SVG */}
            <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/70 flex flex-col justify-between">
              <div>
                <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                  Code-barres de l'article
                </span>
                <div className="flex items-center justify-between mt-2">
                  <span className="font-mono text-sm font-bold text-slate-900">
                    {defaultVariant?.barcode || product.barcode || "Non généré"}
                  </span>
                  {defaultVariant?.barcode && (
                    <button
                      type="button"
                      onClick={() => copyBarcode(defaultVariant.id, defaultVariant.barcode!)}
                      className="p-1 text-slate-400 hover:text-primary-600 rounded-md hover:bg-white transition-colors"
                      title="Copier le code-barres"
                    >
                      {copiedId === defaultVariant.id ? (
                        <Check size={14} className="text-emerald-600" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-center min-h-[48px] bg-white rounded-lg p-1 border border-slate-100">
                {defaultVariant?.barcode ? (
                  <BarcodeSvg
                    value={defaultVariant.barcode}
                    height={38}
                    showText={false}
                    className="max-w-full"
                  />
                ) : (
                  <span className="text-xs text-slate-400">Aucun code-barres assigné</span>
                )}
              </div>
            </div>

            {/* 3. Emplacement & Informations carton */}
            <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200/70 flex flex-col justify-between">
              <div>
                <span className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                  Stockage & Emplacement
                </span>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Emplacement :</span>
                    <span className="font-semibold text-slate-800">
                      {product.location ? (
                        <span className="inline-flex items-center gap-1 text-primary-600 font-medium">
                          <MapPin size={11} /> {product.location}
                        </span>
                      ) : (
                        "Non renseigné"
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{t("product.pairs_per_carton", "Pièces par carton")} :</span>
                    <span className="font-mono font-bold text-slate-800">
                      {product.pairs_per_carton ?? 10}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Référence SKU :</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {product.reference || "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-2xs text-slate-400">
                <span>Créé le {new Date(product.created_at).toLocaleDateString("fr-FR")}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── SKU Matrix (Multi-variants or override) ────────────────────────── */
        <div className="card rounded-2xl border border-slate-200/80 p-5 shadow-xs bg-white space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag size={16} className="text-primary-600" />
              <h2 className="text-sm font-bold text-slate-900">Variantes (Taille × Couleur)</h2>
            </div>
            {isSimpleProduct && showMatrixOverride && (
              <button
                type="button"
                onClick={() => setShowMatrixOverride(false)}
                className="text-xs font-medium text-slate-500 hover:text-primary-600 transition-colors"
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
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <button
          onClick={() => setBranchOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-slate-800 hover:bg-slate-50/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <BarChart3 size={15} className="text-primary-600" />
            Stock par succursale
          </div>
          {branchOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {branchOpen && (
          <div className="border-t border-slate-200/80 px-5 py-4">
            {branchLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4 justify-center">
                <Loader2 size={16} className="animate-spin text-primary-500" /> Chargement...
              </div>
            ) : !branchStock || branchStock.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">Aucune succursale configurée.</p>
            ) : isSimpleProduct ? (
              <div className="overflow-x-auto">
                <table className="data-table text-xs">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/70">
                      <th className="py-3 px-4 font-semibold text-slate-500 uppercase tracking-wider">Succursale</th>
                      <th className="py-3 px-4 font-semibold text-slate-500 uppercase tracking-wider text-end">Stock disponible</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {branchStock.map((branch) => {
                      const branchTotal = branch.variants.reduce((s, v) => s + v.stock, 0);
                      return (
                        <tr key={branch.branch_id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-800">{branch.branch_name}</td>
                          <td className="py-3 px-4 text-end font-mono font-bold tabular-nums">
                            <span
                              className={cn(
                                branchTotal === 0 ? "text-red-600" : branchTotal > 0 ? "text-emerald-600" : "text-slate-400"
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
                    <tr className="border-b border-slate-200/80 bg-slate-50/70">
                      <th className="py-3 px-4 font-semibold text-slate-500 uppercase tracking-wider">Succursale</th>
                      {/* Collect unique sizes across all branches */}
                      {Array.from(
                        new Set(branchStock.flatMap((b) => b.variants.map((v) => `${v.size_eu}_${v.colour === "N/A" ? t("common.na") : v.colour}`)))
                      )
                        .slice(0, 12)
                        .map((key) => {
                          const [size, colour] = key.split("_");
                          return (
                            <th key={key} className="py-3 px-2 text-center whitespace-nowrap font-semibold text-slate-500 uppercase tracking-wider">
                              EU {size}<br />
                              <span className="text-2xs font-normal text-slate-400">{colour}</span>
                            </th>
                          );
                        })}
                      <th className="py-3 px-4 font-semibold text-slate-500 uppercase tracking-wider text-end">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {branchStock.map((branch) => {
                      const variantKeys = Array.from(
                        new Set(branchStock.flatMap((b) => b.variants.map((v) => `${v.size_eu}_${v.colour === "N/A" ? t("common.na") : v.colour}`)))
                      ).slice(0, 12);
                      const branchTotal = branch.variants.reduce((s, v) => s + v.stock, 0);
                      return (
                        <tr key={branch.branch_id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-semibold text-slate-800">{branch.branch_name}</td>
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
                                    v?.stock === 0 ? "text-red-600" : v?.stock && v.stock > 0 ? "text-emerald-600" : "text-slate-400"
                                  )}
                                >
                                  {v?.stock ?? "—"}
                                </span>
                              </td>
                            );
                          })}
                          <td className="py-3 px-4 text-end font-mono font-bold text-slate-900 tabular-nums">{branchTotal}</td>
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
        <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
          <button
            onClick={() => setBarcodesOpen((o) => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-slate-800 hover:bg-slate-50/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Barcode size={15} className="text-primary-600" />
              Codes-barres des variantes
              <span className="text-xs font-medium text-slate-400">
                ({product.variants.filter((v) => v.barcode).length} codes)
              </span>
            </div>
            <div className="flex items-center gap-3">
              {barcodesOpen && (
                <button
                  onClick={(e) => { e.stopPropagation(); handlePrintLabels(); }}
                  disabled={printLoading}
                  className="btn-secondary btn-sm"
                  title="Imprimer les étiquettes"
                >
                  {printLoading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Printer size={13} />}
                  Imprimer étiquettes
                </button>
              )}
              {barcodesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          {barcodesOpen && (
            <div className="border-t border-slate-200/80 px-5 py-4">
              <div className="overflow-x-auto">
                <table className="data-table text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/70">
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.size")}</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.colour")}</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.barcode")}</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Aperçu</th>
                      <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {product.variants
                      .filter((v) => v.is_active)
                      .sort((a, b) => a.size_eu - b.size_eu || a.colour.localeCompare(b.colour))
                      .map((v) => (
                        <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4">
                            {v.size_eu > 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-slate-100 text-slate-800 border border-slate-200">
                                T. {v.size_eu}
                              </span>
                            ) : (
                              <span className="text-slate-500 font-medium">Standard</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 font-medium text-sm">{v.colour === "N/A" ? t("common.na") : v.colour}</td>
                          <td className="py-3.5 px-4">
                            {v.barcode ? (
                              <span className="font-mono font-semibold text-slate-900">{v.barcode}</span>
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
                                className="inline-block text-slate-900"
                              />
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-end">
                            {v.barcode && (
                              <button
                                onClick={() => copyBarcode(v.id, v.barcode!)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-slate-100 transition-colors"
                                title="Copier"
                              >
                                {copiedId === v.id ? (
                                  <Check size={14} className="text-emerald-600" />
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
          <div className="card rounded-2xl border border-slate-200 w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col bg-white overflow-hidden">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between font-bold text-slate-900 bg-slate-50/50 flex-shrink-0">
              <h2>Ajustement de stock multiple</h2>
              <button
                onClick={() => {
                  setAdjustOpen(false);
                  setAdjustError(null);
                  setAdjustForm({ reason: "adjustment", notes: "", deltas: {} });
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-5 overflow-y-auto min-h-0">
              {adjustError && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-xl flex-shrink-0">
                  <AlertTriangle size={14} />
                  {adjustError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 flex-shrink-0">
                {/* Reason */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Motif *</label>
                  <select
                    value={adjustForm.reason}
                    onChange={(e) =>
                      setAdjustForm((f) => ({
                        ...f,
                        reason: e.target.value as BulkAdjustForm["reason"],
                      }))
                    }
                    className="form-input bg-white border-slate-200 shadow-2xs rounded-xl focus:ring-primary-500/20"
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
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Notes</label>
                  <input
                    type="text"
                    value={adjustForm.notes}
                    onChange={(e) =>
                      setAdjustForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    className="form-input bg-white border-slate-200 shadow-2xs rounded-xl focus:ring-primary-500/20"
                    placeholder="Commentaire optionnel..."
                  />
                </div>
              </div>

              {/* Variants table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden flex-shrink-0">
                <table className="data-table text-sm w-full">
                  <thead className="bg-slate-50/90 sticky top-0 z-10 border-b border-slate-200/80">
                    <tr>
                      <th className="w-1/3 py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{isSimpleProduct ? "Article" : "Variante"}</th>
                      <th className="w-1/4 py-3 px-4 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock actuel</th>
                      <th className="w-5/12 py-3 px-4 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Ajustement (±)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
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
                          <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {variantLabel}
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-slate-600 tabular-nums">
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
                                    "form-input text-center font-mono font-bold w-20 py-1.5 rounded-lg border tabular-nums",
                                    deltaVal > 0 ? "text-emerald-700 bg-emerald-50 border-emerald-300" :
                                    deltaVal < 0 ? "text-red-700 bg-red-50 border-red-300" : "border-slate-200"
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
                                    <span className={newStock < 0 ? "text-red-600" : "text-slate-600"}>→ {newStock}</span>
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
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex-shrink-0">
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
    </div>
  );
}
