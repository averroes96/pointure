import { useState } from "react";
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
  sales: "badge badge-success",
  inventory: "badge",
  clients: "badge badge-danger",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function EnterpriseBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-300">
      <Lock size={10} />
      Enterprise
    </span>
  );
}

function UpgradePlaceholder() {
  return (
    <div className="card p-8 text-center max-w-md mx-auto mt-16">
      <div className="flex justify-center mb-4">
        <div className="rounded-full bg-amber-100 p-4">
          <Lock className="text-amber-600" size={32} />
        </div>
      </div>
      <h2 className="text-xl font-bold text-text-primary mb-2">
        Fonctionnalité Enterprise
      </h2>
      <p className="text-text-muted">
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
    <div className="flex gap-1 bg-bg-secondary rounded-lg p-1 w-fit">
      {sources.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            source === s
              ? "bg-white shadow text-text-primary"
              : "text-text-muted hover:text-text-primary"
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
          className="form-input flex-1"
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
          className="form-input flex-1"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
        />
      );
    }
    if (fieldDef.type === "number" || fieldDef.type === "decimal") {
      return (
        <input
          type="number"
          className="form-input flex-1"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          placeholder="Valeur"
        />
      );
    }
    return (
      <input
        type="text"
        className="form-input flex-1"
        value={filter.value}
        onChange={(e) => onChange({ ...filter, value: e.target.value })}
        placeholder="Valeur"
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Field selector */}
      <select
        className="form-input w-44"
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
        className="form-input w-36"
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
        className="btn-ghost btn-sm text-text-muted hover:text-danger flex-shrink-0"
        title="Supprimer ce filtre"
      >
        <X size={16} />
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportBuilderPage() {
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
    <div className="space-y-4">
      {/* Page title */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-text-primary">
          Constructeur de rapports
        </h1>
        <EnterpriseBadge />
      </div>

      {/* Layout: sidebar + main */}
      <div className="flex gap-4" style={{ minHeight: "70vh" }}>
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className="w-52 flex-shrink-0 flex flex-col gap-2">
          <div className="card flex-1 flex flex-col">
            <div className="card-header">
              <span className="text-sm font-semibold text-text-primary">
                Mes modèles
              </span>
            </div>
            <div className="card-body flex-1 overflow-y-auto p-2 space-y-1">
              {templates.length === 0 ? (
                <p className="text-xs text-text-muted px-1 py-2">
                  Aucun modèle sauvegardé
                </p>
              ) : (
                templates.slice(0, 15).map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-bg-secondary cursor-pointer group"
                    onClick={() => loadTemplate(tpl)}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-sm text-text-primary truncate leading-tight">
                        {tpl.name}
                      </span>
                      <span
                        className={`${SOURCE_BADGE_CLASSES[tpl.source]} text-xs w-fit`}
                      >
                        {SOURCE_LABELS[tpl.source]}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTemplate(tpl.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded text-text-muted hover:text-danger transition-opacity flex-shrink-0"
                      title="Supprimer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Save button / inline form */}
            <div className="p-2 border-t border-border">
              {saveFormOpen ? (
                <div className="space-y-1.5">
                  <input
                    className="form-input text-sm w-full"
                    placeholder="Nom du modèle"
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
                  <div className="flex gap-1">
                    <button
                      className="btn-primary btn-sm flex-1 text-xs"
                      onClick={saveTemplate}
                      disabled={saveLoading || !saveName.trim()}
                    >
                      {saveLoading ? "…" : "Enregistrer"}
                    </button>
                    <button
                      className="btn-ghost btn-sm text-xs"
                      onClick={() => {
                        setSaveFormOpen(false);
                        setSaveName("");
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-secondary btn-sm w-full text-xs"
                  onClick={() => setSaveFormOpen(true)}
                >
                  Sauvegarder
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Main builder ─────────────────────────────────────────────────── */}
        <div className="flex-1 space-y-4 min-w-0">
          {/* Source tabs */}
          <SourceTabs source={source} onChange={handleSourceChange} />

          {fieldsLoading ? (
            <div className="text-text-muted text-sm py-8 text-center">
              Chargement des champs…
            </div>
          ) : (
            <>
              {/* Columns section */}
              <div className="card">
                <div className="card-header">
                  <span className="font-semibold text-text-primary">
                    Colonnes{" "}
                    <span className="text-text-muted font-normal text-sm">
                      (max {MAX_COLUMNS})
                    </span>
                  </span>
                  <span className="text-xs text-text-muted ml-auto">
                    {columns.length}/{MAX_COLUMNS} sélectionnées
                  </span>
                </div>
                <div className="card-body space-y-3">
                  {/* Available fields as chips */}
                  <div className="flex flex-wrap gap-1.5">
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
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            selected
                              ? "bg-primary/10 border-primary/30 text-primary cursor-default"
                              : maxed
                              ? "bg-bg-secondary border-border text-text-muted cursor-not-allowed opacity-50"
                              : "bg-white border-border text-text-secondary hover:bg-bg-secondary hover:border-primary/40 cursor-pointer"
                          }`}
                        >
                          {f.label}
                          {selected && (
                            <span className="ml-1 text-primary/60">✓</span>
                          )}
                        </button>
                      );
                    })}
                    {currentFields.length === 0 && (
                      <span className="text-text-muted text-sm">
                        Aucun champ disponible
                      </span>
                    )}
                  </div>

                  {/* Selected columns ordered list */}
                  {columns.length > 0 && (
                    <div className="border border-border rounded-md divide-y divide-border">
                      {columns.map((colId, idx) => {
                        const fieldDef = currentFields.find(
                          (f) => f.id === colId
                        );
                        return (
                          <div
                            key={colId}
                            className="flex items-center gap-2 px-3 py-2 bg-white"
                          >
                            <span className="text-xs text-text-muted w-5 text-right flex-shrink-0">
                              {idx + 1}
                            </span>
                            <span className="flex-1 text-sm text-text-primary">
                              {fieldDef?.label ?? colId}
                            </span>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={() => moveColumn(idx, "up")}
                                disabled={idx === 0}
                                className="p-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-default"
                                title="Monter"
                              >
                                <ChevronUp size={14} />
                              </button>
                              <button
                                onClick={() => moveColumn(idx, "down")}
                                disabled={idx === columns.length - 1}
                                className="p-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-default"
                                title="Descendre"
                              >
                                <ChevronDown size={14} />
                              </button>
                              <button
                                onClick={() => removeColumn(colId)}
                                className="p-0.5 rounded text-text-muted hover:text-danger ml-1"
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
              <div className="card">
                <div className="card-header">
                  <span className="font-semibold text-text-primary">
                    Filtres
                  </span>
                  <button
                    className="btn-ghost btn-sm ml-auto flex items-center gap-1 text-sm"
                    onClick={addFilter}
                  >
                    <Plus size={14} />
                    Ajouter un filtre
                  </button>
                </div>
                <div className="card-body space-y-2">
                  {filters.length === 0 ? (
                    <p className="text-sm text-text-muted">
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
                <div className="card">
                  <div className="card-header">
                    <span className="font-semibold text-text-primary">
                      Plage de dates{" "}
                      <span className="text-danger">*</span>
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-text-secondary whitespace-nowrap">
                          De
                        </label>
                        <input
                          type="date"
                          className="form-input"
                          value={dateFrom}
                          onChange={(e) => {
                            setDateFrom(e.target.value);
                            setDateError(null);
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-text-secondary whitespace-nowrap">
                          À
                        </label>
                        <input
                          type="date"
                          className="form-input"
                          value={dateTo}
                          onChange={(e) => {
                            setDateTo(e.target.value);
                            setDateError(null);
                          }}
                        />
                      </div>
                    </div>
                    {dateError && (
                      <p className="mt-2 text-sm text-danger">{dateError}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Sort section */}
              <div className="card">
                <div className="card-header">
                  <span className="font-semibold text-text-primary flex items-center gap-1.5">
                    <ArrowUpDown size={15} />
                    Tri
                  </span>
                  {sort && (
                    <button
                      className="btn-ghost btn-sm ml-auto text-xs text-text-muted hover:text-danger"
                      onClick={() => setSort(null)}
                    >
                      Effacer
                    </button>
                  )}
                </div>
                <div className="card-body">
                  <div className="flex items-center gap-3">
                    <select
                      className="form-input w-52"
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
                      <div className="flex rounded-md border border-border overflow-hidden">
                        <button
                          onClick={() =>
                            setSort({ ...sort, direction: "asc" })
                          }
                          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                            sort.direction === "asc"
                              ? "bg-primary text-white"
                              : "bg-white text-text-secondary hover:bg-bg-secondary"
                          }`}
                        >
                          ASC
                        </button>
                        <button
                          onClick={() =>
                            setSort({ ...sort, direction: "desc" })
                          }
                          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                            sort.direction === "desc"
                              ? "bg-primary text-white"
                              : "bg-white text-text-secondary hover:bg-bg-secondary"
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
              <div className="flex items-center gap-3">
                <button
                  className="btn-primary flex items-center gap-2"
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
                  className="btn-secondary flex items-center gap-2"
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
                      Exporter CSV
                    </>
                  )}
                </button>
                {previewError && (
                  <span className="text-sm text-danger">{previewError}</span>
                )}
              </div>

              {/* Preview table */}
              {previewData && (
                <div className="card">
                  <div className="card-header">
                    <span className="font-semibold text-text-primary">
                      Aperçu
                    </span>
                    <span className="ml-auto text-sm text-text-muted">
                      {previewData.count} ligne
                      {previewData.count !== 1 ? "s" : ""}
                      {previewData.count > 200 && " (aperçu limité à 200)"}
                    </span>
                  </div>
                  <div className="card-body p-0 overflow-x-auto">
                    {previewData.rows.length === 0 ? (
                      <div className="py-10 text-center text-text-muted text-sm">
                        Aucun résultat
                      </div>
                    ) : (
                      <table className="data-table w-full text-sm">
                        <thead>
                          <tr>
                            {columns.map((colId) => (
                              <th key={colId} className="whitespace-nowrap">
                                {previewData.column_labels[colId] ?? colId}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                              {columns.map((colId) => {
                                const val = row[colId];
                                return (
                                  <td key={colId}>
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
