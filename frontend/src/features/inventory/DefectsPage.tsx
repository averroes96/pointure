import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ShieldAlert,
  AlertTriangle,
  Package,
  Plus,
  FileText,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  TrendingDown,
  Trash2,
  Tag,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import api, { formatDZD, formatDate, type PaginatedResponse } from "@/lib/api";
import { VariantSearchInput } from "@/components/ui/VariantSearchInput";
import type {
  DefectItem,
  DefectMetrics,
  DefectReason,
  DefectStatus,
  SupplierReturnClaim,
  Supplier,
  Branch,
  Variant,
} from "@/types";
import { cn } from "@/lib/utils";

const DEFECT_REASONS: { value: DefectReason; labelKey: string }[] = [
  { value: "unstitched_sole", labelKey: "defects.reason_unstitched_sole" },
  { value: "broken_strap", labelKey: "defects.reason_broken_strap" },
  { value: "mismatched_pair", labelKey: "defects.reason_mismatched_pair" },
  { value: "leather_tear", labelKey: "defects.reason_leather_tear" },
  { value: "discoloration", labelKey: "defects.reason_discoloration" },
  { value: "broken_heel", labelKey: "defects.reason_broken_heel" },
  { value: "missing_insole", labelKey: "defects.reason_missing_insole" },
  { value: "other", labelKey: "defects.reason_other" },
];

const DEFECT_STATUSES: { value: DefectStatus; labelKey: string; badge: string }[] = [
  { value: "quarantined", labelKey: "defects.quarantined", badge: "badge-danger" },
  { value: "claim_pending", labelKey: "defects.claim_pending", badge: "badge-warning" },
  { value: "returned", labelKey: "defects.returned", badge: "badge-success" },
  { value: "sold_discount", labelKey: "defects.sold_discount", badge: "badge-info" },
  { value: "written_off", labelKey: "defects.written_off", badge: "badge-neutral" },
];

