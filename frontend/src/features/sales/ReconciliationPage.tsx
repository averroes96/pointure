/**
 * End-of-day cash reconciliation.
 * Cashier enters actual counted amounts per payment method;
 * the system computes gaps vs what was recorded in sales.
 * Managers can approve the submission.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Clock, AlertTriangle, Check, ChevronDown, ChevronUp, Printer } from "lucide-react";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";
import { openPrintPopup } from "@/lib/printPopup";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import { useTranslation } from "react-i18next";
import type { CashReconciliation } from "@/types";

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// METHOD_LABELS translation done inline using t("payment_method." + m)
const METHODS = ["cash", "cheque", "ccp", "virement"] as const;
type Method = (typeof METHODS)[number];

// ── Print template ────────────────────────────────────────────────────────────

function buildPrintHtml(rec: CashReconciliation): string {
  const rows = METHODS.map((m) => {
    const sys = parseFloat((rec as any)[`system_${m}`] ?? "0");
    const act = parseFloat((rec as any)[`actual_${m}`] ?? "0");
    const gap = act - sys;
    const gapStr = gap === 0 ? "—" : `${gap > 0 ? "+" : ""}${gap.toLocaleString("fr-DZ")}`;
    const gapColor = gap < 0 ? "color:#c0392b;" : gap > 0 ? "color:#e67e22;" : "color:#27ae60;";
    return `<tr>
      <td>${t(`payment_method.${m}`)}</td>
      <td style="text-align:right;">${sys.toLocaleString("fr-DZ")}</td>
      <td style="text-align:right;">${act.toLocaleString("fr-DZ")}</td>
      <td style="text-align:right;font-weight:600;${gapColor}">${gapStr}</td>
    </tr>`;
  }).join("");

  const totalGap = parseFloat(rec.total_gap);
  const gapColor = totalGap < 0 ? "color:#c0392b;" : totalGap > 0 ? "color:#e67e22;" : "color:#27ae60;";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Fermeture de caisse ${rec.date}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,sans-serif;font-size:12px;color:#000;padding:12mm;}
    h1{font-size:17px;font-weight:700;margin-bottom:3px;}
    .meta{font-size:11px;color:#555;margin-bottom:12px;}
    table{width:100%;border-collapse:collapse;margin-top:8px;}
    th,td{padding:6px 8px;border-bottom:1px solid #eee;text-align:left;}
    th{background:#f5f5f5;font-weight:600;font-size:10px;text-transform:uppercase;}
    tfoot td{border-top:2px solid #ccc;font-weight:700;}
    .notes{margin-top:12px;padding:8px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:11px;}
    .status{display:inline-block;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600;}
    .approved{background:#d5f5e3;color:#1e8449;}
    .pending{background:#fef9e7;color:#b7950b;}
    @media print{@page{margin:0;}body{padding:8mm;}}
  </style>
</head>
<body>
  <h1>{t("sales.reconciliation_title")}</h1>
  <div class="meta">
    Date : ${rec.date}${rec.branch_name ? ` · Caisse : ${rec.branch_name}` : ""}
    · Soumis par : ${rec.submitted_by_name ?? "—"}
    · <span class="status ${rec.status === "approved" ? "approved" : "pending"}">
        ${rec.status === "approved" ? t("sales.status_approved") : t("sales.status_pending")}
      </span>
  </div>

  <table>
    <thead>
      <tr>
        <th>Mode</th>
        <th style="text-align:right;">Système</th>
        <th style="text-align:right;">Compté</th>
        <th style="text-align:right;">
                      {t("sales.gap")}
                    </th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td>{t("common.total")}</td>
        <td style="text-align:right;">${parseFloat(rec.total_system).toLocaleString("fr-DZ")} DZD</td>
        <td style="text-align:right;">${parseFloat(rec.total_actual).toLocaleString("fr-DZ")} DZD</td>
        <td style="text-align:right;${gapColor}">
          ${totalGap === 0 ? "—" : `${totalGap > 0 ? "+" : ""}${totalGap.toLocaleString("fr-DZ")}`} DZD
        </td>
      </tr>
    </tfoot>
  </table>

  <p style="margin-top:8px;font-size:10px;color:#777;">Ventes : ${rec.system_sales_count} · Retours : ${parseFloat(rec.system_total_refunds).toLocaleString("fr-DZ")} DZD</p>

  ${rec.notes ? `<div class="notes"><strong>Notes :</strong> ${rec.notes}</div>` : ""}

  <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:40px;font-size:11px;">
    <div>
      <div style="border-top:1px solid #000;padding-top:4px;margin-top:24px;">Caissier / Signature</div>
    </div>
    <div>
      <div style="border-top:1px solid #000;padding-top:4px;margin-top:24px;">Manager / Approbation</div>
    </div>
  </div>
</body>
</html>`;
}

// ── Gap pill ──────────────────────────────────────────────────────────────────

function GapPill({ gap }: { gap: number }) {
  if (gap === 0) return <span className="text-success text-xs font-semibold">✓ 0</span>;
  return (
    <span
      className={cn(
        "text-xs font-semibold font-mono",
        gap < 0 ? "text-danger" : "text-warning",
      )}
    >
      {gap > 0 ? "+" : ""}{formatDZD(gap)}
    </span>
  );
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({
  rec,
  canApprove,
  onApprove,
}: {
  rec: CashReconciliation;
  canApprove: boolean;
  onApprove: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const totalGap = parseFloat(rec.total_gap);

  return (
    <>
      <tr
        className="hover:bg-surface cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-2.5 font-medium text-text-primary">{rec.date}</td>
        <td className="px-3 py-2.5 text-text-muted">{rec.branch_name ?? "—"}</td>
        <td className="px-3 py-2.5">
          <span
            className={cn(
              "badge",
              rec.status === "approved" ? "badge-success" : "badge-warning",
            )}
          >
            {rec.status === "approved" ? t("sales.status_approved") : t("sales.status_pending")}
          </span>
        </td>
        <td className="px-3 py-2.5 text-end font-mono text-sm">
          {formatDZD(rec.total_system)}
        </td>
        <td className="px-3 py-2.5 text-end font-mono text-sm">
          {formatDZD(rec.total_actual)}
        </td>
        <td className="px-3 py-2.5 text-end">
          <GapPill gap={totalGap} />
        </td>
        <td className="px-3 py-2.5 text-text-muted text-sm">{rec.submitted_by_name ?? "—"}</td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); openPrintPopup(buildPrintHtml(rec), "210mm", 10); }}
              className="btn-ghost btn-sm text-text-muted"
            >
              <Printer size={13} />
            </button>
            {canApprove && rec.status === "pending" && (
              <button
                onClick={(e) => { e.stopPropagation(); onApprove(rec.id); }}
                className="btn-secondary btn-sm"
              >
                <Check size={12} />
                {t("common.approve")}
              </button>
            )}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface">
          <td colSpan={8} className="px-4 py-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm mb-2">
              {METHODS.map((m) => {
                const sys = parseFloat((rec as any)[`system_${m}`]);
                const act = parseFloat((rec as any)[`actual_${m}`]);
                const gap = act - sys;
                return (
                  <div key={m} className="bg-white rounded-lg p-2.5 border border-border">
                    <div className="text-xs text-text-muted mb-1">{t(`payment_method.${m}`)}</div>
                    <div className="flex justify-between items-baseline">
                      <span className="font-mono text-sm">{formatDZD(act)}</span>
                      <GapPill gap={gap} />
                    </div>
                    <div className="text-2xs text-text-muted mt-0.5">{t("sales.system_colon")}{formatDZD(sys)}</div>
                  </div>
                );
              })}
            </div>
            {rec.notes && (
              <p className="text-xs text-text-muted italic">{t("common.notes_colon")} {rec.notes}</p>
            )}
            {rec.approved_by_name && (
              <p className="text-xs text-text-muted mt-1">
                {t("sales.approved_by_date", { name: rec.approved_by_name, date: formatDate(rec.approved_at) })}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface ActualAmounts {
  cash: string;
  cheque: string;
  ccp: string;
  virement: string;
}

export default function ReconciliationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(todayISO());
  const [amounts, setAmounts] = useState<ActualAmounts>({ cash: "", cheque: "", ccp: "", virement: "" });
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const canApprove = user?.role === "owner" || user?.role === "manager";
  const branchId = currentBranch?.id ?? null;

  // System totals from daily summary
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<{
    by_payment_method: Record<string, number>;
    sale_count: number;
    total_refunds: number;
  }>({
    queryKey: ["daily-summary", date, branchId],
    queryFn: () =>
      api.get(`/sales/daily-summary/?date=${date}${branchId ? `&branch_id=${branchId}` : ""}`).then((r) => r.data),
    enabled: !!date,
  });

  // Existing reconciliation for this date/branch (if any)
  const { data: existing } = useQuery<CashReconciliation[]>({
    queryKey: ["reconciliations", "history", date, branchId],
    queryFn: () =>
      api.get(`/sales/reconciliations/history/?date=${date}${branchId ? `&branch=${branchId}` : ""}`).then((r) => r.data),
    enabled: !!date,
  });

  // All recent history
  const { data: history } = useQuery<CashReconciliation[]>({
    queryKey: ["reconciliations", "history"],
    queryFn: () => api.get("/sales/reconciliations/history/").then((r) => r.data),
  });

  const todayRec = existing?.[0] ?? null;
  const systemAmounts = summary?.by_payment_method ?? {};

  function getActual(m: Method): number {
    return parseFloat(amounts[m] || "0") || 0;
  }
  function getSystem(m: Method): number {
    return parseFloat(String(systemAmounts[m] ?? "0")) || 0;
  }
  function getGap(m: Method): number {
    return getActual(m) - getSystem(m);
  }
  const totalSystem = METHODS.reduce((s, m) => s + getSystem(m), 0);
  const totalActual = METHODS.reduce((s, m) => s + getActual(m), 0);
  const totalGap = totalActual - totalSystem;

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/sales/reconciliations/submit/", {
        date,
        branch: branchId,
        actual_cash: amounts.cash || "0",
        actual_cheque: amounts.cheque || "0",
        actual_ccp: amounts.ccp || "0",
        actual_virement: amounts.virement || "0",
        notes,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliations"] });
      setFormError(null);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/sales/reconciliations/${id}/approve/`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reconciliations"] }),
    onError: (err) => setFormError(getApiError(err)),
  });

  // Pre-fill form from existing pending reconciliation
  function prefillFromRec(rec: CashReconciliation) {
    setAmounts({
      cash: rec.actual_cash,
      cheque: rec.actual_cheque,
      ccp: rec.actual_ccp,
      virement: rec.actual_virement,
    });
    setNotes(rec.notes);
  }

  const isApproved = todayRec?.status === "approved";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("sales.reconciliation_title")}</h1>
          <p className="text-sm text-text-muted">{t("sales.reconciliation_desc")}</p>
        </div>
      </div>

      {/* Date selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-text-primary whitespace-nowrap">{t("sales.date_colon")}</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="form-input max-w-[200px]"
          max={todayISO()}
        />
        {currentBranch && (
          <span className="badge badge-info">{currentBranch.name}</span>
        )}
      </div>

      {/* Status banner when already submitted */}
      {todayRec && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl px-4 py-3 border",
            isApproved
              ? "bg-success-light border-success/30"
              : "bg-warning-light border-warning/30",
          )}
        >
          <div className="flex items-center gap-2">
            {isApproved ? (
              <CheckCircle size={18} className="text-success" />
            ) : (
              <Clock size={18} className="text-warning" />
            )}
            <span className="text-sm font-medium text-text-primary">
              {isApproved
                ? t("sales.approved_by_date", { name: todayRec.approved_by_name, date: formatDate(todayRec.approved_at) })
                : t("sales.reconciliation_submitted_pending")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openPrintPopup(buildPrintHtml(todayRec), "210mm", 10)}
              className="btn-secondary btn-sm"
            >
              <Printer size={13} /> Imprimer
            </button>
            {!isApproved && (
              <button
                onClick={() => prefillFromRec(todayRec)}
                className="btn-secondary btn-sm"
              >
                {t("common.edit")}
              </button>
            )}
            {canApprove && !isApproved && (
              <button
                onClick={() => approveMutation.mutate(todayRec.id)}
                disabled={approveMutation.isPending}
                className="btn-primary btn-sm"
              >
                <Check size={13} />
                {t("common.approve")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Reconciliation form (hidden when approved) */}
      {!isApproved && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-text-primary">
              {t("sales.cash_count_entry")}
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {t("sales.cash_count_desc")}
            </p>
          </div>

          {summaryLoading ? (
            <div className="card-body text-text-muted text-sm py-8 text-center">
              {t("sales.loading_system_totals")}
            </div>
          ) : summaryError ? (
            <div className="card-body text-danger text-sm py-8 text-center">
              {t("sales.error_loading_totals")}
            </div>
          ) : summary?.sale_count === 0 ? (
            <div className="card-body py-8 text-center space-y-1">
              <p className="text-text-primary font-medium text-sm">{t('sales.no_sales_for_date', { date })}</p>
              <p className="text-text-muted text-xs">
                {t("sales.no_sales_hint")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className="px-4 py-2.5 text-start text-xs font-semibold text-text-muted uppercase tracking-wide">
                      {t("sales.payment_method")}
                    </th>
                    <th className="px-4 py-2.5 text-end text-xs font-semibold text-text-muted uppercase tracking-wide">
                      {t("sales.system_dzd")}
                    </th>
                    <th className="px-4 py-2.5 text-end text-xs font-semibold text-text-muted uppercase tracking-wide">
                      {t("sales.counted_dzd")}
                    </th>
                    <th className="px-4 py-2.5 text-end text-xs font-semibold text-text-muted uppercase tracking-wide">
                      {t("sales.gap")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {METHODS.map((m) => {
                    const sys = getSystem(m);
                    const gap = getGap(m);
                    return (
                      <tr key={m} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium text-text-primary">
                          {t(`payment_method.${m}`)}
                        </td>
                        <td className="px-4 py-3 text-end font-mono text-text-muted">
                          {formatDZD(sys)}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={amounts[m]}
                            onChange={(e) =>
                              setAmounts((prev) => ({ ...prev, [m]: e.target.value }))
                            }
                            className="form-input text-end font-mono max-w-[160px] ms-auto"
                            placeholder="0,00"
                          />
                        </td>
                        <td className="px-4 py-3 text-end">
                          <GapPill gap={gap} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-surface">
                    <td className="px-4 py-3 font-semibold">{t("common.total")}</td>
                    <td className="px-4 py-3 text-end font-mono font-semibold">
                      {formatDZD(totalSystem)} DZD
                    </td>
                    <td className="px-4 py-3 text-end font-mono font-semibold">
                      {formatDZD(totalActual)} DZD
                    </td>
                    <td className="px-4 py-3 text-end">
                      <GapPill gap={totalGap} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Summary chips */}
          {summary && (
            <div className="px-4 py-3 border-t border-border flex flex-wrap gap-3 text-xs text-text-muted">
              <span>{t("sales.sales_registered_count", { count: summary.sale_count })}</span>
              <span>·</span>
              <span>{t("sales.refunds_colon")} {formatDZD(summary.total_refunds)} DZD</span>
              {totalGap !== 0 && (
                <>
                  <span>·</span>
                  <span className={totalGap < 0 ? "text-danger font-medium" : "text-warning font-medium"}>
                    {totalGap < 0 ? t("sales.missing") : t("sales.excess")} : {formatDZD(Math.abs(totalGap))} DZD
                  </span>
                </>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="px-4 py-3 border-t border-border">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
              {t("sales.notes_observations")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input resize-none h-16 text-sm"
              placeholder={t("sales.notes_placeholder")}
            />
          </div>

          {/* Error */}
          {formError && (
            <div className="mx-4 mb-3 text-sm text-danger bg-danger-light rounded-lg px-3 py-2">
              {formError}
            </div>
          )}

          {/* Gap warning before submit */}
          {totalGap !== 0 && totalActual > 0 && (
            <div className="mx-4 mb-3 flex items-start gap-2 text-sm bg-warning-light text-warning rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {t("sales.gap_warning_text", { amount: formatDZD(Math.abs(totalGap)) })}
              </span>
            </div>
          )}

          {/* Submit */}
          <div className="px-4 pb-4">
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || summaryLoading}
              className="btn-primary w-full"
            >
              {submitMutation.isPending ? t("sales.recording") : t("sales.submit_reconciliation")}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {history && history.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="font-semibold text-text-primary">{t("sales.reconciliation_history")}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-text-muted uppercase tracking-wide">Date</th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-text-muted uppercase tracking-wide">{t("sales.register")}</th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-text-muted uppercase tracking-wide">{t("common.status")}</th>
                  <th className="px-3 py-2.5 text-end text-xs font-semibold text-text-muted uppercase tracking-wide">Système</th>
                  <th className="px-3 py-2.5 text-end text-xs font-semibold text-text-muted uppercase tracking-wide">Compté</th>
                  <th className="px-3 py-2.5 text-end text-xs font-semibold text-text-muted uppercase tracking-wide">
                      {t("sales.gap")}
                    </th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-text-muted uppercase tracking-wide">{t("sales.submitted_by")}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {history.map((rec) => (
                  <HistoryRow
                    key={rec.id}
                    rec={rec}
                    canApprove={canApprove}
                    onApprove={(id) => approveMutation.mutate(id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
