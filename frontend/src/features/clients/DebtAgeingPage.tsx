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
import { Download, AlertCircle, MapPin, MessageCircle, Search, ExternalLink } from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import type { DebtAgeingRow } from "@/types";
import { cn } from "@/lib/utils";
import { wilayaName } from "@/lib/wilayas";

function sendDebtReminderWhatsApp(row: DebtAgeingRow) {
  const rawPhone = (row.phone || "").replace(/\s+/g, "").replace(/[^0-9+]/g, "");
  let intlPhone = rawPhone;
  if (intlPhone.startsWith("0")) {
    intlPhone = "213" + intlPhone.slice(1);
  } else if (intlPhone.startsWith("+")) {
    intlPhone = intlPhone.slice(1);
  }
  const formattedTotal = formatDZD(row.total);
  const msg =
    `Bonjour ${row.client_name},\n` +
    `Sauf erreur ou omission de notre part, votre solde restant dû en magasin s'élève à *${formattedTotal} DZD*.\n` +
    `Merci de votre confiance !\n` +
    `---\n` +
    `مرحباً ${row.client_name}، نود تذكيركم بأن الرصيد المتبقي في حسابكم هو *${formattedTotal} د.ج*. شكراً لثقتكم!`;
  const url = intlPhone
    ? `https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

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
  bgClass,
  bold = false,
}: {
  value: string;
  colorClass: string;
  bgClass?: string;
  bold?: boolean;
}) {
  const num = parseFloat(value);
  if (!num || num === 0) {
    return <td className="py-3 px-4 text-end font-mono text-slate-300 text-xs">—</td>;
  }
  return (
    <td className="py-3 px-4 text-end">
      <span
        className={cn(
          "font-mono text-xs tabular-nums px-2 py-0.5 rounded-md font-semibold inline-block",
          colorClass,
          bgClass,
          bold && "font-bold text-sm"
        )}
      >
        {formatDZD(value)}
      </span>
    </td>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="py-3.5 px-4">
          <div className="h-4 bg-slate-100 rounded-md" style={{ width: i === 0 ? "80%" : "60%" }} />
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
  const [searchQuery, setSearchQuery] = useState<string>("");

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
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (wilayaFilter && r.wilaya !== wilayaFilter) return false;
      if (q) {
        const matchName = (r.client_name || "").toLowerCase().includes(q);
        const matchPhone = (r.phone || "").toLowerCase().includes(q);
        if (!matchName && !matchPhone) return false;
      }
      return true;
    });
  }, [rows, wilayaFilter, searchQuery]);

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

  async function handleExportExcel() {
    try {
      const response = await api.get("/clients/ageing-csv/", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vieillissement-creances-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.show(t("client.error_debt_ageing"));
    }
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast.message && (
        <div className="fixed top-4 end-4 z-50 bg-slate-900/95 text-white backdrop-blur-md border border-slate-700/50 shadow-2xl rounded-xl px-4 py-3 text-xs font-medium animate-in fade-in duration-200">
          {toast.message}
        </div>
      )}

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">
            Tableau de vieillissement des créances
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            {isLoading ? "Chargement de la balance âgée..." : (
              <>
                <span className="font-mono font-semibold text-slate-700">{filtered.length}</span> clients avec solde dû
              </>
            )}
          </p>
        </div>
        <button onClick={handleExportExcel} className="btn-secondary rounded-xl">
          <Download size={15} />
          {t("common.export_csv")}
        </button>
      </div>

      {/* Top Bucket KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs">
          <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wider block">{t("client.total_receivables")}</span>
          <p className="text-base font-bold font-mono text-slate-900 mt-1 tabular-nums">
            {formatDZD(totals.total)} <span className="text-2xs font-normal text-slate-400">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-blue-200/60 bg-blue-50/40 shadow-2xs">
          <span className="text-2xs font-semibold text-blue-700 uppercase tracking-wider block">{t("client.current_interval")}</span>
          <p className="text-base font-bold font-mono text-blue-800 mt-1 tabular-nums">
            {formatDZD(totals.current)} <span className="text-2xs font-normal text-blue-500">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-amber-200/60 bg-amber-50/40 shadow-2xs">
          <span className="text-2xs font-semibold text-amber-700 uppercase tracking-wider block">31–60j</span>
          <p className="text-base font-bold font-mono text-amber-800 mt-1 tabular-nums">
            {formatDZD(totals.days_30)} <span className="text-2xs font-normal text-amber-500">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-orange-200/60 bg-orange-50/40 shadow-2xs">
          <span className="text-2xs font-semibold text-orange-700 uppercase tracking-wider block">61–90j</span>
          <p className="text-base font-bold font-mono text-orange-800 mt-1 tabular-nums">
            {formatDZD(totals.days_60)} <span className="text-2xs font-normal text-orange-500">DZD</span>
          </p>
        </div>
        <div className="card p-3.5 rounded-xl border border-rose-200/60 bg-rose-50/40 shadow-2xs col-span-2 md:col-span-1">
          <span className="text-2xs font-semibold text-rose-700 uppercase tracking-wider block">{t("client.days_90_plus")}</span>
          <p className="text-base font-bold font-mono text-rose-800 mt-1 tabular-nums">
            {formatDZD(totals.days_90_plus)} <span className="text-2xs font-normal text-rose-500">DZD</span>
          </p>
        </div>
      </div>

      {/* Filter bar & Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("client.search_debt_placeholder")}
              className="form-input ps-9 pe-3 py-2 text-xs rounded-xl bg-white border-slate-200/90 shadow-2xs focus:ring-primary-500/20 w-56"
            />
          </div>
          <div className="relative">
            <MapPin size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={wilayaFilter}
              onChange={(e) => setWilayaFilter(e.target.value)}
              className="form-input ps-9 pe-8 py-2 text-xs rounded-xl bg-white border-slate-200/90 shadow-2xs focus:ring-primary-500/20 max-w-[220px]"
            >
              <option value="">{t("client.wilaya")}</option>
              {wilayas.map((w) => (
                <option key={w} value={w}>{wilayaName(w) || w}</option>
              ))}
            </select>
          </div>

          {(wilayaFilter || searchQuery) && (
            <button
              onClick={() => {
                setWilayaFilter("");
                setSearchQuery("");
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              {t("client.reset_filter")}
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
            <span>{t("client.days_30")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <span>{t("client.days_60")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
            <span>{t("client.days_90")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-600 inline-block" />
            <span>{t("client.days_90_plus")}</span>
          </div>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="card rounded-2xl border border-rose-200 bg-rose-50/50 p-6 text-center space-y-2">
          <AlertCircle size={28} className="text-rose-600 mx-auto" />
          <p className="text-slate-900 font-bold font-sans">Erreur de chargement</p>
          <p className="text-xs text-slate-600">
            Impossible de récupérer les données de vieillissement des créances.
          </p>
        </div>
      )}

      {/* Table Card */}
      {!isError && (
        <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70">
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("invoice.client")}</th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("client.wilaya")}</th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">
                    <span className="text-blue-700">{t("client.current_interval")}</span>
                  </th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">
                    <span className="text-amber-700">{t("client.days_60")}</span>
                  </th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">
                    <span className="text-orange-700">{t("client.days_90")}</span>
                  </th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">
                    <span className="text-rose-700">{t("client.days_90_plus")}</span>
                  </th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("client.total_due")}</th>
                  <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {/* Loading skeletons */}
                {isLoading &&
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}

                {/* Empty state */}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                      Aucune créance trouvée
                      {wilayaFilter ? ` pour la wilaya "${wilayaFilter}"` : ""}.
                    </td>
                  </tr>
                )}

                {/* Data rows */}
                {filtered.map((row) => (
                  <tr key={row.client_id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <button
                        onClick={() => navigate(`/clients/${row.client_id}`)}
                        className="font-semibold text-slate-900 hover:text-primary-600 transition-colors text-start font-sans"
                      >
                        {row.client_name}
                      </button>
                      {row.phone && (
                        <div className="text-xs text-slate-500 font-mono mt-0.5">{row.phone}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 text-xs">
                      {row.wilaya ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                          {wilayaName(row.wilaya) || row.wilaya}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    <AmountCell
                      value={row.current}
                      colorClass="text-blue-700"
                      bgClass={parseFloat(row.current) > 0 ? "bg-blue-50/80" : undefined}
                    />
                    <AmountCell
                      value={row.days_30}
                      colorClass="text-amber-800"
                      bgClass={parseFloat(row.days_30) > 0 ? "bg-amber-50/80" : undefined}
                    />
                    <AmountCell
                      value={row.days_60}
                      colorClass="text-orange-800"
                      bgClass={parseFloat(row.days_60) > 0 ? "bg-orange-50/80" : undefined}
                    />
                    <AmountCell
                      value={row.days_90_plus}
                      colorClass="text-rose-700"
                      bgClass={parseFloat(row.days_90_plus) > 0 ? "bg-rose-50/80" : undefined}
                    />

                    <td className="py-3 px-4 text-end">
                      <span className="font-mono font-bold text-sm text-slate-900 tabular-nums">
                        {formatDZD(row.total)}{" "}
                        <span className="text-2xs text-slate-400 font-normal">DZD</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-end">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => sendDebtReminderWhatsApp(row)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                          title={t("v14.whatsapp_reminder")}
                        >
                          <MessageCircle size={13} />
                          WhatsApp
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/clients/${row.client_id}`)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 transition-colors"
                          title="Voir la fiche client"
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Summary / Totals row */}
              {!isLoading && filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50/90 border-t-2 border-slate-200 font-bold">
                    <td colSpan={2} className="py-3.5 px-4 text-slate-800 text-xs font-sans uppercase tracking-wider">
                      {t("client.total_clients_count", { count: filtered.length })}
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-blue-700 tabular-nums">
                      {formatDZD(totals.current)}
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-amber-800 tabular-nums">
                      {formatDZD(totals.days_30)}
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-orange-800 tabular-nums">
                      {formatDZD(totals.days_60)}
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-rose-700 tabular-nums">
                      {formatDZD(totals.days_90_plus)}
                    </td>
                    <td className="py-3.5 px-4 text-end font-mono text-sm text-slate-900 font-extrabold tabular-nums">
                      {formatDZD(totals.total)}{" "}
                      <span className="text-2xs text-slate-500 font-normal">DZD</span>
                    </td>
                    <td />
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
