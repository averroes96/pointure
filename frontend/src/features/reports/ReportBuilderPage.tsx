import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Lock,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  ArrowUpDown,
  FileDown,
  Play,
} from "lucide-react";
import api from "@/lib/api";
import { usePlan } from "@/hooks/usePlan";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldDef {
  id: string;
  label: string;
  type: "string" | "number" | "decimal" | "date" | "choice" | "boolean";
  operators: { value: string; label: string }[];
  choices: string[];
  sortable: boolean;
}

interface FieldsResponse {
  sales: FieldDef[];
  inventory: FieldDef[];
  clients: FieldDef[];
}

interface Filter {
  id: string; // local uuid for keying
  field: string;
  operator: string;
  value: string;
}

interface SortConfig {
  field: string;
  direction: "asc" | "desc";
}

interface ReportConfig {
  columns: string[];
  filters: Filter[];
  sort: SortConfig | null;
  date_from: string;
  date_to: string;
}

interface Template {
  id: number;
  name: string;
  source: "sales" | "inventory" | "clients";
  config: ReportConfig;
}

interface PreviewResponse {
  rows: Record<string, unknown>[];
  column_labels: Record<string, string>;
  count: number;
}

type Source = "sales" | "inventory" | "clients";

// ─── Small helpers ────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SOURCE_LABELS: Record<Source, string> = {
  sales: "Ventes",
  inventory: "Inventaire",
  clients: "Clients",
};

const SOURCE_BADGE_CLASSES: Record<Source, string> = {
  sales: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  inventory: "bg-blue-50 text-blue-700 border border-blue-200",
  clients: "bg-purple-50 text-purple-700 border border-purple-200",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function EnterpriseBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200 shadow-2xs">
      <Lock size={12} className="text-amber-600" />
      Enterprise
    </span>
  );
}

function UpgradePlaceholder() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-8 text-center max-w-md mx-auto mt-16">
      <div className="flex justify-center mb-4">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <Lock className="text-amber-600" size={32} />
        </div>
      </div>
      <h2 className="text-xl font-bold font-sans tracking-tight text-slate-900 mb-2">
        Fonctionnalité Enterprise
      </h2>
      <p className="text-sm text-slate-500">
        Le constructeur de rapports est disponible sur le plan Enterprise.
      </p>
    </div>
  );
}

interface SourceTabsProps {
  source: Source;
  onChange: (s: Source) => void;
}

