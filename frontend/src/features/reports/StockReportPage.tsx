import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Package, AlertTriangle, DollarSign, BarChart2, ExternalLink, Download, type LucideIcon } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import { downloadCSV } from "@/lib/csvExport";
import { viewPdfDocument } from "@/lib/pdfViewer";

interface StockByCategory {
  category: string;
  count: number;
  units: number;
  value: string;
}

interface StockByBrand {
  brand: string;
  count: number;
  units: number;
}

interface StockReport {
  total_sku_count: number;
  total_units: number;
  total_stock_value: string;
  total_retail_value: string;
  low_stock_count: number;
  out_of_stock_count: number;
  by_category: StockByCategory[];
  by_brand: StockByBrand[];
}

function KPICard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 hover:border-slate-300 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider truncate">{label}</div>
          <div className="text-xl font-bold font-mono tracking-tight text-slate-900 mt-1.5 tabular-nums truncate">{value}</div>
          {sub && <div className="text-xs font-medium text-slate-500 mt-1">{sub}</div>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export default function StockReportPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery<StockReport>({
    queryKey: ["reports", "stock"],
    queryFn: () => api.get("/reports/stock/").then((r) => r.data),
  });

  function handleExportCSV() {
    if (!data) return;
    const rows = data.by_category.map((row) => ({
      "Catégorie": t(`category.${row.category}`, { defaultValue: row.category }),
      "Références": row.count,
      [t("report.units")]: row.units,
    }));
    downloadCSV(rows, `rapport-stock-${new Date().toISOString().split("T")[0]}.csv`);
  }

  async function handleGeneratePDF() {
    try {
      const response = await api.get("/reports/stock/pdf/", {
        responseType: "blob",
      });
      await viewPdfDocument(response.data, {
        title: `Rapport de Stock — ${new Date().toLocaleDateString("fr-FR")}`,
        filename: `rapport-stock-${new Date().toISOString().split("T")[0]}`,
      });
    } catch {
      alert("Impossible de générer le PDF — réessayez.");
    }
  }

  const byCategory = data?.by_category ?? [];
  const byBrand = data?.by_brand ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">Rapport de stock</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">Synthèse et valorisation de l'inventaire actuel</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleGeneratePDF}
            className="btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl shadow-2xs"
          >
            <ExternalLink size={14} />
            Générer rapport PDF
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!data}
            className="btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl shadow-2xs disabled:opacity-50"
          >
            <Download size={14} />
            {t("common.export_csv")}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-12 text-center text-slate-400 font-medium">
          <div className="flex items-center justify-center gap-2">
            <div className="h-5 w-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span>{t("report.loading_report")}</span>
          </div>
        </div>
      )}

      {isError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center text-rose-700 font-medium text-sm shadow-2xs">
          Impossible de charger le rapport de stock.
        </div>
      )}

      {data && !isLoading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KPICard
              label="Références (SKU)"
              value={data.total_sku_count}
              icon={Package}
              color="bg-primary-600"
              sub="variantes actives"
            />
            <KPICard
              label="Total unités"
              value={data.total_units}
              icon={BarChart2}
              color="bg-indigo-600"
              sub="en stock"
            />
            <KPICard
              label="Valeur Achat"
              value={formatDZD(data.total_stock_value) + " DZD"}
              icon={DollarSign}
              color="bg-slate-700"
              sub="prix d'achat × qté"
            />
            <KPICard
              label="Valeur Revente"
              value={formatDZD(data.total_retail_value) + " DZD"}
              icon={DollarSign}
              color="bg-emerald-600"
              sub="prix de vente × qté"
            />
            <KPICard
              label="Stock bas"
              value={data.low_stock_count}
              icon={AlertTriangle}
              color="bg-amber-500"
              sub="sous le seuil"
            />
            <KPICard
              label="Ruptures"
              value={data.out_of_stock_count}
              icon={AlertTriangle}
              color="bg-rose-500"
              sub="stock = 0"
            />
          </div>

          {/* Tables row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By category */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">Par catégorie</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-3.5 text-start">Catégorie</th>
                      <th className="px-4 py-3.5 text-end">Références</th>
                      <th className="px-4 py-3.5 text-end">{t("report.units")}</th>
                      <th className="px-4 py-3.5 text-end">Valeur</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {byCategory.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-slate-400 font-medium">
                          Aucune donnée.
                        </td>
                      </tr>
                    )}
                    {byCategory.map((row) => (
                      <tr key={row.category} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3.5 font-semibold text-slate-900">
                          {t(`category.${row.category}`, { defaultValue: row.category })}
                        </td>
                        <td className="px-4 py-3.5 text-end font-mono text-xs text-slate-600">{row.count}</td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-800 tabular-nums">{row.units}</td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-primary-600 tabular-nums">
                          {formatDZD(row.value)}{" "}
                          <span className="text-2xs text-slate-400 font-normal">DZD</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {byCategory.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                        <td className="px-4 py-3.5 font-bold text-slate-900">{t("common.total")}</td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-slate-700">
                          {byCategory.reduce((s, r) => s + r.count, 0)}
                        </td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-slate-900 text-sm">
                          {byCategory.reduce((s, r) => s + r.units, 0)}
                        </td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-primary-600 text-sm tabular-nums">
                          {formatDZD(
                            byCategory
                              .reduce((s, r) => s + parseFloat(r.value || "0"), 0)
                              .toFixed(2)
                          )}{" "}
                          <span className="text-xs text-slate-400 font-normal">DZD</span>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* By brand */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">Par marque</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-3.5 text-start">{t("report.brand")}</th>
                      <th className="px-4 py-3.5 text-end">Références</th>
                      <th className="px-4 py-3.5 text-end">{t("report.units")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {byBrand.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-slate-400 font-medium">
                          Aucune donnée.
                        </td>
                      </tr>
                    )}
                    {byBrand.map((row) => (
                      <tr key={row.brand} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3.5 font-semibold text-slate-900">{row.brand || "—"}</td>
                        <td className="px-4 py-3.5 text-end font-mono text-xs text-slate-600">{row.count}</td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-800 tabular-nums">{row.units}</td>
                      </tr>
                    ))}
                  </tbody>
                  {byBrand.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                        <td className="px-4 py-3.5 font-bold text-slate-900">{t("common.total")}</td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-slate-700">
                          {byBrand.reduce((s, r) => s + r.count, 0)}
                        </td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-slate-900 text-sm">
                          {byBrand.reduce((s, r) => s + r.units, 0)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
