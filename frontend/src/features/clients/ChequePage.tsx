import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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

function printChequeDepositSlip(cheques: Cheque[], storeName: string) {
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
        <td>${c.direction === "payable" ? "Fournisseur (Sortant)" : "Client (Entrant)"}</td>
        <td style="font-family:monospace;">${formatDate(c.due_date)}</td>
        <td style="text-align:right;font-family:monospace;font-weight:bold;">${formatDZD(c.amount)} DZD</td>
      </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Bordereau d'Échéancier Chèques — ${storeName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 28px; color: #0f172a; font-size: 12px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 18px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }
    th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; }
    .total-box { margin-top: 16px; text-align: right; font-size: 15px; font-weight: bold; font-family: monospace; }
    @media print { body { margin: 12px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${storeName} — BORDEREAU & ÉCHÉANCIER DES CHÈQUES</h1>
      <p style="margin:4px 0;color:#64748b;">Édité le ${new Date().toLocaleString("fr-DZ")}</p>
    </div>
    <div style="text-align:right;">
      <strong>Nombre de chèques :</strong> ${list.length}<br/>
      <strong>Total :</strong> ${formatDZD(totalAmount)} DZD
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px;text-align:center;">#</th>
        <th>N° Chèque</th>
        <th>Banque</th>
        <th>Tiers (Client / Fournisseur)</th>
        <th>Sens</th>
        <th>Échéance</th>
        <th style="text-align:right;">Montant</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="total-box">TOTAL BORDEREAU : ${formatDZD(totalAmount)} DZD</div>
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
              onClick={() => printChequeDepositSlip(cheques, storeName)}
              className="btn-secondary btn-sm flex items-center gap-1.5"
            >
              <Printer size={15} />
              Imprimer Bordereau
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="btn-primary btn-sm flex items-center gap-1.5 cursor-pointer"
          >
            <Plus size={16} />
            Nouveau Chèque
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
              Échéances imminentes ou dépassées
            </h4>
            <p className="text-xs text-amber-800 mt-0.5 font-medium">
              <span className="font-bold">{urgentCount} chèque(s)</span> arrivent à échéance dans 3 jours ou moins (ou sont déjà échus). Pensez à les déposer en banque ou à vérifier l'encaissement.
            </p>
          </div>
        </div>
      )}

      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="card p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-slate-500 uppercase tracking-wider block">
              À Encaisser (Clients)
            </span>
            <p className="text-lg font-black font-mono text-blue-700 mt-1 tabular-nums">
              {formatDZD(pendingReceivableTotal)}{" "}
              <span className="text-2xs font-normal text-slate-400">DZD</span>
            </p>
            <span className="text-2xs text-slate-500 font-medium">
              {pendingReceivables.length} chèque(s) en attente
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <ArrowDownLeft size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-slate-500 uppercase tracking-wider block">
              À Payer (Fournisseurs)
            </span>
            <p className="text-lg font-black font-mono text-indigo-700 mt-1 tabular-nums">
              {formatDZD(pendingPayableTotal)}{" "}
              <span className="text-2xs font-normal text-slate-400">DZD</span>
            </p>
            <span className="text-2xs text-slate-500 font-medium">
              {pendingPayables.length} chèque(s) émis
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <ArrowUpRight size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-amber-200/70 bg-amber-50/40 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-amber-700 uppercase tracking-wider block">
              Échéance Proche / Dépassée
            </span>
            <p className="text-lg font-black font-mono text-amber-900 mt-1 tabular-nums">
              {urgentCount} <span className="text-2xs font-normal text-amber-600">chèque(s)</span>
            </p>
            <span className="text-2xs text-amber-700 font-medium">J ≤ 3 jours</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
        </div>

        <div className="card p-4 rounded-xl border border-slate-200/80 bg-white shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-2xs font-bold text-slate-500 uppercase tracking-wider block">
              Chèques Déposés / Encaissés
            </span>
            <p className="text-lg font-black font-mono text-emerald-700 mt-1 tabular-nums">
              {formatDZD(depositedTotal)}{" "}
              <span className="text-2xs font-normal text-slate-400">DZD</span>
            </p>
            <span className="text-2xs text-slate-500 font-medium">
              {cheques.filter((c) => c.status === "deposited").length} chèque(s) réglés
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Landmark size={20} />
          </div>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="card p-4 rounded-2xl border border-slate-200/80 bg-white shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par N° de chèque, client, fournisseur, banque ou note…"
              className="form-input pl-9 text-xs h-10"
            />
          </div>

          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="form-input text-xs h-10 md:w-48"
          >
            <option value="">Tous les sens (Entrant/Sortant)</option>
            <option value="receivable">Entrants — Clients (À encaisser)</option>
            <option value="payable">Sortants — Fournisseurs (À payer)</option>
          </select>

          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="form-input text-xs h-10 md:w-52"
          >
            <option value="">Toutes les banques</option>
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
              { value: "", label: "Tous les statuts" },
              { value: "pending", label: "En attente" },
              { value: "deposited", label: "Encaissés / Déposés" },
              { value: "bounced", label: "Impayés / Rejetés" },
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
            <span className="text-slate-500 font-medium">Échéance du</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="form-input h-8 text-xs px-2.5 w-36"
            />
            <span className="text-slate-500 font-medium">au</span>
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
                Réinitialiser
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t("cheque.number", "N° Chèque")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Sens & Tiers
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t("cheque.bank", "Banque")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t("cheque.due_date", "Échéance")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Compte à Rebours
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">
                  {t("cheque.amount", "Montant")}
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">
                  {t("common.actions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
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
                    <Landmark size={36} className="mx-auto mb-2 text-slate-300" />
                    <p className="font-bold text-slate-700">Aucun chèque enregistré</p>
                    <p className="text-xs text-slate-400 mt-1 mb-4">
                      Enregistrez vos chèques clients ou fournisseurs, ou encaissez par chèque directement depuis la caisse POS.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(true)}
                      className="btn-primary btn-sm inline-flex items-center gap-1.5"
                    >
                      <Plus size={15} />
                      Enregistrer un chèque
                    </button>
                  </td>
                </tr>
              )}
              {cheques.map((cheque) => (
                <tr key={cheque.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="font-mono font-bold text-slate-900 text-sm">{cheque.number}</div>
                    {cheque.notes && (
                      <div className="text-2xs text-slate-500 line-clamp-1 mt-0.5">{cheque.notes}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-3xs font-bold uppercase",
                          cheque.direction === "payable"
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200",
                        )}
                      >
                        {cheque.direction === "payable" ? (
                          <>
                            <ArrowUpRight size={10} /> Fournisseur
                          </>
                        ) : (
                          <>
                            <ArrowDownLeft size={10} /> Client
                          </>
                        )}
                      </span>
                      <span className="font-sans font-bold text-slate-800 text-sm">
                        {cheque.client_name || cheque.supplier_name || "Tiers non spécifié"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 text-xs font-medium">
                    {cheque.bank ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                        {cheque.bank}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 text-xs font-mono">
                    {formatDate(cheque.due_date)}
                  </td>
                  <td className="px-4 py-3.5">
                    {cheque.status === "pending" && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                          cheque.days_until_due <= 0
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : cheque.days_until_due <= 3
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200",
                        )}
                      >
                        <Clock size={11} />
                        {cheque.days_until_due < 0
                          ? `En retard (${Math.abs(cheque.days_until_due)}j)`
                          : cheque.days_until_due === 0
                          ? "Aujourd'hui"
                          : `J-${cheque.days_until_due}`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-end font-mono font-bold text-sm text-slate-900 tabular-nums">
                    {formatDZD(cheque.amount)}{" "}
                    <span className="text-2xs font-normal text-slate-400">DZD</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold",
                        cheque.status === "deposited"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : cheque.status === "bounced"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : "bg-amber-50 text-amber-800 border border-amber-200",
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
                        ? "Encaissé"
                        : cheque.status === "bounced"
                        ? "Rejeté / Impayé"
                        : "En attente"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <div className="flex items-center justify-end gap-1.5">
                      {cheque.status === "pending" ? (
                        <>
                          <button
                            onClick={() => depositMutation.mutate(cheque.id)}
                            disabled={depositMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-bold rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
                            title={t("cheque.mark_deposited", "Marquer comme encaissé")}
                          >
                            <CheckCircle2 size={12} />
                            Encaisser
                          </button>
                          <button
                            onClick={() => bounceMutation.mutate(cheque.id)}
                            disabled={bounceMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-bold rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer"
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
                          className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-semibold rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                          title="Remettre en attente"
                        >
                          <RotateCcw size={12} />
                          En attente
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm(`Supprimer le chèque N° ${cheque.number} ?`)) {
                            deleteMutation.mutate(cheque.id);
                          }
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Supprimer"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-border flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary-100 text-primary-700">
              <Landmark size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Enregistrer un Nouveau Chèque</h3>
              <p className="text-2xs text-slate-500">
                Suivi d'échéance bancaire client ou fournisseur
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
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
                  ? "border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20"
                  : "border-slate-200 bg-slate-50/60 hover:bg-slate-100",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
                <ArrowDownLeft size={15} className="text-blue-600" />
                Chèque Client (Entrant)
              </div>
              <p className="text-2xs text-slate-500 mt-0.5">Chèque reçu d'un client à encaisser</p>
            </button>

            <button
              type="button"
              onClick={() => setDirection("payable")}
              className={cn(
                "p-3 rounded-2xl border text-left transition-all cursor-pointer",
                direction === "payable"
                  ? "border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20"
                  : "border-slate-200 bg-slate-50/60 hover:bg-slate-100",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                <ArrowUpRight size={15} className="text-indigo-600" />
                Chèque Fournisseur (Sortant)
              </div>
              <p className="text-2xs text-slate-500 mt-0.5">Chèque émis pour régler un fournisseur</p>
            </button>
          </div>

          {/* Client or Supplier */}
          {direction === "receivable" ? (
            <div>
              <label className="form-label text-xs">Client émetteur</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="form-input text-xs"
              >
                <option value="">— Sélectionner un client (optionnel) —</option>
                {(clientsData?.results ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="form-label text-xs">Fournisseur bénéficiaire</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="form-input text-xs"
              >
                <option value="">— Sélectionner un fournisseur (optionnel) —</option>
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
              <label className="form-label text-xs">Numéro du chèque *</label>
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
              <label className="form-label text-xs">Banque / Établissement *</label>
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
              <label className="form-label text-xs">Montant (DZD) *</label>
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
              <label className="form-label text-xs">Date d'échéance / Encaissement *</label>
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
            <label className="form-label text-xs">Notes / Référence facture</label>
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
              Annuler
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !number.trim() || !amount || !dueDate}
              className="btn-primary btn-sm"
            >
              {createMutation.isPending ? "Enregistrement…" : "Enregistrer le chèque"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
