import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, ArrowUpDown } from "lucide-react";
import api, { formatDate, type PaginatedResponse } from "@/lib/api";
import type { StockMovement, MovementReason, Branch } from "@/types";
import { cn } from "@/lib/utils";

const REASON_LABELS: Record<MovementReason, string> = {
  sale: "Vente",
  reception: "Réception",
  adjustment: "Ajustement",
  return: "Retour",
  transfer_out: "Transfert sortant",
  transfer_in: "Transfert entrant",
  damaged: "Endommagé",
  initial: "Stock initial",
};

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

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Tous les motifs" },
  ...Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label })),
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
      REASON_LABELS[m.reason] ?? m.reason,
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Mouvements de stock</h1>
          <p className="text-sm text-text-muted">{data?.count ?? 0} mouvement(s)</p>
        </div>
        <button onClick={handleExportCSV} className="btn-secondary">
          <Download size={16} />
          Exporter CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card card-body">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Variant search */}
          <div className="relative lg:col-span-1">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="form-input ps-9"
              placeholder="Rechercher un article..."
            />
          </div>

          {/* Reason */}
          <select
            value={reason}
            onChange={(e) => { setReason(e.target.value); setPage(1); }}
            className="form-input"
          >
            {REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="form-input"
            placeholder="Du"
          />

          {/* Date to */}
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="form-input"
            placeholder="Au"
          />

          {/* Branch */}
          <select
            value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
            className="form-input"
          >
            <option value="">Toutes les agences</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {(search || reason || dateFrom || dateTo || branchId) && (
          <div className="mt-2 flex items-center gap-2">
            <button onClick={handleReset} className="btn-ghost btn-sm text-text-muted">
              Réinitialiser les filtres
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date / Heure</th>
                <th>Article</th>
                <th>Dépôt</th>
                <th>Motif</th>
                <th className="text-end">Δ Quantité</th>
                <th>Référence</th>
                <th>Opérateur</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">Chargement...</td>
                </tr>
              )}
              {!isLoading && movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-text-muted">Aucun mouvement trouvé.</td>
                </tr>
              )}
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="text-text-muted text-xs whitespace-nowrap">
                    {formatTimestamp(movement.timestamp)}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <ArrowUpDown size={13} className="text-text-muted flex-shrink-0" />
                      <span className="font-medium text-text-primary">{movement.variant_str}</span>
                    </div>
                  </td>
                  <td className="text-text-muted">{movement.branch_name || "—"}</td>
                  <td>
                    <span className={cn("badge", REASON_BADGE_CLASS[movement.reason] ?? "badge-neutral")}>
                      {REASON_LABELS[movement.reason] ?? movement.reason}
                    </span>
                  </td>
                  <td className="text-end">
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        movement.quantity_delta > 0 ? "text-success" : "text-danger"
                      )}
                    >
                      {movement.quantity_delta > 0
                        ? `+${movement.quantity_delta}`
                        : movement.quantity_delta}
                    </span>
                  </td>
                  <td className="text-text-muted text-xs font-mono">
                    {movement.reference_id || "—"}
                  </td>
                  <td className="text-text-muted text-xs">{movement.user_email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Page {data.current_page} / {data.total_pages} · {data.count} mouvements
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
