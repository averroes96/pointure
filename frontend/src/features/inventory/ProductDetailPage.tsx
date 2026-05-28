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
  Printer,
  Copy,
  Check,
} from "lucide-react";
import api, { formatDZD, getApiError } from "@/lib/api";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import SkuMatrix from "./components/SkuMatrix";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { usePrintLabels } from "@/hooks/usePrintLabels";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BranchStockRow {
  branch_id: number;
  branch_name: string;
  variants: { variant_id: number; size_eu: number; colour: string; stock: number }[];
}

interface AdjustForm {
  variant_id: string;
  quantity_delta: string;
  reason: "adjustment" | "reception" | "damaged" | "return" | "initial";
  notes: string;
}

const ADJUST_REASONS: { value: AdjustForm["reason"]; label: string }[] = [
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
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold text-text-primary">{value}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role !== "cashier";
  const { printLabels } = usePrintLabels();

  // UI state
  const [branchOpen, setBranchOpen] = useState(false);
  const [barcodesOpen, setBarcodesOpen] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({
    variant_id: "",
    quantity_delta: "",
    reason: "adjustment",
    notes: "",
  });
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: product, isLoading, error } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn: () => api.get(`/inventory/products/${id}/`).then((r) => r.data),
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
    mutationFn: () =>
      api.post("/inventory/movements/adjust/", {
        variant: parseInt(adjustForm.variant_id),
        quantity_delta: parseInt(adjustForm.quantity_delta),
        reason: adjustForm.reason,
        notes: adjustForm.notes,
      }),
    onSuccess: () => {
      // Capture before clearing so auto-print can use them
      const variantId = adjustForm.variant_id;
      const delta = parseInt(adjustForm.quantity_delta);

      queryClient.invalidateQueries({ queryKey: ["product", id] });
      queryClient.invalidateQueries({ queryKey: ["product-branch-stock", id] });
      setAdjustOpen(false);
      setAdjustForm({ variant_id: "", quantity_delta: "", reason: "adjustment", notes: "" });
      setAdjustError(null);

      // Auto-print barcode labels when stock is added (positive delta only).
      // copies = number of units added so one sticker can be affixed to each item.
      if (delta > 0 && variantId) {
        printLabels(variantId, delta);
      }
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
    if (!adjustForm.variant_id || !adjustForm.quantity_delta) return;
    const delta = parseInt(adjustForm.quantity_delta);
    if (isNaN(delta) || delta === 0) {
      setAdjustError("La quantité ne peut pas être zéro.");
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

  return (
    <div className="space-y-5">
      {/* ── Breadcrumb / Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            to="/inventory/products"
            className="mt-1 text-text-muted hover:text-text-primary transition-colors"
            title="Retour aux produits"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-text-primary">{product.name}</h1>
              {product.brand && (
                <span className="text-sm text-text-muted font-medium">· {product.brand}</span>
              )}
              {product.reference && (
                <span className="badge badge-neutral font-mono text-xs">{product.reference}</span>
              )}
              <span
                className={cn(
                  "badge",
                  product.is_active ? "badge-success" : "badge-neutral"
                )}
              >
                {product.is_active ? (
                  <><CheckCircle size={10} className="inline me-1" />Actif</>
                ) : (
                  <><XCircle size={10} className="inline me-1" />Inactif</>
                )}
              </span>
            </div>
            <p className="text-sm text-text-muted mt-0.5">
              {CATEGORY_LABELS[product.category] ?? product.category} &middot;{" "}
              {GENDER_LABELS[product.gender] ?? product.gender} &middot;{" "}
              {SEASON_LABELS[product.season] ?? product.season}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
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

        {/* Image */}
        <div className="card p-4 flex items-center justify-center min-h-[200px]">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="max-h-48 max-w-full object-contain rounded-lg"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-text-muted opacity-40">
              <Package size={56} />
              <span className="text-xs">Pas d'image</span>
            </div>
          )}
        </div>

        {/* Classification + description */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">Informations</h3>
          <div className="grid grid-cols-3 gap-4">
            <InfoBadge label="Catégorie" value={CATEGORY_LABELS[product.category] ?? product.category} />
            <InfoBadge label="Genre" value={GENDER_LABELS[product.gender] ?? product.gender} />
            <InfoBadge label="Saison" value={SEASON_LABELS[product.season] ?? product.season} />
          </div>
          {product.description && (
            <p className="text-sm text-text-muted border-t border-border pt-3 leading-relaxed">
              {product.description}
            </p>
          )}
        </div>

        {/* Pricing + Stock KPIs */}
        <div className="flex flex-col gap-4">
          {/* Pricing */}
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Prix</h3>
            <div className="flex items-end justify-between">
              <span className="text-xs text-text-muted">Prix de vente</span>
              <span className="font-mono font-bold text-lg text-text-primary">
                {formatDZD(product.sale_price)} <span className="text-xs text-text-muted">DZD</span>
              </span>
            </div>
            {user?.can_see_costs && product.purchase_price && (
              <>
                <div className="flex items-end justify-between">
                  <span className="text-xs text-text-muted">Prix d'achat</span>
                  <span className="font-mono text-sm text-text-muted">
                    {formatDZD(product.purchase_price)} DZD
                  </span>
                </div>
                {product.margin_pct != null && (
                  <div className="flex items-end justify-between border-t border-border pt-2">
                    <span className="text-xs text-text-muted">Marge</span>
                    <span
                      className={cn(
                        "font-mono font-semibold text-sm",
                        parseFloat(product.margin_pct) >= 20
                          ? "text-success"
                          : parseFloat(product.margin_pct) >= 10
                          ? "text-warning"
                          : "text-danger"
                      )}
                    >
                      {parseFloat(product.margin_pct).toFixed(1)}%
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Stock KPI */}
          <div
            className={cn(
              "card p-5",
              outOfStock
                ? "border-danger/30 bg-danger-light"
                : product.has_low_stock
                ? "border-warning/30 bg-warning-light"
                : ""
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-text-muted font-medium uppercase tracking-wide mb-1">
                  Stock total
                </p>
                <p
                  className={cn(
                    "text-3xl font-mono font-bold",
                    outOfStock ? "text-danger" : product.has_low_stock ? "text-warning" : "text-success"
                  )}
                >
                  {product.total_stock}
                </p>
              </div>
              <div className="text-right">
                {outOfStock ? (
                  <div className="flex items-center gap-1 text-danger text-xs font-semibold">
                    <XCircle size={14} />
                    Rupture de stock
                  </div>
                ) : product.has_low_stock ? (
                  <div className="flex items-center gap-1 text-warning text-xs font-semibold">
                    <AlertTriangle size={14} />
                    Stock bas
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-success text-xs font-semibold">
                    <CheckCircle size={14} />
                    Disponible
                  </div>
                )}
                <p className="text-xs text-text-muted mt-1">
                  {activeVariants.length} variante(s) active(s)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SKU Matrix ──────────────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Tag size={16} className="text-primary-500" />
          <h2 className="text-sm font-semibold text-text-primary">Variantes (Taille × Couleur)</h2>
        </div>
        <SkuMatrix
          productId={product.id}
          variants={product.variants}
          onSave={() => queryClient.invalidateQueries({ queryKey: ["product", id] })}
          readOnly={!isManager}
        />
      </div>

      {/* ── Stock by Branch (collapsible) ────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setBranchOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-text-primary hover:bg-surface/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <BarChart3 size={15} className="text-primary-500" />
            Stock par succursale
          </div>
          {branchOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {branchOpen && (
          <div className="border-t border-border px-5 py-4">
            {branchLoading ? (
              <div className="flex items-center gap-2 text-text-muted text-sm py-4 justify-center">
                <Loader2 size={16} className="animate-spin" /> Chargement...
              </div>
            ) : !branchStock || branchStock.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-4">Aucune succursale configurée.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>Succursale</th>
                      {/* Collect unique sizes across all branches */}
                      {Array.from(
                        new Set(branchStock.flatMap((b) => b.variants.map((v) => `${v.size_eu}_${v.colour}`)))
                      )
                        .slice(0, 12)
                        .map((key) => {
                          const [size, colour] = key.split("_");
                          return (
                            <th key={key} className="text-center whitespace-nowrap">
                              EU{size}<br />
                              <span className="text-2xs font-normal text-text-muted">{colour}</span>
                            </th>
                          );
                        })}
                      <th className="text-end">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchStock.map((branch) => {
                      const variantKeys = Array.from(
                        new Set(branchStock.flatMap((b) => b.variants.map((v) => `${v.size_eu}_${v.colour}`)))
                      ).slice(0, 12);
                      const branchTotal = branch.variants.reduce((s, v) => s + v.stock, 0);
                      return (
                        <tr key={branch.branch_id}>
                          <td className="font-medium">{branch.branch_name}</td>
                          {variantKeys.map((key) => {
                            const [sizeStr, colour] = key.split("_");
                            const v = branch.variants.find(
                              (bv) => bv.size_eu === parseInt(sizeStr) && bv.colour === colour
                            );
                            return (
                              <td key={key} className="text-center font-mono">
                                <span
                                  className={cn(
                                    "font-medium",
                                    v?.stock === 0 ? "text-danger" : v?.stock && v.stock > 0 ? "text-success" : "text-text-muted"
                                  )}
                                >
                                  {v?.stock ?? "—"}
                                </span>
                              </td>
                            );
                          })}
                          <td className="text-end font-mono font-bold">{branchTotal}</td>
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

      {/* ── Codes-barres (collapsible) ──────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setBarcodesOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-text-primary hover:bg-surface/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Barcode size={15} className="text-primary-500" />
            Codes-barres des variantes
            <span className="text-xs font-normal text-text-muted">
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
          <div className="border-t border-border px-5 py-4">
            <div className="overflow-x-auto">
              <table className="data-table text-sm">
                <thead>
                  <tr>
                    <th>Pointure</th>
                    <th>Couleur</th>
                    <th>Code-barres</th>
                    <th className="text-center">Aperçu</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants
                    .filter((v) => v.is_active)
                    .sort((a, b) => a.size_eu - b.size_eu || a.colour.localeCompare(b.colour))
                    .map((v) => (
                      <tr key={v.id}>
                        <td className="font-mono font-semibold">EU {v.size_eu}</td>
                        <td>{v.colour}</td>
                        <td>
                          {v.barcode ? (
                            <span className="font-mono text-text-primary">{v.barcode}</span>
                          ) : (
                            <span className="text-text-muted text-xs">Non généré</span>
                          )}
                        </td>
                        <td className="text-center py-2">
                          {v.barcode && (
                            <BarcodeSvg
                              value={v.barcode}
                              height={36}
                              showText={false}
                              className="inline-block text-text-primary"
                            />
                          )}
                        </td>
                        <td>
                          {v.barcode && (
                            <button
                              onClick={() => copyBarcode(v.id, v.barcode!)}
                              className="btn-ghost btn-sm text-text-muted hover:text-primary-500"
                              title="Copier"
                            >
                              {copiedId === v.id ? (
                                <Check size={14} className="text-success" />
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

      {/* ── Stock Adjustment Modal ────────────────────────────────────────────── */}
      {adjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="card w-full max-w-md shadow-2xl">
            {/* Modal header */}
            <div className="card-header">
              <h2 className="font-semibold text-text-primary">Ajustement de stock</h2>
              <button
                onClick={() => {
                  setAdjustOpen(false);
                  setAdjustError(null);
                }}
                className="text-text-muted hover:text-text-primary"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="card-body space-y-4">
              {adjustError && (
                <div className="flex items-center gap-2 text-xs text-danger bg-danger-light px-3 py-2 rounded-lg">
                  <AlertTriangle size={13} />
                  {adjustError}
                </div>
              )}

              {/* Variant select */}
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Variante *
                </label>
                <select
                  value={adjustForm.variant_id}
                  onChange={(e) =>
                    setAdjustForm((f) => ({ ...f, variant_id: e.target.value }))
                  }
                  className="form-input"
                >
                  <option value="">— Choisir une variante —</option>
                  {product.variants
                    .filter((v) => v.is_active)
                    .sort((a, b) => a.size_eu - b.size_eu || a.colour.localeCompare(b.colour))
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        EU{v.size_eu} · {v.colour} — stock: {v.stock_qty}
                      </option>
                    ))}
                </select>
              </div>

              {/* Quantity delta */}
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Quantité (positif = entrée, négatif = sortie) *
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setAdjustForm((f) => ({
                        ...f,
                        quantity_delta: String((parseInt(f.quantity_delta) || 0) - 1),
                      }))
                    }
                    className="btn-secondary btn-sm w-9 h-9 flex-shrink-0"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    value={adjustForm.quantity_delta}
                    onChange={(e) =>
                      setAdjustForm((f) => ({ ...f, quantity_delta: e.target.value }))
                    }
                    className="form-input text-center font-mono"
                    placeholder="0"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAdjustForm((f) => ({
                        ...f,
                        quantity_delta: String((parseInt(f.quantity_delta) || 0) + 1),
                      }))
                    }
                    className="btn-secondary btn-sm w-9 h-9 flex-shrink-0"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {adjustForm.quantity_delta !== "" && parseInt(adjustForm.quantity_delta) !== 0 && (
                  <p className="text-xs mt-1">
                    {parseInt(adjustForm.quantity_delta) > 0 ? (
                      <span className="text-success">
                        +{adjustForm.quantity_delta} unités ajoutées au stock
                      </span>
                    ) : (
                      <span className="text-danger">
                        {adjustForm.quantity_delta} unités retirées du stock
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Motif *</label>
                <select
                  value={adjustForm.reason}
                  onChange={(e) =>
                    setAdjustForm((f) => ({
                      ...f,
                      reason: e.target.value as AdjustForm["reason"],
                    }))
                  }
                  className="form-input"
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
                <label className="block text-xs font-medium text-text-muted mb-1">Notes</label>
                <textarea
                  value={adjustForm.notes}
                  onChange={(e) =>
                    setAdjustForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  className="form-input resize-none"
                  rows={2}
                  placeholder="Commentaire optionnel..."
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-surface/40 rounded-b-lg">
              <button
                onClick={() => {
                  setAdjustOpen(false);
                  setAdjustError(null);
                }}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button
                onClick={submitAdjust}
                disabled={
                  adjustMutation.isPending ||
                  !adjustForm.variant_id ||
                  !adjustForm.quantity_delta ||
                  parseInt(adjustForm.quantity_delta) === 0
                }
                className="btn-primary"
              >
                {adjustMutation.isPending ? (
                  <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
                ) : (
                  "Confirmer l'ajustement"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
