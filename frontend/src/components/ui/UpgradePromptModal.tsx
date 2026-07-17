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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary-600">
            <ArrowUpCircle size={22} />
            <h2 className="text-lg font-bold">Mise à niveau requise</h2>
          </div>
          <button onClick={() => setDetail(null)} className="text-text-muted hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-text-muted">
          Cette fonctionnalité nécessite le plan{" "}
          <span className="font-semibold text-primary-600">
            {PLAN_LABELS[detail.required_plan] ?? detail.required_plan}
          </span>
          . Votre plan actuel est{" "}
          <span className="font-medium">{PLAN_LABELS[detail.current_plan] ?? detail.current_plan}</span>.
        </p>

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => {
              setDetail(null);
              navigate("/settings");
            }}
            className="btn-primary flex-1"
          >
            Voir les plans
          </button>
          <button onClick={() => setDetail(null)} className="btn-secondary">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
