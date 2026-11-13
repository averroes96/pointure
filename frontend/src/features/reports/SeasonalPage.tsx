import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import api, { formatDZD } from "@/lib/api";

interface Occurrence {
  id: string;
  date: string;
  label: string;
  is_estimated: boolean;
  is_current: boolean;
  pairs: number;
  revenue: string;
  top_models: { name: string; pairs: number }[];
  top_sizes: { size_eu: number; pairs: number }[];
}

interface SeasonalReport {
  event: string;
  days_before: number;
  occurrences: Occurrence[];
}

const EVENTS = ["aid_el_fitr", "aid_el_adha", "rentree"] as const;

export default function SeasonalPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const event = params.get("event") || "aid_el_fitr";
  const days = params.get("days_before") || "30";

  const { data, isLoading, isError } = useQuery<SeasonalReport>({
    queryKey: ["reports", "seasonal", event, days],
    queryFn: () => api.get("/reports/seasonal/", {
      params: { event, days_before: days },
    }).then((response) => response.data),
  });

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next);
  }

  const rows = [...(data?.occurrences ?? [])].reverse();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t("seasonal.title")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("seasonal.subtitle")}</p>
        <Link to="/reports/reorder" className="inline-block mt-2 text-sm font-semibold text-teal-800 dark:text-teal-300 hover:underline">
          {t("report.reorder_link")}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        <label className="block">
          <span className="form-label">{t("seasonal.event")}</span>
          <select className="form-input" value={event} onChange={(e) => setFilter("event", e.target.value)}>
            {EVENTS.map((value) => (
              <option key={value} value={value}>{t(`seasonal.kind.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="form-label">{t("seasonal.days_before")}</span>
          <select className="form-input" value={days} onChange={(e) => setFilter("days_before", e.target.value)}>
            {[15, 30, 45, 60].map((value) => (
              <option key={value} value={value}>{t("seasonal.days_n", { count: value })}</option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">{t("report.loading_report")}</p>}
      {isError && <p className="text-sm text-red-600 dark:text-red-400">{t("report.error_loading_date")}</p>}

      {data && (
        <div className="overflow-x-auto bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">{t("seasonal.date")}</th>
                <th className="px-4 py-3 font-medium">{t("report.units_sold")}</th>
                <th className="px-4 py-3 font-medium">{t("report.revenue")}</th>
                <th className="px-4 py-3 font-medium">{t("seasonal.top_models")}</th>
                <th className="px-4 py-3 font-medium">{t("seasonal.top_sizes")}</th>
              </tr>
            </thead>
            <tbody className="text-slate-900 dark:text-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 dark:border-slate-800 ${row.is_current ? "bg-amber-50/80 dark:bg-amber-950/20" : ""}`}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">{row.date}</div>
                    {row.is_estimated && (
                      <div className="text-xs text-amber-700 dark:text-amber-300">{t("seasonal.estimated")}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">{row.pairs}</td>
                  <td className="px-4 py-2 font-mono">{formatDZD(row.revenue)}</td>
                  <td className="px-4 py-2">{row.top_models.map((item) => `${item.name} (${item.pairs})`).join(", ") || "—"}</td>
                  <td className="px-4 py-2 font-mono">{row.top_sizes.map((item) => item.size_eu).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
