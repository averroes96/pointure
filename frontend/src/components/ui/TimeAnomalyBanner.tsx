import { useState } from "react";
import { AlertTriangle, Clock, RefreshCw, X, ShieldAlert } from "lucide-react";
import { useTimeSyncStatus } from "@/lib/time";
import { cn } from "@/lib/utils";

export default function TimeAnomalyBanner() {
  const {
    anomalyDetected,
    anomalyMessage,
    currentTimeDisplay,
    syncSource,
    resync,
    isRefetching,
  } = useTimeSyncStatus(120000); // Check every 2 minutes

  const [dismissed, setDismissed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  if (!anomalyDetected || dismissed) {
    return null;
  }

  const handleResync = async () => {
    try {
      setSyncing(true);
      setSyncSuccess(null);
      await resync();
      setSyncSuccess("Horloge synchronisée !");
      setTimeout(() => setSyncSuccess(null), 4000);
    } catch {
      // Ignored
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mb-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 text-amber-950 dark:text-amber-200 shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
            <ShieldAlert size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                Alerte Décalage Horloge Système
              </h4>
              <span className="px-1.5 py-0.2 rounded text-3xs font-bold uppercase bg-amber-500/20 text-amber-800 dark:text-amber-200">
                Protection Active
              </span>
            </div>
            <p className="text-xs text-amber-900/90 dark:text-amber-200/90 mt-0.5 leading-relaxed">
              {anomalyMessage ||
                "L'heure de votre système présente une incohérence avec l'heure réelle ou les dernières ventes."}
            </p>
            {currentTimeDisplay && (
              <p className="text-2xs text-amber-800/80 dark:text-amber-300/70 mt-1 font-mono">
                Heure réseau vérifiée appliquée aux ventes : <strong>{currentTimeDisplay}</strong>
                {syncSource && ` (Source: ${syncSource})`}
              </p>
            )}
            {syncSuccess && (
              <p className="text-2xs font-bold text-emerald-700 dark:text-emerald-400 mt-1 animate-in fade-in">
                ✓ {syncSuccess}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button
            onClick={handleResync}
            disabled={syncing || isRefetching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={13} className={cn((syncing || isRefetching) && "animate-spin")} />
            <span>{syncing ? "Synchronisation..." : "Recaler l'horloge"}</span>
          </button>

          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-100 hover:bg-amber-500/10 rounded-lg transition-colors cursor-pointer"
            title="Masquer cette alerte"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