export default function DefectsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"defects" | "claims">("defects");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Modal states
  const [showLogModal, setShowLogModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Queries
  const { data: metrics, isLoading: loadingMetrics } = useQuery<DefectMetrics>({
    queryKey: ["defect-metrics"],
    queryFn: () => api.get("/inventory/defects/metrics/").then((r) => r.data),
  });

  const { data: defectsData, isLoading: loadingDefects } = useQuery<PaginatedResponse<DefectItem>>({
    queryKey: ["defects", { search, statusFilter, reasonFilter }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (reasonFilter) params.set("defect_reason", reasonFilter);
      return api.get(`/inventory/defects/?${params.toString()}`).then((r) => r.data);
    },
    enabled: tab === "defects",
  });

  const { data: claimsData, isLoading: loadingClaims } = useQuery<PaginatedResponse<SupplierReturnClaim>>({
    queryKey: ["supplier-return-claims"],
    queryFn: () => api.get("/suppliers/return-claims/").then((r) => r.data),
    enabled: tab === "claims",
  });

  const { data: suppliers } = useQuery<PaginatedResponse<Supplier>>({
    queryKey: ["suppliers-list-all"],
    queryFn: () => api.get("/suppliers/?page_size=100").then((r) => r.data),
  });

  const { data: branches } = useQuery<PaginatedResponse<Branch>>({
    queryKey: ["branches-list"],
    queryFn: () => api.get("/branches/").then((r) => r.data),
  });

  // Mutations
  const writeOffMutation = useMutation({
    mutationFn: (id: number) => api.post(`/inventory/defects/${id}/write-off/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["defects"] });
      queryClient.invalidateQueries({ queryKey: ["defect-metrics"] });
      setFeedbackMsg({ type: "success", text: "Article passé en perte (Rebut)." });
      setTimeout(() => setFeedbackMsg(null), 3000);
    },
  });

  const discountSaleMutation = useMutation({
    mutationFn: (id: number) => api.post(`/inventory/defects/${id}/discount-sale/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["defects"] });
      queryClient.invalidateQueries({ queryKey: ["defect-metrics"] });
      setFeedbackMsg({ type: "success", text: "Article transféré vers vente 2ème choix." });
      setTimeout(() => setFeedbackMsg(null), 3000);
    },
  });

  const applyCreditMutation = useMutation({
    mutationFn: (claimId: number) => api.post(`/suppliers/return-claims/${claimId}/apply-credit/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-return-claims"] });
      queryClient.invalidateQueries({ queryKey: ["defects"] });
      queryClient.invalidateQueries({ queryKey: ["defect-metrics"] });
      setFeedbackMsg({ type: "success", text: t("defects.apply_credit_success") });
      setTimeout(() => setFeedbackMsg(null), 4000);
    },
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    const list = defectsData?.results || [];
    const quarantinedList = list.filter((item) => item.status === "quarantined").map((i) => i.id);
    if (selectedIds.length === quarantinedList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(quarantinedList);
    }
  };

  const downloadClaimPdf = (claimId: number, claimNumber: string) => {
    api
      .get(`/suppliers/return-claims/${claimId}/pdf/`, { responseType: "blob" })
      .then((res) => {
        const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `Bon_Retour_${claimNumber}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
      })
      .catch(() => {
        alert("Erreur lors de la génération du PDF.");
      });
  };

  const defectList = defectsData?.results || [];
  const claimList = claimsData?.results || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2.5">
            <ShieldAlert className="text-warning" size={28} />
            {t("defects.title")}
          </h1>
          <p className="text-text-muted text-sm mt-1">{t("defects.subtitle")}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLogModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Plus size={16} />
            {t("defects.log_defect")}
          </button>
          {selectedIds.length > 0 && (
            <button
              onClick={() => setShowClaimModal(true)}
              className="btn-primary flex items-center gap-2 shadow-sm animate-pulse"
            >
              <Package size={16} />
              {t("defects.create_claim")} ({selectedIds.length})
            </button>
          )}
        </div>
      </div>

      {/* Feedback banner */}
      {feedbackMsg && (
        <div
          className={cn(
            "p-4 rounded-xl flex items-center gap-3 text-sm transition-all duration-300",
            feedbackMsg.type === "success"
              ? "bg-success/10 text-success border border-success/20"
              : "bg-danger/10 text-danger border border-danger/20"
          )}
        >
          {feedbackMsg.type === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span className="font-medium">{feedbackMsg.text}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 border-l-4 border-l-danger bg-surface hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              {t("defects.quarantined_pairs")}
            </span>
            <div className="p-2 rounded-lg bg-danger/10 text-danger">
              <ShieldAlert size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-danger">
              {loadingMetrics ? "..." : metrics?.quarantined_pairs ?? 0}
            </span>
            <span className="text-xs text-text-muted">paires</span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Valeur: <span className="font-mono font-semibold">{formatDZD(metrics?.quarantined_value ?? "0")} DZD</span>
          </p>
        </div>

        <div className="card p-5 border-l-4 border-l-warning bg-surface hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              {t("defects.pending_claims")}
            </span>
            <div className="p-2 rounded-lg bg-warning/10 text-warning">
              <Clock size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-warning">
              {loadingMetrics ? "..." : metrics?.pending_claims_pairs ?? 0}
            </span>
            <span className="text-xs text-text-muted">paires</span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            En attente: <span className="font-mono font-semibold">{formatDZD(metrics?.pending_claims_value ?? "0")} DZD</span>
          </p>
        </div>

        <div className="card p-5 border-l-4 border-l-success bg-surface hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              {t("defects.returned_pairs")}
            </span>
            <div className="p-2 rounded-lg bg-success/10 text-success">
              <CheckCircle2 size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-success">
              {loadingMetrics ? "..." : metrics?.returned_pairs ?? 0}
            </span>
            <span className="text-xs text-text-muted">paires</span>
          </div>
          <p className="text-xs text-text-muted mt-1">Crédit déduit des fournisseurs</p>
        </div>

        <div className="card p-5 border-l-4 border-l-info bg-surface hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              {t("defects.resolved_pairs")}
            </span>
            <div className="p-2 rounded-lg bg-info/10 text-info">
              <Sparkles size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-text-primary">
              {loadingMetrics ? "..." : metrics?.total_resolved_pairs ?? 0}
            </span>
            <span className="text-xs text-text-muted">total</span>
          </div>
          <p className="text-xs text-text-muted mt-1">Toutes résolutions confondues</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-border gap-6">
        <button
          onClick={() => setTab("defects")}
          className={cn(
            "pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors",
            tab === "defects"
              ? "border-primary-600 text-primary-600"
              : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <ShieldAlert size={16} />
          Articles Défectueux ({metrics?.quarantined_pairs ?? 0})
        </button>
        <button
          onClick={() => setTab("claims")}
          className={cn(
            "pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors",
            tab === "claims"
              ? "border-primary-600 text-primary-600"
              : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <FileText size={16} />
          Bons de Retour Fournisseurs
        </button>
      </div>

      {tab === "defects" ? (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="card p-4 flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full">
              <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Rechercher par article, référence, note..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input ps-9 w-full text-sm"
              />
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="form-input text-sm"
              >
                <option value="">{t("defects.all_statuses")}</option>
                {DEFECT_STATUSES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {t(st.labelKey)}
                  </option>
                ))}
              </select>

              <select
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value)}
                className="form-input text-sm"
              >
                <option value="">{t("defects.all_reasons")}</option>
                {DEFECT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {t(r.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={
                          defectList.filter((i) => i.status === "quarantined").length > 0 &&
                          selectedIds.length === defectList.filter((i) => i.status === "quarantined").length
                        }
                        onChange={toggleSelectAll}
                        className="rounded border-border"
                      />
                    </th>
                    <th>{t("defects.variant")}</th>
                    <th>{t("defects.reason")}</th>
                    <th>{t("defects.filter_supplier")}</th>
                    <th>{t("defects.filter_branch")}</th>
                    <th className="text-center">{t("defects.quantity")}</th>
                    <th className="text-end">{t("defects.unit_cost")}</th>
                    <th className="text-center">{t("defects.status")}</th>
                    <th>{t("defects.date")}</th>
                    <th className="text-center">{t("defects.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingDefects && (
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-text-muted">
                        Chargement des défectueux...
                      </td>
                    </tr>
                  )}
                  {!loadingDefects && defectList.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center py-12 text-text-muted">
                        <ShieldAlert className="mx-auto text-text-muted/40 mb-2" size={36} />
                        {t("defects.no_defects")}
                      </td>
                    </tr>
                  )}
                  {defectList.map((item) => {
                    const isQuarantined = item.status === "quarantined";
                    const isSelected = selectedIds.includes(item.id);
                    const statusObj = DEFECT_STATUSES.find((s) => s.value === item.status);

                    return (
                      <tr key={item.id} className={cn(isSelected && "bg-primary-50/40")}>
                        <td className="text-center">
                          {isQuarantined ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(item.id)}
                              className="rounded border-border"
                            />
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </td>
                        <td>
                          <div className="font-medium text-text-primary">
                            {item.product_name || item.variant_label}
                          </div>
                          <div className="text-xs text-text-muted flex items-center gap-2 mt-0.5">
                            {item.size_eu && <span className="font-mono">Taille {item.size_eu}</span>}
                            {item.colour && <span>• {item.colour}</span>}
                            {item.variant_sku && <span className="font-mono text-[11px] text-text-muted">[{item.variant_sku}]</span>}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-warning text-xs">
                            {item.defect_reason_display}
                          </span>
                          {item.notes && (
                            <p className="text-xs text-text-muted italic mt-1 max-w-xs truncate" title={item.notes}>
                              {item.notes}
                            </p>
                          )}
                        </td>
                        <td className="text-sm">{item.supplier_name || "—"}</td>
                        <td className="text-sm text-text-muted">{item.branch_name}</td>
                        <td className="text-center font-mono font-bold text-danger">{item.quantity}</td>
                        <td className="text-end font-mono text-sm">{formatDZD(item.cost_price)} DZD</td>
                        <td className="text-center">
                          <span className={cn("badge text-xs", statusObj?.badge || "badge-neutral")}>
                            {item.status_display}
                          </span>
                          {item.return_claim_number && (
                            <div className="text-[11px] font-mono text-primary-600 mt-0.5">
                              {item.return_claim_number}
                            </div>
                          )}
                        </td>
                        <td className="text-xs text-text-muted">{formatDate(item.created_at)}</td>
                        <td className="text-center">
                          {isQuarantined ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => discountSaleMutation.mutate(item.id)}
                                title={t("defects.mark_sold_discount")}
                                className="p-1.5 rounded hover:bg-info/10 text-info transition-colors"
                              >
                                <Tag size={15} />
                              </button>
                              <button
                                onClick={() => writeOffMutation.mutate(item.id)}
                                title={t("defects.mark_written_off")}
                                className="p-1.5 rounded hover:bg-danger/10 text-danger transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-text-muted">{item.resolved_by_name || "Traité"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Claims List Tab */
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>N° Bon de Retour</th>
                    <th>{t("defects.filter_supplier")}</th>
                    <th className="text-center">Articles / Paires</th>
                    <th className="text-end">Montant Total (Avoir)</th>
                    <th className="text-center">{t("defects.status")}</th>
                    <th>Date d'émission</th>
                    <th className="text-center">{t("defects.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingClaims && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-text-muted">
                        Chargement des réclamations...
                      </td>
                    </tr>
                  )}
                  {!loadingClaims && claimList.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-text-muted">
                        <FileText className="mx-auto text-text-muted/40 mb-2" size={36} />
                        Aucun bon de retour émis pour l'instant.
                      </td>
                    </tr>
                  )}
                  {claimList.map((claim) => (
                    <tr key={claim.id}>
                      <td className="font-mono font-bold text-primary-600">
                        {claim.claim_number}
                      </td>
                      <td className="font-medium text-text-primary">{claim.supplier_name}</td>
                      <td className="text-center font-mono">{claim.item_count || claim.items?.length || 0}</td>
                      <td className="text-end font-mono font-bold text-danger">
                        {formatDZD(claim.total_amount)} DZD
                      </td>
                      <td className="text-center">
                        <span
                          className={cn(
                            "badge text-xs",
                            claim.status === "settled"
                              ? "badge-success"
                              : claim.status === "accepted"
                              ? "badge-info"
                              : "badge-warning"
                          )}
                        >
                          {claim.status_display}
                        </span>
                      </td>
                      <td className="text-xs text-text-muted">{formatDate(claim.created_at)}</td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => downloadClaimPdf(claim.id, claim.claim_number)}
                            className="btn-secondary btn-sm flex items-center gap-1"
                            title={t("defects.download_pdf")}
                          >
                            <Download size={13} />
                            PDF
                          </button>
                          {!claim.credit_note_applied && (
                            <button
                              onClick={() => applyCreditMutation.mutate(claim.id)}
                              className="btn-primary btn-sm flex items-center gap-1"
                              title="Déduire de la dette fournisseur"
                            >
                              <CheckCircle2 size={13} />
                              Valider Avoir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Manual Defect Log Modal */}
      {showLogModal && (
        <LogDefectModal
          branches={branches?.results || []}
          suppliers={suppliers?.results || []}
          onClose={() => setShowLogModal(false)}
          onSuccess={() => {
            setShowLogModal(false);
            queryClient.invalidateQueries({ queryKey: ["defects"] });
            queryClient.invalidateQueries({ queryKey: ["defect-metrics"] });
            setFeedbackMsg({ type: "success", text: "Paire défectueuse enregistrée et isolée en quarantaine." });
            setTimeout(() => setFeedbackMsg(null), 3000);
          }}
        />
      )}

      {/* Create Supplier Claim Modal */}
      {showClaimModal && (
        <CreateClaimModal
          selectedItemIds={selectedIds}
          selectedItems={defectList.filter((i) => selectedIds.includes(i.id))}
          suppliers={suppliers?.results || []}
          onClose={() => setShowClaimModal(false)}
          onSuccess={() => {
            setShowClaimModal(false);
            setSelectedIds([]);
            setTab("claims");
            queryClient.invalidateQueries({ queryKey: ["defects"] });
            queryClient.invalidateQueries({ queryKey: ["defect-metrics"] });
            queryClient.invalidateQueries({ queryKey: ["supplier-return-claims"] });
            setFeedbackMsg({ type: "success", text: t("defects.claim_created_success") });
            setTimeout(() => setFeedbackMsg(null), 4000);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Log Defect Modal Component
// ─────────────────────────────────────────────────────────────

function LogDefectModal({
  branches,
  suppliers,
  onClose,
  onSuccess,
}: {
  branches: Branch[];
  suppliers: Supplier[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [branchId, setBranchId] = useState(branches[0]?.id ? String(branches[0].id) : "");
  const [supplierId, setSupplierId] = useState("");
  const [defectReason, setDefectReason] = useState<DefectReason>("unstitched_sole");
  const [quantity, setQuantity] = useState("1");
  const [costPrice, setCostPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVariant) {
      setError("Veuillez sélectionner un article.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post("/inventory/defects/", {
        variant: selectedVariant.id,
        branch: branchId ? parseInt(branchId) : undefined,
        supplier: supplierId ? parseInt(supplierId) : null,
        defect_reason: defectReason,
        quantity: parseInt(quantity) || 1,
        cost_price: costPrice ? parseFloat(costPrice) : undefined,
        notes: notes.trim(),
      });
      onSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Erreur lors de l'enregistrement de l'anomalie.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="card w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="card-header flex items-center justify-between border-b border-border p-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <ShieldAlert className="text-warning" size={20} />
            {t("defects.log_defect")}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-hover text-text-muted">
            <XCircle size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-danger/10 text-danger border border-danger/20 rounded-lg text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="form-label mb-1 block">Sélectionner l'article / pointure *</label>
            <VariantSearchInput value={selectedVariant} onSelect={setSelectedVariant} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label mb-1 block">{t("defects.quantity")} *</label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="form-input w-full font-mono"
              />
            </div>

            <div>
              <label className="form-label mb-1 block">{t("defects.unit_cost")} (DZD)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Facultatif"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="form-input w-full font-mono"
              />
            </div>
          </div>

          <div>
            <label className="form-label mb-1 block">{t("defects.reason")} *</label>
            <select
              value={defectReason}
              onChange={(e) => setDefectReason(e.target.value as DefectReason)}
              className="form-input w-full"
            >
              {DEFECT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label mb-1 block">{t("defects.filter_branch")} *</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="form-input w-full"
                required
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label mb-1 block">{t("defects.filter_supplier")}</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="form-input w-full"
              >
                <option value="">(Non spécifié)</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label mb-1 block">Observations / Remarques</label>
            <textarea
              rows={2}
              placeholder="Ex: Talon gauche décollé à la réception, boîte endommagée..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input w-full text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t("app.cancel")}
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              {loading && <RefreshCw size={14} className="animate-spin" />}
              Isoler en quarantaine
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Create Supplier Claim Modal Component
// ─────────────────────────────────────────────────────────────

function CreateClaimModal({
  selectedItemIds,
  selectedItems,
  suppliers,
  onClose,
  onSuccess,
}: {
  selectedItemIds: number[];
  selectedItems: DefectItem[];
  suppliers: Supplier[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  // Guess supplier from selected items if they share one
  const initialSupplier = selectedItems.find((i) => i.supplier)?.supplier;
  const [supplierId, setSupplierId] = useState(initialSupplier ? String(initialSupplier) : "");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalAmount = selectedItems.reduce(
    (sum, item) => sum + item.quantity * (parseFloat(item.cost_price) || 0),
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      setError("Veuillez sélectionner le fournisseur destinataire du bon de retour.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post("/inventory/defects/supplier-claim/", {
        defect_ids: selectedItemIds,
        supplier: parseInt(supplierId),
        notes: notes.trim(),
      });
      onSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Erreur lors de la création du bon de retour.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="card w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="card-header flex items-center justify-between border-b border-border p-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Package className="text-primary-600" size={20} />
            {t("defects.create_claim")}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-hover text-text-muted">
            <XCircle size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-danger/10 text-danger border border-danger/20 rounded-lg text-xs">
              {error}
            </div>
          )}

          <div className="p-4 bg-surface-hover rounded-xl border border-border space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Articles sélectionnés :</span>
              <span className="font-mono font-bold text-text-primary">{selectedItems.length} article(s)</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Total paires :</span>
              <span className="font-mono font-bold text-text-primary">
                {selectedItems.reduce((acc, i) => acc + i.quantity, 0)} paires
              </span>
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
              <span className="font-semibold text-text-primary">Montant estimé de l'avoir :</span>
              <span className="font-mono font-bold text-danger text-base">{formatDZD(totalAmount)} DZD</span>
            </div>
          </div>

          <div>
            <label className="form-label mb-1 block">Fournisseur destinataire *</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="form-input w-full"
              required
            >
              <option value="">Sélectionnez un fournisseur...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label mb-1 block">Notes / Motif du retour</label>
            <textarea
              rows={3}
              placeholder="Ex: Marchandise non conforme / défectueuse à la livraison. Demande de note de crédit..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input w-full text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t("app.cancel")}
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              {loading && <RefreshCw size={14} className="animate-spin" />}
              Générer Bon de Retour
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
