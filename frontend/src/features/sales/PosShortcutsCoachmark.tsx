import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Keyboard,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Zap,
  Maximize2,
  RotateCcw,
  Search,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "shodz_pos_coachmark_seen";

export default function PosShortcutsCoachmark() {
  const { t } = useTranslation();

  // On first visit, automatically open if the user hasn't seen it yet
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "true";
    } catch {
      return true;
    }
  });

  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Listen to global shortcut event (F12) to toggle the cheat-sheet
  useEffect(() => {
    const handleToggle = () => {
      setIsOpen((prev) => !prev);
    };
    window.addEventListener("app-toggle-pos-coachmark", handleToggle);
    return () => window.removeEventListener("app-toggle-pos-coachmark", handleToggle);
  }, []);

  const handleDismissPermanent = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignore storage errors
    }
    setIsDismissed(true);
    setIsOpen(false);
  };

  const handleToggleOpen = () => {
    setIsOpen((prev) => !prev);
  };

  // If collapsed or closed, show the subtle floating trigger pill
  if (!isOpen) {
    return (
      <div className="fixed bottom-4 end-4 z-40">
        <button
          type="button"
          onClick={handleToggleOpen}
          className="group flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-primary-600 dark:hover:text-primary-400 shadow-lg hover:shadow-xl hover:border-primary-300 dark:hover:border-primary-700 transition-all cursor-pointer"
          title={t("sales.coachmark.title", "Raccourcis Essentiels de Caisse")}
        >
          <div className="w-6 h-6 rounded-lg bg-primary-50 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 flex items-center justify-center transition-transform group-hover:scale-110">
            <Keyboard size={14} className="stroke-[2.2]" />
          </div>
          <span>{t("sales.coachmark.pill_btn", "Raccourcis Caisse (F12)")}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 end-4 z-40 max-w-sm w-[calc(100vw-2rem)] sm:w-96 animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="relative rounded-3xl bg-white/98 dark:bg-slate-900/98 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800/80 bg-gradient-to-r from-primary-50/50 via-slate-50/30 to-transparent dark:from-primary-950/30 dark:via-slate-900/30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary-500 text-white flex items-center justify-center shadow-xs">
              <Keyboard size={16} className="stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {t("sales.coachmark.title", "Raccourcis Essentiels de Caisse")}
                </h3>
                <span className="text-3xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary-100 dark:bg-primary-950 text-primary-700 dark:text-primary-300">
                  {t("sales.coachmark.badge", "Guide Caisse")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleToggleOpen}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={t("sales.coachmark.minimize", "Réduire")}
            >
              <ChevronDown size={16} />
            </button>
            <button
              type="button"
              onClick={handleDismissPermanent}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={t("common.close", "Fermer")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-2.5 max-h-[75vh] overflow-y-auto">
          <p className="text-2xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            {t(
              "sales.coachmark.subtitle",
              "Gagnez du temps au comptoir avec les 5 raccourcis haute fréquence :"
            )}
          </p>

          {/* ── 1. F1: New Sale / Clear Ticket ── */}
          <div className="p-2.5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <kbd className="px-2 py-1 text-2xs font-mono font-black bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white shadow-2xs shrink-0">
                  F1
                </kbd>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t("sales.coachmark.f1_title", "Nouvelle vente / Vider ticket")}
                  </h4>
                  <p className="text-3xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t("sales.coachmark.f1_desc", "Réinitialise le panier pour un nouvel encaissement.")}
                  </p>
                </div>
              </div>
              <RotateCcw size={14} className="text-slate-400 shrink-0 mt-1" />
            </div>
          </div>

          {/* ── 2. F2: Search Product / Focus Scanner ── */}
          <div className="p-2.5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <kbd className="px-2 py-1 text-2xs font-mono font-black bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white shadow-2xs shrink-0">
                  F2
                </kbd>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t("sales.coachmark.f2_title", "Rechercher produit / Douchette")}
                  </h4>
                  <p className="text-3xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t("sales.coachmark.f2_desc", "Place le curseur dans la recherche ou prêt pour le scan.")}
                  </p>
                </div>
              </div>
              <Search size={14} className="text-primary-500 shrink-0 mt-1" />
            </div>
          </div>

          {/* ── 3. F10 or Numpad .: Quick Cashout & Print ── */}
          <div className="p-2.5 rounded-2xl bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-800/60 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 transition-colors">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <kbd className="px-1.5 py-1 text-2xs font-mono font-black bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-lg text-emerald-900 dark:text-emerald-200 shadow-2xs shrink-0">
                  F10
                </kbd>
                <span className="text-3xs font-bold text-emerald-700 dark:text-emerald-400">
                  {t("sales.coachmark.or_key", "ou")}
                </span>
                <kbd className="px-2 py-1 text-2xs font-mono font-black bg-emerald-100 dark:bg-emerald-900 border border-emerald-300 dark:border-emerald-600 rounded-lg text-emerald-900 dark:text-emerald-100 shadow-2xs shrink-0" title={t("sales.coachmark.numpad_dot", "Point (.) Pavé num.")}>
                  .
                </kbd>
                <div>
                  <h4 className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                    {t("sales.coachmark.f10_title", "Encaissement express & ticket")}
                  </h4>
                  <p className="text-3xs text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                    {t("sales.coachmark.f10_desc", "Valide la vente en espèces et lance l'impression.")}
                  </p>
                </div>
              </div>
              <Zap size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-1" />
            </div>
          </div>

          {/* ── 4. F11: Fullscreen Kiosk Mode ── */}
          <div className="p-2.5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <kbd className="px-2 py-1 text-2xs font-mono font-black bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white shadow-2xs shrink-0">
                  F11
                </kbd>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t("sales.coachmark.f11_title", "Mode kiosque plein écran")}
                  </h4>
                  <p className="text-3xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t("sales.coachmark.f11_desc", "Masque l'interface Windows pour une caisse dédiée.")}
                  </p>
                </div>
              </div>
              <Maximize2 size={14} className="text-indigo-500 shrink-0 mt-1" />
            </div>
          </div>

          {/* ── 5. Esc: Cancel / Back ── */}
          <div className="p-2.5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <kbd className="px-1.5 py-1 text-2xs font-mono font-black bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white shadow-2xs shrink-0">
                  Échap
                </kbd>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t("sales.coachmark.esc_title", "Annuler / Retour")}
                  </h4>
                  <p className="text-3xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t("sales.coachmark.esc_desc", "Ferme les fenêtres modales ou vide la recherche.")}
                  </p>
                </div>
              </div>
              <X size={14} className="text-rose-500 shrink-0 mt-1" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-3xs text-slate-500 dark:text-slate-400">
            <Sparkles size={12} className="text-amber-500 shrink-0" />
            <span>{t("sales.coachmark.tip_f12", "Astuce : Appuyez sur F12 à tout moment pour revoir ces raccourcis.")}</span>
          </div>

          <button
            type="button"
            onClick={handleDismissPermanent}
            className="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors shrink-0 shadow-2xs cursor-pointer"
          >
            {t("sales.coachmark.got_it", "J'ai compris")}
          </button>
        </div>
      </div>
    </div>
  );
}

