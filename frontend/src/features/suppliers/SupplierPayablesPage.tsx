/**
 * SupplierPayablesPage — Tableau de vieillissement des dettes fournisseurs
 * Route: /suppliers/payables
 *
 * Mirrors DebtAgeingPage but for the payable side:
 * what the business owes to each supplier, bucketed by how long it's been overdue.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, Mail, Phone } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import type { PayableAgeingRow } from "@/types";
import { cn } from "@/lib/utils";

// ── Amount cell ───────────────────────────────────────────────────────────────

// ── Amount cell ───────────────────────────────────────────────────────────────

function AmountCell({
  value,
  colorClass,
  bgClass,
}: {
  value: string;
  colorClass: string;
  bgClass?: string;
}) {
  const num = parseFloat(value as string);
  if (!num || num === 0)
    return <td className="py-3 px-4 text-end font-mono text-slate-300 text-xs">—</td>;
  return (
    <td className="py-3 px-4 text-end">
      <span
        className={cn(
          "font-mono text-xs tabular-nums px-2 py-0.5 rounded-md font-semibold inline-block",
          colorClass,
          bgClass
        )}
      >
        {formatDZD(value)}
      </span>
    </td>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="py-3.5 px-4">
          <div className="h-4 bg-slate-100 rounded-md" style={{ width: i === 0 ? "70%" : "55%" }} />
        </td>
      ))}
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SupplierPayablesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: rows = [], isLoading, isError } = useQuery<PayableAgeingRow[]>({
    queryKey: ["reports", "payables-ageing"],
    queryFn: () => api.get("/suppliers/payables-ageing/").then((r) => r.data),
  });

  const totals = useMemo(() =>
    rows.reduce(
      (acc, row) => ({
        current:      acc.current      + parseFloat(row.current      || "0"),
        days_30:      acc.days_30      + parseFloat(row.days_30      || "0"),
        days_60:      acc.days_60      + parseFloat(row.days_60      || "0"),
        days_90:      acc.days_90      + parseFloat(row.days_90      || "0"),
        days_90_plus: acc.days_90_plus + parseFloat(row.days_90_plus || "0"),
        total:        acc.total        + parseFloat(row.total        || "0"),
      }),
      { current: 0, days_30: 0, days_60: 0, days_90: 0, days_90_plus: 0, total: 0 }
    ),
  [rows]);

  async function handleExport() {
    setExportError(null);
    try {
      const res = await api.get("/suppliers/payables-ageing-csv/", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payables-ageing-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(t("common.export_error"));
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.supplier_payables")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            {isLoading
              ? t("common.loading")
              : (
                <>
                  <span className="font-mono font-semibold text-slate-700">{rows.length}</span> fournisseur(s) avec solde impayé
                </>
              )}
          </p>
        </div>
        <button onClick={handleExport} className="btn-secondary rounded-xl">
          <Download size={15} />
          {t("common.export_csv")}
        </button>
      </div>

      {exportError && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-3.5 py-2.5 rounded-xl font-medium">
          {exportError}
        </div>
      )}

      {/* Top Bucket KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs">
          <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wider block">Total Dû Fournisseurs</span>
          <p className="text-base font-bold font-mono text-slate-900 mt-1 tabular-nums">
            {formatDZD(totals.total)} <span className="text-2xs font-normal text-slate-400">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-blue-200/60 bg-blue-50/40 shadow-2xs">
          <span className="text-2xs font-semibold text-blue-700 uppercase tracking-wider block">{t("supplier.current_not_due")}</span>
          <p className="text-base font-bold font-mono text-blue-800 mt-1 tabular-nums">
            {formatDZD(totals.current)} <span className="text-2xs font-normal text-blue-500">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-amber-200/60 bg-amber-50/40 shadow-2xs">
          <span className="text-2xs font-semibold text-amber-700 uppercase tracking-wider block">{t("supplier.days_1_30")}</span>
          <p className="text-base font-bold font-mono text-amber-800 mt-1 tabular-nums">
            {formatDZD(totals.days_30)} <span className="text-2xs font-normal text-amber-500">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-orange-200/60 bg-orange-50/40 shadow-2xs">
          <span className="text-2xs font-semibold text-orange-700 uppercase tracking-wider block">{t("supplier.days_31_60")}</span>
          <p className="text-base font-bold font-mono text-orange-800 mt-1 tabular-nums">
            {formatDZD(totals.days_60)} <span className="text-2xs font-normal text-orange-500">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-rose-200/60 bg-rose-50/40 shadow-2xs col-span-2 md:col-span-1">
          <span className="text-2xs font-semibold text-rose-700 uppercase tracking-wider block">+60j / Retard</span>
          <p className="text-base font-bold font-mono text-rose-800 mt-1 tabular-nums">
            {formatDZD(totals.days_90 + totals.days_90_plus)} <span className="text-2xs font-normal text-rose-500">DZD</span>
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
          {t("supplier.current_not_due")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
          {t("supplier.days_1_30")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
          {t("supplier.days_31_60")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-600 inline-block" />
          {t("supplier.days_60_plus")}
        </span>
      </div>

      {/* Error */}
      {isError && (
        <div className="card rounded-2xl border border-rose-200 bg-rose-50/50 p-6 text-center space-y-2">
          <AlertCircle size={28} className="text-rose-600 mx-auto" />
          <p className="text-slate-900 font-bold font-sans">{t("common.error_loading")}</p>
          <p className="text-xs text-slate-600">{t("common.error_fetching_data")}</p>
        </div>
      )}

      {/* Table Card */}
      {!isError && (
        <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70">
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fournisseur</th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">
                    <span className="text-blue-700">{t("supplier.current")}</span>
                    <span className="block text-2xs font-normal text-slate-400">{t("supplier.not_due")}</span>
                  </th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end"><span className="text-amber-700">1–30j</span></th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end"><span className="text-orange-700">31–60j</span></th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end"><span className="text-orange-800">61–90j</span></th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end"><span className="text-rose-700">+90j</span></th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("supplier.total_due")}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {isLoading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}

                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">{t("supplier.no_payables")}</td>
                  </tr>
                )}

                {rows.map((row) => (
                  <tr key={row.supplier_id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <button
                        onClick={() => navigate(`/suppliers/${row.supplier_id}`)}
                        className="font-semibold text-slate-900 hover:text-primary-600 transition-colors text-start font-sans"
                      >
                        {row.supplier_name}
                      </button>
                      <div className="flex items-center gap-3 mt-0.5">
                        {row.phone && (
                          <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
                            <Phone size={11} className="text-slate-400" />
                            {row.phone}
                          </span>
                        )}
                        {row.email && (
                          <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                            <Mail size={11} className="text-slate-400" />
                            {row.email}
                          </span>
                        )}
                      </div>
                    </td>

                    <AmountCell value={row.current}      colorClass="text-blue-700" bgClass={parseFloat(row.current) > 0 ? "bg-blue-50/80" : undefined} />
                    <AmountCell value={row.days_30}      colorClass="text-amber-800" bgClass={parseFloat(row.days_30) > 0 ? "bg-amber-50/80" : undefined} />
                    <AmountCell value={row.days_60}      colorClass="text-orange-800" bgClass={parseFloat(row.days_60) > 0 ? "bg-orange-50/80" : undefined} />
                    <AmountCell value={row.days_90}      colorClass="text-orange-900" bgClass={parseFloat(row.days_90) > 0 ? "bg-orange-100/80" : undefined} />
                    <AmountCell value={row.days_90_plus} colorClass="text-rose-700" bgClass={parseFloat(row.days_90_plus) > 0 ? "bg-rose-50/80" : undefined} />

                    <td className="py-3 px-4 text-end">
                      <span className="font-mono font-bold text-sm text-slate-900 tabular-nums">
                        {formatDZD(row.total)}{" "}
                        <span className="text-2xs text-slate-400 font-normal">DZD</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>

              {!isLoading && rows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50/90 border-t-2 border-slate-200 font-bold">
                    <td className="py-3.5 px-4 text-slate-800 text-xs font-sans uppercase tracking-wider">
                      Total ({rows.length} fournisseur{rows.length > 1 ? "s" : ""})
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-blue-700 tabular-nums">{formatDZD(totals.current)}</td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-amber-800 tabular-nums">{formatDZD(totals.days_30)}</td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-orange-800 tabular-nums">{formatDZD(totals.days_60)}</td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-orange-900 tabular-nums">{formatDZD(totals.days_90)}</td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-rose-700 tabular-nums">{formatDZD(totals.days_90_plus)}</td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-slate-900 font-extrabold tabular-nums">
                      {formatDZD(totals.total)}{" "}
                      <span className="text-2xs text-slate-500 font-normal">DZD</span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
