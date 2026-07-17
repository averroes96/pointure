/**
 * StockTransferPage — /inventory/transfers
 *
 * Lists inter-branch stock transfers and allows creating new ones.
 * Status flow:  pending → in_transit → received  (or → cancelled)
 *
 * Actions:
 *   POST /inventory/transfers/              — create
 *   POST /inventory/transfers/{id}/dispatch — pending → in_transit
 *   POST /inventory/transfers/{id}/receive  — pending|in_transit → received (creates movements)
 *   POST /inventory/transfers/{id}/cancel   — pending|in_transit → cancelled
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, ArrowRight, Loader2, AlertTriangle,
  CheckCircle, X, Truck, PackageCheck, Ban,
  type LucideIcon,
} from "lucide-react";
import api, { formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Branch, Variant, StockTransfer, TransferStatus } from "@/types";
import { cn } from "@/lib/utils";
import { usePrintLabels } from "@/hooks/usePrintLabels";

// ── Status config ─────────────────────────────────────────────────────────────

// STATUS_LABEL translated inline

const STATUS_BADGE: Record<TransferStatus, string> = {
  pending:    "badge-warning",
  in_transit: "badge-info",
  received:   "badge-success",
  cancelled:  "badge-neutral",
};

// STATUS_TABS translated inline

// ── Variant search input ──────────────────────────────────────────────────────

function VariantSearchInput({
  value,
  onSelect,
}: {
  value: Variant | null;
  onSelect: (v: Variant) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(value ? `${value.product_name} — T${value.size_eu} ${value.colour}` : "");
  const [results, setResults] = useState<Variant[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) setQuery(`${value.product_name} — T${value.size_eu} ${value.colour}`);
  }, [value?.id]);

  function search(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/inventory/variants/?search=${encodeURIComponent(q)}&page_size=10`);
        setResults(res.data.results ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function pick(v: Variant) {
    setQuery(`${v.product_name} — T${v.size_eu} ${v.colour}`);
    setResults([]);
    setOpen(false);
    onSelect(v);
  }

  return (
    <div className="relative">
      <div className="relative">
        {loading
          ? <Loader2 size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
          : <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        }
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="form-input ps-9"
          placeholder="Produit, pointure, couleur..."
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
          {results.map((v) => (
            <button
              key={v.id}
              type="button"
              onMouseDown={() => pick(v)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface text-start transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm text-text-primary truncate">{v.product_name}</div>
                <div className="text-xs text-text-muted">
                  Pointure {v.size_eu} · {v.colour}
                </div>
              </div>
              <span className={cn(
                "badge text-xs flex-shrink-0",
                v.stock_qty <= 0 ? "badge-danger" : v.is_low_stock ? "badge-warning" : "badge-success"
              )}>
                {v.stock_qty} en stock
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create transfer modal ─────────────────────────────────────────────────────

function CreateTransferModal({
  branches,
  onClose,
}: {
  branches: Branch[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [form, setForm] = useState({
    from_branch: "",
    to_branch: "",
    quantity: "1",
    notes: "",
  });
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const activeBranches = branches.filter((b) => b.is_active);

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/inventory/transfers/", {
        from_branch: Number(form.from_branch),
        to_branch: Number(form.to_branch),
        variant: selectedVariant!.id,
        quantity: Number(form.quantity),
        notes: form.notes,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      onClose();
    },
    onError: (err) => setErrMsg(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVariant) { setErrMsg("Sélectionnez une variante."); return; }
    if (!form.from_branch) { setErrMsg("Sélectionnez la branche source."); return; }
    if (!form.to_branch)   { setErrMsg("Sélectionnez la branche destination."); return; }
    if (form.from_branch === form.to_branch) { setErrMsg("Les branches source et destination doivent être différentes."); return; }
    if (Number(form.quantity) < 1) { setErrMsg("La quantité doit être ≥ 1."); return; }
    setErrMsg(null);
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="card w-full max-w-lg shadow-2xl">
        <div className="card-header flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-text-primary">{t("inventory.create_transfer_title")}</h2>
            <p className="text-xs text-text-muted mt-0.5">{t("inventory.create_transfer_desc")}</p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="card-body space-y-4">
          {errMsg && (
            <div className="flex items-center gap-2 px-3 py-2 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
              <AlertTriangle size={13} className="flex-shrink-0" />
              <span className="flex-1">{errMsg}</span>
              <button type="button" onClick={() => setErrMsg(null)}><X size={13} /></button>
            </div>
          )}

          {/* Branches */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">{t("inventory.source_branch")}</label>
              <select
                value={form.from_branch}
                onChange={(e) => setForm((f) => ({ ...f, from_branch: e.target.value }))}
                className="form-input"
                required
              >
                <option value="">Sélectionner...</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">{t("inventory.dest_branch")}</label>
              <select
                value={form.to_branch}
                onChange={(e) => setForm((f) => ({ ...f, to_branch: e.target.value }))}
                className="form-input"
                required
              >
                <option value="">Sélectionner...</option>
                {activeBranches
                  .filter((b) => String(b.id) !== form.from_branch)
                  .map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
              </select>
            </div>
          </div>

          {/* Variant */}
          <div>
            <label className="form-label">{t("inventory.variant_req")}</label>
            <VariantSearchInput value={selectedVariant} onSelect={setSelectedVariant} />
            {selectedVariant && (
              <p className="text-xs text-text-muted mt-1">
                Stock actuel : <strong>{selectedVariant.stock_qty}</strong> unité(s)
              </p>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className="form-label">{t("inventory.quantity_req")}</label>
            <input
              type="number"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              className="form-input max-w-[120px] text-center font-mono"
              min="1"
              max={selectedVariant?.stock_qty ?? undefined}
              required
            />
            {selectedVariant && Number(form.quantity) > selectedVariant.stock_qty && (
              <p className="text-xs text-danger mt-1">
                Quantité supérieure au stock disponible ({selectedVariant.stock_qty}).
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="form-label">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="form-input resize-none"
              rows={2}
              placeholder="Motif du transfert, instructions..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">{t("common.cancel")}</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending
                ? <><Loader2 size={14} className="animate-spin" /> Création…</>
                : <><Truck size={14} /> Créer le transfert</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Action confirmation banner ────────────────────────────────────────────────

type ActionType = "dispatch" | "receive" | "cancel";

// ACTION_CONFIG translated inline


function getActionConfig(type: ActionType, t: any) {
  const configs: Record<ActionType, any> = {
    dispatch: { label: t("inventory.dispatch"), confirmLabel: t("inventory.confirm_dispatch"), endpoint: "dispatch", icon: Truck, variant: "btn-primary" },
    receive: { label: t("inventory.receive"), confirmLabel: t("inventory.confirm_receive"), endpoint: "receive", icon: PackageCheck, variant: "btn-primary" },
    cancel: { label: t("common.cancel"), confirmLabel: t("inventory.confirm_cancel"), endpoint: "cancel", icon: Ban, variant: "btn-secondary text-danger" }
  };
  return configs[type];
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface PendingAction {
  transferId: number;
  type: ActionType;
  transferLabel: string;
}

export default function StockTransferPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { printLabels } = usePrintLabels();
  const [statusFilter, setStatusFilter] = useState<TransferStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────────

  const { data: branchesData } = useQuery<{ results: Branch[] }>({
    queryKey: ["branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data),
    staleTime: 300_000,
  });
  const branches = branchesData?.results ?? [];

  const { data, isLoading } = useQuery<PaginatedResponse<StockTransfer>>({
    queryKey: ["stock-transfers", { statusFilter, search, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search)       params.set("search", search);
      params.set("page", String(page));
      return api.get(`/inventory/transfers/?${params}`).then((r) => r.data);
    },
  });
  const transfers = data?.results ?? [];

  // ── Action mutation ───────────────────────────────────────────────────────

  const actionMutation = useMutation({
    mutationFn: ({ transferId, endpoint }: { transferId: number; endpoint: string }) =>
      api.post(`/inventory/transfers/${transferId}/${endpoint}/`).then((r) => r.data),
    onSuccess: (_, { endpoint }) => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });

      // Auto-print barcode labels when stock is received.
      // copies = transfer quantity so one sticker goes on each received item.
      if (endpoint === "receive" && pendingAction) {
        const transfer = data?.results.find((t) => t.id === pendingAction.transferId);
        if (transfer?.variant && transfer.quantity > 0) {
          printLabels(transfer.variant, transfer.quantity);
        }
      }

      setPendingAction(null);
      setActionError(null);
    },
    onError: (err) => setActionError(getApiError(err)),
  });

  function confirmAction() {
    if (!pendingAction) return;
    const { endpoint } = getActionConfig(pendingAction.type, t);
    actionMutation.mutate({ transferId: pendingAction.transferId, endpoint });
  }

  // ── Available actions for a transfer ─────────────────────────────────────

  function getActions(t: StockTransfer): ActionType[] {
    if (t.status === "pending")    return ["dispatch", "receive", "cancel"];
    if (t.status === "in_transit") return ["receive", "cancel"];
    return [];
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">{t("inventory.stock_transfers")}</h1>
            <p className="text-sm text-text-muted">{t("inventory.transfer_count", { count: data?.count ?? 0 })}</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} />
            Nouveau transfert
          </button>
        </div>

        {/* Confirmation banner */}
        {pendingAction && (
          <div className="flex items-center gap-3 px-4 py-3 bg-warning/10 border border-warning/30 rounded-lg">
            <AlertTriangle size={15} className="text-warning flex-shrink-0" />
            <span className="text-sm flex-1">
              <strong>{getActionConfig(pendingAction.type, t).confirmLabel}</strong> pour :{" "}
              <span className="font-mono">{pendingAction.transferLabel}</span>
            </span>
            {actionError && (
              <span className="text-xs text-danger">{actionError}</span>
            )}
            <button
              onClick={confirmAction}
              disabled={actionMutation.isPending}
              className={cn("btn-sm", getActionConfig(pendingAction.type, t).variant)}
            >
              {actionMutation.isPending
                ? <Loader2 size={13} className="animate-spin" />
                : <CheckCircle size={13} />
              }
              Confirmer
            </button>
            <button
              onClick={() => { setPendingAction(null); setActionError(null); }}
              className="btn-ghost btn-sm text-text-muted"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Status tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {[{ value: "", label: t("status.all") }, { value: "pending", label: t("status.pending") }, { value: "in_transit", label: t("status.in_transit") }, { value: "received", label: t("status.received") }, { value: "cancelled", label: t("status.cancelled") }].map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); setPage(1); }}
              className={cn(
                "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                statusFilter === tab.value
                  ? "border-primary-500 text-primary-600"
                  : "border-transparent text-text-muted hover:text-text-primary"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-xs">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input ps-9"
            placeholder="Produit, branche..."
          />
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("inventory.transfer_no")}</th>
                  <th>{t("inventory.variant")}</th>
                  <th>{t("inventory.route")}</th>
                  <th className="text-center">{t("sales.qty")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.date")}</th>
                  <th>{t("inventory.created_by")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-text-muted">
                      <Loader2 size={18} className="animate-spin mx-auto mb-1" />
                      Chargement...
                    </td>
                  </tr>
                )}
                {!isLoading && transfers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-text-muted">
                      Aucun transfert trouvé.
                    </td>
                  </tr>
                )}
                {transfers.map((transfer) => {
                  const actions = getActions(transfer);
                  const isPending = pendingAction?.transferId === transfer.id;
                  return (
                    <tr
                      key={transfer.id}
                      className={cn(isPending && "bg-warning/5")}
                    >
                      {/* N° */}
                      <td className="font-mono text-sm text-text-muted">#{transfer.id}</td>

                      {/* Variante */}
                      <td>
                        <div className="font-medium text-text-primary text-sm">
                          {transfer.product_name}
                        </div>
                        <div className="text-xs text-text-muted">
                          {transfer.variant_str}
                        </div>
                      </td>

                      {/* Trajet */}
                      <td>
                        <div className="flex items-center gap-1.5 text-sm">
                          <span className="font-medium text-text-primary">{transfer.from_branch_name}</span>
                          <ArrowRight size={13} className="text-text-muted flex-shrink-0" />
                          <span className="font-medium text-text-primary">{transfer.to_branch_name}</span>
                        </div>
                      </td>

                      {/* Quantité */}
                      <td className="text-center">
                        <span className="font-mono font-semibold text-sm">{transfer.quantity}</span>
                      </td>

                      {/* Statut */}
                      <td>
                        <span className={cn("badge", STATUS_BADGE[transfer.status])}>
                          {t(`status.${transfer.status}`)}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="text-text-muted text-sm whitespace-nowrap">
                        {formatDate(transfer.created_at)}
                        {transfer.received_at && (
                          <div className="text-xs text-success">
                            Reçu {formatDate(transfer.received_at)}
                          </div>
                        )}
                      </td>

                      {/* Créé par */}
                      <td className="text-text-muted text-xs">
                        {transfer.created_by_email || "—"}
                      </td>

                      {/* Actions */}
                      <td>
                        {actions.length > 0 ? (
                          <div className="flex items-center gap-1 flex-wrap">
                            {actions.map((actionType) => {
                              const cfg = getActionConfig(actionType, t);
                              const Icon = cfg.icon;
                              return (
                                <button
                                  key={actionType}
                                  onClick={() => {
                                    setActionError(null);
                                    setPendingAction({
                                      transferId: transfer.id,
                                      type: actionType,
                                      transferLabel: `#${transfer.id} — ${transfer.variant_str}`,
                                    });
                                  }}
                                  className={cn(
                                    "btn-ghost btn-sm flex items-center gap-1",
                                    actionType === "cancel"
                                      ? "text-text-muted hover:text-danger"
                                      : "text-primary-500"
                                  )}
                                  title={cfg.label}
                                  disabled={isPending}
                                >
                                  <Icon size={13} />
                                  <span className="hidden sm:inline">{cfg.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.total_pages > 1 && (
            <div className="px-4 py-3 border-t border-border flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {t("inventory.page_info_transfers", { current: data.current_page, total: data.total_pages, count: data.count })}
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

      {/* Create modal */}
      {showCreate && (
        <CreateTransferModal
          branches={branches}
          onClose={() => setShowCreate(false)}
        />
      )}
    </>
  );
}
