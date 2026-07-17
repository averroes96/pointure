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

function AmountCell({ value, colorClass }: { value: string; colorClass: string }) {
  const { t } = useTranslation();
  const num = parseFloat(value as string);
  if (!num || num === 0)
    return <td className="text-end font-mono text-text-muted text-sm">—</td>;
  return (
    <td className={cn("text-end font-mono text-sm", colorClass)}>
      {formatDZD(value)}
    </td>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i}>
          <div className="h-4 bg-border rounded animate-pulse" style={{ width: i === 0 ? "70%" : "55%" }} />
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.supplier_payables")}</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {isLoading
              ? t("common.loading")
              : `${rows.length} fournisseur(s) avec solde impayé`}
          </p>
        </div>
        <button onClick={handleExport} className="btn-secondary">
          <Download size={15} />{t("common.export_csv")}</button>
      </div>

      {exportError && (
        <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-lg">
          {exportError}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-primary-500 inline-block" />{t("supplier.current_not_due")}</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-warning inline-block" />{t("supplier.days_1_30")}</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />{t("supplier.days_31_60")}</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-danger inline-block" />{t("supplier.days_60_plus")}</span>
      </div>

      {/* Error */}
      {isError && (
        <div className="card px-4 py-6 text-center space-y-2">
          <AlertCircle size={28} className="text-danger mx-auto" />
          <p className="text-text-primary font-medium">{t("common.error_loading")}</p>
          <p className="text-sm text-text-muted">{t("common.error_fetching_data")}</p>
        </div>
      )}

      {/* Table */}
      {!isError && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fournisseur</th>
                  <th className="text-end">
                    <span className="text-primary-600">{t("supplier.current")}</span>
                    <span className="block text-2xs font-normal text-text-muted">{t("supplier.not_due")}</span>
                  </th>
                  <th className="text-end"><span className="text-warning">1–30j</span></th>
                  <th className="text-end"><span className="text-orange-500">31–60j</span></th>
                  <th className="text-end"><span className="text-orange-600">61–90j</span></th>
                  <th className="text-end"><span className="text-danger">+90j</span></th>
                  <th className="text-end">{t("supplier.total_due")}</th>
                </tr>
              </thead>

              <tbody>
                {isLoading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}

                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-text-muted">{t("supplier.no_payables")}</td>
                  </tr>
                )}

                {rows.map((row) => (
                  <tr key={row.supplier_id} className="hover:bg-surface transition-colors">
                    <td>
                      <button
                        onClick={() => navigate(`/suppliers/${row.supplier_id}`)}
                        className="font-medium text-primary-600 hover:underline text-start"
                      >
                        {row.supplier_name}
                      </button>
                      <div className="flex items-center gap-3 mt-0.5">
                        {row.phone && (
                          <span className="text-xs text-text-muted flex items-center gap-1">
                            <Phone size={10} />
                            {row.phone}
                          </span>
                        )}
                        {row.email && (
                          <span className="text-xs text-text-muted flex items-center gap-1">
                            <Mail size={10} />
                            {row.email}
                          </span>
                        )}
                      </div>
                    </td>

                    <AmountCell value={row.current}      colorClass="text-primary-600" />
                    <AmountCell value={row.days_30}      colorClass="text-warning" />
                    <AmountCell value={row.days_60}      colorClass="text-orange-500" />
                    <AmountCell value={row.days_90}      colorClass="text-orange-600" />
                    <AmountCell value={row.days_90_plus} colorClass="text-danger" />

                    <td className="text-end font-mono font-semibold text-sm text-text-primary">
                      {formatDZD(row.total)}{" "}
                      <span className="text-2xs text-text-muted font-normal">DZD</span>
                    </td>
                  </tr>
                ))}
              </tbody>

              {!isLoading && rows.length > 0 && (
                <tfoot>
                  <tr className="bg-surface border-t-2 border-border font-semibold">
                    <td className="text-text-primary text-sm">
                      Total ({rows.length} fournisseur{rows.length > 1 ? "s" : ""})
                    </td>
                    <td className="text-end font-mono text-sm text-primary-600">{formatDZD(totals.current)}</td>
                    <td className="text-end font-mono text-sm text-warning">{formatDZD(totals.days_30)}</td>
                    <td className="text-end font-mono text-sm text-orange-500">{formatDZD(totals.days_60)}</td>
                    <td className="text-end font-mono text-sm text-orange-600">{formatDZD(totals.days_90)}</td>
                    <td className="text-end font-mono text-sm text-danger">{formatDZD(totals.days_90_plus)}</td>
                    <td className="text-end font-mono text-sm text-text-primary">
                      {formatDZD(totals.total)}{" "}
                      <span className="text-2xs text-text-muted font-normal">DZD</span>
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
