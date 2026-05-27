/**
 * DebtAgeingPage — Tableau de vieillissement des créances
 * Route: /clients/ageing  (or /reports/ageing)
 *
 * Fetches GET /clients/ageing/ → DebtAgeingRow[]
 * Columns: Client, Wilaya, Courant (0-30j), 31-60j, 61-90j, +90j, Total
 * Color coding per ageing bucket.
 * Filter by wilaya. Summary row at bottom. Excel export stub.
 */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, AlertCircle, MapPin } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import type { DebtAgeingRow } from "@/types";
import { cn } from "@/lib/utils";

// ── Toast (inline, no external lib assumed) ────────────────────────────────

function useToast() {
  const [message, setMessage] = useState<string | null>(null);

  function show(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  return { message, show };
}

// ── Amount cell with colour coding ────────────────────────────────────────

function AmountCell({
  value,
  colorClass,
  bold = false,
}: {
  value: string;
  colorClass: string;
  bold?: boolean;
}) {
  const num = parseFloat(value);
  if (!num || num === 0) {
    return <td className="text-end font-mono text-text-muted text-sm">—</td>;
  }
  return (
    <td className={cn("text-end font-mono text-sm", colorClass, bold && "font-bold")}>
      {formatDZD(value)}
    </td>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i}>
          <div className="h-4 bg-border rounded animate-pulse" style={{ width: i === 0 ? "80%" : "60%" }} />
        </td>
      ))}
    </tr>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function DebtAgeingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [wilayaFilter, setWilayaFilter] = useState<string>("");

  const { data: rows = [], isLoading, isError } = useQuery<DebtAgeingRow[]>({
    queryKey: ["reports", "ageing"],
    queryFn: () => api.get("/clients/ageing/").then((r) => r.data),
  });

  // Unique wilayas for dropdown
  const wilayas = useMemo(
    () => Array.from(new Set(rows.map((r) => r.wilaya).filter(Boolean))).sort(),
    [rows]
  );

  // Filtered rows
  const filtered = useMemo(
    () =>
      wilayaFilter
        ? rows.filter((r) => r.wilaya === wilayaFilter)
        : rows,
    [rows, wilayaFilter]
  );

  // Totals per bucket
  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, row) => ({
        current: acc.current + parseFloat(row.current || "0"),
        days_30: acc.days_30 + parseFloat(row.days_30 || "0"),
        days_60: acc.days_60 + parseFloat(row.days_60 || "0"),
        days_90: acc.days_90 + parseFloat(row.days_90 || "0"),
        days_90_plus: acc.days_90_plus + parseFloat(row.days_90_plus || "0"),
        total: acc.total + parseFloat(row.total || "0"),
      }),
      { current: 0, days_30: 0, days_60: 0, days_90: 0, days_90_plus: 0, total: 0 }
    );
  }, [filtered]);

  function handleExportExcel() {
    toast.show("Bientôt disponible");
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast.message && (
        <div className="fixed top-4 end-4 z-50 bg-surface border border-border shadow-lg rounded-lg px-4 py-3 text-sm text-text-primary">
          {toast.message}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            Tableau de vieillissement des créances
          </h1>
          <p className="text-sm text-text-muted mt-0.5">
            {isLoading ? "Chargement..." : `${filtered.length} clients avec solde`}
          </p>
        </div>
        <button onClick={handleExportExcel} className="btn-secondary">
          <Download size={15} />
          Exporter Excel
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin size={15} className="text-text-muted flex-shrink-0" />
          <select
            value={wilayaFilter}
            onChange={(e) => setWilayaFilter(e.target.value)}
            className="form-input max-w-[200px]"
          >
            <option value="">Toutes les wilayas</option>
            {wilayas.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>

        {wilayaFilter && (
          <button
            onClick={() => setWilayaFilter("")}
            className="btn-ghost btn-sm text-text-muted hover:text-text-primary"
          >
            Réinitialiser le filtre
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-primary-500 inline-block" />
          <span>Courant (0-30j)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-warning inline-block" />
          <span>31-60 jours</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
          <span>61-90 jours</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-danger inline-block" />
          <span>+90 jours</span>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="card px-4 py-6 text-center space-y-2">
          <AlertCircle size={28} className="text-danger mx-auto" />
          <p className="text-text-primary font-medium">Erreur de chargement</p>
          <p className="text-sm text-text-muted">
            Impossible de récupérer les données de vieillissement.
          </p>
        </div>
      )}

      {/* Table */}
      {!isError && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Wilaya</th>
                  <th className="text-end">
                    <span className="text-primary-600">Courant</span>
                    <span className="block text-2xs font-normal text-text-muted">0-30j</span>
                  </th>
                  <th className="text-end">
                    <span className="text-warning">31-60j</span>
                  </th>
                  <th className="text-end">
                    <span className="text-orange-500">61-90j</span>
                  </th>
                  <th className="text-end">
                    <span className="text-danger">+90j</span>
                  </th>
                  <th className="text-end">Total</th>
                </tr>
              </thead>

              <tbody>
                {/* Loading skeletons */}
                {isLoading &&
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}

                {/* Empty state */}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-text-muted">
                      Aucune créance trouvée
                      {wilayaFilter ? ` pour la wilaya "${wilayaFilter}"` : ""}.
                    </td>
                  </tr>
                )}

                {/* Data rows */}
                {filtered.map((row) => (
                  <tr key={row.client_id} className="hover:bg-surface-hover transition-colors">
                    <td>
                      <button
                        onClick={() => navigate(`/clients/${row.client_id}`)}
                        className="font-medium text-primary-600 hover:underline text-start"
                      >
                        {row.client_name}
                      </button>
                      {row.phone && (
                        <div className="text-xs text-text-muted mt-0.5">{row.phone}</div>
                      )}
                    </td>
                    <td className="text-text-muted">{row.wilaya || "—"}</td>

                    <AmountCell
                      value={row.current}
                      colorClass="text-primary-600"
                    />
                    <AmountCell
                      value={row.days_30}
                      colorClass="text-warning"
                    />
                    <AmountCell
                      value={row.days_60}
                      colorClass="text-orange-500"
                    />
                    <AmountCell
                      value={row.days_90_plus}
                      colorClass="text-danger"
                    />

                    <td className="text-end font-mono font-semibold text-sm text-text-primary">
                      {formatDZD(row.total)}{" "}
                      <span className="text-2xs text-text-muted font-normal">DZD</span>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Summary / Totals row */}
              {!isLoading && filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-surface border-t-2 border-border font-semibold">
                    <td colSpan={2} className="text-text-primary text-sm">
                      Total ({filtered.length} clients)
                    </td>
                    <td className="text-end font-mono text-sm text-primary-600">
                      {formatDZD(totals.current)}
                    </td>
                    <td className="text-end font-mono text-sm text-warning">
                      {formatDZD(totals.days_30)}
                    </td>
                    <td className="text-end font-mono text-sm text-orange-500">
                      {formatDZD(totals.days_60)}
                    </td>
                    <td className="text-end font-mono text-sm text-danger">
                      {formatDZD(totals.days_90_plus)}
                    </td>
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
