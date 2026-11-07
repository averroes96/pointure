import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  HardDrive,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  Printer,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  FolderOpen,
  Info,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn, escapeHtml } from "@/lib/utils";
import { openPrintPopup } from "@/lib/printPopup";
import { useAuth } from "@/features/auth/AuthContext";

export interface ExternalBackupConfig {
  destination_dir: string;
  encrypt: boolean;
  keep_external: number;
  has_passphrase: boolean;
  last_external_backup_at: string | null;
  last_external_error: string | null;
  last_external_file: string | null;
  is_destination_connected: boolean;
  is_older_than_3_days: boolean;
}

interface ExternalBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: ExternalBackupConfig;
  onSuccess: (updatedConfig: ExternalBackupConfig) => void;
}

export default function ExternalBackupModal({
  isOpen,
  onClose,
  config,
  onSuccess,
}: ExternalBackupModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Mode: "config" or "recovery_sheet"
  const [step, setStep] = useState<"config" | "recovery_sheet">("config");

  // Form State
  const [destinationDir, setDestinationDir] = useState(config?.destination_dir || "");
  const [encrypt, setEncrypt] = useState(config?.encrypt ?? true);
  const [keepExternal, setKeepExternal] = useState<number>(config?.keep_external ?? 30);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Recovery Sheet State
  const [savedPassphrase, setSavedPassphrase] = useState("");
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [savedConfig, setSavedConfig] = useState<ExternalBackupConfig | null>(null);

  // Form submission state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep("config");
      setDestinationDir(config?.destination_dir || "");
      setEncrypt(config?.encrypt ?? true);
      setKeepExternal(config?.keep_external ?? 30);
      setPassphrase("");
      setPassphraseConfirm("");
      setShowPassphrase(false);
      setError(null);
      setCopied(false);
      setAcknowledged(false);
      setSavedPassphrase("");
      setSavedConfig(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleCopyPassphrase = async () => {
    try {
      await navigator.clipboard.writeText(savedPassphrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handlePrintRecoverySheet = () => {
    const storeName = user?.tenant?.name || "ShoeDZ Pointure";
    const dateStr = new Date().toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const safeStore = escapeHtml(storeName);
    const safeDate = escapeHtml(dateStr);
    const safePassphrase = escapeHtml(savedPassphrase);

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Fiche de Récupération Sauvegarde - ShoeDZ</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 40px;
      color: #0f172a;
      line-height: 1.5;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      color: #991b1b;
      background: #fee2e2;
      border: 1px solid #fecaca;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 20px;
      margin: 12px 0 4px 0;
      color: #0f172a;
    }
    .meta {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 20px;
    }
    .passphrase-box {
      background: #f8fafc;
      border: 2px dashed #0284c7;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      margin: 24px 0;
    }
    .passphrase-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #0369a1;
      margin-bottom: 8px;
    }
    .passphrase-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: 0.1em;
      word-break: break-all;
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 16px;
      margin-top: 24px;
      font-size: 12px;
      color: #92400e;
    }
    .warning strong {
      color: #78350f;
    }
    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="badge">Document Strictement Confidentiel</span>
    <h1>FICHE DE RÉCUPÉRATION DE SAUVEGARDE CHIFFRÉE</h1>
    <div class="meta">
      <strong>Établissement :</strong> ${safeStore} &nbsp;|&nbsp; 
      <strong>Date d'émission :</strong> ${safeDate}
    </div>
  </div>

  <div class="passphrase-box">
    <div class="passphrase-title">Phrase de passe de déchiffrement (AES-256-GCM)</div>
    <div class="passphrase-code">${safePassphrase}</div>
  </div>

  <div class="warning">
    <strong>AVERTISSEMENT CRITIQUE DE SÉCURITÉ :</strong><br/>
    Conservez cette fiche imprimée dans un endroit physique sécurisé hors du point de vente (ex: coffre-fort de direction).<br/>
    En cas de panne, sinistre ou vol, cette phrase de passe est <strong>l'unique clé</strong> permettant de restaurer vos sauvegardes chiffrées (.shodzbak).<br/>
    Pour des raisons de sécurité cryptographique, aucun technicien ni support ShoeDZ ne peut récupérer ou réinitialiser ce mot de passe.
  </div>

  <div class="footer">
    ShoeDZ Pointure Desktop — Solution de gestion certifiée hors-ligne
  </div>
</body>
</html>`;

    openPrintPopup(html, "210mm");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate inputs
    const trimmedDir = destinationDir.trim();

    if (encrypt) {
      if (!config?.has_passphrase && !passphrase) {
        setError(
          t(
            "desktop.external_passphrase_required_error",
            "Une phrase de passe de chiffrement est requise pour activer le chiffrement."
          )
        );
        return;
      }

      if (passphrase) {
        if (passphrase.length < 8) {
          setError(
            t(
              "desktop.external_passphrase_min_len_error",
              "La phrase de passe doit comporter au moins 8 caractères."
            )
          );
          return;
        }

        if (passphrase !== passphraseConfirm) {
          setError(
            t(
              "desktop.external_passphrase_mismatch_error",
              "Les phrases de passe ne correspondent pas."
            )
          );
          return;
        }
      }
    }

    setLoading(true);

    try {
      const payload: Record<string, any> = {
        destination_dir: trimmedDir,
        encrypt: encrypt,
        keep_external: Number(keepExternal) || 30,
      };

      if (passphrase) {
        payload.passphrase = passphrase;
        payload.passphrase_confirm = passphraseConfirm;
      }

      const res = await api.post("/desktop/backups/config/", payload);
      const updatedConfig = res.data?.external_config;

      if (passphrase) {
        // Show the recovery sheet step
        setSavedPassphrase(passphrase);
        setSavedConfig(updatedConfig);
        setStep("recovery_sheet");
      } else {
        // No new passphrase was set; finish directly
        onSuccess(updatedConfig);
        onClose();
      }
    } catch (err: any) {
      setError(
        getApiError(err) ||
          t("desktop.external_config_save_error", "Erreur lors de l'enregistrement de la configuration.")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFinishRecovery = () => {
    if (savedConfig) {
      onSuccess(savedConfig);
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-900 dark:text-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-950/60 text-primary-700 dark:text-primary-400 flex items-center justify-center shrink-0 shadow-xs border border-primary-200 dark:border-primary-900/60">
            {step === "config" ? (
              <HardDrive size={24} className="stroke-[2.2]" />
            ) : (
              <ShieldCheck size={24} className="stroke-[2.2]" />
            )}
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {step === "config"
                ? t("desktop.external_modal_title", "Configuration de la Sauvegarde Externe")
                : t("desktop.external_recovery_sheet_title", "FICHE DE RÉCUPÉRATION DE SAUVEGARDE")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {step === "config"
                ? t(
                    "desktop.external_modal_subtitle",
                    "Configurez la réplication automatique de vos sauvegardes vers une clé USB ou un disque externe."
                  )
                : t(
                    "desktop.external_recovery_sheet_confidential",
                    "Document strictement confidentiel — À conserver hors du magasin"
                  )}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2.5 animate-in fade-in duration-150">
              <AlertTriangle size={16} className="shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {step === "config" ? (
            <form id="external-backup-form" onSubmit={handleSubmit} className="space-y-5">
              {/* Destination Directory */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {t("desktop.external_dest_input_label", "Chemin du dossier de destination (ex: E:\\Sauvegardes)")}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <FolderOpen size={16} />
                  </div>
                  <input
                    type="text"
                    value={destinationDir}
                    onChange={(e) => setDestinationDir(e.target.value)}
                    placeholder={t(
                      "desktop.external_dest_input_placeholder",
                      "Ex: D:\\Sauvegardes_ShoeDZ ou E:\\Backups"
                    )}
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                  />
                </div>
                <p className="text-2xs text-slate-400 mt-1">
                  {t(
                    "desktop.external_dest_help",
                    "Indiquez la lettre de lecteur ou le dossier de votre clé USB ou disque dur externe. S'il est déconnecté, la sauvegarde locale continuera normalement."
                  )}
                </p>
              </div>

              {/* Encryption Toggle */}
              <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Lock size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {t("desktop.external_encrypt_toggle_label", "Activer le chiffrement AES-256-GCM (Recommandé)")}
                      </div>
                      <div className="text-2xs text-slate-500 dark:text-slate-400">
                        {t(
                          "desktop.external_encrypt_toggle_desc",
                          "Vos fichiers seront protégés par une phrase de passe et sauvegardés au format sécurisé .shodzbak."
                        )}
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={encrypt}
                      onChange={(e) => setEncrypt(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                {encrypt && (
                  <div className="pt-3 border-t border-slate-200/60 dark:border-slate-700/60 space-y-3">
                    {config?.has_passphrase && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/50 text-2xs">
                        <Info size={14} className="shrink-0" />
                        <span>
                          {t(
                            "desktop.external_passphrase_change_hint",
                            "Laissez vide pour conserver la phrase de passe existante, ou saisissez une nouvelle phrase pour la remplacer."
                          )}
                        </span>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        {t("desktop.external_passphrase_label", "Phrase de passe de chiffrement")}
                        {!config?.has_passphrase && <span className="text-rose-500 ml-1">*</span>}
                      </label>
                      <div className="relative">
                        <input
                          type={showPassphrase ? "text" : "password"}
                          value={passphrase}
                          onChange={(e) => setPassphrase(e.target.value)}
                          placeholder={
                            config?.has_passphrase
                              ? "•••••••••••• (Inchangée)"
                              : t("desktop.external_passphrase_placeholder", "Phrase secrète (ex: CleSecuriseeMagasin2026)")
                          }
                          className="w-full pl-3 pr-9 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 font-mono"
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
                        {t("desktop.external_passphrase_min_len", "Au moins 8 caractères recommandés.")}
                      </p>
                    </div>

                    {passphrase.length > 0 && (
                      <div className="animate-in fade-in duration-150">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {t("desktop.external_passphrase_confirm_label", "Confirmer la phrase de passe")}
                          <span className="text-rose-500 ml-1">*</span>
                        </label>
                        <input
                          type={showPassphrase ? "text" : "password"}
                          value={passphraseConfirm}
                          onChange={(e) => setPassphraseConfirm(e.target.value)}
                          placeholder={t(
                            "desktop.external_passphrase_confirm_placeholder",
                            "Retapez la même phrase de passe"
                          )}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 font-mono"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Retention limit */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {t(
                    "desktop.external_keep_label",
                    "Nombre de sauvegardes à conserver sur le support externe"
                  )}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={keepExternal}
                    onChange={(e) => setKeepExternal(parseInt(e.target.value) || 30)}
                    className="w-32 px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t("desktop.external_retention_copies", { count: keepExternal })}
                  </span>
                </div>
                <p className="text-2xs text-slate-400 mt-1">
                  {t(
                    "desktop.external_keep_hint",
                    "Les sauvegardes les plus anciennes au-delà de cette limite seront automatiquement supprimées du support externe."
                  )}
                </p>
              </div>
            </form>
          ) : (
            /* Printable Recovery Sheet Step */
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Sheet Preview Card */}
              <div className="p-5 rounded-2xl border-2 border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 space-y-4">
                <div className="flex items-center justify-between border-b border-sky-200 dark:border-sky-900/60 pb-3">
                  <div>
                    <span className="px-2 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                      Document Strictement Confidentiel
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      {user?.tenant?.name || "ShoeDZ Pointure"}
                    </h4>
                  </div>
                  <div className="text-2xs text-slate-500 dark:text-slate-400 font-medium">
                    {new Date().toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-2xs font-semibold text-sky-800 dark:text-sky-300 uppercase tracking-wider">
                    {t("desktop.external_recovery_passphrase", "Phrase de passe de restauration :")}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-900">
                    <span className="font-mono text-base font-bold text-slate-900 dark:text-white tracking-wider break-all select-all">
                      {savedPassphrase}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyPassphrase}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                      title={t("common.copy", "Copier")}
                    >
                      {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                    </button>
                  </div>
                  {copied && (
                    <p className="text-3xs text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
                      {t("desktop.external_recovery_copied", "Copié dans le presse-papier !")}
                    </p>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/50 text-2xs text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={13} className="text-amber-700 dark:text-amber-400 shrink-0" />
                    <span>Avertissement Critique</span>
                  </div>
                  <p className="leading-relaxed">
                    {t(
                      "desktop.external_recovery_warning",
                      "IMPORTANT : En cas de perte de cette phrase de passe, aucune sauvegarde chiffrée (.shodzbak) ne pourra être restaurée. Même l'équipe technique ne peut contourner ce chiffrement."
                    )}
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handlePrintRecoverySheet}
                    className="btn-secondary py-2 px-3 text-xs font-semibold rounded-xl inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Printer size={15} />
                    <span>{t("desktop.external_recovery_print", "Imprimer la fiche de récupération")}</span>
                  </button>
                </div>
              </div>

              {/* Acknowledgment Checkbox */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 rounded text-primary-600 focus:ring-primary-500 h-4 w-4 border-slate-300 dark:border-slate-600 dark:bg-slate-700"
                />
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200 select-none">
                  {t(
                    "desktop.external_recovery_ack",
                    "J'ai bien noté ou imprimé cette phrase de passe en lieu sûr hors du magasin."
                  )}
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50/80 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
          {step === "config" ? (
            <>
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
                form="external-backup-form"
                disabled={loading}
                className="inline-flex items-center gap-2 py-2 px-4 text-xs font-semibold rounded-xl bg-primary-600 hover:bg-primary-700 text-white shadow-xs transition-all disabled:opacity-50 cursor-pointer"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                <span>{t("common.save", "Enregistrer")}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleFinishRecovery}
              disabled={!acknowledged}
              className="inline-flex items-center gap-2 py-2 px-5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              <Check size={14} />
              <span>{t("desktop.external_recovery_finish", "Terminer et valider")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

