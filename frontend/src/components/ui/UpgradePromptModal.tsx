/**
 * UpgradePromptModal — shown when the backend returns 403 plan_upgrade_required.
 * Listens to the custom "plan-upgrade-required" browser event dispatched by the
 * API interceptor in src/lib/api.ts.
 */
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ArrowUpCircle } from "lucide-react";

const PLAN_LABELS: Record<string, string> = {
  free: "Gratuit",
  pro_retail: "Pro Retail",
  pro_wholesale: "Pro Wholesale",
  enterprise: "Enterprise",
};

interface UpgradeDetail {
  required_plan: string;
  current_plan: string;
  upgrade_url?: string;
}

export default function UpgradePromptModal() {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<UpgradeDetail | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: Event) => {
      setDetail((e as CustomEvent<UpgradeDetail>).detail);
    };
    window.addEventListener("plan-upgrade-required", handler);
    return () => window.removeEventListener("plan-upgrade-required", handler);
  }, []);

  if (!detail) return null;

  const getPlanLabel = (plan: string) =>
    t(`plan.plan_${plan}`, PLAN_LABELS[plan] ?? plan);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
            <ArrowUpCircle size={22} />
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t("plan.upgrade_required", "Mise à niveau requise")}
            </h2>
          </div>
          <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("plan.feature_requires_plan", {
            required_plan: getPlanLabel(detail.required_plan),
            current_plan: getPlanLabel(detail.current_plan),
            defaultValue: `Cette fonctionnalité nécessite le plan ${getPlanLabel(detail.required_plan)}. Votre plan actuel est ${getPlanLabel(detail.current_plan)}.`,
          })}
        </p>

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => {
              setDetail(null);
              navigate("/settings");
            }}
            className="btn-primary flex-1"
          >
            {t("plan.view_plans", "Voir les plans")}
          </button>
          <button onClick={() => setDetail(null)} className="btn-secondary">
            {t("common.close", "Fermer")}
          </button>
        </div>
      </div>
    </div>
  );
}
