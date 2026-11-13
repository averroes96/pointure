import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api, { formatDZD } from "@/lib/api";

interface SizeRow {
  size_eu: number;
  units_sold: number;
  sales_share: string;
  stock: number;
  on_order: number;
  weeks_of_cover: string | null;
  sell_through_pct: string;
}

interface BrokenProduct {
  product_id: string;
  name: string;
  brand: string;
  core_sizes: number[];
  missing_sizes: number[];
  basis: "product" | "category" | "gender" | "default";
  stock_pairs: number;
  stock_value: string;
}

interface SizeCurveReport {
  weeks: number;
  sizes: SizeRow[];
  broken: BrokenProduct[];
}

const CATEGORIES = ["sneakers", "boots", "sandals", "formal", "sport", "kids", "slippers", "other"] as const;
const GENDERS = ["M", "F", "K", "U"] as const;
const WEEK_OPTIONS = [4, 8, 12, 26, 52] as const;

export default function SizeCurvePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const weeks = params.get("weeks") || "8";
  const brand = params.get("brand") || "";
  const category = params.get("category") || "";
  const gender = params.get("gender") || "";
  const product = params.get("product") || "";

  const filters = {
    weeks,
    ...(brand ? { brand } : {}),
    ...(category ? { category } : {}),
    ...(gender ? { gender } : {}),
    ...(product ? { product } : {}),
  };

  const { data, isLoading, isError } = useQuery<SizeCurveReport>({
    queryKey: ["reports", "size-curve", filters],
    queryFn: () => api.get("/reports/size-curve/", { params: filters }).then((r) => r.data),
  });

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next);
  }

  const chartData = (data?.sizes ?? []).map((row) => ({
    size: String(row.size_eu),
    units: row.units_sold,
  }));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t("report.size_curve_title")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("report.size_curve_subtitle")}</p>
        <Link to="/reports/reorder" className="inline-block mt-2 text-sm font-semibold text-teal-800 dark:text-teal-300 hover:underline">
          {t("report.reorder_link")}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="block">
          <span className="form-label">{t("report.weeks")}</span>
          <select className="form-input" value={weeks} onChange={(e) => setFilter("weeks", e.target.value)}>
            {WEEK_OPTIONS.map((value) => (
              <option key={value} value={value}>{t("report.weeks_n", { count: value })}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="form-label">{t("report.brand")}</span>
          <input
            className="form-input"
            value={brand}
            onChange={(e) => setFilter("brand", e.target.value)}
            placeholder={t("report.brand")}
          />
        </label>
        <label className="block">
          <span className="form-label">{t("report.category")}</span>
          <select className="form-input" value={category} onChange={(e) => setFilter("category", e.target.value)}>
            <option value="">{t("report.all")}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>{t(`category.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="form-label">{t("report.gender")}</span>
          <select className="form-input" value={gender} onChange={(e) => setFilter("gender", e.target.value)}>
            <option value="">{t("report.all")}</option>
            {GENDERS.map((value) => (
              <option key={value} value={value}>{t(`gender.${value.toLowerCase()}`)}</option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">{t("report.loading_report")}</p>}
      {isError && <p className="text-sm text-red-600 dark:text-red-400">{t("report.error_loading_date")}</p>}

      {data && (
        <>
          <section className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{t("report.units_sold")}</h2>
            {chartData.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("report.no_sizes")}</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis dataKey="size" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="units" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="overflow-x-auto bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("report.size")}</th>
                  <th className="px-4 py-3 font-medium">{t("report.units_sold")}</th>
                  <th className="px-4 py-3 font-medium">{t("report.sales_share")}</th>
                  <th className="px-4 py-3 font-medium">{t("report.stock")}</th>
                  <th className="px-4 py-3 font-medium">{t("report.on_order")}</th>
                  <th className="px-4 py-3 font-medium">{t("report.weeks_of_cover")}</th>
                  <th className="px-4 py-3 font-medium">{t("report.sell_through")}</th>
                </tr>
              </thead>
              <tbody className="text-slate-900 dark:text-slate-100">
                {data.sizes.map((row) => (
                  <tr key={row.size_eu} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 font-mono">{row.size_eu}</td>
                    <td className="px-4 py-2 font-mono">{row.units_sold}</td>
                    <td className="px-4 py-2 font-mono">{row.sales_share}%</td>
                    <td className="px-4 py-2 font-mono">{row.stock}</td>
                    <td className="px-4 py-2 font-mono">{row.on_order}</td>
                    <td className="px-4 py-2 font-mono">{row.weeks_of_cover ?? "—"}</td>
                    <td className="px-4 py-2 font-mono">{row.sell_through_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("report.broken_title")}</h2>
            {data.broken.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("report.broken_empty")}</p>
            ) : (
              <ul className="space-y-2">
                {data.broken.map((item) => (
                  <li key={item.product_id} className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4">
                    <Link
                      to={`/inventory/products/${item.product_id}`}
                      className="font-semibold text-teal-800 dark:text-teal-300 hover:underline"
                    >
                      {item.brand ? `${item.brand} ` : ""}{item.name}
                    </Link>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                      {t("report.missing_sizes")}: {item.missing_sizes.join(", ")}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      {t(`report.basis_${item.basis}`)}
                      {" · "}
                      {t("report.broken_pairs", { count: item.stock_pairs })}
                      {" · "}
                      {formatDZD(item.stock_value)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
