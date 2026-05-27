/**
 * Sales History Page — /sales
 * Paginated list of completed/cancelled sales with filters and receipt download.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Receipt, TrendingUp, ShoppingBag, Plus, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import { printReceipt } from "@/lib/receipt";
import type { Sale } from "@/types";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

const STATUS_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "completed", label: "Complétée" },
  { value: "cancelled", label: "Annulée" },
  { value: "refunded", label: "Remboursée" },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Espèces",
  cheque: "Chèque",
  ccp: "CCP",
  virement: "Virement",
  account: "Compte client",
};

export default function SalesHistoryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const storeName = user?.tenant?.name ?? "ShoeDZ";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Sale>>({
    queryKey: ["sales", { search, status, dateFrom, dateTo, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("page", String(page));
      return api.get(`/sales/?${params.toString()}`).then((r) => r.data);
    },
  });

  const sales = data?.results ?? [];

  // Summary totals from current page
  const pageTotalRevenue = sales
    .filter((s) => s.status === "completed")
    .reduce((sum, s) => sum + parseFloat(s.total_amount || "0"), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.sales")}</h1>
          <p className="text-sm text-text-muted">
            {data?.count ?? 0} {t("sales.sale", { count: data?.count ?? 0, defaultValue: "ventes" })}
          </p>
        </div>
        <Link to="/sales/new" className="btn-primary">
          <Plus size={16} />
          Nouvelle vente
        </Link>
      </div>

      {/* KPI strip */}
      {!isLoading && sales.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-success/10 rounded-lg border border-success/20">
            <TrendingUp size={16} className="text-success" />
            <span className="text-sm text-text-muted">CA (page):</span>
            <span className="font-mono font-semibold text-success">{formatDZD(pageTotalRevenue)} DZD</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-primary-50 rounded-lg border border-primary-200">
            <ShoppingBag size={16} className="text-primary-500" />
            <span className="text-sm text-text-muted">Ventes (page):</span>
            <span className="font-mono font-semibold text-primary-600">{sales.filter((s) => s.status === "completed").length}</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9"
            placeholder="N° reçu ou caissier…"
          />
        </div>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="form-input max-w-[160px]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted whitespace-nowrap">Du</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="form-input text-sm py-1.5"
          />
          <label className="text-xs text-text-muted">au</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="form-input text-sm py-1.5"
          />
        </div>

        {(search || status || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(1); }}
            className="btn-ghost btn-sm text-text-muted"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>N° Reçu</th>
                <th>Date</th>
                <th>Caissier</th>
                <th>Client</th>
                <th>Moyens paiement</th>
                <th>{t("common.status")}</th>
                <th className="text-end">Total</th>
                <th className="text-end">Solde dû</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-text-muted">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && sales.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-text-muted">
                    {t("common.no_data")}
                  </td>
                </tr>
              )}

              {sales.map((sale) => (
                <>
                  <tr
                    key={sale.id}
                    className={cn(
                      "cursor-pointer",
                      sale.status === "cancelled" && "opacity-60",
                      expandedId === sale.id && "bg-primary-50/40"
                    )}
                    onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <Receipt size={14} className="text-text-muted flex-shrink-0" />
                        <span className="font-mono font-medium">{sale.receipt_number || `#${sale.id}`}</span>
                      </div>
                    </td>
                    <td className="text-text-muted text-sm">{formatDate(sale.created_at)}</td>
                    <td className="text-sm">{sale.cashier_name || "—"}</td>
                    <td className="text-sm">{sale.client ? `Client #${sale.client}` : <span className="text-text-muted italic">Comptoir</span>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {sale.payments?.map((p, i) => (
                          <span key={i} className="badge badge-neutral text-2xs">
                            {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={cn("badge", getStatusBadgeClass(sale.status))}>
                        {STATUS_OPTIONS.find((o) => o.value === sale.status)?.label ?? sale.status}
                      </span>
                    </td>
                    <td className="text-end font-mono">
                      {formatDZD(sale.total_amount)}
                      <span className="text-2xs text-text-muted ms-1">DZD</span>
                    </td>
                    <td className="text-end">
                      <span
                        className={cn(
                          "font-mono text-sm",
                          parseFloat(sale.balance_due || "0") > 0 ? "text-danger font-semibold" : "text-text-muted"
                        )}
                      >
                        {parseFloat(sale.balance_due || "0") > 0
                          ? `${formatDZD(sale.balance_due)} DZD`
                          : "—"}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-ghost btn-sm text-primary-500"
                        title="Imprimer le bon de vente"
                        onClick={() => printReceipt(sale, storeName)}
                      >
                        <Printer size={14} />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded row: sale items */}
                  {expandedId === sale.id && (
                    <tr key={`${sale.id}-detail`} className="bg-primary-50/20">
                      <td colSpan={9} className="px-6 py-3">
                        <div className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">
                          Articles ({sale.items?.length ?? 0})
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-text-muted">
                              <th className="text-start pb-1 font-medium">Article</th>
                              <th className="text-end pb-1 font-medium">Qté</th>
                              <th className="text-end pb-1 font-medium">P.U.</th>
                              <th className="text-end pb-1 font-medium">Remise</th>
                              <th className="text-end pb-1 font-medium">Sous-total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {(sale.items ?? []).map((item) => (
                              <tr key={item.id}>
                                <td className="py-1">{item.variant_str}</td>
                                <td className="text-end font-mono">{item.quantity}</td>
                                <td className="text-end font-mono">{formatDZD(item.unit_price)}</td>
                                <td className="text-end font-mono text-text-muted">
                                  {parseFloat(item.discount_amount) > 0
                                    ? `-${formatDZD(item.discount_amount)}`
                                    : "—"}
                                </td>
                                <td className="text-end font-mono font-medium">
                                  {formatDZD(item.subtotal)} DZD
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-border">
                              <td colSpan={4} className="text-end pt-2 text-sm font-semibold">
                                Total:
                              </td>
                              <td className="text-end pt-2 font-mono font-bold text-primary-600">
                                {formatDZD(sale.total_amount)} DZD
                              </td>
                            </tr>
                          </tfoot>
                        </table>

                        {/* Notes */}
                        {sale.notes && (
                          <div className="mt-2 text-xs text-text-muted italic">
                            Note: {sale.notes}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Page {data.current_page} / {data.total_pages} · {data.count} ventes
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary btn-sm"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.next}
                className="btn-secondary btn-sm"
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
