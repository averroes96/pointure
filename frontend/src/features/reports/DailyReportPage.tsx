import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TrendingUp, ShoppingBag, BarChart2, CreditCard, Printer, Download, RotateCcw, type LucideIcon } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import { downloadCSV } from "@/lib/csvExport";
import { openPrintPopup } from "@/lib/printPopup";

interface TopProduct {
  name: string;
  brand: string;
  units: number;
  revenue: string;
}

interface PaymentBreakdownItem {
  method: string;
  amount: string;
  count: number;
}

interface DailyReport {
  date: string;
  total_revenue: string;
  sale_count: number;
  total_refunds: string;
  net_revenue: string;
  cash_total: string;
  ccp_total: string;
  virement_total: string;
  cheque_total: string;
  items_sold: number;
  top_products: TopProduct[];
  payment_breakdown: PaymentBreakdownItem[];
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
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

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Espèces", cheque: "Chèque", ccp: "CCP",
  virement: "Virement", account: "Compte client",
};

function buildDailyReportHtml(data: DailyReport, date: string): string {
  const paymentRows = data.payment_breakdown
    .map((r) => `
      <tr>
        <td>${PAYMENT_LABELS[r.method] ?? r.method}</td>
        <td style="text-align:right;">${r.count}</td>
        <td style="text-align:right;font-weight:600;">${Number(r.amount).toLocaleString("fr-DZ")} DZD</td>
      </tr>`)
    .join("");

  const productRows = data.top_products.slice(0, 5)
    .map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${p.brand} ${p.name}</td>
        <td style="text-align:right;">${p.units}</td>
        <td style="text-align:right;font-weight:600;">${Number(p.revenue).toLocaleString("fr-DZ")} DZD</td>
      </tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Rapport journalier ${date}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial,sans-serif; font-size:12px; color:#000; padding:12mm; }
    h1  { font-size:18px; font-weight:700; margin-bottom:2px; }
    h2  { font-size:13px; font-weight:600; margin:12px 0 6px; border-bottom:1px solid #ccc; padding-bottom:3px; }
    .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:10px 0; }
    .kpi  { border:1px solid #ddd; border-radius:6px; padding:8px 10px; }
    .kpi-label { font-size:10px; color:#666; }
    .kpi-value { font-size:15px; font-weight:700; margin-top:2px; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th,td { padding:5px 8px; border-bottom:1px solid #eee; text-align:left; }
    th { background:#f5f5f5; font-weight:600; font-size:10px; text-transform:uppercase; }
    tfoot td { border-top:2px solid #ccc; font-weight:700; }
    .two-col { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:4px; }
    @media print { @page { margin:0; } body { padding:8mm; } }
  </style>
</head>
<body>
  <h1>Rapport journalier</h1>
  <p style="font-size:11px;color:#555;margin-top:2px;">Date&nbsp;: ${date}</p>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">CA brut</div>
      <div class="kpi-value">${Number(data.total_revenue).toLocaleString("fr-DZ")} DZD</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Retours</div>
      <div class="kpi-value" style="color:#c0392b;">− ${Number(data.total_refunds).toLocaleString("fr-DZ")} DZD</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">CA net</div>
      <div class="kpi-value" style="color:#27ae60;">${Number(data.net_revenue).toLocaleString("fr-DZ")} DZD</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Nb ventes</div>
      <div class="kpi-value">${data.sale_count}</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <h2>Répartition des paiements</h2>
      <table>
        <thead><tr><th>Mode</th><th style="text-align:right;">Nb</th><th style="text-align:right;">Montant</th></tr></thead>
        <tbody>${paymentRows}</tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td style="text-align:right;">${data.sale_count}</td>
            <td style="text-align:right;">${Number(data.total_revenue).toLocaleString("fr-DZ")} DZD</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div>
      <h2>Top 5 articles</h2>
      <table>
        <thead><tr><th>#</th><th>Article</th><th style="text-align:right;">Qté</th><th style="text-align:right;">CA</th></tr></thead>
        <tbody>${productRows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

export default function DailyReportPage() {
  const { t } = useTranslation();
  const [date, setDate] = useState<string>(todayISO());

  const { data, isLoading, isError } = useQuery<DailyReport>({
    queryKey: ["reports", "daily", date],
    queryFn: () =>
      api.get(`/reports/daily/?date=${date}`).then((r) => r.data),
    enabled: !!date,
  });

  const topProducts = data?.top_products ?? [];
  const paymentBreakdown = data?.payment_breakdown ?? [];

  function handleExportCSV() {
    if (!data) return;
    const rows = data.payment_breakdown.map((row) => ({
      "Mode": t(`payment_method.${row.method}`, { defaultValue: row.method }),
      "Nb transactions": row.count,
      "Montant (DZD)": row.amount,
    }));
    rows.push({
      "Mode": "TOTAL",
      "Nb transactions": data.sale_count,
      "Montant (DZD)": data.total_revenue,
    });
    downloadCSV(rows, `rapport-journalier-${date}.csv`);
  }

  return (
    <div className="space-y-5 print:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Rapport journalier</h1>
          <p className="text-sm text-text-muted">Synthèse des ventes par jour</p>
        </div>
        <button onClick={() => data && openPrintPopup(buildDailyReportHtml(data, date), "210mm", 15)} disabled={!data} className="btn-secondary">
          <Printer size={16} />
          Imprimer
        </button>
        <button onClick={handleExportCSV} disabled={!data} className="btn-secondary">
          <Download size={16} />
          Exporter CSV
        </button>
      </div>

      {/* Date picker */}
      <div className="flex items-center gap-3 print:hidden">
        <label className="text-sm font-medium text-text-primary whitespace-nowrap">Date :</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="form-input max-w-[200px]"
          max={todayISO()}
        />
      </div>

      {/* Print title */}
      <div className="hidden print:block text-center mb-4">
        <h1 className="text-2xl font-bold">Rapport journalier</h1>
        <p className="text-gray-500">{date}</p>
      </div>

      {isLoading && (
        <div className="card card-body text-center text-text-muted py-12">
          Chargement du rapport...
        </div>
      )}

      {isError && (
        <div className="card card-body text-center text-danger py-8">
          Impossible de charger le rapport pour cette date.
        </div>
      )}

      {data && !isLoading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KPICard
              label="CA brut du jour"
              value={formatDZD(data.total_revenue) + " DZD"}
              icon={TrendingUp}
              color="bg-primary-500"
              sub={`${data.sale_count} vente(s)`}
            />
            <KPICard
              label="Retours / Remboursements"
              value={"− " + formatDZD(data.total_refunds) + " DZD"}
              icon={RotateCcw}
              color="bg-danger"
            />
            <KPICard
              label="CA net du jour"
              value={formatDZD(data.net_revenue) + " DZD"}
              icon={BarChart2}
              color="bg-success"
              sub="brut − retours"
            />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
            <KPICard
              label="Articles vendus"
              value={data.items_sold}
              icon={ShoppingBag}
              color="bg-accent"
              sub="unités"
            />
            <KPICard
              label="Chèques reçus"
              value={formatDZD(data.cheque_total) + " DZD"}
              icon={CreditCard}
              color="bg-warning"
            />
          </div>

          {/* Bottom section */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Payment breakdown */}
            <div className="card overflow-hidden">
              <div className="card-header">
                <h2 className="font-semibold text-text-primary">Répartition des paiements</h2>
              </div>
              {paymentBreakdown.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Mode de paiement</th>
                        <th className="text-end">Nb transactions</th>
                        <th className="text-end">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentBreakdown.map((row) => (
                        <tr key={row.method}>
                          <td className="font-medium text-text-primary">
                            {t(`payment_method.${row.method}`, { defaultValue: row.method })}
                          </td>
                          <td className="text-end text-text-muted">{row.count}</td>
                          <td className="text-end font-mono font-medium">
                            {formatDZD(row.amount)}{" "}
                            <span className="text-2xs text-text-muted">DZD</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border">
                        <td className="px-3 py-2.5 font-semibold">Total</td>
                        <td className="px-3 py-2.5 text-end text-text-muted">
                          {paymentBreakdown.reduce((s, r) => s + r.count, 0)}
                        </td>
                        <td className="px-3 py-2.5 text-end font-mono font-bold text-primary-600">
                          {formatDZD(data.total_revenue)} DZD
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="card-body text-center text-text-muted py-6">
                  Aucun paiement enregistré.
                </div>
              )}
            </div>

            {/* Top products */}
            <div className="card overflow-hidden">
              <div className="card-header">
                <h2 className="font-semibold text-text-primary">Top 5 articles</h2>
              </div>
              {topProducts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Article</th>
                        <th>Marque</th>
                        <th className="text-end">Unités</th>
                        <th className="text-end">CA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.slice(0, 5).map((product, i) => (
                        <tr key={i}>
                          <td>
                            <span className="w-5 h-5 rounded-full bg-primary-50 text-primary-600 text-xs font-bold flex items-center justify-center">
                              {i + 1}
                            </span>
                          </td>
                          <td className="font-medium text-text-primary">{product.name}</td>
                          <td className="text-text-muted">{product.brand || "—"}</td>
                          <td className="text-end font-mono">{product.units}</td>
                          <td className="text-end font-mono text-primary-600">
                            {formatDZD(product.revenue)}{" "}
                            <span className="text-2xs text-text-muted">DZD</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="card-body text-center text-text-muted py-6">
                  Aucune vente ce jour.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