function SourceTabs({ source, onChange }: SourceTabsProps) {
  const sources: Source[] = ["sales", "inventory", "clients"];
  return (
    <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl border border-slate-200/80 w-fit">
      {sources.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-4 py-1.5 rounded-lg text-xs transition-all ${
            source === s
              ? "bg-white shadow-2xs text-slate-900 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 font-medium"
          }`}
        >
          {SOURCE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

interface FilterRowProps {
  filter: Filter;
  fields: FieldDef[];
  onChange: (updated: Filter) => void;
  onRemove: () => void;
}

function FilterRow({ filter, fields, onChange, onRemove }: FilterRowProps) {
  const fieldDef = fields.find((f) => f.id === filter.field);

  function handleFieldChange(fieldId: string) {
    const def = fields.find((f) => f.id === fieldId);
    onChange({
      ...filter,
      field: fieldId,
      operator: def?.operators[0]?.value ?? "",
      value: "",
    });
  }

  function renderValueInput() {
    if (!fieldDef) {
      return (
        <input
          className="form-input flex-1"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          placeholder="Valeur"
        />
      );
    }
    if (fieldDef.type === "choice") {
      return (
        <select
          className="form-input flex-1"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
        >
          <option value="">— choisir —</option>
          {fieldDef.choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    }
    if (fieldDef.type === "boolean") {
      return (
        <select
          className="input rounded-xl border-slate-200 text-xs flex-1 min-w-[130px]"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
        >
          <option value="">— choisir —</option>
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
      );
    }
    if (fieldDef.type === "date") {
      return (
        <input
          type="date"
          className="input rounded-xl border-slate-200 text-xs flex-1 min-w-[140px] font-mono"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
        />
      );
    }
    if (fieldDef.type === "number" || fieldDef.type === "decimal") {
      return (
        <input
          type="number"
          className="input rounded-xl border-slate-200 text-xs flex-1 min-w-[120px] font-mono"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          placeholder="Valeur"
        />
      );
    }
    return (
      <input
        type="text"
        className="input rounded-xl border-slate-200 text-xs flex-1 min-w-[140px]"
        value={filter.value}
        onChange={(e) => onChange({ ...filter, value: e.target.value })}
        placeholder="Valeur"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-50 border border-slate-200/80 rounded-xl">
      {/* Field selector */}
      <select
        className="input w-44 rounded-xl border-slate-200 text-xs"
        value={filter.field}
        onChange={(e) => handleFieldChange(e.target.value)}
      >
        <option value="">— champ —</option>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>

      {/* Operator selector */}
      <select
        className="input w-36 rounded-xl border-slate-200 text-xs"
        value={filter.operator}
        onChange={(e) => onChange({ ...filter, operator: e.target.value })}
        disabled={!fieldDef}
      >
        <option value="">— op —</option>
        {(fieldDef?.operators ?? []).map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {/* Value input */}
      {renderValueInput()}

      {/* Remove */}
      <button
        onClick={onRemove}
        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
        title="Supprimer ce filtre"
      >
        <X size={15} />
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportBuilderPage() {
  const { t } = useTranslation();
  const { canAccess } = usePlan();
  const qc = useQueryClient();

  // Builder state
  const [source, setSource] = useState<Source>("sales");
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<SortConfig | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Preview state
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  // Template save state
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);

  // Export loading
  const [exportLoading, setExportLoading] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: fieldsData, isLoading: fieldsLoading } =
    useQuery<FieldsResponse>({
      queryKey: ["report-builder-fields"],
      queryFn: () =>
        api.get("/reports/builder/fields/").then((r) => r.data),
      staleTime: 5 * 60 * 1000,
    });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["report-templates"],
    queryFn: () => api.get("/reports/templates/").then((r) => r.data),
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const currentFields: FieldDef[] = fieldsData?.[source] ?? [];
  const sortableFields = currentFields.filter((f) => f.sortable);
  const MAX_COLUMNS = 8;

  // ── Source change ─────────────────────────────────────────────────────────

  function handleSourceChange(s: Source) {
    setSource(s);
    setColumns([]);
    setFilters([]);
    setSort(null);
    setPreviewData(null);
    setPreviewError(null);
    setDateError(null);
  }

  // ── Columns ───────────────────────────────────────────────────────────────

  function addColumn(fieldId: string) {
    if (columns.includes(fieldId) || columns.length >= MAX_COLUMNS) return;
    setColumns([...columns, fieldId]);
  }

  function removeColumn(fieldId: string) {
    setColumns(columns.filter((c) => c !== fieldId));
    if (sort?.field === fieldId) setSort(null);
  }

  function moveColumn(index: number, direction: "up" | "down") {
    const newCols = [...columns];
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= newCols.length) return;
    [newCols[index], newCols[target]] = [newCols[target], newCols[index]];
    setColumns(newCols);
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  function addFilter() {
    setFilters([
      ...filters,
      { id: uid(), field: "", operator: "", value: "" },
    ]);
  }

  function updateFilter(id: string, updated: Filter) {
    setFilters(filters.map((f) => (f.id === id ? updated : f)));
  }

  function removeFilter(id: string) {
    setFilters(filters.filter((f) => f.id !== id));
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  function buildConfig(): ReportConfig {
    return {
      columns,
      filters,
      sort,
      date_from: dateFrom,
      date_to: dateTo,
    };
  }

  async function runPreview() {
    setDateError(null);
    if (source === "sales" && (!dateFrom || !dateTo)) {
      setDateError("La plage de dates est requise pour les rapports de ventes.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await api.post<PreviewResponse>(
        "/reports/builder/preview/",
        {
          source,
          ...buildConfig(),
        }
      );
      setPreviewData(res.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Erreur lors de la génération de l'aperçu.";
      setPreviewError(msg);
    } finally {
      setPreviewLoading(false);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async function handleExport() {
    if (source === "sales" && (!dateFrom || !dateTo)) {
      setDateError("La plage de dates est requise pour les rapports de ventes.");
      return;
    }
    setDateError(null);
    setExportLoading(true);
    try {
      const config = { source, ...buildConfig() };
      const encoded = encodeURIComponent(JSON.stringify(config));
      const res = await api.get(
        `/reports/builder/export/?config=${encoded}`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport_${source}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently handle — could show toast in real app
    } finally {
      setExportLoading(false);
    }
  }

  // ── Template operations ───────────────────────────────────────────────────

  function loadTemplate(tpl: Template) {
    setSource(tpl.source);
    setColumns(tpl.config.columns ?? []);
    setFilters(tpl.config.filters ?? []);
    setSort(tpl.config.sort ?? null);
    setDateFrom(tpl.config.date_from ?? "");
    setDateTo(tpl.config.date_to ?? "");
    setPreviewData(null);
    setPreviewError(null);
    setDateError(null);
  }

  async function deleteTemplate(id: number) {
    try {
      await api.delete(`/reports/templates/${id}/`);
      qc.invalidateQueries({ queryKey: ["report-templates"] });
    } catch {
      // silently handle
    }
  }

  async function saveTemplate() {
    if (!saveName.trim()) return;
    setSaveLoading(true);
    try {
      await api.post("/reports/templates/", {
        name: saveName.trim(),
        source,
        config: buildConfig(),
      });
      qc.invalidateQueries({ queryKey: ["report-templates"] });
      setSaveFormOpen(false);
      setSaveName("");
    } catch {
      // silently handle
    } finally {
      setSaveLoading(false);
    }
  }

  // ── Enterprise gate ───────────────────────────────────────────────────────

  if (!canAccess("enterprise")) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text-primary">
            Constructeur de rapports
          </h1>
          <EnterpriseBadge />
        </div>
        <UpgradePlaceholder />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">
          Constructeur de rapports
        </h1>
        <EnterpriseBadge />
      </div>

      {/* Layout: sidebar + main */}
      <div className="flex flex-col md:flex-row gap-6" style={{ minHeight: "70vh" }}>
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className="w-full md:w-60 shrink-0 flex flex-col gap-2">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs flex-1 flex flex-col overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Mes modèles
              </span>
              <span className="text-2xs font-mono font-semibold text-slate-400">
                {templates.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {templates.length === 0 ? (
                <p className="text-xs text-slate-400 px-2 py-4 text-center font-medium">
                  Aucun modèle sauvegardé
                </p>
              ) : (
                templates.slice(0, 15).map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between rounded-xl px-2.5 py-2 hover:bg-slate-50 cursor-pointer group transition-colors"
                    onClick={() => loadTemplate(tpl)}
                  >
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="text-xs font-semibold text-slate-900 truncate leading-tight">
                        {tpl.name}
                      </span>
                      <span
                        className={`${SOURCE_BADGE_CLASSES[tpl.source]} text-2xs font-semibold px-2 py-0.5 rounded-full w-fit`}
                      >
                        {SOURCE_LABELS[tpl.source]}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTemplate(tpl.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 ml-1 p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all shrink-0"
                      title={t("common.delete")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Save button / inline form */}
            <div className="p-3 border-t border-slate-100 bg-slate-50/50">
              {saveFormOpen ? (
                <div className="space-y-2">
                  <input
                    className="input text-xs w-full rounded-xl border-slate-200"
                    placeholder={t("report.template_name")}
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveTemplate();
                      if (e.key === "Escape") {
                        setSaveFormOpen(false);
                        setSaveName("");
                      }
                    }}
                    autoFocus
                  />
                  <div className="flex gap-1.5">
                    <button
                      className="btn-primary py-1.5 px-3 rounded-xl flex-1 text-xs font-semibold"
                      onClick={saveTemplate}
                      disabled={saveLoading || !saveName.trim()}
                    >
                      {saveLoading ? "…" : t("common.save")}
                    </button>
                    <button
                      className="btn-secondary py-1.5 px-2.5 rounded-xl text-xs"
                      onClick={() => {
                        setSaveFormOpen(false);
                        setSaveName("");
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-secondary w-full py-2 text-xs font-semibold rounded-xl shadow-2xs"
                  onClick={() => setSaveFormOpen(true)}
                >
                  {t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Main builder ─────────────────────────────────────────────────── */}
        <div className="flex-1 space-y-6 min-w-0">
          {/* Source tabs */}
          <SourceTabs source={source} onChange={handleSourceChange} />

          {fieldsLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-12 text-slate-400 text-sm font-medium text-center">
              <div className="flex items-center justify-center gap-2">
                <div className="h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            </div>
          ) : (
            <>
              {/* Columns section */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-900 text-sm">
                    {t("report.columns")}{" "}
                    <span className="text-slate-400 font-normal text-xs">
                      (max {MAX_COLUMNS})
                    </span>
                  </span>
                  <span className="text-xs font-mono font-medium text-slate-500">
                    {t("report.columns_selected", { count: columns.length, max: MAX_COLUMNS })}
                  </span>
                </div>
                <div className="space-y-4">
                  {/* Available fields as chips */}
                  <div className="flex flex-wrap gap-2">
                    {currentFields.map((f) => {
                      const selected = columns.includes(f.id);
                      const maxed =
                        !selected && columns.length >= MAX_COLUMNS;
                      return (
                        <button
                          key={f.id}
                          onClick={() => {
                            if (!selected && !maxed) addColumn(f.id);
                          }}
                          disabled={selected || maxed}
                          title={
                            maxed
                              ? "Maximum de colonnes atteint"
                              : selected
                              ? "Déjà sélectionnée"
                              : `Ajouter "${f.label}"`
                          }
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                            selected
                              ? "bg-primary-50 border-primary-200 text-primary-700 shadow-2xs cursor-default"
                              : maxed
                              ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-50"
                              : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-primary-300 shadow-2xs cursor-pointer"
                          }`}
                        >
                          {f.label}
                          {selected && (
                            <span className="ml-1 text-primary-600">✓</span>
                          )}
                        </button>
                      );
                    })}
                    {currentFields.length === 0 && (
                      <span className="text-slate-400 text-sm font-medium">
                        Aucun champ disponible
                      </span>
                    )}
                  </div>

                  {/* Selected columns ordered list */}
                  {columns.length > 0 && (
                    <div className="border border-slate-200/80 rounded-xl divide-y divide-slate-100 overflow-hidden bg-slate-50/30">
                      {columns.map((colId, idx) => {
                        const fieldDef = currentFields.find(
                          (f) => f.id === colId
                        );
                        return (
                          <div
                            key={colId}
                            className="flex items-center gap-3 px-4 py-2.5 bg-white"
                          >
                            <span className="text-xs font-mono font-semibold text-slate-400 w-5 text-end shrink-0">
                              {idx + 1}
                            </span>
                            <span className="flex-1 text-xs font-semibold text-slate-900">
                              {fieldDef?.label ?? colId}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => moveColumn(idx, "up")}
                                disabled={idx === 0}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default transition-colors"
                                title="Monter"
                              >
                                <ChevronUp size={14} />
                              </button>
                              <button
                                onClick={() => moveColumn(idx, "down")}
                                disabled={idx === columns.length - 1}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default transition-colors"
                                title="Descendre"
                              >
                                <ChevronDown size={14} />
                              </button>
                              <button
                                onClick={() => removeColumn(colId)}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 ml-1 transition-colors"
                                title="Retirer"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Filters section */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-900 text-sm">{t("report.filters")}</span>
                  <button
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100 rounded-xl transition-colors shadow-2xs"
                    onClick={addFilter}
                  >
                    <Plus size={14} />
                    {t("report.add_filter")}
                  </button>
                </div>
                <div className="space-y-2.5">
                  {filters.length === 0 ? (
                    <p className="text-xs text-slate-400 font-medium py-2">
                      Aucun filtre actif.
                    </p>
                  ) : (
                    filters.map((f) => (
                      <FilterRow
                        key={f.id}
                        filter={f}
                        fields={currentFields}
                        onChange={(updated) => updateFilter(f.id, updated)}
                        onRemove={() => removeFilter(f.id)}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Date range (sales only) */}
              {source === "sales" && (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <span className="font-semibold text-slate-900 text-sm">
                      Plage de dates <span className="text-rose-500">*</span>
                    </span>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                          De
                        </label>
                        <input
                          type="date"
                          className="input rounded-xl border-slate-200 text-sm font-mono"
                          value={dateFrom}
                          onChange={(e) => {
                            setDateFrom(e.target.value);
                            setDateError(null);
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                          À
                        </label>
                        <input
                          type="date"
                          className="input rounded-xl border-slate-200 text-sm font-mono"
                          value={dateTo}
                          onChange={(e) => {
                            setDateTo(e.target.value);
                            setDateError(null);
                          }}
                        />
                      </div>
                    </div>
                    {dateError && (
                      <p className="mt-2 text-xs font-medium text-rose-600">{dateError}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Sort section */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                    <ArrowUpDown size={15} className="text-slate-400" />
                    Tri
                  </span>
                  {sort && (
                    <button
                      className="text-xs font-medium text-slate-400 hover:text-rose-600 transition-colors"
                      onClick={() => setSort(null)}
                    >
                      Effacer
                    </button>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <select
                      className="input w-56 rounded-xl border-slate-200 text-sm"
                      value={sort?.field ?? ""}
                      onChange={(e) => {
                        const fieldId = e.target.value;
                        if (!fieldId) {
                          setSort(null);
                        } else {
                          setSort({
                            field: fieldId,
                            direction: sort?.direction ?? "asc",
                          });
                        }
                      }}
                    >
                      <option value="">— aucun tri —</option>
                      {sortableFields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>

                    {sort && (
                      <div className="flex rounded-xl border border-slate-200/80 overflow-hidden shadow-2xs">
                        <button
                          onClick={() =>
                            setSort({ ...sort, direction: "asc" })
                          }
                          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                            sort.direction === "asc"
                              ? "bg-primary-600 text-white"
                              : "bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          ASC
                        </button>
                        <button
                          onClick={() =>
                            setSort({ ...sort, direction: "desc" })
                          }
                          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                            sort.direction === "desc"
                              ? "bg-primary-600 text-white"
                              : "bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          DESC
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl shadow-xs"
                  onClick={runPreview}
                  disabled={previewLoading}
                >
                  {previewLoading ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Chargement…
                    </>
                  ) : (
                    <>
                      <Play size={15} />
                      Aperçu (200 lignes max)
                    </>
                  )}
                </button>
                <button
                  className="btn-secondary inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl shadow-2xs"
                  onClick={handleExport}
                  disabled={exportLoading}
                >
                  {exportLoading ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      Export…
                    </>
                  ) : (
                    <>
                      <FileDown size={15} />
                      {t("common.export_csv")}
                    </>
                  )}
                </button>
                {previewError && (
                  <span className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">{previewError}</span>
                )}
              </div>

              {/* Preview table */}
              {previewData && (
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-sm">
                      Aperçu des résultats
                    </span>
                    <span className="text-xs font-mono font-medium text-slate-500">
                      {previewData.count} ligne{previewData.count !== 1 ? "s" : ""}
                      {previewData.count > 200 && " (aperçu limité à 200)"}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    {previewData.rows.length === 0 ? (
                      <div className="py-12 text-center text-slate-400 text-sm font-medium">
                        Aucun résultat correspondant aux critères.
                      </div>
                    ) : (
                      <table className="w-full text-start text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            {columns.map((colId) => (
                              <th key={colId} className="px-4 py-3.5 whitespace-nowrap text-start">
                                {previewData.column_labels[colId] ?? colId}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewData.rows.map((row, rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-slate-50/70 transition-colors">
                              {columns.map((colId) => {
                                const val = row[colId];
                                return (
                                  <td key={colId} className="px-4 py-3 text-xs text-slate-700">
                                    {val === null || val === undefined
                                      ? "—"
                                      : String(val)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

