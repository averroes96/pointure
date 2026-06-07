import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Search, AlertCircle, MessageCircle } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import api, { formatDZD, type PaginatedResponse } from "@/lib/api";
import type { Client } from "@/types";
import { cn, whatsappLink } from "@/lib/utils";
import { wilayaName } from "@/lib/wilayas";

export default function ClientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [clientType, setClientType] = useState("");
  const [page, setPage] = useState(1);

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.client_list")}</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} clients</p>
        </div>
        <Link to="/clients/new" className="btn-primary">
          <Plus size={16} />
          {t("client.new")}
        </Link>
      </div>

      {/* Search + type filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9"
            placeholder="Nom, téléphone, NIF..."
          />
        </div>
        <select
          value={clientType}
          onChange={(e) => { setClientType(e.target.value); setPage(1); }}
          className="form-input max-w-[160px]"
        >
          <option value="">Tous les types</option>
          <option value="retail">Détail</option>
          <option value="wholesale">Gros</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("client.name")}</th>
                <th>{t("client.phone")}</th>
                <th>{t("client.wilaya")}</th>
                <th className="text-end">{t("client.credit_limit")}</th>
                <th className="text-end">{t("client.balance")}</th>
                <th>{t("common.status")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">{t("common.loading")}</td>
                </tr>
              )}
              {!isLoading && clients.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">{t("common.no_data")}</td>
                </tr>
              )}
              {clients.map((client) => (
                <tr
                  key={client.id}
                  className="cursor-pointer hover:bg-surface"
                  onClick={() => navigate(`/clients/${client.id}`)}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{client.name}</span>
                      <span className={cn(
                        "text-2xs font-semibold px-1.5 py-0.5 rounded-full border",
                        client.client_type === "wholesale"
                          ? "bg-purple-50 text-purple-700 border-purple-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                      )}>
                        {client.client_type === "wholesale" ? "Gros" : "Détail"}
                      </span>
                    </div>
                    {client.nif && <div className="text-xs text-text-muted">NIF: {client.nif}</div>}
                  </td>
                  <td>
                    {client.phone ? (
                      <a
                        href={whatsappLink(client.phone, `Bonjour ${client.name}`)}
                        target="_blank"
                        className="flex items-center gap-1 text-sm text-green-600 hover:underline"
                      >
                        <MessageCircle size={12} />
                        {client.phone}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="text-text-muted">{wilayaName(client.wilaya) || "—"}</td>
                  <td className="text-end font-mono text-text-muted">
                    {parseFloat(client.credit_limit) > 0
                      ? formatDZD(client.credit_limit) + " DZD"
                      : "—"}
                  </td>
                  <td className="text-end">
                    <div className="flex items-center justify-end gap-1">
                      {client.is_over_credit_limit && (
                        <AlertCircle size={14} className="text-danger" />
                      )}
                      <span
                        className={cn(
                          "font-mono font-medium",
                          parseFloat(client.cached_balance) > 0
                            ? client.is_over_credit_limit ? "text-danger" : "text-warning"
                            : "text-success"
                        )}
                      >
                        {formatDZD(client.cached_balance)} DZD
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={cn("badge", client.is_active ? "badge-success" : "badge-neutral")}>
                      {client.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        className="btn-ghost btn-sm text-primary-500"
                        onClick={() => navigate(`/clients/${client.id}`)}
                      >
                        {t("common.view")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">Page {data.current_page} / {data.total_pages}</span>
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
