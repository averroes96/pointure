import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Sliders,
  Eye,
  Check,
  X,
  Sparkles,
  Loader2,
  Package,
  Layers,
  Grid3X3,
  ListOrdered,
  FileCheck,
} from "lucide-react";
import api, { formatDZD, getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Supplier,
  PurchaseOrder,
  ImportSizeMode,
  POImportPreviewResponse,
  POImportLineItem,
} from "@/types";

interface PurchaseOrderImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedSupplierId?: string | number | null;
  onSuccess?: (createdPO: PurchaseOrder) => void;
}

type WizardStep = "upload" | "mapping" | "preview";

const CANONICAL_FIELDS = [
  { key: "reference", labelKey: "po_import.field_reference", defaultLabel: "Référence / SKU", required: true },
  { key: "description", labelKey: "po_import.field_description", defaultLabel: "Désignation / Nom", required: false },
  { key: "size", labelKey: "po_import.field_size", defaultLabel: "Pointure / Taille", required: false },
  { key: "quantity", labelKey: "po_import.field_quantity", defaultLabel: "Quantité (Paires)", required: false },
  { key: "cartons", labelKey: "po_import.field_cartons", defaultLabel: "Nombre de cartons", required: false },
  { key: "unit_price", labelKey: "po_import.field_unit_price", defaultLabel: "Prix d'achat unitaire", required: false },
  { key: "colour", labelKey: "po_import.field_colour", defaultLabel: "Couleur", required: false },
  { key: "brand", labelKey: "po_import.field_brand", defaultLabel: "Marque", required: false },
  { key: "location", labelKey: "po_import.field_location", defaultLabel: "Emplacement / Rayon", required: false },
];

