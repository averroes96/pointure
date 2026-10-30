import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Landmark,
  Plus,
  Search,
  Printer,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Cheque, Client, Supplier } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

export const ALGERIAN_BANKS = [
  "BNA (Banque Nationale d'Algérie)",
  "BEA (Banque Extérieure d'Algérie)",
  "CPA (Crédit Populaire d'Algérie)",
  "BADR (Banque de l'Agriculture et du Développement Rural)",
  "BDL (Banque de Développement Local)",
  "CNEP Banque",
  "Algérie Poste / CCP",
  "AGB (Gulf Bank Algérie)",
  "Banque Al Baraka d'Algérie",
  "Al Salam Bank Algeria",
  "Société Générale Algérie",
  "BNP Paribas El Djazaïr",
  "Housing Bank (HBTF)",
  "Trust Bank Algeria",
  "Natixis Algérie",
  "Fransabank El Djazaïr",
];

function printChequeDepositSlip(cheques: Cheque[], storeName: string, t?: (k: string, fallback?: string) => string) {
  const lang = i18n.language || "fr";
  const isRtl = lang.startsWith("ar");
  const translate = t || ((k: string, fb?: string) => i18n.t(k, fb || k));

  const pendingReceivables = cheques.filter(
    (c) => c.status === "pending" && c.direction === "receivable",
  );
  const list = pendingReceivables.length > 0 ? pendingReceivables : cheques;
  const totalAmount = list.reduce((s, c) => s + parseFloat(c.amount || "0"), 0);

  const win = window.open("", "_blank");
  if (!win) return;

  const rowsHtml = list
    .map(
      (c, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td style="font-family:monospace;font-weight:bold;">${c.number}</td>
        <td>${c.bank || "—"}</td>
        <td>${c.client_name || c.supplier_name || "—"}</td>
        <td>${c.direction === "payable" ? translate("cheque.supplier_outgoing", "Fournisseur (Sortant)") : translate("cheque.client_incoming", "Client (Entrant)")}</td>
        <td style="font-family:monospace;">${formatDate(c.due_date)}</td>
        <td style="text-align:${isRtl ? 'left' : 'right'};font-family:monospace;font-weight:bold;">${formatDZD(c.amount)} ${translate("common.dzd", "DZD")}</td>
      </tr>`,
    )
    .join("");

  const slipTitle = translate("cheque.schedule_slip", "Bordereau d'Échéancier Chèques");
  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <meta name="color-scheme" content="light" />
  <title>${slipTitle} — ${storeName}</title>
  <style>
    :root { color-scheme: light !important; }
    html, body {
      background: #ffffff !important;
      color: #0f172a !important;
      color-scheme: light !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
      margin: 28px;
      font-size: 12px;
      direction: ${isRtl ? 'rtl' : 'ltr'};
    }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 18px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: ${isRtl ? 'right' : 'left'}; }
    th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; font-weight: 700; }
    .total-box { margin-top: 16px; text-align: ${isRtl ? 'left' : 'right'}; font-size: 15px; font-weight: bold; font-family: monospace; }
    .signatures { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 40px; }
    .sig-box { width: 220px; border-top: 1px solid #0f172a; text-align: center; padding-top: 8px; font-weight: bold; }
    @media print {
      body { margin: 12px; background: #ffffff !important; color: #0f172a !important; }
      @page { size: A4; margin: 1.5cm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${storeName} — ${translate("cheque.deposit_slip_heading", "BORDEREAU & ÉCHÉANCIER DES CHÈQUES")}</h1>
      <p style="margin:4px 0;color:#64748b;">${translate("cheque.generated_on", "Édité le")} ${new Date().toLocaleString(lang === "ar" ? "ar-DZ" : lang === "en" ? "en-US" : "fr-DZ")}</p>
    </div>
    <div style="text-align:${isRtl ? 'left' : 'right'};">
      <strong>${translate("cheque.cheque_count", "Nombre de chèques :")}</strong> ${list.length}<br/>
      <strong>${translate("common.total", "Total :")}</strong> ${formatDZD(totalAmount)} ${translate("common.dzd", "DZD")}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px;text-align:center;">#</th>
        <th>${translate("cheque.col_cheque_no", "N° Chèque")}</th>
        <th>${translate("cheque.col_bank", "Banque")}</th>
        <th>${translate("cheque.col_party", "Tiers (Client / Fournisseur)")}</th>
        <th>${translate("cheque.col_direction", "Sens")}</th>
        <th>${translate("cheque.col_due_date", "Échéance")}</th>
        <th style="text-align:${isRtl ? 'left' : 'right'};">${translate("cheque.col_amount", "Montant")}</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="total-box">${translate("cheque.total_slip", "TOTAL BORDEREAU")} : ${formatDZD(totalAmount)} ${translate("common.dzd", "DZD")}</div>
  <div class="signatures">
    <div class="sig-box">${translate("cheque.depositor_stamp", "Visa & Cachet du Déposant")}</div>
    <div class="sig-box">${translate("cheque.bank_acknowledgement", "Accusé de Réception Banque")}</div>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
}

export default function ChequePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const storeName = user?.tenant?.name ?? "Pointure";

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [directionFilter, setDirectionFilter] = useState<string>("");
  const [bankFilter, setBankFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const queryParams = new URLSearchParams({ ordering: "due_date" });
  if (search.trim()) queryParams.set("search", search.trim());
  if (statusFilter) queryParams.set("status", statusFilter);
  if (directionFilter) queryParams.set("direction", directionFilter);
  if (bankFilter) queryParams.set("bank", bankFilter);
  if (fromDate) queryParams.set("from", fromDate);
  if (toDate) queryParams.set("to", toDate);

  const { data, isLoading } = useQuery<PaginatedResponse<Cheque>>({
    queryKey: ["cheques", search, statusFilter, directionFilter, bankFilter, fromDate, toDate],
    queryFn: () => api.get(`/clients/cheques/?${queryParams.toString()}`).then((r) => r.data),
  });

  const depositMutation = useMutation({
    mutationFn: (id: number | string) =>
      api.post(`/clients/cheques/${id}/mark-deposited/`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });

  const bounceMutation = useMutation({
    mutationFn: (id: number | string) =>
      api.post(`/clients/cheques/${id}/mark-bounced/`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });

  const pendingMutation = useMutation({
    mutationFn: (id: number | string) =>
      api.post(`/clients/cheques/${id}/mark-pending/`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => api.delete(`/clients/cheques/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });

  const cheques = data?.results ?? [];

  const urgentCount = cheques.filter(
    (c) => c.status === "pending" && c.days_until_due <= 3,
  ).length;

  const pendingReceivables = cheques.filter(
    (c) => c.status === "pending" && c.direction !== "payable",
  );
  const pendingReceivableTotal = pendingReceivables.reduce(
    (acc, c) => acc + parseFloat(c.amount || "0"),
    0,
  );

  const pendingPayables = cheques.filter(
    (c) => c.status === "pending" && c.direction === "payable",
  );
  const pendingPayableTotal = pendingPayables.reduce(
    (acc, c) => acc + parseFloat(c.amount || "0"),
    0,
  );

  const depositedTotal = cheques
    .filter((c) => c.status === "deposited")
    .reduce((acc, c) => acc + parseFloat(c.amount || "0"), 0);

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black font-sans tracking-tight text-slate-900">
            {t("nav.cheque_tracker", "Chèques & Échéancier Bancaire")}
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Suivi des chèques clients à encaisser et chèques fournisseurs à décaisser ·{" "}
            <span className="font-mono font-bold text-slate-700">{cheques.length}</span> chèque(s)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {cheques.length > 0 && (
            <button
              type="button"
              onClick={() => printChequeDepositSlip(cheques, storeName, t)}
              className="btn-secondary btn-sm flex items-center gap-1.5"
            >
              <Printer size={15} />
              {t("cheque.print_schedule_slip")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="btn-primary btn-sm flex items-center gap-1.5 cursor-pointer"
          >
            <Plus size={16} />
            {t("cheque.new_cheque")}
          </button>
        </div>
      </div>

      {/* Upcoming Alert */}
      {urgentCount > 0 && (
        <div className="rounded-2xl border border-amber-200/90 bg-amber-50/70 p-4 flex items-center gap-3.5 shadow-2xs">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-bold text-amber-900 font-sans uppercase tracking-wider">
              {t("cheque.near_or_overdue")}
            </h4>
            <p className="text-xs text-amber-800 mt-0.5 font-medium">
              <span className="font-bold">{urgentCount} {t("cheque.cheque_count", { count: urgentCount })}</span> {t("client.due_in_3_days", { count: urgentCount })}
            </p>
          </div>
        </div>
      )}

      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="card p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t("cheque.to_collect_clients")}
            </span>
            <p className="text-lg font-black font-mono text-blue-700 dark:text-blue-400 mt-1 tabular-nums">
              {formatDZD(pendingReceivableTotal)}{" "}
              <span className="text-2xs font-normal text-slate-400">DZD</span>
            </p>
            <span className="text-2xs text-slate-500 dark:text-slate-400 font-medium">
              {t("cheque.cheque_count", { count: pendingReceivables.length })}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <ArrowDownLeft size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t("cheque.to_pay_suppliers")}
            </span>
            <p className="text-lg font-black font-mono text-indigo-700 dark:text-indigo-400 mt-1 tabular-nums">
              {formatDZD(pendingPayableTotal)}{" "}
              <span className="text-2xs font-normal text-slate-400">DZD</span>
            </p>
            <span className="text-2xs text-slate-500 dark:text-slate-400 font-medium">
              {t("cheque.cheque_count", { count: pendingPayables.length })}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <ArrowUpRight size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-amber-200/70 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/30 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
              {t("cheque.near_or_overdue")}
            </span>
            <p className="text-lg font-black font-mono text-amber-900 dark:text-amber-300 mt-1 tabular-nums">
              {urgentCount} <span className="text-2xs font-normal text-amber-600 dark:text-amber-400">{t("cheque.cheque_count", { count: urgentCount })}</span>
            </p>
            <span className="text-2xs text-amber-700 dark:text-amber-400 font-medium">J ≤ 3 {t("cheque.days_until_due")}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t("cheque.deposited_collected")}
            </span>
            <p className="text-lg font-black font-mono text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
              {formatDZD(depositedTotal)}{" "}
              <span className="text-2xs font-normal text-slate-400">DZD</span>
            </p>
            <span className="text-2xs text-slate-500 dark:text-slate-400 font-medium">
              {t("cheque.cheque_count", { count: cheques.filter((c) => c.status === "deposited").length })}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Landmark size={20} />
          </div>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="card p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cheque.search_placeholder")}
              className="form-input pl-9 text-xs h-10"
            />
          </div>

          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="form-input text-xs h-10 md:w-48"
          >
            <option value="">{t("cheque.all_directions")}</option>
            <option value="receivable">{t("cheque.incoming_clients")}</option>
            <option value="payable">{t("cheque.outgoing_suppliers")}</option>
          </select>

          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="form-input text-xs h-10 md:w-52"
          >
            <option value="">{t("cheque.bank")}</option>
            {ALGERIAN_BANKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          {/* Status Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { value: "", label: t("invoice.status_all") },
              { value: "pending", label: t("status.pending") },
              { value: "deposited", label: t("cheque.status_deposited") },
              { value: "bounced", label: t("cheque.status_bounced") },
            ].map((st) => (
              <button
                key={st.value}
                type="button"
                onClick={() => setStatusFilter(st.value)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer",
                  statusFilter === st.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100",
                )}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">{t("cheque.due_date_from")}</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="form-input h-8 text-xs px-2.5 w-36"
            />
            <span className="text-slate-500 font-medium">{t("common.to")}</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="form-input h-8 text-xs px-2.5 w-36"
            />
            {(search || statusFilter || directionFilter || bankFilter || fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
                  setDirectionFilter("");
                  setBankFilter("");
                  setFromDate("");
                  setToDate("");
                }}
                className="text-xs text-rose-600 hover:underline font-semibold ml-1"
              >
                {t("client.reset_filter")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden bg-white dark:bg-slate-900/90">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t("cheque.number")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t("cheque.direction_and_party")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t("cheque.bank")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t("cheque.due_date")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t("client.delay")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">
                  {t("cheque.amount")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t("common.status")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-end">
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                    {t("common.loading", "Chargement…")}
                  </td>
                </tr>
              )}
              {!isLoading && cheques.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-14 text-slate-500 text-sm">
                    <Landmark size={36} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="font-bold text-slate-700 dark:text-slate-200">{t("cheque.no_cheques_recorded")}</p>
                    <p className="text-xs text-slate-400 mt-1 mb-4">
                      {t("cheque.no_cheques_desc")}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(true)}
                      className="btn-primary btn-sm inline-flex items-center gap-1.5"
                    >
                      <Plus size={15} />
                      {t("cheque.new_cheque")}
                    </button>
                  </td>
                </tr>
              )}
              {cheques.map((cheque) => (
                <tr key={cheque.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="font-mono font-bold text-slate-900 dark:text-white text-sm">{cheque.number}</div>
                    {cheque.notes && (
                      <div className="text-2xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">{cheque.notes}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-3xs font-bold uppercase",
                          cheque.direction === "payable"
                            ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                            : "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800",
                        )}
                      >
                        {cheque.direction === "payable" ? (
                          <>
                            <ArrowUpRight size={10} /> {t("supplier.supplier")}
                          </>
                        ) : (
                          <>
                            <ArrowDownLeft size={10} /> {t("invoice.client")}
                          </>
                        )}
                      </span>
                      <span className="font-sans font-bold text-slate-800 dark:text-slate-200 text-sm">
                        {cheque.client_name || cheque.supplier_name || t("cheque.unspecified_party")}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300 text-xs font-medium">
                    {cheque.bank ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                        {cheque.bank}
                      </span>
                    ) : (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300 text-xs font-mono">
                    {formatDate(cheque.due_date)}
                  </td>
                  <td className="px-4 py-3.5">
                    {cheque.status === "pending" && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                          cheque.days_until_due <= 0
                            ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                            : cheque.days_until_due <= 3
                            ? "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                            : "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800",
                        )}
                      >
                        <Clock size={11} />
                        {cheque.days_until_due < 0
                          ? `${t("invoice.status_overdue")} (${Math.abs(cheque.days_until_due)}j)`
                          : cheque.days_until_due === 0
                          ? t("common.today")
                          : `J-${cheque.days_until_due}`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                    {formatDZD(cheque.amount)}{" "}
                    <span className="text-2xs font-normal text-slate-400">DZD</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                        cheque.status === "deposited"
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                          : cheque.status === "bounced"
                          ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                          : "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
                      )}
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          cheque.status === "deposited"
                            ? "bg-emerald-500"
                            : cheque.status === "bounced"
                            ? "bg-rose-500"
                            : "bg-amber-500",
                        )}
                      />
                      {cheque.status === "deposited"
                        ? t("cheque.mark_deposited")
                        : cheque.status === "bounced"
                        ? t("cheque.mark_bounced")
                        : t("status.pending")}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <div className="flex items-center justify-end gap-1.5">
                      {cheque.status === "pending" ? (
                        <>
                          <button
                            onClick={() => depositMutation.mutate(cheque.id)}
                            disabled={depositMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-bold rounded-lg text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                            title={t("cheque.mark_deposited", "Marquer comme encaissé")}
                          >
                            <CheckCircle2 size={12} />
                            Encaisser
                          </button>
                          <button
                            onClick={() => bounceMutation.mutate(cheque.id)}
                            disabled={bounceMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-bold rounded-lg text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                            title={t("cheque.mark_bounced", "Marquer comme rejeté")}
                          >
                            <XCircle size={12} />
                            Rejeter
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => pendingMutation.mutate(cheque.id)}
                          disabled={pendingMutation.isPending}
                          className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-semibold rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                          title={t("supplier.revert_draft", "Remettre en attente")}
                        >
                          <RotateCcw size={12} />
                          {t("status.pending")}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm(t("cheque.delete_confirm", { number: cheque.number }))) {
                            deleteMutation.mutate(cheque.id);
                          }
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                        title={t("common.delete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreateModal && (
        <CreateChequeModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ["cheques"] });
          }}
        />
      )}
    </div>
  );
}

// ── Create Cheque Modal ───────────────────────────────────────────────────

function CreateChequeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<"receivable" | "payable">("receivable");
  const [clientId, setClientId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [number, setNumber] = useState("");
  const [bank, setBank] = useState("BNA (Banque Nationale d'Algérie)");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: clientsData } = useQuery<PaginatedResponse<Client>>({
    queryKey: ["clients-cheque-modal"],
    queryFn: () => api.get("/clients/?page_size=200").then((r) => r.data),
    enabled: direction === "receivable",
  });

  const { data: suppliersData } = useQuery<PaginatedResponse<Supplier>>({
    queryKey: ["suppliers-cheque-modal"],
    queryFn: () => api.get("/suppliers/?page_size=200").then((r) => r.data),
    enabled: direction === "payable",
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api
        .post("/clients/cheques/", {
          direction,
          client: direction === "receivable" && clientId ? clientId : null,
          supplier: direction === "payable" && supplierId ? supplierId : null,
          number: number.trim(),
          bank: bank.trim(),
          amount: parseFloat(amount) || 0,
          due_date: dueDate,
          notes: notes.trim(),
        })
        .then((r) => r.data),
    onSuccess: () => onCreated(),
    onError: (err) => setError(getApiError(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-border dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary-100 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300">
              <Landmark size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">{t("cheque.record_new_cheque_title")}</h3>
              <p className="text-2xs text-slate-500 dark:text-slate-400">
                {t("client.cheque_tracker")}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          className="p-5 space-y-4"
        >
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium">
              {error}
            </div>
          )}

          {/* Direction selector */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setDirection("receivable")}
              className={cn(
                "p-3 rounded-2xl border text-left transition-all cursor-pointer",
                direction === "receivable"
                  ? "border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 ring-2 ring-blue-500/20"
                  : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900 dark:text-blue-300">
                <ArrowDownLeft size={15} className="text-blue-600 dark:text-blue-400" />
                {t("cheque.client_incoming")}
              </div>
              <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">{t("cheque.cheque_client_desc")}</p>
            </button>

            <button
              type="button"
              onClick={() => setDirection("payable")}
              className={cn(
                "p-3 rounded-2xl border text-left transition-all cursor-pointer",
                direction === "payable"
                  ? "border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20"
                  : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900 dark:text-indigo-300">
                <ArrowUpRight size={15} className="text-indigo-600 dark:text-indigo-400" />
                {t("cheque.supplier_outgoing")}
              </div>
              <p className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">{t("cheque.cheque_supplier_desc")}</p>
            </button>
          </div>

          {/* Client or Supplier */}
          {direction === "receivable" ? (
            <div>
              <label className="form-label text-xs">{t("cheque.client_issuer")}</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="form-input text-xs"
              >
                <option value="">— {t("invoice.select_client")} —</option>
                {(clientsData?.results ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="form-label text-xs">{t("cheque.supplier_beneficiary")}</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="form-input text-xs"
              >
                <option value="">— {t("supplier.select_supplier", "Sélectionner un fournisseur (optionnel)")} —</option>
                {(suppliersData?.results ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.phone})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label text-xs">{t("cheque.cheque_number_label")}</label>
              <input
                type="text"
                required
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="Ex: 004928192"
                className="form-input text-xs font-mono font-bold"
              />
            </div>

            <div>
              <label className="form-label text-xs">{t("cheque.bank_institution")}</label>
              <input
                type="text"
                list="algerian-banks-list"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                placeholder="Ex: BNA, BEA, CPA, BADR..."
                className="form-input text-xs"
              />
              <datalist id="algerian-banks-list">
                {ALGERIAN_BANKS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label text-xs">{t("payment.amount")}</label>
              <input
                type="number"
                required
                min={1}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ex: 45000"
                className="form-input text-xs font-mono font-bold"
              />
            </div>

            <div>
              <label className="form-label text-xs">{t("cheque.due_date")} *</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="form-input text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="form-label text-xs">{t("cheque.notes_optional")}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Règlement commande automne, caution..."
              className="form-input text-xs"
            />
          </div>

          <div className="pt-3 border-t border-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary btn-sm"
              disabled={createMutation.isPending}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !number.trim() || !amount || !dueDate}
              className="btn-primary btn-sm"
            >
              {createMutation.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
