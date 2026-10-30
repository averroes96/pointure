import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, X, Sparkles,
  PackagePlus, UploadCloud, Database, Printer, KeyRound, ShoppingCart,
  ArrowRight, Loader2, RotateCcw, AlertCircle
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { getPrinterConfig, testPrintTicket, savePrinterConfig } from "@/lib/printerConfig";
import BulkImportWizardModal from "@/components/import/BulkImportWizardModal";
import QuickCashierModal from "./QuickCashierModal";
import type { DashboardKPIs } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  kpis?: DashboardKPIs;
  onDismiss?: () => void;
}

export default function GetStartedWidget({ kpis, onDismiss }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCashierModal, setShowCashierModal] = useState(false);
  const [printerTested, setPrinterTested] = useState<boolean>(() => {
    return localStorage.getItem("shodz_printer_tested") === "true";
  });
  const [testPrintLoading, setTestPrintLoading] = useState(false);
  const [printFeedback, setPrintFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [demoFeedback, setDemoFeedback] = useState<string | null>(null);

  const printerConfig = getPrinterConfig();
  const [paperWidth, setPaperWidth] = useState<"80mm" | "58mm">(printerConfig.ticket.paperWidth);

  // Milestone checks
  const m1Done = (kpis?.product_count ?? 0) > 0;
  const m2Done = printerTested;
  const m3Done = (kpis?.cashier_count ?? 0) > 0;
  const m4Done = (kpis?.sale_count ?? 0) > 0;

  const completedCount = [m1Done, m2Done, m3Done, m4Done].filter(Boolean).length;
  const progressPercent = Math.round((completedCount / 4) * 100);
  const allCompleted = completedCount === 4;

  // Option C: Seed demo catalog mutation
  const seedDemoMutation = useMutation({
    mutationFn: () => api.post("/inventory/products/seed-demo-catalog/").then((r) => r.data),
    onSuccess: (data) => {
      setDemoFeedback(data.detail || t("dashboard.onboarding.demo_seeded_success", "Catalogue de test chargé avec succès !"));
      queryClient.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (err) => {
      setDemoFeedback(getApiError(err));
    },
  });

  const handleTestPrint = async () => {
    setTestPrintLoading(true);
    setPrintFeedback(null);
    try {
      const cfg = getPrinterConfig();
      // Update paper width if changed in selector
      if (cfg.ticket.paperWidth !== paperWidth) {
        cfg.ticket.paperWidth = paperWidth;
        savePrinterConfig(cfg);
      }
      const res = await testPrintTicket(cfg.ticket.printerName, paperWidth);
      if (res.success) {
        localStorage.setItem("shodz_printer_tested", "true");
        setPrinterTested(true);
        setPrintFeedback({
          msg: t("dashboard.onboarding.printer_test_success", "Ticket de test envoyé à l'imprimante !"),
          type: "success",
        });
      } else {
        setPrintFeedback({
          msg: res.failureReason || t("dashboard.onboarding.printer_test_fail", "Échec de l'impression du ticket"),
          type: "error",
        });
      }
    } catch (e: any) {
      setPrintFeedback({ msg: e?.message || "Erreur d'impression", type: "error" });
    } finally {
      setTestPrintLoading(false);
    }
  };

  const handleDismissPermanent = () => {
    localStorage.setItem("shodz_hide_onboarding_widget", "true");
    if (onDismiss) onDismiss();
  };

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-primary-200/80 dark:border-primary-900/60 bg-gradient-to-br from-white via-primary-50/20 to-primary-100/30 dark:from-slate-900 dark:via-slate-900 dark:to-primary-950/20 shadow-sm transition-all">
        {/* Top Header & Progress */}
        <div className="p-5 sm:p-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-600 text-white flex items-center justify-center shadow-xs shadow-primary-600/30 shrink-0">
                <Sparkles size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    {t("dashboard.onboarding.widget_title", "Guide de démarrage ShoeDZ")}
                  </h2>
                  <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/60 text-primary-700 dark:text-primary-300 font-mono">
                    {completedCount} / 4
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {allCompleted
                    ? t("dashboard.onboarding.all_completed_desc", "Félicitations ! Votre boutique est entièrement prête pour vos encaissements.")
                    : t("dashboard.onboarding.widget_subtitle", "Configurez votre boutique en 4 étapes simples pour commencer à encaisser.")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={isCollapsed ? t("common.expand", "Agrandir") : t("common.collapse", "Réduire")}
              >
                {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </button>
              <button
                type="button"
                onClick={handleDismissPermanent}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={t("dashboard.onboarding.dismiss_hint", "Masquer le guide")}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Dynamic Progress Bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-2xs font-semibold mb-1.5">
              <span className="text-slate-600 dark:text-slate-400 font-mono">
                {t("dashboard.onboarding.progress_label", "Progression de configuration")}
              </span>
              <span className="text-primary-600 dark:text-primary-400 font-mono font-bold">
                {progressPercent}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-600 to-emerald-500 transition-all duration-500 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Collapsible Content: The 4 Milestones */}
        {!isCollapsed && (
          <div className="px-5 sm:px-6 pb-6 pt-1 space-y-3">
            {/* ── Milestone 1: Footwear Inventory ── */}
            <div
              className={cn(
                "p-4 rounded-xl border transition-all",
                m1Done
                  ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/80"
                  : "bg-white dark:bg-slate-900/90 border-slate-200/80 dark:border-slate-800"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {m1Done ? (
                      <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Circle size={18} className="text-slate-300 dark:text-slate-600" />
                    )}
                  </div>
                  <div>
                    <h3 className={cn("text-xs font-bold", m1Done ? "text-emerald-900 dark:text-emerald-200" : "text-slate-900 dark:text-white")}>
                      {t("dashboard.onboarding.m1_title", "1. Constituez votre stock de chaussures")}
                    </h3>
                    <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {m1Done
                        ? t("dashboard.onboarding.m1_done_desc", "{{count}} modèle(s) enregistrés dans votre catalogue.", { count: kpis?.product_count ?? 1 })
                        : t("dashboard.onboarding.m1_todo_desc", "Ajoutez vos premiers modèles par pointure, importez vos listes ou chargez le catalogue démo.")}
                    </p>
                  </div>
                </div>

                {m1Done && (
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                    {t("common.done", "Terminé")}
                  </span>
                )}
              </div>

              {/* Milestone 1 Action Options */}
              {!m1Done && (
                <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* Option A: Manual */}
                  <Link
                    to="/inventory/products/new"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/80 hover:bg-primary-50 dark:hover:bg-primary-950/40 hover:text-primary-600 dark:hover:text-primary-300 border border-slate-200/60 dark:border-slate-700/60 transition-all"
                  >
                    <PackagePlus size={15} className="text-primary-600" />
                    <span>{t("dashboard.onboarding.m1_opt_manual", "Saisie manuelle")}</span>
                  </Link>

                  {/* Option B: Import */}
                  <button
                    type="button"
                    onClick={() => setShowImportModal(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/80 hover:bg-primary-50 dark:hover:bg-primary-950/40 hover:text-primary-600 dark:hover:text-primary-300 border border-slate-200/60 dark:border-slate-700/60 transition-all text-left"
                  >
                    <UploadCloud size={15} className="text-indigo-600" />
                    <span>{t("dashboard.onboarding.m1_opt_import", "Importer Excel / DBF")}</span>
                  </button>

                  {/* Option C: 20 Demo models */}
                  <button
                    type="button"
                    onClick={() => seedDemoMutation.mutate()}
                    disabled={seedDemoMutation.isPending}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-all text-left shadow-2xs"
                  >
                    {seedDemoMutation.isPending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Database size={15} />
                    )}
                    <span>{t("dashboard.onboarding.m1_opt_demo", "Charger 20 modèles démo")}</span>
                  </button>
                </div>
              )}

              {demoFeedback && (
                <p className="text-2xs text-emerald-600 dark:text-emerald-400 mt-2 font-medium">
                  {demoFeedback}
                </p>
              )}
            </div>

            {/* ── Milestone 2: Configure & Test Receipt Printer ── */}
            <div
              className={cn(
                "p-4 rounded-xl border transition-all",
                m2Done
                  ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/80"
                  : "bg-white dark:bg-slate-900/90 border-slate-200/80 dark:border-slate-800"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {m2Done ? (
                      <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Circle size={18} className="text-slate-300 dark:text-slate-600" />
                    )}
                  </div>
                  <div>
                    <h3 className={cn("text-xs font-bold", m2Done ? "text-emerald-900 dark:text-emerald-200" : "text-slate-900 dark:text-white")}>
                      {t("dashboard.onboarding.m2_title", "2. Configurez & testez l'imprimante de caisse")}
                    </h3>
                    <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {t("dashboard.onboarding.m2_desc", "Vérifiez la sortie thermique sur tickets de caisse (80mm ou 58mm).")}
                    </p>
                  </div>
                </div>

                {m2Done && (
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                    {t("common.done", "Terminé")}
                  </span>
                )}
              </div>

              {/* Milestone 2 Printer Test Action */}
              <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xs font-semibold text-slate-600 dark:text-slate-400">
                    {t("printers.ticket_format", "Format :")}
                  </span>
                  <select
                    value={paperWidth}
                    onChange={(e) => setPaperWidth(e.target.value as "80mm" | "58mm")}
                    className="px-2.5 py-1 text-2xs font-mono font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                  >
                    <option value="80mm">80 mm (Standard)</option>
                    <option value="58mm">58 mm (Compact)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleTestPrint}
                  disabled={testPrintLoading}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 transition-all shadow-2xs"
                >
                  {testPrintLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Printer size={14} />
                  )}
                  <span>{t("dashboard.onboarding.m2_btn_test", "Imprimer un ticket de test")}</span>
                </button>

                <Link
                  to="/settings"
                  className="text-2xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {t("dashboard.onboarding.m2_advanced_settings", "Paramètres imprimantes avancés →")}
                </Link>
              </div>

              {printFeedback && (
                <div
                  className={cn(
                    "mt-2 text-2xs font-medium flex items-center gap-1.5",
                    printFeedback.type === "success"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {printFeedback.type === "success" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  <span>{printFeedback.msg}</span>
                </div>
              )}
            </div>

            {/* ── Milestone 3: Create Cashier Profile with PIN ── */}
            <div
              className={cn(
                "p-4 rounded-xl border transition-all",
                m3Done
                  ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/80"
                  : "bg-white dark:bg-slate-900/90 border-slate-200/80 dark:border-slate-800"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {m3Done ? (
                      <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Circle size={18} className="text-slate-300 dark:text-slate-600" />
                    )}
                  </div>
                  <div>
                    <h3 className={cn("text-xs font-bold", m3Done ? "text-emerald-900 dark:text-emerald-200" : "text-slate-900 dark:text-white")}>
                      {t("dashboard.onboarding.m3_title", "3. Créez un profil caissier avec code PIN")}
                    </h3>
                    <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {m3Done
                        ? t("dashboard.onboarding.m3_done_desc", "{{count}} compte(s) caissier configuré(s) pour votre boutique.", { count: kpis?.cashier_count ?? 1 })
                        : t("dashboard.onboarding.m3_todo_desc", "Attribuez un code PIN à 4 chiffres pour sécuriser les changements de quart et les verrouillages d'écran.")}
                    </p>
                  </div>
                </div>

                {m3Done ? (
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                    {t("common.done", "Terminé")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCashierModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/60 hover:bg-primary-100 dark:hover:bg-primary-900/60 border border-primary-200/60 dark:border-primary-800/60 transition-all shrink-0"
                  >
                    <KeyRound size={14} />
                    <span>{t("dashboard.onboarding.m3_btn_add", "Créer caissier PIN")}</span>
                  </button>
                )}
              </div>
            </div>

            {/* ── Milestone 4: Complete First Test Sale ── */}
            <div
              className={cn(
                "p-4 rounded-xl border transition-all",
                m4Done
                  ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/80"
                  : "bg-white dark:bg-slate-900/90 border-slate-200/80 dark:border-slate-800"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {m4Done ? (
                      <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Circle size={18} className="text-slate-300 dark:text-slate-600" />
                    )}
                  </div>
                  <div>
                    <h3 className={cn("text-xs font-bold", m4Done ? "text-emerald-900 dark:text-emerald-200" : "text-slate-900 dark:text-white")}>
                      {t("dashboard.onboarding.m4_title", "4. Réalisez votre première vente d'essai")}
                    </h3>
                    <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {m4Done
                        ? t("dashboard.onboarding.m4_done_desc", "{{count}} vente(s) enregistrée(s). Félicitations !", { count: kpis?.sale_count ?? 1 })
                        : t("dashboard.onboarding.m4_todo_desc", "Ouvrez le terminal de caisse tactile, sélectionnez une paire et validez votre premier ticket.")}
                    </p>
                  </div>
                </div>

                {m4Done ? (
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                    {t("common.done", "Terminé")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate("/sales/new")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 shadow-2xs transition-all shrink-0"
                  >
                    <ShoppingCart size={14} />
                    <span>{t("dashboard.onboarding.m4_btn_sale", "Ouvrir la caisse (F1)")}</span>
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Import Modal */}
      {showImportModal && (
        <BulkImportWizardModal
          initialEntity="products"
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
            queryClient.invalidateQueries({ queryKey: ["reports"] });
            setShowImportModal(false);
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Quick Cashier Modal */}
      {showCashierModal && (
        <QuickCashierModal
          isOpen={showCashierModal}
          onClose={() => setShowCashierModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
            setShowCashierModal(false);
          }}
        />
      )}
    </>
  );
}