export function PurchaseOrderImportModal({
  isOpen,
  onClose,
  preselectedSupplierId,
  onSuccess,
}: PurchaseOrderImportModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [supplierId, setSupplierId] = useState<string>(
    preselectedSupplierId ? String(preselectedSupplierId) : ""
  );
  const [suppliersList, setSuppliersList] = useState<Supplier[]>([]);

  // Preview data from server
  const [previewData, setPreviewData] = useState<POImportPreviewResponse | null>(null);

  // Mapping configuration state
  const [headerRow, setHeaderRow] = useState<number>(1);
  const [sizeMode, setSizeMode] = useState<ImportSizeMode>("single");
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [defaultColour, setDefaultColour] = useState<string>("");
  const [defaultPairsPerCarton, setDefaultPairsPerCarton] = useState<string>("10");

  // Options for confirmation
  const [poReference, setPoReference] = useState<string>("");
  const [poNotes, setPoNotes] = useState<string>("");
  const [quickCreateProducts, setQuickCreateProducts] = useState<boolean>(true);
  const [saveAsTemplate, setSaveAsTemplate] = useState<boolean>(false);
  const [templateName, setTemplateName] = useState<string>("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load suppliers if not preselected
  useEffect(() => {
    if (isOpen) {
      api.get("/suppliers/?page_size=100").then((res) => {
        setSuppliersList(res.data.results ?? []);
      }).catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (preselectedSupplierId) {
      setSupplierId(String(preselectedSupplierId));
    }
  }, [preselectedSupplierId]);

  // ── Step 1: Upload & Preview Mutation ───────────────────────────────────────
  const previewMutation = useMutation({
    mutationFn: async (opts?: {
      overrideHeaderRow?: number;
      overrideSizeMode?: ImportSizeMode;
      overrideColumnMap?: Record<string, string>;
      overrideColour?: string;
      overridePpc?: number;
    } | void) => {
      setErrorMsg(null);
      const formData = new FormData();
      if (selectedFile) {
        formData.append("file", selectedFile);
      }
      if (supplierId) {
        formData.append("supplier_id", supplierId);
      }

      if (opts?.overrideHeaderRow !== undefined) {
        formData.append("header_row", String(opts.overrideHeaderRow));
      } else if (headerRow) {
        formData.append("header_row", String(headerRow));
      }

      if (opts?.overrideSizeMode) {
        formData.append("size_mode", opts.overrideSizeMode);
      } else if (sizeMode) {
        formData.append("size_mode", sizeMode);
      }

      const activeColMap = opts?.overrideColumnMap || columnMap;
      if (Object.keys(activeColMap).length > 0) {
        // Send as individual fields or raw JSON
        formData.append("column_map", JSON.stringify(activeColMap));
      }

      const clr = opts?.overrideColour !== undefined ? opts.overrideColour : defaultColour;
      if (clr) formData.append("default_colour", clr);

      const ppc = opts?.overridePpc !== undefined ? opts.overridePpc : parseInt(defaultPairsPerCarton);
      if (ppc && ppc > 0) formData.append("default_pairs_per_carton", String(ppc));

      const res = await api.post("/suppliers/purchase-orders/import-preview/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return res.data as POImportPreviewResponse;
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setHeaderRow(data.header_row);
      setSizeMode(data.size_mode);
      setColumnMap(data.column_map || {});
      setDefaultColour(data.default_colour || "");
      if (data.default_pairs_per_carton) {
        setDefaultPairsPerCarton(String(data.default_pairs_per_carton));
      }
      if (!poReference && selectedFile) {
        const baseName = selectedFile.name.replace(/\.[^/.]+$/, "");
        setPoReference(`BC-${baseName}`);
      }
      setStep("mapping");
    },
    onError: (err) => {
      setErrorMsg(getApiError(err));
    },
  });

  // Re-run preview with updated mapping
  const refreshPreviewMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);
      const formData = new FormData();
      if (selectedFile) formData.append("file", selectedFile);
      if (supplierId) formData.append("supplier_id", supplierId);
      formData.append("header_row", String(headerRow));
      formData.append("size_mode", sizeMode);
      formData.append("column_map", JSON.stringify(columnMap));
      if (defaultColour) formData.append("default_colour", defaultColour);
      if (defaultPairsPerCarton) formData.append("default_pairs_per_carton", defaultPairsPerCarton);

      const res = await api.post("/suppliers/purchase-orders/import-preview/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return res.data as POImportPreviewResponse;
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setStep("preview");
    },
    onError: (err) => {
      setErrorMsg(getApiError(err));
    },
  });

  // ── Step 3: Confirm Import Mutation ─────────────────────────────────────────
  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) {
        throw new Error(t("po_import.error_missing_supplier", "Veuillez sélectionner un fournisseur."));
      }
      if (!previewData?.preview_lines?.length) {
        throw new Error(t("po_import.error_no_lines", "Aucune ligne à importer."));
      }

      const payload = {
        supplier_id: supplierId,
        reference: poReference,
        notes: poNotes,
        lines: previewData.preview_lines,
        quick_create_products: quickCreateProducts,
        save_as_template: saveAsTemplate,
        template_name: templateName,
        template_data: {
          header_row: headerRow,
          column_map: columnMap,
          size_mode: sizeMode,
          default_colour: defaultColour,
          default_pairs_per_carton: parseInt(defaultPairsPerCarton) || 10,
        },
      };

      const res = await api.post("/suppliers/purchase-orders/import-confirm/", payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-import-templates"] });
      onClose();
      if (onSuccess && data.purchase_order) {
        onSuccess(data.purchase_order);
      }
    },
    onError: (err) => {
      setErrorMsg(getApiError(err));
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const filename = file.name.toLowerCase();
      if (!filename.endsWith(".xlsx") && !filename.endsWith(".csv")) {
        setSelectedFile(null);
        setErrorMsg(t("po_import.error_unsupported_file", "Veuillez choisir un fichier .xlsx ou .csv."));
        e.target.value = "";
        return;
      }
      setSelectedFile(file);
      setErrorMsg(null);
    }
  };

  const handleApplySavedTemplate = (templateId: string) => {
    const tmpl = previewData?.templates?.find((t) => t.id === templateId);
    if (!tmpl) return;
    setHeaderRow(tmpl.header_row);
    setSizeMode(tmpl.size_mode);
    setColumnMap(tmpl.column_map || {});
    setDefaultColour(tmpl.default_colour || "");
    if (tmpl.default_pairs_per_carton) {
      setDefaultPairsPerCarton(String(tmpl.default_pairs_per_carton));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-500">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">
                {t("po_import.modal_title", "Import intelligent de bon de commande")}
              </h2>
              <p className="text-xs text-text-muted">
                {t("po_import.modal_subtitle", "Fichiers Excel (.xlsx) ou CSV multilingues (Français, Arabe, Anglais)")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stepper Navigation */}
        <div className="px-6 py-3 border-b border-border bg-surface/30 flex items-center justify-between text-xs font-medium">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                step === "upload"
                  ? "bg-primary-500 text-white"
                  : "bg-surface text-text-muted border border-border"
              )}
            >
              1
            </span>
            <span className={step === "upload" ? "text-primary-600 dark:text-primary-400 font-bold" : "text-text-muted"}>
              {t("po_import.step_upload", "Fichier & Fournisseur")}
            </span>
          </div>

          <div className="w-8 h-px bg-border" />

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                step === "mapping"
                  ? "bg-primary-500 text-white"
                  : "bg-surface text-text-muted border border-border"
              )}
            >
              2
            </span>
            <span className={step === "mapping" ? "text-primary-600 dark:text-primary-400 font-bold" : "text-text-muted"}>
              {t("po_import.step_mapping", "Colonnes & Pointures")}
            </span>
          </div>

          <div className="w-8 h-px bg-border" />

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                step === "preview"
                  ? "bg-primary-500 text-white"
                  : "bg-surface text-text-muted border border-border"
              )}
            >
              3
            </span>
            <span className={step === "preview" ? "text-primary-600 dark:text-primary-400 font-bold" : "text-text-muted"}>
              {t("po_import.step_preview", "Rapprochement & Validation")}
            </span>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-800 text-danger-700 dark:text-danger-300 text-xs flex items-center gap-2">
            <AlertTriangle size={15} className="flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: UPLOAD */}
          {step === "upload" && (
            <div className="space-y-6">
              {/* Supplier Selection */}
              <div>
                <label className="form-label font-medium mb-1.5 block">
                  {t("po_import.supplier_label", "Fournisseur concerné")} <span className="text-danger-500">*</span>
                </label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="form-select w-full"
                >
                  <option value="">{t("po_import.select_supplier", "— Sélectionner un fournisseur —")}</option>
                  {suppliersList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.origin_country ? `(${s.origin_country})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* File Dropzone */}
              <div>
                <label className="form-label font-medium mb-1.5 block">
                  {t("po_import.file_label", "Fichier bon de commande (Excel ou CSV)")}
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-3",
                    selectedFile
                      ? "border-primary-500 bg-primary-50/20 dark:bg-primary-950/20"
                      : "border-border hover:border-primary-400 bg-surface/30"
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv, .xlsx"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="p-3 rounded-full bg-surface border border-border text-primary-500">
                    <Upload size={28} />
                  </div>
                  {selectedFile ? (
                    <div>
                      <p className="font-semibold text-text-primary text-sm">{selectedFile.name}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {(selectedFile.size / 1024).toFixed(1)} KB · {t("po_import.click_to_change", "Cliquer pour changer de fichier")}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium text-text-primary text-sm">
                        {t("po_import.drag_and_drop", "Glissez-déposez un fichier ici ou cliquez pour parcourir")}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {t(
                          "po_import.supported_formats",
                          "Formats pris en charge : .xlsx et .csv (UTF-8, Windows arabe CP1256, français CP1252)"
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Supported Languages & Footwear Tips */}
              <div className="p-4 rounded-lg bg-surface/50 border border-border space-y-2 text-xs text-text-muted">
                <div className="flex items-center gap-2 font-medium text-text-primary">
                  <Sparkles size={14} className="text-primary-500" />
                  <span>{t("po_import.smart_features_title", "Reconnaissance intelligente ShoeDZ")}</span>
                </div>
                <p>
                  • <strong>Multilingue :</strong> Détection automatique des en-têtes en Français, Arabe (المرجع، المقاس، الكمية...) et Anglais.
                </p>
                <p>
                  • <strong>Modes de pointures :</strong> Supporte pointure unitaire par ligne, plages de pointures (ex: 37-41) réparties selon le colisage, ou grilles matricielles (colonnes 36 à 46).
                </p>
                <p>
                  • <strong>Nettoyage automatique :</strong> Prise en charge des prix avec virgules françaises (ex: 1 250,50 DA) et devises (DZD, DA, €).
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: MAPPING & SETTINGS */}
          {step === "mapping" && previewData && (
            <div className="space-y-6">
              {/* File stats info banner */}
              <div className="p-3 rounded-lg bg-surface/60 border border-border flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono bg-card px-2 py-0.5 rounded border border-border text-text-primary">
                    {previewData.detected_encoding}
                  </span>
                  <span className="text-text-muted">
                    Séparateur : <strong className="text-text-primary font-mono">{previewData.detected_delimiter}</strong>
                  </span>
                  <span className="text-text-muted">
                    Lignes détectées : <strong className="text-text-primary">{previewData.total_raw_rows}</strong>
                  </span>
                </div>

                {/* Saved template dropdown */}
                {previewData.templates && previewData.templates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">{t("po_import.use_template", "Modèle sauvegardé :")}</span>
                    <select
                      onChange={(e) => handleApplySavedTemplate(e.target.value)}
                      defaultValue={previewData.applied_template_id || ""}
                      className="form-select text-xs py-1"
                    >
                      <option value="">{t("po_import.custom_mapping", "Configuration personnalisée")}</option>
                      {previewData.templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name} ({tpl.size_mode})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Mode Selection Tabs */}
              <div>
                <label className="form-label font-medium mb-1.5 block">
                  {t("po_import.size_mode_label", "Mode de gestion des pointures")}
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setSizeMode("single")}
                    className={cn(
                      "p-3 rounded-lg border text-start transition-all flex items-start gap-3",
                      sizeMode === "single"
                        ? "border-primary-500 bg-primary-50/30 dark:bg-primary-950/30 ring-1 ring-primary-500"
                        : "border-border hover:bg-surface"
                    )}
                  >
                    <ListOrdered size={18} className={sizeMode === "single" ? "text-primary-500" : "text-text-muted"} />
                    <div>
                      <div className="font-semibold text-xs text-text-primary">
                        {t("po_import.mode_single", "1 Pointure par ligne")}
                      </div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        Chaque ligne contient une référence et une pointure unique.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSizeMode("range")}
                    className={cn(
                      "p-3 rounded-lg border text-start transition-all flex items-start gap-3",
                      sizeMode === "range"
                        ? "border-primary-500 bg-primary-50/30 dark:bg-primary-950/30 ring-1 ring-primary-500"
                        : "border-border hover:bg-surface"
                    )}
                  >
                    <Layers size={18} className={sizeMode === "range" ? "text-primary-500" : "text-text-muted"} />
                    <div>
                      <div className="font-semibold text-xs text-text-primary">
                        {t("po_import.mode_range", "Plage de pointures (ex: 37-41)")}
                      </div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        Ligne avec colis ou paires réparties selon le découpage du carton.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSizeMode("matrix")}
                    className={cn(
                      "p-3 rounded-lg border text-start transition-all flex items-start gap-3",
                      sizeMode === "matrix"
                        ? "border-primary-500 bg-primary-50/30 dark:bg-primary-950/30 ring-1 ring-primary-500"
                        : "border-border hover:bg-surface"
                    )}
                  >
                    <Grid3X3 size={18} className={sizeMode === "matrix" ? "text-primary-500" : "text-text-muted"} />
                    <div>
                      <div className="font-semibold text-xs text-text-primary">
                        {t("po_import.mode_matrix", "Grille matricielle (36..46)")}
                      </div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        Les pointures sont présentées sous forme de colonnes dans le tableau.
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Header row & defaults */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="form-label text-xs font-medium mb-1 block">
                    {t("po_import.header_row", "Ligne des en-têtes (1-indexé)")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={headerRow}
                    onChange={(e) => setHeaderRow(Math.max(1, parseInt(e.target.value) || 1))}
                    className="form-input text-xs w-full font-mono"
                  />
                </div>

                <div>
                  <label className="form-label text-xs font-medium mb-1 block">
                    {t("po_import.default_colour", "Couleur par défaut")}
                  </label>
                  <input
                    type="text"
                    value={defaultColour}
                    onChange={(e) => setDefaultColour(e.target.value)}
                    placeholder="Standard"
                    className="form-input text-xs w-full"
                  />
                </div>

                <div>
                  <label className="form-label text-xs font-medium mb-1 block">
                    {t("po_import.default_ppc", "Paires par carton par défaut")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={defaultPairsPerCarton}
                    onChange={(e) => setDefaultPairsPerCarton(e.target.value)}
                    className="form-input text-xs w-full font-mono"
                  />
                </div>
              </div>

              {/* Column Mapping Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label font-medium block text-xs">
                    {t("po_import.mapping_table_title", "Correspondance des colonnes du fichier")}
                  </label>
                  <span className="text-[11px] text-text-muted">
                    {Object.values(columnMap).filter(Boolean).length} {t("po_import.mapped_count", "colonnes associées")}
                  </span>
                </div>

                <div className="border border-border rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                  <table className="data-table text-xs">
                    <thead className="bg-surface sticky top-0">
                      <tr>
                        <th>{t("po_import.column_in_file", "Colonne dans le fichier")}</th>
                        <th>{t("po_import.detected_sample", "Exemple de valeur")}</th>
                        <th>{t("po_import.assigned_field", "Champ ShoeDZ")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.headers.map((hdr, idx) => {
                        const sampleVal = previewData.raw_rows?.[0]?.[idx] ?? "—";
                        const isMatrixCol = Boolean(previewData.size_matrix_columns?.[hdr]);
                        return (
                          <tr key={hdr}>
                            <td className="font-medium text-text-primary">
                              {hdr}
                              {isMatrixCol && (
                                <span className="ms-2 px-1.5 py-0.5 rounded text-[10px] bg-primary-100 dark:bg-primary-950 text-primary-600 font-mono">
                                  Pointure {previewData.size_matrix_columns[hdr]}
                                </span>
                              )}
                            </td>
                            <td className="text-text-muted font-mono truncate max-w-xs">{String(sampleVal)}</td>
                            <td>
                              <select
                                value={columnMap[hdr] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setColumnMap((prev) => ({
                                    ...prev,
                                    [hdr]: val,
                                  }));
                                }}
                                className="form-select text-xs py-1"
                              >
                                <option value="">{t("po_import.field_ignore", "— Ignorer cette colonne —")}</option>
                                {CANONICAL_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {t(f.labelKey, f.defaultLabel)} {f.required ? "*" : ""}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & RECONCILIATION */}
          {step === "preview" && previewData && (
            <div className="space-y-6">
              {/* Summary Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="card p-3 bg-surface/60 border border-border">
                  <div className="text-[11px] text-text-muted uppercase tracking-wider">{t("po_import.stat_lines", "Lignes")}</div>
                  <div className="text-xl font-bold text-text-primary mt-1">{previewData.summary.total_lines}</div>
                </div>

                <div className="card p-3 bg-surface/60 border border-border">
                  <div className="text-[11px] text-text-muted uppercase tracking-wider">{t("po_import.stat_pairs", "Total Paires")}</div>
                  <div className="text-xl font-bold text-primary-500 mt-1">{previewData.summary.total_pairs}</div>
                </div>

                <div className="card p-3 bg-surface/60 border border-border">
                  <div className="text-[11px] text-text-muted uppercase tracking-wider">{t("po_import.stat_cartons", "Total Colis")}</div>
                  <div className="text-xl font-bold text-text-primary mt-1">{previewData.summary.total_cartons}</div>
                </div>

                <div className="card p-3 bg-surface/60 border border-border">
                  <div className="text-[11px] text-text-muted uppercase tracking-wider">{t("po_import.stat_amount", "Montant estimé")}</div>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                    {formatDZD(previewData.summary.total_estimated_amount)} DZD
                  </div>
                </div>
              </div>

              {/* Status Breakdown Pills */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  {previewData.summary.matched_count} {t("po_import.status_matched", "articles existants en catalogue")}
                </span>

                {previewData.summary.missing_variants_count > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    {previewData.summary.missing_variants_count} {t("po_import.status_missing_variant", "nouvelles variantes à ajouter")}
                  </span>
                )}

                {previewData.summary.new_products_count > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center gap-1.5">
                    <Sparkles size={13} />
                    {previewData.summary.new_products_count} {t("po_import.status_new_products", "nouveaux modèles à créer")}
                  </span>
                )}
              </div>

              {/* Lines Preview Table */}
              <div className="border border-border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                <table className="data-table text-xs">
                  <thead className="bg-surface sticky top-0">
                    <tr>
                      <th>{t("po_import.table_ref", "Réf")}</th>
                      <th>{t("po_import.table_desc", "Désignation")}</th>
                      <th className="text-center">{t("po_import.table_size", "Pointure")}</th>
                      <th>{t("po_import.table_colour", "Couleur")}</th>
                      <th className="text-end">{t("po_import.table_qty", "Qté")}</th>
                      <th className="text-end">{t("po_import.table_cartons", "Colis")}</th>
                      <th className="text-end">{t("po_import.table_unit_price", "P.U (DZD)")}</th>
                      <th className="text-end">{t("po_import.table_total", "Total (DZD)")}</th>
                      <th>{t("po_import.table_status", "Statut")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.preview_lines.map((line, idx) => {
                      const totalLine = (line.quantity * parseFloat(line.unit_price || "0")).toFixed(2);
                      return (
                        <tr key={idx}>
                          <td className="font-mono font-medium">{line.reference || "—"}</td>
                          <td className="truncate max-w-xs">{line.description}</td>
                          <td className="text-center font-mono font-medium">
                            {line.size_eu > 0 ? line.size_eu : "—"}
                          </td>
                          <td>{line.colour}</td>
                          <td className="text-end font-mono font-bold">{line.quantity}</td>
                          <td className="text-end font-mono text-text-muted">{line.cartons || "—"}</td>
                          <td className="text-end font-mono">{formatDZD(line.unit_price)}</td>
                          <td className="text-end font-mono font-semibold">{formatDZD(totalLine)}</td>
                          <td>
                            {line.match_status === "matched" && (
                              <span className="badge badge-success text-[10px]">Existant</span>
                            )}
                            {line.match_status === "missing_variant" && (
                              <span className="badge badge-warning text-[10px]">Variante manquante</span>
                            )}
                            {line.match_status === "new_product" && (
                              <span className="badge badge-info text-[10px]">Nouveau produit</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Order Info & Creation Options */}
              <div className="card p-4 border border-border space-y-4 bg-surface/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label text-xs font-medium mb-1 block">
                      {t("po_import.po_reference", "Référence du bon de commande")}
                    </label>
                    <input
                      type="text"
                      value={poReference}
                      onChange={(e) => setPoReference(e.target.value)}
                      placeholder="BC-2026-001"
                      className="form-input text-xs w-full font-mono"
                    />
                  </div>

                  <div>
                    <label className="form-label text-xs font-medium mb-1 block">
                      {t("po_import.po_notes", "Notes / Instructions de livraison")}
                    </label>
                    <input
                      type="text"
                      value={poNotes}
                      onChange={(e) => setPoNotes(e.target.value)}
                      placeholder="Importé automatiquement"
                      className="form-input text-xs w-full"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-border">
                  <label className="flex items-center gap-2 text-xs font-medium text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={quickCreateProducts}
                      onChange={(e) => setQuickCreateProducts(e.target.checked)}
                      className="rounded border-border text-primary-600 focus:ring-primary-500"
                    />
                    <span>{t("po_import.quick_create_label", "Créer automatiquement les fiches produits et variantes manquantes en catalogue")}</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-medium text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveAsTemplate}
                      onChange={(e) => setSaveAsTemplate(e.target.checked)}
                      className="rounded border-border text-primary-600 focus:ring-primary-500"
                    />
                    <span>{t("po_import.save_template_label", "Enregistrer cette configuration comme modèle d'import pour ce fournisseur")}</span>
                  </label>

                  {saveAsTemplate && (
                    <div className="ps-6 pt-1">
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder={t("po_import.template_name_placeholder", "Nom du modèle (ex : Grille standard El Eulma)")}
                        className="form-input text-xs w-full max-w-sm"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-surface/50">
          <div>
            {step !== "upload" && (
              <button
                type="button"
                onClick={() => setStep(step === "preview" ? "mapping" : "upload")}
                className="btn-secondary btn-sm flex items-center gap-1.5"
              >
                <ArrowLeft size={14} />
                {t("common.back", "Retour")}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">
              {t("common.cancel", "Annuler")}
            </button>

            {step === "upload" && (
              <button
                type="button"
                disabled={!selectedFile || !supplierId || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
                className="btn-primary btn-sm flex items-center gap-1.5"
              >
                {previewMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t("common.processing", "Analyse en cours...")}
                  </>
                ) : (
                  <>
                    {t("po_import.btn_continue_mapping", "Analyser et configurer")}
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            )}

            {step === "mapping" && (
              <button
                type="button"
                disabled={refreshPreviewMutation.isPending}
                onClick={() => refreshPreviewMutation.mutate()}
                className="btn-primary btn-sm flex items-center gap-1.5"
              >
                {refreshPreviewMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t("common.processing", "Calcul de l'aperçu...")}
                  </>
                ) : (
                  <>
                    {t("po_import.btn_preview_lines", "Valider les colonnes et voir l'aperçu")}
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            )}

            {step === "preview" && (
              <button
                type="button"
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
                className="btn-primary btn-sm flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {confirmMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t("po_import.btn_creating_po", "Création de la commande...")}
                  </>
                ) : (
                  <>
                    <FileCheck size={14} />
                    {t("po_import.btn_confirm_import", "Créer le bon de commande")}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
