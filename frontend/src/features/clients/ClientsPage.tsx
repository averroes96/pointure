import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, AlertCircle, MessageCircle, Upload } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import api, { formatDZD, type PaginatedResponse } from "@/lib/api";
import type { Client } from "@/types";
import { cn, whatsappLink } from "@/lib/utils";
import { wilayaName } from "@/lib/wilayas";
import ImportModal from "@/components/ui/ImportModal";

const CLIENT_TEMPLATE = `name,phone,address,wilaya,client_type,nif,rc
Ahmed Benali,0555123456,Rue des Fleurs Alger,16,retail,,
Société ABC SARL,0770987654,Zone Industrielle Oran,31,wholesale,123456789,RC/31/A/0001
`;

export default function ClientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [clientType, setClientType] = useState("");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading } = useQuery<PaginatedResponse<Client>>({
    queryKey: ["clients", { search, clientType, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), ordering: "-cached_balance" });
      if (search) params.set("search", search);
      if (clientType) params.set("client_type", clientType);
      return api.get(`/clients/?${params}`).then((r) => r.data);
    },
  });

  const clients = data?.results ?? [];

  return (
    <div className="space-y-5">
      {showImport && (
        <ImportModal
          title="Importer des clients"
          endpoint="/clients/import/"
          templateCsv={CLIENT_TEMPLATE}
          templateFilename="modele_clients.csv"
          onSuccess={() => { qc.invalidateQueries({ queryKey: ["clients"] }); setShowImport(false); }}
          onClose={() => setShowImport(false)}
        />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">{t("nav.client_list")}</h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            <span className="font-mono font-semibold text-slate-700">{data?.count ?? 0}</span> clients enregistrés
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => setShowImport(true)} className="btn-secondary">
            <Upload size={15} />
            Importer CSV
          </button>
          <Link to="/clients/new" className="btn-primary">
            <Plus size={16} />
            {t("client.new")}
          </Link>
        </div>
      </div>

      {/* Search + Type filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            data-shortcut-search="true"
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9 pe-12 bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
            placeholder={t("client.search_placeholder")}
          />
          <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md shadow-2xs pointer-events-none">
            F2
          </kbd>
        </div>
        <select
          value={clientType}
          onChange={(e) => { setClientType(e.target.value); setPage(1); }}
          className="form-input max-w-[170px] bg-white border-slate-200/90 shadow-2xs rounded-xl focus:ring-primary-500/20"
        >
          <option value="">Tous les types</option>
          <option value="retail">{t("client.retail")}</option>
          <option value="wholesale">{t("client.wholesale")}</option>
        </select>
      </div>

      {/* Table Card */}
      <div className="card rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70">
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("client.name")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("client.phone")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("client.wilaya")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("client.credit_limit")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("client.balance")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("common.status")}</th>
                <th className="py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-end">{t("common.actions")}</th>
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
              {!isLoading && clients.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    <span className="text-sm">{t("common.no_data")}</span>
                  </td>
                </tr>
              )}
              {clients.map((client) => (
                <tr
                  key={client.id}
                  className="group cursor-pointer hover:bg-slate-50/80 transition-colors"
                  onClick={() => navigate(`/clients/${client.id}`)}
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">{client.name}</span>
                      <span className={cn(
                        "text-2xs font-bold px-2 py-0.5 rounded-md border",
                        client.client_type === "wholesale"
                          ? "bg-purple-50 text-purple-700 border-purple-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                      )}>
                        {client.client_type === "wholesale" ? t("client.wholesale") : t("client.retail")}
                      </span>
                    </div>
                    {client.nif && <div className="text-2xs font-mono text-slate-400 mt-0.5">NIF: {client.nif}</div>}
                  </td>
                  <td className="py-3.5 px-4">
                    {client.phone ? (
                      <a
                        href={whatsappLink(client.phone, `Bonjour ${client.name}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100/80 px-2 py-1 rounded-lg border border-emerald-200 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MessageCircle size={13} className="text-emerald-600" />
                        {client.phone}
                      </a>
                    ) : (
                      <span className="text-slate-400 font-mono text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 font-medium text-sm">{wilayaName(client.wilaya) || "—"}</td>
                  <td className="py-3.5 px-4 text-end font-mono text-slate-500 tabular-nums text-sm">
                    {parseFloat(client.credit_limit) > 0 ? (
                      <>
                        {formatDZD(client.credit_limit)} <span className="text-2xs font-sans text-slate-400">DZD</span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-end">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {client.is_over_credit_limit && (
                        <AlertCircle size={13} className="text-red-600 flex-shrink-0" />
                      )}
                      <span
                        className={cn(
                          "font-mono font-bold tabular-nums text-sm",
                          parseFloat(client.cached_balance) > 0
                            ? client.is_over_credit_limit ? "text-red-600" : "text-amber-600"
                            : "text-emerald-600"
                        )}
                      >
                        {formatDZD(client.cached_balance)} <span className="text-2xs font-sans text-slate-400 font-normal">DZD</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={cn("badge", client.is_active ? "badge-success" : "badge-neutral")}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", client.is_active ? "bg-emerald-500" : "bg-slate-400")} />
                      {client.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-end" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-ghost btn-sm text-primary-600 hover:bg-primary-50 hover:text-primary-700 font-semibold inline-flex items-center"
                      onClick={() => navigate(`/clients/${client.id}`)}
                    >
                      {t("common.view")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total_pages > 1 && (
          <div className="px-5 py-3.5 border-t border-slate-200/80 bg-slate-50/40 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              {t("common.page_info_movements", { current: data.current_page, total: data.total_pages, count: data.count }).split("·")[0].trim()}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(page - 1)} disabled={!data.previous} className="btn-secondary btn-sm">
                {t("common.previous")}
              </button>
              <button onClick={() => setPage(page + 1)} disabled={!data.next} className="btn-secondary btn-sm">
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
