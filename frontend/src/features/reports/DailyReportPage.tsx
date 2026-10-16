import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TrendingUp, ShoppingBag, BarChart2, CreditCard, Printer, Download, RotateCcw, Tag, FileSignature, type LucideIcon } from "lucide-react";
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
  total_discounts: string;
  total_stamps: string;
  cash_total: string;
  ccp_total: string;
  virement_total: string;
  cheque_total: string;
  items_sold: number;
  top_products: TopProduct[];
  payment_breakdown: PaymentBreakdownItem[];
}

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
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
          <div className="text-2xl font-bold font-mono tracking-tight text-slate-900 mt-1.5 tabular-nums truncate">{value}</div>
          {sub && <div className="text-xs font-medium text-slate-500 mt-1">{sub}</div>}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </div>
  );
}

function buildDailyReportHtml(data: DailyReport, date: string, t: any): string {
  const paymentRows = data.payment_breakdown
    .map((r) => `
      <tr>
        <td>${t(`payment_method.${r.method}`, { defaultValue: r.method })}</td>
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
  <title>${t("nav.daily_report")} ${date}</title>
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
  <h1>${t("nav.daily_report")}</h1>
  <p style="font-size:11px;color:#555;margin-top:2px;">Date&nbsp;: ${date}</p>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">${t("report.gross_revenue")}</div>
      <div class="kpi-value">${Number(data.total_revenue).toLocaleString("fr-DZ")} DZD</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${t("report.refunds")}</div>
      <div class="kpi-value" style="color:#c0392b;">− ${Number(data.total_refunds).toLocaleString("fr-DZ")} DZD</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${t("report.net_revenue")}</div>
      <div class="kpi-value" style="color:#27ae60;">${Number(data.net_revenue).toLocaleString("fr-DZ")} DZD</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${t("report.sale_count")}</div>
      <div class="kpi-value">${data.sale_count}</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <h2>${t("report.payment_breakdown")}</h2>
      <table>
        <thead><tr><th>${t("payment.method")}</th><th style="text-align:right;">${t("report.nb_count")}</th><th style="text-align:right;">${t("report.amount")}</th></tr></thead>
        <tbody>${paymentRows}</tbody>
        <tfoot>
          <tr>
            <td>${t("common.total")}</td>
            <td style="text-align:right;">${data.payment_breakdown.reduce((s, r) => s + r.count, 0)}</td>
            <td style="text-align:right;">${Number(data.total_revenue).toLocaleString("fr-DZ")} DZD</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div>
      <h2>${t("report.top_5_items")}</h2>
      <table>
        <thead><tr><th>#</th><th>${t("report.item")}</th><th style="text-align:right;">${t("report.qty")}</th><th style="text-align:right;">${t("report.revenue")}</th></tr></thead>
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
      [t("payment.method")]: t(`payment_method.${row.method}`, { defaultValue: row.method }),
      [t("report.nb_count", "Nb transactions")]: row.count,
      [t("report.amount", "Montant (DZD)")]: row.amount,
    }));
    rows.push({
      [t("payment.method")]: t("common.total", "TOTAL"),
      [t("report.nb_count", "Nb transactions")]: data.payment_breakdown.reduce((s, r) => s + r.count, 0),
      [t("report.amount", "Montant (DZD)")]: data.total_revenue,
    });
    downloadCSV(rows, `rapport-journalier-${date}.csv`);
  }

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.daily_report")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">{t("report.daily_summary")}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => data && openPrintPopup(buildDailyReportHtml(data, date, t), "210mm", 15)}
            disabled={!data}
            className="btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl shadow-2xs disabled:opacity-50"
          >
            <Printer size={14} />
            {t("common.print")}
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

      {/* Date picker */}
      <div className="flex items-center gap-3 print:hidden">
        <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">Date d'analyse :</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input max-w-[200px] rounded-xl border-slate-200 text-sm font-mono"
          max={todayISO()}
        />
      </div>

      {/* Print title */}
      <div className="hidden print:block text-center mb-4">
        <h1 className="text-2xl font-bold">{t("nav.daily_report")}</h1>
        <p className="text-gray-500">{date}</p>
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
          {t("report.error_loading_date")}
        </div>
      )}

      {data && !isLoading && (
        <>
          {/* Primary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KPICard
              label="CA brut du jour"
              value={formatDZD(data.total_revenue) + " DZD"}
              icon={TrendingUp}
              color="bg-primary-600"
              sub={`${data.sale_count} vente(s)`}
            />
            <KPICard
              label="Retours / Remboursements"
              value={"− " + formatDZD(data.total_refunds) + " DZD"}
              icon={RotateCcw}
              color="bg-rose-500"
            />
            <KPICard
              label="CA net du jour"
              value={formatDZD(data.net_revenue) + " DZD"}
              icon={BarChart2}
              color="bg-emerald-600"
            />
          </div>

          {/* Secondary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="Articles vendus"
              value={data.items_sold}
              icon={ShoppingBag}
              color="bg-indigo-600"
              sub="unités"
            />
            <KPICard
              label="Chèques reçus"
              value={formatDZD(data.cheque_total) + " DZD"}
              icon={CreditCard}
              color="bg-amber-500"
            />
            <KPICard
              label="Total des remises"
              value={formatDZD(data.total_discounts) + " DZD"}
              icon={Tag}
              color="bg-sky-500"
            />
            <KPICard
              label="Timbres fiscaux"
              value={formatDZD(data.total_stamps) + " DZD"}
              icon={FileSignature}
              color="bg-slate-700"
            />
          </div>

          {/* Bottom section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment breakdown */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">{t("report.payment_breakdown")}</h2>
              </div>
              {paymentBreakdown.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="px-4 py-3.5 text-start">Mode de paiement</th>
                        <th className="px-4 py-3.5 text-end">Nb transactions</th>
                        <th className="px-4 py-3.5 text-end">{t("report.amount")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paymentBreakdown.filter((r) => r.method !== "account").map((row) => (
                        <tr key={row.method} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3.5 font-semibold text-slate-900">
                            {t(`payment_method.${row.method}`, { defaultValue: row.method })}
                          </td>
                          <td className="px-4 py-3.5 text-end font-mono text-xs text-slate-600">{row.count}</td>
                          <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 tabular-nums">
                            {formatDZD(row.amount)}{" "}
                            <span className="text-2xs text-slate-400 font-normal">DZD</span>
                          </td>
                        </tr>
                      ))}
                      {paymentBreakdown.some((r) => r.method === "account") && (
                        <>
                          <tr className="border-t border-slate-200 bg-slate-50/70">
                            <td colSpan={3} className="py-2.5 px-4 text-xs font-bold text-slate-600 uppercase tracking-wider">
                              Solde / Crédit Client
                            </td>
                          </tr>
                          {paymentBreakdown.filter((r) => r.method === "account").map((row) => (
                            <tr key={row.method} className="hover:bg-slate-50/70 transition-colors">
                              <td className="px-4 py-3.5 font-semibold text-slate-900">
                                {t(`payment_method.${row.method}`, { defaultValue: row.method })}
                              </td>
                              <td className="px-4 py-3.5 text-end font-mono text-xs text-slate-600">{row.count}</td>
                              <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-indigo-600 tabular-nums">
                                {formatDZD(row.amount)}{" "}
                                <span className="text-2xs text-slate-400 font-normal">DZD</span>
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                        <td className="px-4 py-3.5 font-bold text-slate-900">{t("common.total")}</td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-slate-700">
                          {paymentBreakdown.reduce((s, r) => s + r.count, 0)}
                        </td>
                        <td className="px-4 py-3.5 text-end font-mono font-bold text-primary-600 text-base tabular-nums">
                          {formatDZD(data.total_revenue)} <span className="text-xs text-slate-400 font-normal">DZD</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400 text-sm font-medium">
                  Aucun paiement enregistré pour cette date.
                </div>
              )}
            </div>

            {/* Top products */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">{t("report.top_5_items")}</h2>
              </div>
              {topProducts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="w-12 px-4 py-3.5 text-center">#</th>
                        <th className="px-4 py-3.5 text-start">{t("report.item")}</th>
                        <th className="px-4 py-3.5 text-start">{t("report.brand")}</th>
                        <th className="px-4 py-3.5 text-end">{t("report.units")}</th>
                        <th className="px-4 py-3.5 text-end">{t("report.revenue")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topProducts.slice(0, 5).map((product, i) => (
                        <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3.5 text-center">
                            <span className="w-7 h-7 rounded-xl bg-primary-50 text-primary-700 text-xs font-bold inline-flex items-center justify-center">
                              {i + 1}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-slate-900">{product.name}</td>
                          <td className="px-4 py-3.5 text-slate-400 font-medium text-xs">{product.brand || "—"}</td>
                          <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-800 tabular-nums">{product.units}</td>
                          <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-primary-600 tabular-nums">
                            {formatDZD(product.revenue)}{" "}
                            <span className="text-2xs text-slate-400 font-normal">DZD</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400 text-sm font-medium">
                  Aucune vente enregistrée ce jour.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
