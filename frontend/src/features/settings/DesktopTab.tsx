import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Monitor,
  RefreshCw,
  CheckCircle2,
  Download,
  FolderArchive,
  FileText,
  AlertCircle,
  HardDrive,
  ShieldCheck,
  ExternalLink,
  Database,
  Plus,
  Trash2,
  Loader2,
  Clock,
  Sparkles,
  Info,
  X,
} from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import type { UpdateStatusData } from "@/vite-env";

interface BackupItem {
  filename: string;
  size_bytes: number;
  size_human: string;
  created_at: string;
}

interface BackupsResponse {
  backups: BackupItem[];
  total_count: number;
  backups_dir: string;
  db_path: string;
  max_copies: number;
  last_backup: string | null;
}

export default function DesktopTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Desktop & Update State
  const [version, setVersion] = useState<string>("1.0.0");
  const [status, setStatus] = useState<UpdateStatusData["status"]>("idle" as any);
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; releaseDate?: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [checking, setChecking] = useState<boolean>(false);

  // Backup State
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Electron API setup
  useEffect(() => {
    if (window.electronAPI?.getVersion) {
      window.electronAPI.getVersion().then((v) => setVersion(v || "1.0.0")).catch(() => {});
    }

    if (window.electronAPI?.onUpdateStatus) {
      const cleanup = window.electronAPI.onUpdateStatus((data) => {
        setStatus(data.status);
        if (data.status === "checking") {
          setChecking(true);
          setErrorMessage("");
        } else if (data.status === "available") {
          setChecking(false);
          setUpdateInfo({ version: data.version, releaseDate: data.releaseDate });
        } else if (data.status === "not-available") {
          setChecking(false);
        } else if (data.status === "downloading") {
          setChecking(false);
          setDownloadProgress(data.percent ?? 0);
        } else if (data.status === "downloaded") {
          setChecking(false);
          setUpdateInfo({ version: data.version });
        } else if (data.status === "error") {
          setChecking(false);
          setErrorMessage(data.message || "Impossible de vérifier les mises à jour");
        }
      });
      return cleanup;
    }
  }, []);

  // Backups query
  const {
    data: backupsData,
    isLoading: backupsLoading,
    isRefetching: backupsRefetching,
    refetch: refetchBackups,
  } = useQuery<BackupsResponse>({
    queryKey: ["desktop", "backups"],
    queryFn: () => api.get("/desktop/backups/").then((r) => r.data),
  });

  // Create manual backup mutation
  const createBackupMutation = useMutation({
    mutationFn: () => api.post("/desktop/backups/create/").then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["desktop", "backups"] });
      setToast({
        type: "success",
        message: data?.message || "Nouvelle sauvegarde créée avec succès !",
      });
    },
    onError: (err: any) => {
      setToast({
        type: "error",
        message: err?.response?.data?.detail || "Erreur lors de la création de la sauvegarde.",
      });
    },
  });

  // Delete backup mutation
  const deleteBackupMutation = useMutation({
    mutationFn: (filename: string) =>
      api.delete(`/desktop/backups/${encodeURIComponent(filename)}/`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["desktop", "backups"] });
      setToast({
        type: "success",
        message: "Fichier de sauvegarde supprimé.",
      });
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      setToast({
        type: "error",
        message: err?.response?.data?.detail || "Erreur lors de la suppression.",
      });
    },
  });

  // Download backup handler
  const handleDownloadBackup = async (filename: string) => {
    try {
      setDownloadingFile(filename);
      const response = await api.get(`/desktop/backups/${encodeURIComponent(filename)}/download/`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setToast({
        type: "success",
        message: `Téléchargement de ${filename} terminé.`,
      });
    } catch {
      setToast({
        type: "error",
        message: "Échec du téléchargement de la sauvegarde.",
      });
    } finally {
      setDownloadingFile(null);
    }
  };

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.checkForUpdates) return;
    setChecking(true);
    setStatus("checking");
    setErrorMessage("");
    try {
      const res = await window.electronAPI.checkForUpdates();
      if (res?.status === "error") {
        setStatus("error");
        setErrorMessage(res.message || "Erreur lors de la vérification");
      } else if (res?.status === "dev-mode") {
        setStatus("not-available");
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err?.message || "Erreur réseau");
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = () => {
    if (window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate();
    }
  };

  const isDesktop = !!window.electronAPI?.isDesktop;
  const backups = backupsData?.backups ?? [];
  const latestBackup = backupsData?.last_backup;

  const formatRelativeTime = (dateStr?: string | null) => {
    if (!dateStr) return "Aucune sauvegarde";
    try {
      const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
      if (diff < 60) return "À l'instant";
      if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
      if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)} h`;
      const days = Math.floor(diff / 86400);
      if (days === 1) return "Hier";
      if (days < 7) return `Il y a ${days} jours`;
      return new Date(dateStr).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-8">
      {/* Toast Feedback */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border animate-in fade-in slide-in-from-bottom-2 duration-200",
            toast.type === "success"
              ? "bg-slate-900 text-white border-slate-800"
              : "bg-rose-900 text-white border-rose-800"
          )}
        >
          <div
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
              toast.type === "success" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-300"
            )}
          >
            {toast.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          </div>
          <p className="text-xs font-semibold">{toast.message}</p>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── 1. Database Backups Section (Core Feature) ────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary-50 text-primary-600 border border-primary-200/60 flex items-center justify-center shrink-0">
                <Database size={16} />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                {t("settings.backup_title", "Sauvegardes de la base de données")}
              </h3>
              <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                SQLite WAL
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              {t(
                "settings.backup_desc",
                "Sauvegardes locales automatiques et manuelles. Vos ventes, stocks et clients sont instantanément sécurisés sans interrompre l'activité de la caisse."
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={() => refetchBackups()}
              disabled={backupsLoading || backupsRefetching}
              className="btn-secondary py-2 px-3 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
              title="Rafraîchir la liste"
            >
              <RefreshCw size={13} className={cn((backupsLoading || backupsRefetching) && "animate-spin text-primary-600")} />
              <span>Actualiser</span>
            </button>

            {isDesktop && (
              <button
                onClick={() => window.electronAPI?.openBackupsFolder?.()}
                className="btn-secondary py-2 px-3 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
                title="Ouvrir dans l'Explorateur Windows"
              >
                <FolderArchive size={13} className="text-slate-500" />
                <span>Ouvrir dossier</span>
              </button>
            )}

            <button
              onClick={() => createBackupMutation.mutate()}
              disabled={createBackupMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-primary-600 hover:bg-primary-700 text-white shadow-xs hover:shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {createBackupMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              <span>{t("settings.backup_create_now", "Créer une sauvegarde maintenant")}</span>
            </button>
          </div>
        </div>

        {/* Status Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Last backup */}
          <div className="p-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs flex items-center justify-between">
            <div>
              <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                {t("settings.backup_last", "Dernière sauvegarde")}
              </div>
              <div className="text-sm font-bold text-slate-900 mt-1">
                {backupsLoading ? "..." : formatRelativeTime(latestBackup)}
              </div>
              <div className="text-2xs text-slate-400 font-mono mt-0.5 truncate max-w-[180px]">
                {backups[0]?.filename || "Aucune sauvegarde générée"}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} />
            </div>
          </div>

          {/* Schedule */}
          <div className="p-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs flex items-center justify-between">
            <div>
              <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                {t("settings.backup_schedule", "Sauvegarde automatique")}
              </div>
              <div className="text-sm font-bold text-slate-900 mt-1">Quotidienne</div>
              <div className="text-2xs text-slate-400 mt-0.5">
                {backupsData?.max_copies ? `Rétention glissante : ${backupsData.max_copies} copies` : "14 jours"}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
              <Clock size={18} />
            </div>
          </div>

          {/* Data Location */}
          <div className="p-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs flex items-center justify-between">
            <div>
              <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                {t("settings.backup_location", "Emplacement des données")}
              </div>
              <div className="text-sm font-bold text-slate-900 mt-1">Base active (SQLite)</div>
              <div className="text-2xs text-slate-400 font-mono mt-0.5 truncate max-w-[180px]" title={backupsData?.backups_dir}>
                {backupsData?.backups_dir || "%ProgramData%\\ShoeDZ\\backups"}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 border border-slate-200/60 flex items-center justify-center shrink-0">
              <HardDrive size={18} />
            </div>
          </div>
        </div>

        {/* Backups Table */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Fichiers de sauvegarde ({backups.length})
            </span>
            <span className="text-2xs text-slate-400 font-medium">Format standard SQLite 3 (.sqlite3)</span>
          </div>

          {backupsLoading ? (
            <div className="p-12 text-center text-slate-400">
              <Loader2 size={24} className="animate-spin mx-auto text-primary-600 mb-2" />
              <p className="text-xs font-medium">Chargement des sauvegardes...</p>
            </div>
          ) : backups.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center border border-slate-200/70">
                <Database size={22} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  {t("settings.backup_no_backups", "Aucune sauvegarde disponible")}
                </h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                  {t(
                    "settings.backup_no_backups_desc",
                    "Cliquez sur le bouton ci-dessus pour générer votre première sauvegarde manuelle."
                  )}
                </p>
              </div>
              <button
                onClick={() => createBackupMutation.mutate()}
                disabled={createBackupMutation.isPending}
                className="btn-secondary py-2 px-4 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} />
                <span>Créer une première sauvegarde</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-semibold uppercase tracking-wider text-2xs">
                    <th className="py-3 px-4">{t("settings.backup_filename", "Fichier de sauvegarde")}</th>
                    <th className="py-3 px-4">{t("settings.backup_date", "Date de création")}</th>
                    <th className="py-3 px-4 text-end">{t("settings.backup_size", "Taille")}</th>
                    <th className="py-3 px-4 text-center">{t("settings.backup_status", "État")}</th>
                    <th className="py-3 px-4 text-end">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {backups.map((b, index) => {
                    const isLatest = index === 0;
                    return (
                      <tr key={b.filename} className="hover:bg-slate-50/70 transition-colors group">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center border border-slate-200/60 shrink-0 group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors">
                              <FileText size={15} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-semibold text-slate-900">{b.filename}</span>
                                {isLatest && (
                                  <span className="px-1.5 py-0.5 rounded-md font-bold text-3xs uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Dernière
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-600">
                          {formatDateTime(b.created_at)}
                        </td>
                        <td className="py-3.5 px-4 text-end font-mono font-bold text-slate-900">
                          {b.size_human}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={11} /> Prête
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-end">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Download Button */}
                            <button
                              onClick={() => handleDownloadBackup(b.filename)}
                              disabled={downloadingFile === b.filename}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-primary-700 hover:bg-primary-50 border border-transparent hover:border-primary-200 transition-colors cursor-pointer"
                              title={t("settings.backup_download", "Télécharger une copie (.sqlite3)")}
                            >
                              {downloadingFile === b.filename ? (
                                <Loader2 size={15} className="animate-spin text-primary-600" />
                              ) : (
                                <Download size={15} />
                              )}
                            </button>

                            {/* Delete Button / Confirm */}
                            {deleteTarget === b.filename ? (
                              <div className="flex items-center gap-1 animate-in fade-in duration-150">
                                <button
                                  onClick={() => deleteBackupMutation.mutate(b.filename)}
                                  disabled={deleteBackupMutation.isPending}
                                  className="px-2 py-1 text-2xs font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer shadow-2xs"
                                >
                                  {deleteBackupMutation.isPending ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    "Supprimer"
                                  )}
                                </button>
                                <button
                                  onClick={() => setDeleteTarget(null)}
                                  className="px-2 py-1 text-2xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                                >
                                  Annuler
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteTarget(b.filename)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                                title={t("settings.backup_delete", "Supprimer")}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Security / Safety Advice Card */}
        <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/80 flex items-start gap-3.5 text-xs text-amber-900">
          <ShieldCheck size={20} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Bonnes pratiques de sécurité pour votre commerce</p>
            <p className="text-amber-800 leading-relaxed">
              {t(
                "settings.backup_safety_tip",
                "Copiez régulièrement une sauvegarde récente sur une clé USB ou un disque externe. En cas de panne matérielle de votre PC, vous pourrez restaurer immédiatement l'intégralité de vos ventes, crédits clients et stocks."
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ── 2. Application & Mises à Jour (Electron Auto-Updater) ─────────────── */}
      <div className="space-y-4 pt-4 border-t border-slate-100">
        {/* App Overview Card */}
        <div className="p-6 rounded-2xl border border-slate-200/80 bg-slate-50/70 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary-600 text-white flex items-center justify-center text-2xl shadow-xs">
              👟
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold font-sans tracking-tight text-slate-900">ShoeDZ Desktop POS</h3>
                <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-primary-50 text-primary-700 border border-primary-200">
                  {isDesktop ? "Windows Edition" : "Web Edition"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Version installée : <strong className="text-slate-900 font-mono">v{version}</strong>
              </p>
            </div>
          </div>

          {isDesktop ? (
            <button
              onClick={handleCheckForUpdates}
              disabled={checking || status === "downloading"}
              className="btn-secondary py-2 px-3.5 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-2xs self-stretch md:self-auto justify-center cursor-pointer"
            >
              <RefreshCw size={14} className={checking ? "animate-spin text-primary-600" : ""} />
              <span>{checking ? "Vérification..." : "Vérifier les mises à jour"}</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200">
              <Info size={14} className="text-slate-400" />
              <span>Mode navigateur web local</span>
            </div>
          )}
        </div>

        {/* Update Status Card (only active when in Electron) */}
        {isDesktop && (
          <div className="p-6 rounded-2xl border border-slate-200/80 bg-white shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor size={18} className="text-primary-600" />
                <h4 className="text-sm font-semibold text-slate-900">État des mises à jour logicielles</h4>
              </div>

              {/* Status Badge */}
              {status === "checking" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <RefreshCw size={12} className="animate-spin" /> Recherche en cours...
                </span>
              )}
              {status === "not-available" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={13} /> Votre application est à jour
                </span>
              )}
              {status === "available" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                  <Download size={13} /> Nouvelle version v{updateInfo?.version} disponible
                </span>
              )}
              {status === "downloading" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <Download size={13} className="animate-bounce" /> Téléchargement ({downloadProgress}%)
                </span>
              )}
              {status === "downloaded" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={13} /> Prête pour installation
                </span>
              )}
              {status === "error" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                  <AlertCircle size={13} /> Erreur de vérification
                </span>
              )}
              {status === ("idle" as any) && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
                  Canal de mise à jour stable (GitHub Releases)
                </span>
              )}
            </div>

            {/* Progress bar during download */}
            {status === "downloading" && (
              <div className="space-y-1.5 pt-1">
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="bg-primary-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                <p className="text-2xs text-slate-500 text-right font-mono font-medium">{downloadProgress}% téléchargé</p>
              </div>
            )}

            {/* Downloaded: Call to Action */}
            {status === "downloaded" && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
                <div>
                  <p className="text-sm font-bold text-emerald-900">
                    La version {updateInfo?.version || "récente"} est téléchargée et prête !
                  </p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Cliquez sur le bouton ci-contre pour redémarrer l'application et appliquer automatiquement la mise à jour.
                  </p>
                </div>
                <button
                  onClick={handleInstallUpdate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-xs shrink-0 transition-colors cursor-pointer"
                >
                  <Download size={14} />
                  <span>Redémarrer et appliquer</span>
                </button>
              </div>
            )}

            {/* Error message */}
            {status === "error" && errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {errorMessage}
              </div>
            )}
          </div>
        )}

        {/* ── 3. Diagnostics & Données Locales ──────────────────────────────── */}
        <div className="p-6 rounded-2xl border border-slate-200/80 bg-white shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <HardDrive size={18} className="text-primary-600" />
            <h4 className="text-sm font-semibold text-slate-900">Diagnostics et Données Locales</h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center text-slate-600 shadow-2xs">
                  <FolderArchive size={18} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-900">Sauvegardes automatiques</p>
                  <p className="text-2xs text-slate-400 font-mono mt-0.5 truncate max-w-[200px]" title={backupsData?.backups_dir}>
                    {backupsData?.backups_dir || "C:\\ProgramData\\ShoeDZ\\backups"}
                  </p>
                </div>
              </div>
              {isDesktop && (
                <button
                  onClick={() => window.electronAPI?.openBackupsFolder?.()}
                  className="p-2 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded-xl transition-colors cursor-pointer"
                  title="Ouvrir dans l'Explorateur Windows"
                >
                  <ExternalLink size={15} />
                </button>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/70 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center text-slate-600 shadow-2xs">
                  <FileText size={18} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-900">Journaux techniques (Logs)</p>
                  <p className="text-2xs text-slate-400 font-mono mt-0.5">C:\ProgramData\ShoeDZ\logs</p>
                </div>
              </div>
              {isDesktop && (
                <button
                  onClick={() => window.electronAPI?.openLogsFolder?.()}
                  className="p-2 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded-xl transition-colors cursor-pointer"
                  title="Ouvrir dans l'Explorateur Windows"
                >
                  <ExternalLink size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

