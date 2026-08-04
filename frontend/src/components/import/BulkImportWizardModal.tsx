import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Download,
  RefreshCw,
  Sliders,
  Eye,
  Check,
  X,
  Building2,
  Sparkles,
  ShieldCheck,
  FileUp,
  Loader2,
  Users,
  Truck,
  Package,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ImportEntityType = "products" | "clients" | "suppliers";
export type DuplicateStrategy = "update" | "skip" | "create_new";

interface SystemFieldDef {
  key: string;
  label: string;
  required: boolean;
  type: string;
  description?: string;
}

const SYSTEM_FIELDS: Record<ImportEntityType, SystemFieldDef[]> = {
  products: [
    { key: "name", label: "Nom du produit", required: true, type: "text", description: "Nom ou modèle (ex: Air Max 90)" },
    { key: "size_eu", label: "Pointure (EU)", required: true, type: "number", description: "Taille / Pointure (ex: 42, 38.5)" },
    { key: "sale_price", label: "Prix de vente", required: true, type: "currency", description: "Prix TTC en DZD" },
    { key: "purchase_price", label: "Prix d'achat", required: false, type: "currency", description: "Prix d'achat unitaire en DZD" },
    { key: "wholesale_price", label: "Prix de gros", required: false, type: "currency", description: "Tarif de gros en DZD" },
    { key: "brand", label: "Marque", required: false, type: "text", description: "Marque (ex: Nike, Adidas, Puma)" },
    { key: "sku", label: "Référence / SKU", required: false, type: "text", description: "Code référence produit" },
    { key: "category", label: "Catégorie", required: false, type: "text", description: "sneakers, boots, sandals, formal, etc." },
    { key: "gender", label: "Genre", required: false, type: "text", description: "M (Homme), F (Femme), K (Enfant), U (Mixte)" },
    { key: "color", label: "Couleur", required: false, type: "text", description: "Noir, Blanc, Bleu, Marron, etc." },
    { key: "initial_stock", label: "Stock initial", required: false, type: "integer", description: "Quantité en stock à l'ouverture" },
    { key: "barcode", label: "Code-barres (EAN/UPC)", required: false, type: "text", description: "Code-barres variante ou modèle" },
    { key: "pairs_per_carton", label: "Paires par carton", required: false, type: "integer", description: "Nombre de paires par colis" },
    { key: "alert_threshold", label: "Seuil d'alerte stock", required: false, type: "integer", description: "Niveau minimum avant alerte" },
    { key: "description", label: "Description", required: false, type: "text", description: "Notes ou détails produit" },
  ],
  clients: [
    { key: "name", label: "Nom du client", required: true, type: "text", description: "Nom complet ou raison sociale" },
    { key: "phone", label: "Téléphone", required: false, type: "phone", description: "Numéro de contact principal" },
    { key: "wilaya", label: "Wilaya (1-58)", required: false, type: "text", description: "Nom ou numéro de wilaya" },
    { key: "address", label: "Adresse", required: false, type: "text", description: "Adresse complète" },
    { key: "client_type", label: "Type de client", required: false, type: "text", description: "retail (Détail) ou wholesale (Gros)" },
    { key: "email", label: "Email", required: false, type: "email", description: "Adresse email" },
    { key: "credit_limit", label: "Plafond de crédit", required: false, type: "currency", description: "Limite de dette autorisée en DZD" },
    { key: "nif", label: "NIF", required: false, type: "text", description: "Numéro d'Identification Fiscale" },
    { key: "rc", label: "Registre de Commerce", required: false, type: "text", description: "Numéro RC" },
    { key: "notes", label: "Notes / Remarques", required: false, type: "text", description: "Observations client" },
  ],
  suppliers: [
    { key: "name", label: "Nom du fournisseur", required: true, type: "text", description: "Raison sociale ou nom du fournisseur" },
    { key: "contact_name", label: "Contact / Représentant", required: false, type: "text", description: "Nom de la personne de contact" },
    { key: "phone", label: "Téléphone", required: false, type: "phone", description: "Numéro de téléphone" },
    { key: "email", label: "Email", required: false, type: "email", description: "Adresse email" },
    { key: "origin_country", label: "Pays d'origine", required: false, type: "text", description: "Code ISO (DZ, TR, CN, IT, etc.)" },
    { key: "address", label: "Adresse", required: false, type: "text", description: "Adresse ou siège" },
    { key: "wilaya", label: "Wilaya", required: false, type: "text", description: "Wilaya en Algérie" },
    { key: "nif", label: "NIF", required: false, type: "text", description: "Numéro d'Identification Fiscale" },
    { key: "rc", label: "Registre de Commerce", required: false, type: "text", description: "Numéro RC" },
    { key: "notes", label: "Notes / Conditions", required: false, type: "text", description: "Conditions de paiement ou remarques" },
  ],
};

