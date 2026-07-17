import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Package, AlertTriangle, DollarSign, BarChart2, ExternalLink, Download, type LucideIcon } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import { downloadCSV } from "@/lib/csvExport";

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
  const { t } = useTranslation();
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="kpi-card__label">{label}</div>
          <div className="kpi-card__value">{value}</div>
          {sub && <div className="text-xs text-text-muted mt-1">{sub}</div>}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={20} className="text-white" />
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
      t("report.units"): row.units,
    }));
    downloadCSV(rows, `rapport-stock-${new Date().toISOString().split("T")[0]}.csv`);
  }

  async function handleGeneratePDF() {
    try {
      const response = await api.get("/reports/stock/pdf/", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rapport-stock-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Also open in new tab for inline preview
      window.open(url, "_blank");
    } catch {
      alert("Impossible de générer le PDF — réessayez.");
    }
  }

  const byCategory = data?.by_category ?? [];
  const byBrand = data?.by_brand ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Rapport de stock</h1>
          <p className="text-sm text-text-muted">Synthèse de l'inventaire actuel</p>
        </div>
        <button onClick={handleGeneratePDF} className="btn-secondary">
          <ExternalLink size={16} />
          Générer rapport PDF
        </button>
        <button onClick={handleExportCSV} disabled={!data} className="btn-secondary">
          <Download size={16} />{t("common.export_csv")}</button>
      </div>

      {isLoading && (
        <div className="card card-body text-center text-text-muted py-12">{t("report.loading_report")}</div>
      )}

      {isError && (
        <div className="card card-body text-center text-danger py-8">
          Impossible de charger le rapport de stock.
        </div>
      )}

      {data && !isLoading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KPICard
              label="Références (SKU)"
              value={data.total_sku_count}
              icon={Package}
              color="bg-primary-500"
              sub="variantes actives"
            />
            <KPICard
              label="Total unités"
              value={data.total_units}
              icon={BarChart2}
              color="bg-accent"
              sub="en stock"
            />
            <KPICard
              label="Valeur du stock"
              value={formatDZD(data.total_stock_value) + " DZD"}
              icon={DollarSign}
              color="bg-success"
              sub="prix d'achat × qté"
            />
            <KPICard
              label="Stock bas"
              value={data.low_stock_count}
              icon={AlertTriangle}
              color="bg-warning"
              sub="sous le seuil"
            />
            <KPICard
              label="Ruptures"
              value={data.out_of_stock_count}
              icon={AlertTriangle}
              color="bg-danger"
              sub="stock = 0"
            />
          </div>

          {/* Tables row */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* By category */}
            <div className="card overflow-hidden">
              <div className="card-header">
                <h2 className="font-semibold text-text-primary">Par catégorie</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Catégorie</th>
                      <th className="text-end">Références</th>
                      <th className="text-end">{t("report.units")}</th>
                      <th className="text-end">Valeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCategory.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-6 text-text-muted">
                          Aucune donnée.
                        </td>
                      </tr>
                    )}
                    {byCategory.map((row) => (
                      <tr key={row.category}>
                        <td className="font-medium text-text-primary">
                          {t(`category.${row.category}`, { defaultValue: row.category })}
                        </td>
                        <td className="text-end font-mono text-text-muted">{row.count}</td>
                        <td className="text-end font-mono">{row.units}</td>
                        <td className="text-end font-mono text-primary-600">
                          {formatDZD(row.value)}{" "}
                          <span className="text-2xs text-text-muted">DZD</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {byCategory.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border">
                        <td className="px-3 py-2.5 font-semibold">{t("common.total")}</td>
                        <td className="px-3 py-2.5 text-end font-mono">
                          {byCategory.reduce((s, r) => s + r.count, 0)}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono font-bold">
                          {byCategory.reduce((s, r) => s + r.units, 0)}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono font-bold text-primary-600">
                          {formatDZD(
                            byCategory
                              .reduce((s, r) => s + parseFloat(r.value || "0"), 0)
                              .toFixed(2)
                          )}{" "}
                          DZD
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* By brand */}
            <div className="card overflow-hidden">
              <div className="card-header">
                <h2 className="font-semibold text-text-primary">Par marque</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("report.brand")}</th>
                      <th className="text-end">Références</th>
                      <th className="text-end">{t("report.units")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byBrand.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-6 text-text-muted">
                          Aucune donnée.
                        </td>
                      </tr>
                    )}
                    {byBrand.map((row) => (
                      <tr key={row.brand}>
                        <td className="font-medium text-text-primary">{row.brand || "—"}</td>
                        <td className="text-end font-mono text-text-muted">{row.count}</td>
                        <td className="text-end font-mono">{row.units}</td>
                      </tr>
                    ))}
                  </tbody>
                  {byBrand.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border">
                        <td className="px-3 py-2.5 font-semibold">{t("common.total")}</td>
                        <td className="px-3 py-2.5 text-end font-mono">
                          {byBrand.reduce((s, r) => s + r.count, 0)}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono font-bold">
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
