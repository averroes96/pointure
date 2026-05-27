import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, ShoppingBag, BarChart2, CreditCard, Printer } from "lucide-react";
import api, { formatDZD } from "@/lib/api";

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
  cash_total: string;
  ccp_total: string;
  virement_total: string;
  cheque_total: string;
  items_sold: number;
  top_products: TopProduct[];
  payment_breakdown: PaymentBreakdownItem[];
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Espèces",
  ccp: "CCP",
  virement: "Virement",
  cheque: "Chèque",
  account: "Compte client",
};

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
  icon: React.FC<{ size?: number; className?: string }>;
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

export default function DailyReportPage() {
  const [date, setDate] = useState<string>(todayISO());

  const { data, isLoading, isError } = useQuery<DailyReport>({
    queryKey: ["reports", "daily", date],
    queryFn: () =>
      api.get(`/reports/daily/?date=${date}`).then((r) => r.data),
    enabled: !!date,
  });

  const topProducts = data?.top_products ?? [];
  const paymentBreakdown = data?.payment_breakdown ?? [];

  return (
    <div className="space-y-5 print:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Rapport journalier</h1>
          <p className="text-sm text-text-muted">Synthèse des ventes par jour</p>
        </div>
        <button onClick={() => window.print()} className="btn-secondary">
          <Printer size={16} />
          Imprimer
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="CA du jour"
              value={formatDZD(data.total_revenue) + " DZD"}
              icon={TrendingUp}
              color="bg-primary-500"
            />
            <KPICard
              label="Nb ventes"
              value={data.sale_count}
              icon={BarChart2}
              color="bg-accent"
              sub="transactions"
            />
            <KPICard
              label="Articles vendus"
              value={data.items_sold}
              icon={ShoppingBag}
              color="bg-success"
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
                            {PAYMENT_METHOD_LABELS[row.method] ?? row.method}
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
