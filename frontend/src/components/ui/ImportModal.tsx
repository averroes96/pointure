import { useRef, useState } from "react";
import { Upload, X, Download, CheckCircle, AlertTriangle, Loader2, FileText } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ImportError {
  row: number;
  message: string;
}

interface ImportResult {
  dry_run: boolean;
  errors: ImportError[];
  // products
  created_products?: number;
  created_variants?: number;
  // clients
  created?: number;
  skipped: number;
}

interface Props {
  title: string;
  endpoint: string;
  templateCsv: string;
  templateFilename: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function ImportModal({
  title, endpoint, templateCsv, templateFilename, onSuccess, onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function downloadTemplate() {
    const blob = new Blob([templateCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function pickFile(f: File | null) {
    if (!f) return;
    const ok = f.name.endsWith(".csv") || f.name.endsWith(".xlsx");
    if (!ok) { setFatalError("Seuls les fichiers .csv et .xlsx sont acceptés."); return; }
    setFile(f);
    setResult(null);
    setFatalError(null);
  }

  async function submit() {
    if (!file) return;
    setLoading(true);
    setFatalError(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const url = dryRun ? `${endpoint}?dry_run=true` : endpoint;
      const res = await api.post(url, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data as ImportResult);
      if (!dryRun && (res.data as ImportResult).errors.length === 0) {
        onSuccess();
      }
    } catch (err) {
      setFatalError(getApiError(err));
    } finally {
      setLoading(false);
    }
  }

  const hasResult = result !== null;
  const hasErrors = hasResult && result.errors.length > 0;
  const totalCreated = result
    ? (result.created ?? 0) + (result.created_variants ?? 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-text-primary flex items-center gap-2">
            <Upload size={16} />
            {title}
          </h2>
          <button onClick={onClose} className="btn-ghost btn-sm text-text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Template download */}
          <div className="flex items-center gap-3 p-3 bg-surface rounded-lg border border-border">
            <FileText size={16} className="text-text-muted flex-shrink-0" />
            <div className="flex-1 text-sm text-text-muted">
              Utilisez le modèle pour préparer votre fichier.
            </div>
            <button onClick={downloadTemplate} className="btn-secondary btn-sm flex-shrink-0">
              <Download size={13} />
              Modèle CSV
            </button>
          </div>

          {/* Drop zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
              dragging ? "border-primary-400 bg-primary-50" : "border-border hover:border-primary-300",
              file ? "bg-success/5 border-success/40" : ""
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files[0] ?? null);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-2 text-success font-medium">
                <CheckCircle size={18} />
                {file.name}
                <span className="text-xs text-text-muted font-normal">
                  ({(file.size / 1024).toFixed(1)} Ko)
                </span>
              </div>
            ) : (
              <div className="text-text-muted">
                <Upload size={24} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Glissez un fichier ici ou <span className="text-primary-500">parcourir</span></p>
                <p className="text-xs mt-1">.csv ou .xlsx</p>
              </div>
            )}
          </div>

          {/* Dry run toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => { setDryRun(e.target.checked); setResult(null); }}
              className="w-4 h-4 rounded border-border"
            />
            <div>
              <span className="text-sm font-medium text-text-primary">Simulation (dry run)</span>
              <p className="text-xs text-text-muted">Valide le fichier sans créer de données. Décochez pour importer.</p>
            </div>
          </label>

          {/* Fatal error */}
          {fatalError && (
            <div className="flex items-start gap-2 px-3 py-2 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              {fatalError}
            </div>
          )}

          {/* Result summary */}
          {hasResult && (
            <div className={cn(
              "rounded-lg border p-4 space-y-2",
              hasErrors ? "bg-warning-light border-warning/30" : "bg-success/5 border-success/30"
            )}>
              <p className="text-sm font-semibold text-text-primary">
                {result.dry_run ? "Résultat de la simulation" : "Import terminé"}
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                {result.created_products != null && (
                  <span className="text-success font-mono">
                    +{result.created_products} produit(s)
                  </span>
                )}
                {result.created_variants != null && (
                  <span className="text-success font-mono">
                    +{result.created_variants} variante(s)
                  </span>
                )}
                {result.created != null && (
                  <span className="text-success font-mono">
                    +{result.created} client(s)
                  </span>
                )}
                {result.skipped > 0 && (
                  <span className="text-text-muted font-mono">
                    {result.skipped} ignoré(s)
                  </span>
                )}
                {hasErrors && (
                  <span className="text-danger font-mono">
                    {result.errors.length} erreur(s)
                  </span>
                )}
              </div>

              {hasErrors && (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {result.errors.map((err, idx) => (
                    <div key={idx} className="text-xs text-danger flex gap-2">
                      <span className="font-mono flex-shrink-0">Ligne {err.row}</span>
                      <span>{err.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {!hasErrors && !result.dry_run && totalCreated > 0 && (
                <p className="text-xs text-success">Import réussi sans erreur.</p>
              )}
              {!hasErrors && result.dry_run && (
                <p className="text-xs text-text-muted">
                  Décochez "Simulation" puis cliquez sur Importer pour créer les données.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="btn-secondary">Fermer</button>
          <button
            onClick={submit}
            disabled={!file || loading}
            className="btn-primary"
          >
            {loading
              ? <><Loader2 size={14} className="animate-spin" /> Traitement…</>
              : dryRun
              ? <><Upload size={14} /> Simuler</>
              : <><Upload size={14} /> Importer</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
