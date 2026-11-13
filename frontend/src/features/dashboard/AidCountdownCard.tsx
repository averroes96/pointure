import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import api from "@/lib/api";

interface AidPreview {
  event?: string;
  date?: string;
  days_until?: number;
  days_before?: number;
  last_year_pairs?: number;
  last_year_top_sizes?: number[];
}

export default function AidCountdownCard() {
  const { t } = useTranslation();
  const { data } = useQuery<AidPreview>({
    queryKey: ["reports", "seasonal-preview"],
    queryFn: () => api.get("/reports/seasonal-preview/").then((response) => response.data),
  });

  if (!data?.event || data.days_until == null) return null;

  const sizes = (data.last_year_top_sizes ?? []).join(", ");
  return (
    <section className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4 md:p-5">
      <h2 className="text-base font-semibold text-amber-950 dark:text-amber-100">
        {data.days_until === 0
          ? t("dashboard.aid_today", { name: t(`seasonal.kind.${data.event}`) })
          : t("dashboard.aid_countdown", {
              name: t(`seasonal.kind.${data.event}`),
              count: data.days_until,
            })}
      </h2>
      <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
        {t("dashboard.aid_last_year", {
          count: data.last_year_pairs ?? 0,
          days: data.days_before ?? 30,
          sizes: sizes || "—",
        })}
      </p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
        <Link to={`/reports/seasonal?event=${data.event}`} className="text-teal-800 dark:text-teal-300 hover:underline">
          {t("dashboard.aid_compare")}
        </Link>
        <Link to="/reports/reorder" className="text-teal-800 dark:text-teal-300 hover:underline">
          {t("dashboard.aid_reorder")}
        </Link>
      </div>
    </section>
  );
}
