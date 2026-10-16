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
      <div className="p-12 text-center text-slate-400">
        <Monitor size={40} className="mx-auto mb-3 text-slate-300" />
        <h3 className="font-semibold text-slate-700 text-sm">Application Web uniquement</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          Cette section est disponible uniquement sur l'application installée ShoeDZ pour Windows.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                Windows Edition
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Version installée : <strong className="text-slate-900 font-mono">v{version}</strong>
            </p>
          </div>
        </div>

        <button
          onClick={handleCheckForUpdates}
          disabled={checking || status === "downloading"}
          className="btn-secondary py-2 px-3.5 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-2xs self-stretch md:self-auto justify-center"
        >
          <RefreshCw size={14} className={checking ? "animate-spin text-primary-600" : ""} />
          <span>{checking ? "Vérification..." : "Vérifier les mises à jour"}</span>
        </button>
      </div>

      {/* Update Status Card */}
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
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-xs shrink-0 transition-colors"
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

        {/* Safety Note */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-3 text-xs text-slate-600">
          <ShieldCheck size={18} className="text-primary-600 shrink-0 mt-0.5" />
          <p>
            Toutes vos données (catalogue, stocks, ventes et clients) sont stockées dans{" "}
            <code className="text-2xs font-mono font-semibold bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-800">
              %ProgramData%\ShoeDZ
            </code>{" "}
            et restent 100% préservées lors de chaque mise à jour.
          </p>
        </div>
      </div>

      {/* Local Data & Diagnostics */}
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
                <p className="text-2xs text-slate-400 font-mono mt-0.5">C:\ProgramData\ShoeDZ\backups</p>
              </div>
            </div>
            <button
              onClick={() => window.electronAPI?.openBackupsFolder?.()}
              className="p-2 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded-xl transition-colors"
              title="Ouvrir dans l'Explorateur Windows"
            >
              <ExternalLink size={15} />
            </button>
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
            <button
              onClick={() => window.electronAPI?.openLogsFolder?.()}
              className="p-2 text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded-xl transition-colors"
              title="Ouvrir dans l'Explorateur Windows"
            >
              <ExternalLink size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
