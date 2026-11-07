import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  RotateCcw,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface BackupItem {
  filename: string;
  size_human: string;
  created_at: string;
}

interface RestoreBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFilename?: string | null;
  availableBackups?: BackupItem[];
}

export default function RestoreBackupModal({
  isOpen,
  onClose,
  initialFilename,
  availableBackups = [],
}: RestoreBackupModalProps) {
  const { t } = useTranslation();

  // Mode: "local" (pick from dropdown or initial) or "upload"
  const [sourceType, setSourceType] = useState<"local" | "upload">(
    initialFilename ? "local" : "local"
  );
  const [selectedFilename, setSelectedFilename] = useState<string>(initialFilename || "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState<string>("");
  const [showPassphrase, setShowPassphrase] = useState<boolean>(false);
  const [confirmationInput, setConfirmationInput] = useState<string>("");

  // Submission & Restart status
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<boolean>(false);
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      setSourceType(initialFilename ? "local" : (availableBackups.length > 0 ? "local" : "upload"));
      setSelectedFilename(initialFilename || (availableBackups[0]?.filename ?? ""));
      setSelectedFile(null);
      setPassphrase("");
      setShowPassphrase(false);
      setConfirmationInput("");
      setError(null);
      setLoading(false);
      setRestarting(false);
      setReconnectAttempts(0);
    }
  }, [isOpen, initialFilename, availableBackups]);

  // Polling for backend restart after successful restore staging
  useEffect(() => {
    if (!restarting) return;

    let timer: NodeJS.Timeout;
    const checkHealth = async () => {
      try {
        const res = await api.get("/desktop/meta/", { timeout: 1500 });
        if (res.status === 200) {
          // Backend is back up! Reload the page to refresh session & cache
          window.location.reload();
          return;
        }
      } catch {
        // Backend still restarting
        setReconnectAttempts((prev) => prev + 1);
      }
      timer = setTimeout(checkHealth, 1500);
    };

    // First check after 2 seconds
    timer = setTimeout(checkHealth, 2000);
    return () => clearTimeout(timer);
  }, [restarting]);

  if (!isOpen) return null;

  const isConfirmationValid = confirmationInput.trim().toUpperCase() === "RESTAURER";
  const hasSource = sourceType === "local" ? !!selectedFilename : !!selectedFile;
  const canSubmit = hasSource && isConfirmationValid && !loading && !restarting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      if (sourceType === "local") {
        formData.append("filename", selectedFilename);
      } else if (selectedFile) {
        formData.append("file", selectedFile);
      }

      if (passphrase) {
        formData.append("passphrase", passphrase);
      }

      await api.post("/desktop/backups/restore/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // Restore accepted, backend is restarting with exit code 100
      setRestarting(true);
    } catch (err: any) {
      setError(
        getApiError(err) ||
          t(
            "desktop.restore_failed_error",
            "Échec de la validation de la sauvegarde. Vérifiez le fichier et la phrase de passe."
          )
      );
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-rose-200 dark:border-rose-950/60 overflow-hidden text-slate-900 dark:text-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-rose-50/80 to-white dark:from-rose-950/30 dark:to-slate-900 border-b border-rose-100/70 dark:border-slate-800 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 flex items-center justify-center shrink-0 shadow-xs border border-rose-200 dark:border-rose-900/60">
            <RotateCcw size={24} className="stroke-[2.2]" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              {t("desktop.restore_modal_title", "Restaurer la Base de Données")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t(
                "desktop.restore_modal_subtitle",
                "Remplace les données de l'application par celles de la sauvegarde sélectionnée."
              )}
            </p>
          </div>
          {!restarting && (
            <button
              onClick={onClose}
              disabled={loading}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {restarting ? (
            <div className="py-10 text-center space-y-4 animate-in fade-in duration-200">
              <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 mx-auto flex items-center justify-center shadow-xs">
                <RefreshCw size={26} className="animate-spin" />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  {t("desktop.restore_restarting_title", "Redémarrage du système en cours...")}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                  {t(
                    "desktop.restore_restarting_desc",
                    "La base de données est en cours d'application. L'application va se recharger automatiquement dès que le service sera prêt."
                  )}
                </p>
                {reconnectAttempts > 0 && (
                  <p className="text-2xs font-mono text-slate-400 pt-2">
                    {t("desktop.restore_reconnecting_attempt", "Tentative de reconnexion")} : {reconnectAttempts}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <form id="restore-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Critical Notice */}
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">
                    {t("desktop.restore_warning_title", "Attention : Action irréversible sur les données récentes")}
                  </p>
                  <p className="text-amber-800 dark:text-amber-300 leading-relaxed text-2xs">
                    {t(
                      "desktop.restore_warning_desc",
                      "Toutes les ventes, opérations et articles créés après la date de cette sauvegarde seront remplacés. Une sauvegarde automatique de sécurité pré-restauration de votre base actuelle sera créée avant le remplacement."
                    )}
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2.5 animate-in fade-in duration-150">
                  <AlertTriangle size={16} className="shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{error}</span>
                </div>
              )}

              {/* Source Mode Selector (Local vs Upload) */}
              {!initialFilename && (
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setSourceType("local")}
                    className={cn(
                      "py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer",
                      sourceType === "local"
                        ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    )}
                  >
                    <HardDrive size={14} />
                    <span>{t("desktop.restore_source_local", "Sauvegarde locale")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType("upload")}
                    className={cn(
                      "py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer",
                      sourceType === "upload"
                        ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    )}
                  >
                    <Upload size={14} />
                    <span>{t("desktop.restore_source_file", "Fichier externe")}</span>
                  </button>
                </div>
              )}

              {/* Source Selection Field */}
              {sourceType === "local" ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t("desktop.restore_choose_backup", "Sélectionner la sauvegarde à restaurer")}
                  </label>
                  {initialFilename ? (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5">
                      <FileText size={16} className="text-primary-600 shrink-0" />
                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-white truncate">
                        {initialFilename}
                      </span>
                    </div>
                  ) : (
                    <select
                      value={selectedFilename}
                      onChange={(e) => setSelectedFilename(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                    >
                      {availableBackups.length === 0 ? (
                        <option value="">{t("desktop.restore_no_local_backups", "Aucune sauvegarde locale trouvée")}</option>
                      ) : (
                        availableBackups.map((b) => (
                          <option key={b.filename} value={b.filename}>
                            {b.filename} ({b.size_human})
                          </option>
                        ))
                      )}
                    </select>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t("desktop.restore_upload_label", "Choisir un fichier de sauvegarde (.sqlite3 ou .shodzbak)")}
                  </label>
                  <input
                    type="file"
                    accept=".sqlite3,.shodzbak"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-primary-50 dark:file:bg-primary-950/50 file:text-primary-700 dark:file:text-primary-300 hover:file:bg-primary-100 cursor-pointer border border-slate-200 dark:border-slate-700 rounded-xl p-1 bg-white dark:bg-slate-800"
                  />
                  {selectedFile && (
                    <p className="text-2xs text-slate-400 mt-1 font-mono truncate">
                      {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} Mo)
                    </p>
                  )}
                </div>
              )}

              {/* Passphrase Input (Optional or required for .shodzbak) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("desktop.restore_passphrase_label", "Phrase de passe (si sauvegarde chiffrée)")}
                </label>
                <div className="relative">
                  <input
                    type={showPassphrase ? "text" : "password"}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={t("desktop.restore_passphrase_placeholder", "Laissez vide si non chiffrée")}
                    className="w-full pl-3 pr-9 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showPassphrase ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-2xs text-slate-400 mt-1">
                  {t(
                    "desktop.restore_passphrase_hint",
                    "Indispensable pour déchiffrer les fichiers .shodzbak générés avec chiffrement AES-256."
                  )}
                </p>
              </div>

              {/* Confirmation Phrase Input */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t("desktop.restore_confirm_type_label", "Pour confirmer, tapez")} <strong className="text-rose-600 font-mono">RESTAURER</strong> :
                </label>
                <input
                  type="text"
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  placeholder="RESTAURER"
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 uppercase placeholder:normal-case placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                />
              </div>
            </form>
          )}
        </div>

        {/* Footer Actions */}
        {!restarting && (
          <div className="px-6 py-4 bg-slate-50/80 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary py-2 px-4 text-xs font-semibold rounded-xl cursor-pointer"
            >
              {t("common.cancel", "Annuler")}
            </button>
            <button
              type="submit"
              form="restore-form"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 py-2 px-5 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              <span>{t("desktop.restore_action_confirm", "Restaurer et Redémarrer")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

