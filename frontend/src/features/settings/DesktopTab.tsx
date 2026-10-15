import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import type { UpdateStatusData } from "@/vite-env";

export default function DesktopTab() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string>("1.0.0");
  const [status, setStatus] = useState<UpdateStatusData["status"]>("idle" as any);
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; releaseDate?: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [checking, setChecking] = useState<boolean>(false);

  useEffect(() => {
    // 1. Fetch current application version from Electron main process
    if (window.electronAPI?.getVersion) {
      window.electronAPI.getVersion().then((v) => setVersion(v || "1.0.0")).catch(() => {});
    }

    // 2. Listen to auto-updater lifecycle events
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

  if (!isDesktop) {
    return (
      <div className="p-6 text-center text-text-muted">
        <Monitor size={36} className="mx-auto mb-2 text-text-muted/60" />
        <p className="text-sm">Cette section est disponible uniquement sur l'application installée ShoeDZ pour Windows.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* App Overview Card */}
      <div className="p-5 rounded-2xl border border-border bg-surface-subtle flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary-500 text-white flex items-center justify-center text-2xl shadow-sm">
            👟
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-text-primary">ShoeDZ Desktop POS</h3>
              <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-primary-100 text-primary-700">
                Windows Edition
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Version installée : <strong className="text-text-primary font-mono">v{version}</strong>
            </p>
          </div>
        </div>

        <button
          onClick={handleCheckForUpdates}
          disabled={checking || status === "downloading"}
          className="btn-secondary btn-sm flex items-center gap-1.5 self-stretch md:self-auto justify-center"
        >
          <RefreshCw size={14} className={checking ? "animate-spin text-primary-500" : ""} />
          <span>{checking ? "Vérification..." : "Vérifier les mises à jour"}</span>
        </button>
      </div>

      {/* Update Status Card */}
      <div className="p-5 rounded-2xl border border-border bg-white shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor size={18} className="text-primary-500" />
            <h4 className="text-sm font-semibold text-text-primary">État des mises à jour logicielles</h4>
          </div>

          {/* Status Badge */}
          {status === "checking" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              <RefreshCw size={12} className="animate-spin" /> Recherche en cours...
            </span>
          )}
          {status === "not-available" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={13} /> Votre application est à jour
            </span>
          )}
          {status === "available" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
              <Download size={13} /> Nouvelle version v{updateInfo?.version} disponible
            </span>
          )}
          {status === "downloading" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              <Download size={13} className="animate-bounce" /> Téléchargement ({downloadProgress}%)
            </span>
          )}
          {status === "downloaded" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={13} /> Prête pour installation
            </span>
          )}
          {status === "error" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">
              <AlertCircle size={13} /> Erreur de vérification
            </span>
          )}
          {status === ("idle" as any) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs text-text-muted">
              Canal de mise à jour stable (GitHub Releases)
            </span>
          )}
        </div>

        {/* Progress bar during download */}
        {status === "downloading" && (
          <div className="space-y-1.5 pt-1">
            <div className="w-full bg-surface-subtle h-2.5 rounded-full overflow-hidden border border-border">
              <div
                className="bg-primary-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="text-2xs text-text-muted text-right font-mono">{downloadProgress}% téléchargé</p>
          </div>
        )}

        {/* Downloaded: Call to Action */}
        {status === "downloaded" && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-emerald-900">
                La version {updateInfo?.version || "récente"} est téléchargée et prête !
              </p>
              <p className="text-xs text-emerald-700">
                Cliquez sur le bouton ci-contre pour redémarrer l'application et appliquer automatiquement la mise à jour.
              </p>
            </div>
            <button
              onClick={handleInstallUpdate}
              className="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 shadow-xs shrink-0"
            >
              <Download size={14} />
              <span>Redémarrer et appliquer</span>
            </button>
          </div>
        )}

        {/* Error message */}
        {status === "error" && errorMessage && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
            {errorMessage}
          </div>
        )}

        {/* Safety Note */}
        <div className="p-3.5 rounded-xl bg-surface-subtle border border-border flex items-start gap-2.5 text-xs text-text-muted">
          <ShieldCheck size={16} className="text-primary-500 shrink-0 mt-0.5" />
          <p>
            Toutes vos données (catalogue, stocks, ventes et clients) sont stockées dans{" "}
            <code className="text-2xs font-mono bg-white px-1 py-0.5 rounded border border-border text-text-primary">
              %ProgramData%\ShoeDZ
            </code>{" "}
            et restent 100% préservées lors de chaque mise à jour.
          </p>
        </div>
      </div>

      {/* Local Data & Diagnostics */}
      <div className="p-5 rounded-2xl border border-border bg-white shadow-2xs space-y-4">
        <div className="flex items-center gap-2">
          <HardDrive size={18} className="text-primary-500" />
          <h4 className="text-sm font-semibold text-text-primary">Diagnostics et Données Locales</h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl border border-border bg-surface-subtle flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white border border-border flex items-center justify-center text-text-secondary">
                <FolderArchive size={18} />
              </div>
              <div>
                <p className="text-xs font-semibold text-text-primary">Sauvegardes automatiques</p>
                <p className="text-2xs text-text-muted font-mono">C:\ProgramData\ShoeDZ\backups</p>
              </div>
            </div>
            <button
              onClick={() => window.electronAPI?.openBackupsFolder?.()}
              className="btn-ghost btn-sm text-primary-600 hover:text-primary-700"
              title="Ouvrir dans l'Explorateur Windows"
            >
              <ExternalLink size={14} />
            </button>
          </div>

          <div className="p-3.5 rounded-xl border border-border bg-surface-subtle flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white border border-border flex items-center justify-center text-text-secondary">
                <FileText size={18} />
              </div>
              <div>
                <p className="text-xs font-semibold text-text-primary">Journaux techniques (Logs)</p>
                <p className="text-2xs text-text-muted font-mono">C:\ProgramData\ShoeDZ\logs</p>
              </div>
            </div>
            <button
              onClick={() => window.electronAPI?.openLogsFolder?.()}
              className="btn-ghost btn-sm text-primary-600 hover:text-primary-700"
              title="Ouvrir dans l'Explorateur Windows"
            >
              <ExternalLink size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
