import React, { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Save, AlertCircle, FileSpreadsheet, Layers } from "lucide-react";
import api, { formatDZD, getApiError } from "@/lib/api";
import { useBranch } from "@/features/auth/BranchContext";
import type { Client, Quote, QuoteLine } from "@/types";
import { useBusinessMode } from "@/hooks/useBusinessMode";
import { cn } from "@/lib/utils";
import { unitPriceStringFor } from "@/lib/pricing";
import { ClientSelector } from "./components/ClientSelector";
import {
  InvoiceProductMatrix,
  type MatrixConfig,
  type ProductResult,
  createEmptyMatrix,
} from "./components/InvoiceProductMatrix";
import { AddCartonsModal } from "./components/AddCartonsModal";

type QuoteSubmissionLine = Pick<
  QuoteLine,
  "description" | "variant" | "quantity" | "unit_price" | "discount_pct" | "cartons"
>;

function formatDefaultDate(daysOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split("T")[0];
}

export default function QuoteFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const queryClient = useQueryClient();
  const { currentBranch } = useBranch();
  const { settings } = useBusinessMode();

  // Form states
  const [client, setClient] = useState<Client | null>(null);
  const [date, setDate] = useState<string>(formatDefaultDate(0));
  const [validUntil, setValidUntil] = useState<string>(formatDefaultDate(15));
  const [applyTva, setApplyTva] = useState<boolean>(true);
  const [tvaRate, setTvaRate] = useState<string>("19.00");
  const [notes, setNotes] = useState<string>("");
  const [matrices, setMatrices] = useState<MatrixConfig[]>([createEmptyMatrix()]);
  const [preservedLines, setPreservedLines] = useState<QuoteSubmissionLine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isCartonModalOpen, setIsCartonModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!isEditMode && settings?.tax_regime === "ifu") {
      setApplyTva(false);
    }
  }, [isEditMode, settings?.tax_regime]);

  // Fetch quote in edit mode
  const { data: quoteToEdit, isSuccess: isQuoteLoaded } = useQuery<Quote>({
    queryKey: ["quote", id],
    queryFn: () => api.get(`/invoicing/quotes/${id}/`).then((r) => r.data),
    enabled: isEditMode,
  });

  // Pre-fill form in edit mode
  useEffect(() => {
    if (isQuoteLoaded && quoteToEdit) {
      if (quoteToEdit.client) {
        api.get(`/clients/${quoteToEdit.client}/`).then((r) => setClient(r.data));
      }
      setDate(quoteToEdit.date);
      setValidUntil(quoteToEdit.valid_until);
      setApplyTva(quoteToEdit.apply_tva);
      setTvaRate(quoteToEdit.tva_rate || "19.00");
      setNotes(quoteToEdit.notes || "");

      const loadMatrices = async () => {
        const productMap = new Map<string | number, MatrixConfig>();
        const linesToPreserve: QuoteSubmissionLine[] = [];

        for (const line of quoteToEdit.lines) {
          if (!line.product_id || line.variant == null) {
            linesToPreserve.push({
              description: line.description,
              variant: line.variant,
              quantity: line.quantity,
              unit_price: line.unit_price,
              discount_pct: line.discount_pct,
              cartons: line.cartons,
            });
            continue;
          }

          let matrix = productMap.get(line.product_id);
          const product = matrix?.product ?? (
            await api.get<ProductResult>(`/inventory/products/${line.product_id}/`)
          ).data;
          const matchingVariant = product.variants.find(
            (variant) => String(variant.id) === String(line.variant)
          );

          if (!matchingVariant) {
            linesToPreserve.push({
              description: line.description,
              variant: line.variant,
              quantity: line.quantity,
              unit_price: line.unit_price,
              discount_pct: line.discount_pct,
              cartons: line.cartons,
            });
            continue;
          }

          if (!matrix) {
            matrix = {
              id: Math.random().toString(36).slice(2, 10),
              product,
              cartons: line.cartons,
              pairs_per_carton: 0,
              unit_price: line.unit_price,
              discount_pct: line.discount_pct,
              quantities: {},
            };
            productMap.set(line.product_id, matrix);
          }

          const colour = matchingVariant.colour || "Standard";
          const size = matchingVariant.size_eu;
          if (!matrix.quantities[colour]) {
            matrix.quantities[colour] = {};
          }
          matrix.quantities[colour][size] = parseFloat(line.quantity) || 0;
        }

        setPreservedLines(linesToPreserve);

        const m = Array.from(productMap.values()).map((matrix) => {
          let totalPairs = 0;
          for (const c in matrix.quantities) {
            for (const s in matrix.quantities[c]) {
              totalPairs += matrix.quantities[c][Number(s)];
            }
          }
          if (matrix.cartons && matrix.cartons > 0) {
            matrix.pairs_per_carton = Math.round(totalPairs / matrix.cartons);
          } else {
            matrix.pairs_per_carton = 10;
          }
          return matrix;
        });

        if (m.length > 0) {
          setMatrices(m);
        }
      };

      loadMatrices();
    }
  }, [isQuoteLoaded, quoteToEdit]);

  useEffect(() => {
    const handleCartonShortcut = () => setIsCartonModalOpen(true);
    window.addEventListener("app-shortcut-carton-modal", handleCartonShortcut);
    return () => window.removeEventListener("app-shortcut-carton-modal", handleCartonShortcut);
  }, []);

  // When client changes, update matrix prices if unset or newly matched
  function handleClientChange(c: Client | null) {
    setClient(c);
    if (!c) return;
    setMatrices((prev) =>
      prev.map((m) => {
        if (!m.product) return m;
        const newPrice = unitPriceStringFor(m.product, c.price_tier);
        return {
          ...m,
          unit_price: newPrice,
        };
      })
    );
  }

  // Flatten matrices to QuoteLines
  function getFlatLines() {
    const flatLines = [];
    for (const m of matrices) {
      if (!m.product) continue;
      for (const c in m.quantities) {
        for (const s in m.quantities[c]) {
          const qty = m.quantities[c][Number(s)];
          if (qty > 0) {
            const variant = m.product.variants.find(
              (v) =>
                ((v.colour || "Standard") === c || (v.colour || "N/A") === c) &&
                v.size_eu.toString() === s.toString()
            );
            if (variant) {
              const descSize = s !== "0" && Number(s) > 0 ? ` EU${s}` : "";
              const descCol = c && c !== "N/A" && c !== "Standard" ? ` ${c}` : "";
              flatLines.push({
                description: `${m.product.name}${descSize}${descCol}`.trim(),
                variant: variant.id,
                quantity: qty.toString(),
                unit_price: m.unit_price || "0",
                discount_pct: m.discount_pct || "0",
                cartons: m.cartons || 0,
              });
            }
          }
        }
      }
    }
    return [...flatLines, ...preservedLines];
  }

  // Totals calculations
  const subtotalHT = matrices.reduce((sum, m) => {
    if (!m.product) return sum;
    let pairs = 0;
    Object.values(m.quantities).forEach((sizes) => {
      Object.values(sizes).forEach((qty) => (pairs += qty));
    });
    const price = parseFloat(m.unit_price) || 0;
    const disc = parseFloat(m.discount_pct) || 0;
    return sum + pairs * price * (1 - disc / 100);
  }, 0);

  const tvaAmount = applyTva ? subtotalHT * ((parseFloat(tvaRate) || 19) / 100) : 0;
  const totalTTC = subtotalHT + tvaAmount;

  // Mutation
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: client?.id ?? null,
        branch_id: currentBranch?.id ?? null,
        date,
        valid_until: validUntil,
        apply_tva: applyTva,
        tva_rate: tvaRate,
        notes,
        lines: getFlatLines(),
      };

      if (isEditMode) {
        return api.put(`/invoicing/quotes/${id}/`, payload);
      }
      return api.post("/invoicing/quotes/", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      navigate("/quotes");
    },
    onError: (err) => {
      setFormError(getApiError(err));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const flatLines = getFlatLines();
    if (flatLines.length === 0) {
      setFormError(t("quote.error_no_lines", "Ajoutez au moins un produit avec une quantité valide."));
      return;
    }

    mutation.mutate();
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/quotes"
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <FileSpreadsheet className="text-primary-600 dark:text-primary-400" size={24} />
              {isEditMode
                ? t("quote.edit_title", "Modifier le Devis {{number}}", {
                    number: quoteToEdit?.number || "",
                  })
                : t("quote.new_title", "Nouveau Devis / Facture Proforma")}
            </h1>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
              {t("quote.form_subtitle", "Établissez une proposition commerciale sans incidence de stock ou de créance.")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/quotes"
            className="btn-secondary px-3.5 py-2 text-xs font-medium rounded-xl"
          >
            {t("app.cancel", "Annuler")}
          </Link>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary px-4 py-2 text-xs font-medium rounded-xl shadow-xs shadow-primary-500/20 inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={15} />
            {mutation.isPending
              ? t("app.saving", "Enregistrement...")
              : t("quote.save_quote", "Enregistrer le devis")}
          </button>
        </div>
      </div>

      {/* Error alert */}
      {formError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-xs font-medium text-rose-700 dark:text-rose-300 animate-in fade-in">
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{formError}</span>
          <button
            type="button"
            onClick={() => setFormError(null)}
            className="text-rose-500 hover:text-rose-800 dark:hover:text-rose-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Form Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Client, Metadata, Matrices */}
        <div className="lg:col-span-2 space-y-6">
          {/* Metadata Card */}
          <div className="card p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px]">
              {t("quote.general_info", "Informations Générales")}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {t("quote.client", "Client")}
                </label>
                <ClientSelector value={client} onChange={handleClientChange} />
                {client?.price_tier && (
                  <p className="text-[11px] text-primary-600 dark:text-primary-400 font-medium mt-1">
                    {t("quote.tier_applied", "Tarif client : {{tier}}", {
                      tier: client.price_tier === "gros"
                        ? t("pricing.wholesale", "Gros")
                        : client.price_tier === "demi_gros"
                        ? t("pricing.semi_wholesale", "Demi-Gros")
                        : t("pricing.retail", "Détail"),
                    })}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t("quote.date", "Date du devis")}
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="input w-full text-xs rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t("quote.valid_until", "Valable jusqu'au")}
                  </label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="input w-full text-xs rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3 mt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={applyTva}
                    onChange={(e) => setApplyTva(e.target.checked)}
                    className="w-4 h-4 rounded text-primary-600 border-slate-300 focus:ring-primary-500"
                  />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t("quote.apply_tva", "Appliquer la TVA")}
                  </span>
                </label>
                {applyTva && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={tvaRate}
                      onChange={(e) => setTvaRate(e.target.value)}
                      className="input w-20 py-1 text-xs rounded-lg border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white text-center font-mono"
                    />
                    <span className="text-xs font-mono text-slate-500">%</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("quote.notes", "Remarques / Modalités")}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("quote.notes_placeholder", "Ex: Validité 15 jours, livraison comprise...")}
                  className="input w-full text-xs rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Product Matrices */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px]">
                {t("quote.articles_cartons", "Articles & Grille de Tailles")}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCartonModalOpen(true)}
                  className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-xl inline-flex items-center gap-1.5 text-brand-600 dark:text-brand-400 border-brand-200 dark:border-brand-800 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                >
                  <Layers size={14} />
                  {t("carton.add_cartons_btn", "Ajouter cartons (Série)")}
                </button>
                <button
                  type="button"
                  onClick={() => setMatrices((prev) => [...prev, createEmptyMatrix()])}
                  className="btn-secondary px-3 py-1.5 text-xs font-medium rounded-xl inline-flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  {t("quote.add_product", "Ajouter un produit")}
                </button>
              </div>
            </div>

            {matrices.map((matrix) => (
              <InvoiceProductMatrix
                key={matrix.id}
                config={matrix}
                priceTier={client?.price_tier || "gros"}
                onChange={(updated) =>
                  setMatrices((prev) => prev.map((m) => (m.id === matrix.id ? updated : m)))
                }
                onRemove={() => setMatrices((prev) => prev.filter((m) => m.id !== matrix.id))}
              />
            ))}
          </div>
        </div>

        {/* Right Col: Summary Card */}
        <div className="space-y-6">
          <div className="card p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs sticky top-4 space-y-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px] pb-2 border-b border-slate-100 dark:border-slate-800">
              {t("quote.totals_summary", "Récapitulatif Financier")}
            </h2>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                <span>{t("quote.subtotal_ht", "Sous-total HT")}</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {formatDZD(subtotalHT)} DZD
                </span>
              </div>

              {applyTva && (
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                  <span>
                    {t("quote.tva_line", "TVA ({{rate}}%)", { rate: tvaRate })}
                  </span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {formatDZD(tvaAmount)} DZD
                  </span>
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-baseline">
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {t("quote.total_ttc", "Total TTC")}
                </span>
                <span className="text-xl font-bold font-mono text-primary-600 dark:text-primary-400">
                  {formatDZD(totalTTC)} DZD
                </span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="btn-primary w-full py-2.5 text-xs font-semibold rounded-xl shadow-xs shadow-primary-500/20 inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Save size={15} />
                {mutation.isPending
                  ? t("app.saving", "Enregistrement...")
                  : t("quote.save_quote", "Enregistrer le devis")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>

    <AddCartonsModal
      isOpen={isCartonModalOpen}
      onClose={() => setIsCartonModalOpen(false)}
      priceTier={client?.price_tier || "gros"}
      onAddCartons={(newMatrix) => {
        setMatrices((prev) => [...prev.filter((m) => m.product !== null), newMatrix]);
      }}
    />
  </>
  );
}
