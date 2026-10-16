import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, ArrowUpDown } from "lucide-react";
import api, { formatDate, type PaginatedResponse } from "@/lib/api";
import type { StockMovement, MovementReason, Branch } from "@/types";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
const t = i18n.t.bind(i18n);

// REASON_LABELS generated inline using t("movement_reason." + reason)

const REASON_BADGE_CLASS: Record<MovementReason, string> = {
  sale: "badge-danger",
  reception: "badge-success",
  adjustment: "badge-info",
  return: "badge-warning",
  transfer_out: "badge-neutral",
  transfer_in: "badge-info",
  damaged: "badge-danger",
  initial: "badge-neutral",
};

const REASONS = ["sale", "reception", "adjustment", "return", "transfer_out", "transfer_in", "damaged", "initial"];

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: t("inventory.all_reasons") },
  ...REASONS.map((value) => ({ value, label: t(`movement_reason.${value}`) })),
];

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StockMovementsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaginatedResponse<StockMovement>>({
    queryKey: ["stock-movements", { search, reason, dateFrom, dateTo, branchId, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (reason) params.set("reason", reason);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (branchId) params.set("branch", branchId);
      params.set("page", String(page));
      return api.get(`/inventory/movements/?${params.toString()}`).then((r) => r.data);
    },
  });

  const { data: branchesData } = useQuery<PaginatedResponse<Branch>>({
    queryKey: ["branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data),
  });

  const movements = data?.results ?? [];
  const branches = branchesData?.results ?? [];

  function handleReset() {
    setSearch("");
    setReason("");
    setDateFrom("");
    setDateTo("");
    setBranchId("");
    setPage(1);
  }

  function handleExportCSV() {
    const headers = ["Date/Heure", "Article", "Dépôt", "Motif", "Δ Quantité", "Référence", "Opérateur"];
    const rows = movements.map((m) => [
      formatTimestamp(m.timestamp),
      m.variant_str,
      m.branch_name,
      (t(`movement_reason.${m.reason}`) !== `movement_reason.${m.reason}` ? t(`movement_reason.${m.reason}`) : m.reason),
      m.quantity_delta > 0 ? `+${m.quantity_delta}` : String(m.quantity_delta),
      m.reference_id,
      m.user_email,
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mouvements-stock-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("inventory.stock_movements")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">{t("inventory.movement_count", { count: data?.count ?? 0 })}</p>
        </div>
        <button onClick={handleExportCSV} className="btn-secondary self-start sm:self-auto flex items-center gap-2">
          <Download size={15} />
          Exporter CSV
        </button>
      </div>

      {/* Filters Card */}
      <div className="card rounded-2xl border border-slate-200/80 p-5 shadow-xs bg-white space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Variant search */}
          <div className="relative lg:col-span-1">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="form-input ps-9 bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
              placeholder={t("inventory.search_article")}
            />
          </div>

          {/* Reason */}
          <select
            value={reason}
            onChange={(e) => { setReason(e.target.value); setPage(1); }}
            className="form-input bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
          >
            {[{ value: "", label: t("inventory.all_reasons") }, "sale", "reception", "adjustment", "return", "transfer_out", "transfer_in", "damaged", "initial"].map(opt => typeof opt === "string" ? { value: opt, label: t(`movement_reason.${opt}`) } : opt).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="form-input bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
            placeholder={t("common.from")}
          />

          {/* Date to */}
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="form-input bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
            placeholder={t("common.to")}
          />

          {/* Branch */}
          <select
            value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
            className="form-input bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
          >
            <option value="">{t("inventory.all_branches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {(search || reason || dateFrom || dateTo || branchId) && (
          <div className="pt-2 flex items-center gap-2 border-t border-slate-100">
            <button onClick={handleReset} className="btn-ghost btn-sm text-slate-500 hover:text-slate-800 font-medium">
              Réinitialiser les filtres
            </button>
          </div>
        )}
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.datetime")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.product")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.warehouse")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.reason")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("inventory.delta_qty")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.reference")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("inventory.operator")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">{t("common.loading")}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    <span className="text-sm">{t("inventory.no_movement_found")}</span>
                  </td>
                </tr>
              )}
              {movements.map((movement) => (
                <tr key={movement.id} className="group hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 text-slate-500 text-xs font-mono tabular-nums whitespace-nowrap">
                    {formatTimestamp(movement.timestamp)}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown size={13} className="text-slate-400 flex-shrink-0" />
                      <span className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">{movement.variant_str}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 font-medium text-sm">{movement.branch_name || "—"}</td>
                  <td className="py-3.5 px-4">
                    <span className={cn("badge", REASON_BADGE_CLASS[movement.reason] ?? "badge-neutral")}>
                      {(t(`movement_reason.${movement.reason}`) !== `movement_reason.${movement.reason}` ? t(`movement_reason.${movement.reason}`) : movement.reason)}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-end">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-xs tabular-nums border",
                        movement.quantity_delta > 0
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200"
                      )}
                    >
                      {movement.quantity_delta > 0
                        ? `+${movement.quantity_delta}`
                        : movement.quantity_delta}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-400 text-2xs font-mono">
                    {movement.reference_id || "—"}
                  </td>
                  <td className="py-3.5 px-4 text-slate-500 text-xs font-mono">{movement.user_email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-5 py-3.5 border-t border-slate-200/80 bg-slate-50/40 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              {t("inventory.page_info_movements", { current: data.current_page, total: data.total_pages, count: data.count })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!data.previous}
                className="btn-secondary btn-sm"
              >
                Précédent
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.next}
                className="btn-secondary btn-sm"
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
