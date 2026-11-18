import { useTranslation } from "react-i18next";
import type { BestSellerRow } from "@/types";

/**
 * Period of the dashboard's best-sellers ranking, sent to /reports/best-sellers/?days=… and shown on
 * the card. The backend uses the same default (BEST_SELLERS_DEFAULT_DAYS) and caches the answer.
 */
export const BEST_SELLERS_DAYS = 90;

export function bestSellersUrl(days: number = BEST_SELLERS_DAYS): string {
  return `/reports/best-sellers/?days=${days}`;
}

/** Top five products of the period, by pairs sold. */
export default function BestSellersCard({ rows, days = BEST_SELLERS_DAYS }: { rows?: BestSellerRow[]; days?: number }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-6 space-y-4">
      <div className="border-b border-slate-100 dark:border-slate-800 pb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-900 dark:text-white text-sm">{t("dashboard.best_sellers")}</h2>
        <span className="text-2xs font-medium text-slate-400 dark:text-slate-400">
          {t("dashboard.best_sellers_period", "{{days}} derniers jours", { days })}
        </span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows?.slice(0, 5).map((item, i) => (
          <div key={item.product_id} className="py-3 flex items-center gap-3">
            <div className="w-7 h-7 rounded-xl bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 flex items-center justify-center text-xs font-bold shrink-0 border border-primary-100/50 dark:border-primary-800/60">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{item.product_name}</div>
              <div className="text-xs text-slate-400 font-medium">{item.brand}</div>
            </div>
            <div className="text-sm font-mono font-bold text-primary-600 dark:text-primary-400 tabular-nums">
              {item.units_sold} <span className="text-2xs font-normal text-slate-400">{t("common.pairs")}</span>
            </div>
          </div>
        ))}
        {!rows?.length && (
          <div className="py-8 text-center text-sm text-slate-400 font-medium">
            {t("common.no_data")}
          </div>
        )}
      </div>
    </div>
  );
}