interface Branch {
  id: number;
  name: string;
  code?: string;
  is_main?: boolean;
}

interface ParsedFileData {
  headers: string[];
  total_rows: number;
  sample_rows: Record<string, any>[];
  auto_mapping: Record<string, string>;
  raw_rows: Record<string, any>[];
}

interface PreviewResult {
  summary: {
    total_rows: number;
    valid_rows: number;
    duplicate_rows: number;
    error_rows: number;
    is_valid: boolean;
  };
  rows: {
    row_number: number;
    status: "valid" | "duplicate" | "error";
    data: Record<string, any>;
    errors: string[];
    warnings: string[];
    is_update: boolean;
  }[];
}

interface ExecutionResult {
  success: boolean;
  created_products?: number;
  updated_products?: number;
  created_variants?: number;
  updated_variants?: number;
  created_movements?: number;
  created_clients?: number;
  updated_clients?: number;
  created_suppliers?: number;
  updated_suppliers?: number;
  skipped_count?: number;
  errors?: { row: number; message: string }[];
}

interface Props {
  initialEntity?: ImportEntityType;
  onSuccess: () => void;
  onClose: () => void;
}

export default function BulkImportWizardModal({
  initialEntity = "products",
  onSuccess,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [entity, setEntity] = useState<ImportEntityType>(initialEntity);
  const [templateLang, setTemplateLang] = useState<"fr" | "ar" | "en">(
    i18n.language.startsWith("ar") ? "ar" : i18n.language.startsWith("en") ? "en" : "fr"
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("update");

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Step 2 mapping state: { [fileColumnHeader]: systemFieldKey }
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [parsedData, setParsedData] = useState<ParsedFileData | null>(null);

  // Step 3 preview state
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<"all" | "valid" | "error" | "duplicate">("all");

  // Step 4 final result
  const [execResult, setExecResult] = useState<ExecutionResult | null>(null);

  // Fetch branches
  const { data: branchesData } = useQuery<{ results?: Branch[]; count?: number } | Branch[]>({
    queryKey: ["core-branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data),
  });

  const branches: Branch[] = Array.isArray(branchesData)
    ? branchesData
    : branchesData?.results ?? [];

  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      const main = branches.find((b) => b.is_main) || branches[0];
      setSelectedBranchId(String(main.id));
    }
  }, [branches, selectedBranchId]);

  // Step 1: Download pre-filled template
  const downloadTemplate = (format: "xlsx" | "csv") => {
    const url = `/api/v1/core/import/template/?entity=${entity}&format=${format}&lang=${templateLang}`;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Step 1: Pick and parse file
  const handleFileSelect = (selectedFile: File | null) => {
    if (!selectedFile) return;
    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith(".csv") && !ext.endsWith(".xlsx") && !ext.endsWith(".xls")) {
      setErrorMessage(t("import_wizard.drag_drop_subtitle"));
      return;
    }
    setFile(selectedFile);
    setErrorMessage(null);
  };

  const handleParseAndProceed = async () => {
    if (!file) return;
    setIsLoading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entity", entity);
    if (selectedBranchId) {
      formData.append("branch_id", selectedBranchId);
    }

    try {
      const res = await api.post("/core/import/parse/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = res.data as ParsedFileData;
      setParsedData(data);
      setColumnMapping(data.auto_mapping || {});
      setStep(2);
    } catch (err: any) {
      setErrorMessage(getApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Mapping verification
  const systemFields = SYSTEM_FIELDS[entity];
  const mappedSystemKeys = new Set(Object.values(columnMapping).filter(Boolean));
  const missingRequiredFields = systemFields
    .filter((f) => f.required)
    .filter((f) => !mappedSystemKeys.has(f.key));

  const handleMappingChange = (fileHeader: string, targetKey: string) => {
    setColumnMapping((prev) => {
      const next = { ...prev };
      if (!targetKey) {
        delete next[fileHeader];
      } else {
        Object.keys(next).forEach((k) => {
          if (k !== fileHeader && next[k] === targetKey) {
            delete next[k];
          }
        });
        next[fileHeader] = targetKey;
      }
      return next;
    });
  };

  const handleGeneratePreview = async () => {
    if (!file || !parsedData) return;
    setIsLoading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entity", entity);
    formData.append("mapping", JSON.stringify(columnMapping));
    formData.append("strategy", duplicateStrategy);
    if (selectedBranchId) {
      formData.append("branch_id", selectedBranchId);
    }

    try {
      const res = await api.post("/core/import/preview/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreviewData(res.data as PreviewResult);
      setStep(3);
    } catch (err: any) {
      setErrorMessage(getApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Final execution
  const handleExecuteImport = async () => {
    if (!file) return;
    setIsLoading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entity", entity);
    formData.append("mapping", JSON.stringify(columnMapping));
    formData.append("strategy", duplicateStrategy);
    if (selectedBranchId) {
      formData.append("branch_id", selectedBranchId);
    }

    try {
      const res = await api.post("/core/import/execute/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setExecResult(res.data as ExecutionResult);
      setStep(4);
    } catch (err: any) {
      setErrorMessage(getApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const downloadErrorReport = () => {
    if (!execResult?.errors || execResult.errors.length === 0) return;
    const lines = ["Ligne,Erreur"];
    execResult.errors.forEach((e) => {
      lines.push(`${e.row},"${e.message.replace(/"/g, '""')}"`);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport_erreurs_import_${entity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter preview rows
  const filteredRows = (previewData?.rows || []).filter((r) => {
    if (previewFilter === "all") return true;
    if (previewFilter === "valid") return r.status === "valid" && !r.is_update;
    if (previewFilter === "duplicate") return r.is_update || r.status === "duplicate";
    if (previewFilter === "error") return r.status === "error";
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-card text-text-primary border border-border/80 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/70 bg-surface/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary-500/10 text-primary-500 border border-primary-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-text-primary flex items-center gap-2">
                {t("import_wizard.title")}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
                  v2.0 Localized
                </span>
              </h2>
              <p className="text-xs text-text-muted">
                {t("import_wizard.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-surface rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Wizard Stepper Progress Bar */}
        <div className="grid grid-cols-4 border-b border-border text-xs font-medium bg-surface/30">
          {[
            { num: 1, label: t("import_wizard.step1"), icon: FileUp },
            { num: 2, label: t("import_wizard.step2"), icon: Sliders },
            { num: 3, label: t("import_wizard.step3"), icon: Eye },
            { num: 4, label: t("import_wizard.step4"), icon: CheckCircle2 },
          ].map((s) => {
            const isActive = step === s.num;
            const isDone = step > s.num;
            return (
              <div
                key={s.num}
                className={cn(
                  "flex items-center justify-center gap-2 py-3 px-2 border-b-2 transition-all",
                  isActive
                    ? "border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-500/5 font-semibold"
                    : isDone
                    ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                    : "border-transparent text-text-muted opacity-60"
                )}
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    isActive
                      ? "bg-primary-500 text-white"
                      : isDone
                      ? "bg-emerald-500 text-white"
                      : "bg-surface border border-border text-text-muted"
                  )}
                >
                  {isDone ? <Check size={12} /> : s.num}
                </div>
                <span className="hidden sm:inline truncate">{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Modal Body Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMessage && (
            <div className="flex items-start gap-3 p-4 bg-danger-light border border-danger/30 rounded-xl text-sm text-danger animate-in fade-in">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-danger" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 1: FILE & TEMPLATE UPLOAD                                            */}
          {/* ========================================================================= */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Entity Selector Pills */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                  Type de données à importer
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { key: "products", label: t("import_wizard.entity_products"), icon: Package, desc: "Pointures, prix, couleurs, stock" },
                    { key: "clients", label: t("import_wizard.entity_clients"), icon: Users, desc: "Coordonnées, wilayas, plafonds" },
                    { key: "suppliers", label: t("import_wizard.entity_suppliers"), icon: Truck, desc: "Fournisseurs, contacts, pays" },
                  ].map((item) => {
                    const isSelected = entity === item.key;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setEntity(item.key as ImportEntityType);
                          setFile(null);
                        }}
                        className={cn(
                          "flex flex-col items-start p-4 rounded-xl border text-start transition-all cursor-pointer",
                          isSelected
                            ? "border-primary-500 bg-primary-50/50 dark:bg-primary-950/30 ring-2 ring-primary-500/20 shadow-sm"
                            : "border-border hover:border-primary-200 bg-surface/30 hover:bg-surface/60"
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={cn("w-4 h-4", isSelected ? "text-primary-500" : "text-text-muted")} />
                          <span className="font-semibold text-sm">{item.label}</span>
                        </div>
                        <span className="text-xs text-text-muted">{item.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Branch Selector (For Products opening stock) */}
              {entity === "products" && branches.length > 0 && (
                <div className="p-4 rounded-xl bg-surface/60 border border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-5 h-5 text-primary-500 flex-shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold">{t("import_wizard.select_branch")}</h4>
                      <p className="text-xs text-text-muted">Les mouvements de stock initial seront affectés à cette boutique.</p>
                    </div>
                  </div>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="select-field text-sm font-medium py-1.5 px-3 min-w-[200px]"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.is_main ? "(Principale)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Localized Template Generator Card */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-primary-500/5 via-primary-500/10 to-transparent border border-primary-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary-500" />
                    <span className="text-sm font-bold text-text-primary">
                      {t("import_wizard.download_template")}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    Modèle officiel avec en-têtes pré-configurés et exemples concrets.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Language Selector */}
                  <select
                    value={templateLang}
                    onChange={(e) => setTemplateLang(e.target.value as any)}
                    className="select-field text-xs py-1.5 px-2.5 bg-card"
                  >
                    <option value="fr">🇫🇷 Français</option>
                    <option value="ar">🇩🇿 العربية</option>
                    <option value="en">🇬🇧 English</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => downloadTemplate("xlsx")}
                    className="btn-secondary btn-sm flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:border-emerald-500"
                  >
                    <Download size={13} />
                    {t("import_wizard.template_xlsx")}
                  </button>

                  <button
                    type="button"
                    onClick={() => downloadTemplate("csv")}
                    className="btn-secondary btn-sm flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:border-blue-500"
                  >
                    <Download size={13} />
                    {t("import_wizard.template_csv")}
                  </button>
                </div>
              </div>

              {/* Drag & Drop Upload Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFileSelect(e.dataTransfer.files?.[0] || null);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-3",
                  isDragging
                    ? "border-primary-500 bg-primary-50/50 dark:bg-primary-950/40 scale-[1.01]"
                    : file
                    ? "border-emerald-500/60 bg-emerald-50/10 dark:bg-emerald-950/20"
                    : "border-border hover:border-primary-400/80 bg-surface/20 hover:bg-surface/50"
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                />

                {file ? (
                  <div className="flex flex-col items-center gap-2 animate-in fade-in">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                      <FileSpreadsheet size={24} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1.5">
                        <CheckCircle2 size={16} />
                        {file.name}
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {(file.size / 1024).toFixed(1)} Ko • Prêt pour le mappage
                      </p>
                    </div>
                    <span className="text-xs text-primary-500 hover:underline mt-1">
                      Cliquer pour changer de fichier
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-surface border border-border/80 flex items-center justify-center text-text-muted group-hover:text-primary-500 transition-colors">
                      <Upload size={22} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {t("import_wizard.drag_drop_title")}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {t("import_wizard.drag_drop_subtitle")}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm mt-1 text-xs font-semibold"
                    >
                      {t("import_wizard.browse_files")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: COLUMN AUTO-MAPPING                                               */}
          {/* ========================================================================= */}
          {step === 2 && parsedData && (
            <div className="space-y-5">
              {/* Mapping Status Banner */}
              <div
                className={cn(
                  "p-4 rounded-xl border flex items-start gap-3 text-xs transition-colors",
                  missingRequiredFields.length === 0
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                    : "bg-warning-light border-warning/30 text-warning-dark"
                )}
              >
                {missingRequiredFields.length === 0 ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-bold text-sm">
                    {missingRequiredFields.length === 0
                      ? t("import_wizard.all_required_mapped")
                      : t("import_wizard.missing_required")}
                  </div>
                  {missingRequiredFields.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {missingRequiredFields.map((f) => (
                        <span
                          key={f.key}
                          className="px-2 py-0.5 bg-danger/10 text-danger border border-danger/20 rounded font-mono font-semibold"
                        >
                          {f.label} *
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Auto-mapping table */}
              <div className="border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="bg-surface/80 px-4 py-3 border-b border-border flex items-center justify-between text-xs font-bold text-text-muted uppercase tracking-wider">
                  <div className="w-5/12">{t("import_wizard.column_source")}</div>
                  <div className="w-2/12 text-center">Correspondance</div>
                  <div className="w-5/12">{t("import_wizard.column_target")}</div>
                </div>

                <div className="divide-y divide-border/60 max-h-[50vh] overflow-y-auto">
                  {parsedData.headers.map((header) => {
                    const currentTargetKey = columnMapping[header] || "";
                    const isMatched = !!currentTargetKey;
                    const sampleValues = parsedData.sample_rows
                      .map((row) => row[header])
                      .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
                      .slice(0, 2);

                    return (
                      <div
                        key={header}
                        className={cn(
                          "px-4 py-3 flex items-center justify-between gap-4 transition-colors text-sm",
                          isMatched ? "bg-card hover:bg-surface/40" : "bg-surface/10 opacity-70 hover:opacity-100"
                        )}
                      >
                        {/* Source Column Header & Samples */}
                        <div className="w-5/12">
                          <div className="font-semibold text-text-primary flex items-center gap-1.5">
                            <FileText size={14} className="text-text-muted" />
                            {header}
                          </div>
                          {sampleValues.length > 0 && (
                            <div className="text-xs text-text-muted mt-1 truncate">
                              Exemples : <span className="font-mono text-text-secondary">{sampleValues.join(", ")}</span>
                            </div>
                          )}
                        </div>

                        {/* Middle status icon */}
                        <div className="w-2/12 flex justify-center">
                          {isMatched ? (
                            <div className="w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                              <ArrowRight size={14} />
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-surface border border-border text-text-muted flex items-center justify-center">
                              <X size={12} />
                            </div>
                          )}
                        </div>

                        {/* Target System Field Dropdown */}
                        <div className="w-5/12">
                          <select
                            value={currentTargetKey}
                            onChange={(e) => handleMappingChange(header, e.target.value)}
                            className={cn(
                              "select-field text-xs py-2 px-3 w-full font-medium transition-all",
                              currentTargetKey
                                ? "border-primary-500/60 bg-primary-50/20 text-text-primary"
                                : "text-text-muted border-border"
                            )}
                          >
                            <option value="">{t("import_wizard.ignore_column")}</option>
                            <optgroup label="Champs obligatoires *">
                              {systemFields
                                .filter((f) => f.required)
                                .map((f) => (
                                  <option key={f.key} value={f.key}>
                                    ⭐ {f.label} *
                                  </option>
                                ))}
                            </optgroup>
                            <optgroup label="Champs optionnels">
                              {systemFields
                                .filter((f) => !f.required)
                                .map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: PREVIEW & DUPLICATE STRATEGY                                      */}
          {/* ========================================================================= */}
          {step === 3 && previewData && (
            <div className="space-y-5">
              {/* Duplicate Strategy Options */}
              <div className="p-4 rounded-xl bg-surface/50 border border-border/80 space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("import_wizard.strategy_title")}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    { key: "update", title: t("import_wizard.strategy_update"), desc: t("import_wizard.strategy_update_desc") },
                    { key: "skip", title: t("import_wizard.strategy_skip"), desc: t("import_wizard.strategy_skip_desc") },
                    { key: "create_new", title: t("import_wizard.strategy_create_new"), desc: t("import_wizard.strategy_create_new_desc") },
                  ].map((s) => {
                    const isSelected = duplicateStrategy === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setDuplicateStrategy(s.key as DuplicateStrategy)}
                        className={cn(
                          "p-3 rounded-lg border text-start transition-all cursor-pointer flex flex-col justify-between",
                          isSelected
                            ? "border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 ring-2 ring-primary-500/20"
                            : "border-border bg-card hover:bg-surface/60"
                        )}
                      >
                        <span className="font-bold text-xs text-text-primary">{s.title}</span>
                        <span className="text-[11px] text-text-muted mt-1 leading-snug">{s.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* KPI Summary Cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-surface/40 border border-border flex flex-col">
                  <span className="text-xs text-text-muted">{t("import_wizard.stat_total_rows")}</span>
                  <span className="text-xl font-bold font-mono mt-1">{previewData.summary.total_rows}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col text-emerald-600 dark:text-emerald-400">
                  <span className="text-xs">{t("import_wizard.stat_valid_rows")}</span>
                  <span className="text-xl font-bold font-mono mt-1">+{previewData.summary.valid_rows}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 flex flex-col text-purple-600 dark:text-purple-400">
                  <span className="text-xs">{t("import_wizard.stat_duplicates")}</span>
                  <span className="text-xl font-bold font-mono mt-1">{previewData.summary.duplicate_rows}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/20 flex flex-col text-danger">
                  <span className="text-xs">{t("import_wizard.stat_errors")}</span>
                  <span className="text-xl font-bold font-mono mt-1">{previewData.summary.error_rows}</span>
                </div>
              </div>

              {/* Filter Tabs & Preview Table */}
              <div className="border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="bg-surface/80 px-4 py-2 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-text-primary">
                    {t("import_wizard.preview_title")}
                  </span>
                  <div className="flex items-center gap-1">
                    {(["all", "valid", "duplicate", "error"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setPreviewFilter(tab)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors",
                          previewFilter === tab
                            ? "bg-primary-500 text-white"
                            : "text-text-muted hover:bg-surface"
                        )}
                      >
                        {tab === "all" && `Tous (${previewData.rows.length})`}
                        {tab === "valid" && `Valides (${previewData.summary.valid_rows})`}
                        {tab === "duplicate" && `Doublons (${previewData.summary.duplicate_rows})`}
                        {tab === "error" && `Erreurs (${previewData.summary.error_rows})`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-[38vh] overflow-y-auto divide-y divide-border/60">
                  {filteredRows.length === 0 ? (
                    <div className="p-8 text-center text-xs text-text-muted">
                      Aucune ligne ne correspond à ce filtre.
                    </div>
                  ) : (
                    filteredRows.map((r) => (
                      <div key={r.row_number} className="p-3 text-xs flex items-start gap-3 hover:bg-surface/30">
                        {/* Status Badge */}
                        <div className="flex-shrink-0 pt-0.5">
                          {r.status === "error" ? (
                            <span className="px-2 py-0.5 rounded font-bold bg-danger/10 text-danger border border-danger/20 flex items-center gap-1">
                              <XCircle size={12} /> L.{r.row_number}
                            </span>
                          ) : r.is_update || r.status === "duplicate" ? (
                            <span className="px-2 py-0.5 rounded font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex items-center gap-1">
                              <RefreshCw size={12} /> L.{r.row_number} (Mise à jour)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                              <CheckCircle2 size={12} /> L.{r.row_number}
                            </span>
                          )}
                        </div>

                        {/* Row Details */}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-text-primary truncate">
                            {r.data.name || r.data.brand || "Ligne de données"}
                            {r.data.size_eu && (
                              <span className="ml-2 font-mono text-xs px-1.5 py-0.2 rounded bg-surface border border-border">
                                Pointure {r.data.size_eu}
                              </span>
                            )}
                            {r.data.sale_price && (
                              <span className="ml-2 font-mono text-emerald-600 dark:text-emerald-400">
                                {r.data.sale_price} DZD
                              </span>
                            )}
                            {r.data.phone && (
                              <span className="ml-2 font-mono text-text-muted">
                                📞 {r.data.phone}
                              </span>
                            )}
                          </div>

                          {/* Errors/Warnings */}
                          {r.errors && r.errors.length > 0 && (
                            <div className="text-danger text-[11px] font-medium mt-1">
                              {r.errors.join(" • ")}
                            </div>
                          )}
                          {r.warnings && r.warnings.length > 0 && (
                            <div className="text-warning text-[11px] font-medium mt-0.5">
                              {r.warnings.join(" • ")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 4: EXECUTION & REPORT                                                */}
          {/* ========================================================================= */}
          {step === 4 && execResult && (
            <div className="space-y-6 py-4 animate-in fade-in">
              <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-3 animate-bounce">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                  {t("import_wizard.success_title")}
                </h3>
                <p className="text-xs text-text-muted mt-1 max-w-md">
                  Vos données ont été traitées et enregistrées avec succès dans la base de données.
                </p>
              </div>

              {/* Execution Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {execResult.created_products != null && (
                  <div className="p-4 rounded-xl bg-surface/50 border border-border flex flex-col">
                    <span className="text-xs text-text-muted">{t("import_wizard.summary_created_products")}</span>
                    <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                      +{execResult.created_products}
                    </span>
                  </div>
                )}
                {execResult.created_variants != null && (
                  <div className="p-4 rounded-xl bg-surface/50 border border-border flex flex-col">
                    <span className="text-xs text-text-muted">{t("import_wizard.summary_created_variants")}</span>
                    <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                      +{execResult.created_variants}
                    </span>
                  </div>
                )}
                {execResult.created_movements != null && (
                  <div className="p-4 rounded-xl bg-surface/50 border border-border flex flex-col">
                    <span className="text-xs text-text-muted">{t("import_wizard.summary_stock_movements")}</span>
                    <span className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                      +{execResult.created_movements}
                    </span>
                  </div>
                )}
                {execResult.updated_products != null && execResult.updated_products > 0 && (
                  <div className="p-4 rounded-xl bg-surface/50 border border-border flex flex-col">
                    <span className="text-xs text-text-muted">{t("import_wizard.summary_updated_products")}</span>
                    <span className="text-2xl font-bold font-mono text-purple-600 dark:text-purple-400 mt-1">
                      {execResult.updated_products}
                    </span>
                  </div>
                )}
                {execResult.created_clients != null && (
                  <div className="p-4 rounded-xl bg-surface/50 border border-border flex flex-col">
                    <span className="text-xs text-text-muted">{t("import_wizard.summary_created_clients")}</span>
                    <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                      +{execResult.created_clients}
                    </span>
                  </div>
                )}
                {execResult.created_suppliers != null && (
                  <div className="p-4 rounded-xl bg-surface/50 border border-border flex flex-col">
                    <span className="text-xs text-text-muted">{t("import_wizard.summary_created_suppliers")}</span>
                    <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                      +{execResult.created_suppliers}
                    </span>
                  </div>
                )}
              </div>

              {/* Error Log Download if any errors */}
              {execResult.errors && execResult.errors.length > 0 && (
                <div className="p-4 rounded-xl bg-danger/5 border border-danger/20 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-xs text-danger font-medium">
                    <AlertTriangle size={16} />
                    <span>{execResult.errors.length} ligne(s) ont été ignorées en raison d'erreurs.</span>
                  </div>
                  <button
                    type="button"
                    onClick={downloadErrorReport}
                    className="btn-secondary btn-sm text-xs text-danger border-danger/30 hover:bg-danger/10"
                  >
                    <Download size={13} />
                    {t("import_wizard.download_error_log")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 border-t border-border bg-surface/40 flex items-center justify-between flex-shrink-0">
          <div>
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn-secondary btn-sm flex items-center gap-1.5"
                disabled={isLoading}
              >
                <ArrowLeft size={14} />
                {t("import_wizard.btn_back")}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-secondary btn-sm flex items-center gap-1.5"
                disabled={isLoading}
              >
                <ArrowLeft size={14} />
                {t("import_wizard.btn_back")}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step !== 4 && (
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost btn-sm text-text-muted"
                disabled={isLoading}
              >
                Annuler
              </button>
            )}

            {step === 1 && (
              <button
                type="button"
                onClick={handleParseAndProceed}
                disabled={!file || isLoading}
                className="btn-primary flex items-center gap-2 font-semibold shadow-md shadow-primary-500/20"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Analyse du fichier...
                  </>
                ) : (
                  <>
                    {t("import_wizard.btn_next")}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={missingRequiredFields.length > 0 || isLoading}
                className="btn-primary flex items-center gap-2 font-semibold shadow-md shadow-primary-500/20"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t("import_wizard.btn_simulating")}
                  </>
                ) : (
                  <>
                    Vérifier et prévisualiser
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={isLoading}
                className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 font-semibold shadow-md shadow-emerald-600/20"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t("import_wizard.btn_importing")}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    {t("import_wizard.btn_execute")}
                  </>
                )}
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="btn-primary flex items-center gap-2 font-semibold shadow-md shadow-primary-500/20"
              >
                <Check size={16} />
                {t("import_wizard.btn_finish")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
