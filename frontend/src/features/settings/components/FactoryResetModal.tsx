import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Trash2,
  X,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ShieldAlert,
  Database,
  Archive,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

interface FactoryResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessPurge?: (backupCreated: string | null) => void;
}

export default function FactoryResetModal({
  isOpen,
  onClose,
  onSuccessPurge,
}: FactoryResetModalProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  const [mode, setMode] = useState<"all" | "transactions_only">("all");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const isConfirmationValid = confirmationInput.trim().toUpperCase() === "REINITIALISER";
  const canSubmit = password.length > 0 && isConfirmationValid && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setLoading(true);

    try {
      const response = await api.post("/desktop/reset/", {
        password,
        confirmation: confirmationInput.trim().toUpperCase(),
        mode,
      });

      const data = response.data;

      if (mode === "all") {
        setCompletedNotice(
          "Base de données réinitialisée avec succès. Redirection vers l'assistant de configuration initiale..."
        );
        setTimeout(() => {
          logout();
          window.location.href = "/setup";
        }, 1500);
      } else {
        if (onSuccessPurge) {
          onSuccessPurge(data.backup_created);
        }
        onClose();
      }
    } catch (err: any) {
      setError(getApiError(err) || "La réinitialisation a échoué. Vérifiez votre mot de passe.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-rose-100 overflow-hidden text-slate-900">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-rose-50/80 to-white border-b border-rose-100/70 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 shadow-xs border border-rose-200">
            <ShieldAlert size={26} className="stroke-[2.2]" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              Zone de Danger : Réinitialisation
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Effacer les enregistrements et repartir de zéro. Cette action est irréversible.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading || !!completedNotice}
            className="absolute top-5 end-5 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 cursor-pointer"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Success splash during full wipe */}
        {completedNotice ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto animate-pulse">
              <CheckCircle2 size={36} />
            </div>
            <h4 className="text-base font-bold text-slate-900">Remise à zéro effectuée !</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              {completedNotice}
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-primary-600 font-semibold pt-2">
              <Loader2 size={16} className="animate-spin" />
              <span>Chargement de l'assistant de configuration...</span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Error Message */}
            {error && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200/90 flex items-start gap-3 text-xs text-rose-900">
                <AlertTriangle size={16} className="shrink-0 text-rose-600 mt-0.5" />
                <span className="font-medium">{error}</span>
              </div>
            )}

            {/* Mode selection radio cards */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Type de réinitialisation
              </label>

              <div className="grid grid-cols-1 gap-2.5">
                {/* Mode: ALL */}
                <label
                  className={cn(
                    "p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3",
                    mode === "all"
                      ? "bg-rose-50/70 border-rose-300 ring-2 ring-rose-500/20 shadow-xs"
                      : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                  )}
                >
                  <input
                    type="radio"
                    name="reset_mode"
                    value="all"
                    checked={mode === "all"}
                    onChange={() => setMode("all")}
                    className="mt-1 text-rose-600 focus:ring-rose-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">
                        Remise à zéro complète (Recommandé)
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800">
                        Effacement total
                      </span>
                    </div>
                    <p className="text-2xs text-slate-500 mt-1 leading-relaxed">
                      Supprime <strong>toutes</strong> les données : catalogue de chaussures, ventes, clients, fournisseurs, agences et magasins.
                      L'application redémarrera sur l'assistant de configuration initiale (<code className="font-mono text-rose-700 bg-rose-100/70 px-1 rounded">/setup</code>).
                    </p>
                  </div>
                </label>

                {/* Mode: TRANSACTIONS ONLY */}
                <label
                  className={cn(
                    "p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3",
                    mode === "transactions_only"
                      ? "bg-amber-50/70 border-amber-300 ring-2 ring-amber-500/20 shadow-xs"
                      : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                  )}
                >
                  <input
                    type="radio"
                    name="reset_mode"
                    value="transactions_only"
                    checked={mode === "transactions_only"}
                    onChange={() => setMode("transactions_only")}
                    className="mt-1 text-amber-600 focus:ring-amber-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">
                        Purger uniquement les opérations et tests
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">
                        Conserver catalogue
                      </span>
                    </div>
                    <p className="text-2xs text-slate-500 mt-1 leading-relaxed">
                      Efface les ventes, factures, caisses, dettes et mouvements de stock.
                      <strong> Conserve</strong> votre catalogue de modèles, pointures, prix et utilisateurs. Les stocks sont remis à 0.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Safety backup guarantee notice */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 flex items-start gap-3">
              <Archive size={17} className="text-slate-600 shrink-0 mt-0.5" />
              <div className="text-2xs text-slate-600 leading-relaxed">
                <strong className="text-slate-800">Sauvegarde automatique de sécurité :</strong> Une copie complète de votre base de données (<code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">db_backup_pre_reset_*.sqlite3</code>) sera créée automatiquement dans vos sauvegardes avant toute suppression.
              </div>
            </div>

            {/* Security Inputs */}
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Mot de passe propriétaire ({user?.email}) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Entrez votre mot de passe pour autoriser"
                    className="form-input ps-9 pe-10 py-2.5 text-xs rounded-xl border-slate-200 bg-white"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Tapez <span className="font-mono text-rose-700 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">REINITIALISER</span> pour confirmer <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  placeholder="REINITIALISER"
                  className={cn(
                    "form-input py-2.5 text-xs font-mono tracking-wider rounded-xl border-slate-200 bg-white uppercase",
                    isConfirmationValid && "border-emerald-500 bg-emerald-50/30 text-emerald-900 font-bold"
                  )}
                  required
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="btn-secondary py-2.5 px-4 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  "py-2.5 px-5 text-xs font-bold rounded-xl flex items-center gap-2 transition-all shadow-xs",
                  canSubmit
                    ? "bg-rose-600 hover:bg-rose-700 text-white cursor-pointer active:scale-95 hover:shadow"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                )}
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Sauvegarde & Réinitialisation...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Effacer et Réinitialiser</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
