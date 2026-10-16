/**
 * PurchaseOrderListPage — /purchase-orders
 * Lists all purchase orders with status filter tabs.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, ShoppingBag, Edit2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import type { PurchaseOrder, POStatus } from "@/types";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
const t = i18n.t.bind(i18n);

const STATUS_TABS: { value: POStatus | ""; label: string }[] = [
  { value: "", label: "Toutes" },
  { value: "draft", label: t("supplier.draft") },
  { value: "sent", label: t("supplier.sent") },
  { value: "partial", label: t("supplier.partial") },
  { value: "received", label: t("supplier.received") },
  { value: "cancelled", label: t("supplier.cancelled") },
];

const STATUS_BADGE: Record<POStatus, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  sent: "bg-blue-50 text-blue-700 border-blue-200",
  partial: "bg-amber-50 text-amber-800 border-amber-200",
  received: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

const STATUS_LABEL: Record<POStatus, string> = {
  draft: t("supplier.draft"),
  sent: t("supplier.sent"),
  partial: t("supplier.partial"),
  received: t("supplier.received"),
  cancelled: t("supplier.cancelled"),
};

export default function PurchaseOrderListPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<POStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<PurchaseOrder>>({
    queryKey: ["purchase-orders", { status, search, page }],
    queryFn: () =>
      api
        .get(
          `/suppliers/purchase-orders/?${status ? `status=${status}&` : ""}search=${encodeURIComponent(search)}&page=${page}`
        )
        .then((r) => r.data),
  });

  const orders = data?.results ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.purchase_orders")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> bon(s) de commande fournisseur
          </p>
        </div>
        <Link to="/purchase-orders/new" className="btn-primary rounded-xl shadow-xs shadow-primary-500/20">
          <Plus size={16} />
          {t("supplier.new_purchase_order")}
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl max-w-fit overflow-x-auto border border-slate-200/80">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatus(tab.value); setPage(1); }}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap",
              status === tab.value
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          data-shortcut-search="true"
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="form-input ps-9 pe-12 bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20 text-xs"
          placeholder={t("supplier.search_po")}
        />
        <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md shadow-2xs pointer-events-none">
          F2
        </kbd>
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.supplier")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.reference")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("supplier.expected_date")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Statut</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.total")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">Chargement...</td>
                </tr>
              )}
              {!isLoading && orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">{t("supplier.no_po_found")}</td>
                </tr>
              )}
              {orders.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3.5">
                    <Link
                      to={`/purchase-orders/${po.id}`}
                      className="font-semibold text-slate-900 hover:text-primary-600 transition-colors font-sans flex items-center gap-2"
                    >
                      <ShoppingBag size={14} className="text-slate-400 shrink-0" />
                      <span>{po.supplier_name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    {po.reference ? (
                      <span className="font-mono font-medium text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60">
                        {po.reference}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs italic">{t("supplier.unspecified_reference")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 text-xs font-mono">
                    {po.expected_date ? formatDate(po.expected_date) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-semibold border", STATUS_BADGE[po.status])}>
                      {STATUS_LABEL[po.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 tabular-nums">
                    {formatDZD(po.total_amount)}{" "}
                    <span className="text-2xs text-slate-400 font-normal">DZD</span>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <div className="flex items-center gap-1.5 justify-end">
                      {po.status === "draft" && (
                        <Link
                          to={`/purchase-orders/${po.id}/edit`}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Modifier le brouillon"
                        >
                          <Edit2 size={13} />
                        </Link>
                      )}
                      <Link
                        to={`/purchase-orders/${po.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-primary-700 bg-primary-50/70 hover:bg-primary-100/70 transition-colors"
                      >
                        {t("common.view")}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total_pages > 1 && (
          <div className="px-4 py-3.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
            <span className="text-xs font-medium text-slate-500">
              Page <span className="font-semibold text-slate-800">{data.current_page}</span> / {data.total_pages} · {data.count} commandes
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
              >
                Précédent
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.next}
                className="btn-secondary py-1.5 px-3 text-xs rounded-xl"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
