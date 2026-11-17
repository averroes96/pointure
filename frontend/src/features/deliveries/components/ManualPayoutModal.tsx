import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import axios from "axios";
import api, { getApiError } from "@/lib/api";
import { getTrustedDateString } from "@/lib/time";
import { formatMoney } from "../shipments";
import { differenceTone, parseTrackings, payoutDifference, useInvalidatePayouts } from "../payouts";
import type { CourierSyncState, PayoutPreview } from "../types";

interface Props {
  open: boolean;
  accounts: CourierSyncState[];
  onClose: () => void;
}

const DIFF_CLASS = {
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-rose-400",
  neutral: "text-slate-500 dark:text-slate-400",
};

interface Problems {
  message: string;
  unknown: string[];
  refused: string[];
}

function readProblems(err: unknown): Problems {
  const details = axios.isAxiosError(err) ? err.response?.data?.error?.details || {} : {};
  return {
    message: getApiError(err),
    unknown: Array.isArray(details.unknown_trackings) ? details.unknown_trackings : [],
    refused: Array.isArray(details.refused_trackings) ? details.refused_trackings : [],
  };
}

/**
 * Manual payout from the agency sheet (couriers without a payout API, or a partial
 * pickup): paste or scan tracking numbers, check them, enter the amount counted.
 */
export default function ManualPayoutModal({ open, accounts, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePayouts();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [courier, setCourier] = useState("");
  const [trackingsText, setTrackingsText] = useState("");
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const [problems, setProblems] = useState<Problems | null>(null);
  const [amount, setAmount] = useState("");
  const [pickedUpOn, setPickedUpOn] = useState(getTrustedDateString());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    textRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) setCourier((c) => c || accounts[0]?.courier || "");
  }, [open, accounts]);

  const resetCheck = () => { setPreview(null); setProblems(null); };
  const parcels = () => ({ courier, trackings: parseTrackings(trackingsText), courier_payout_ref: "" });

  const check = useMutation({
    mutationFn: async () => (await api.post<PayoutPreview>("/deliveries/payouts/preview/", parcels())).data,
    onSuccess: (data) => { setPreview(data); setProblems(null); setAmount((a) => a || data.expected_amount); },
    onError: (err) => { setPreview(null); setProblems(readProblems(err)); },
  });

  const record = useMutation({
    mutationFn: () =>
      api.post("/deliveries/payouts/", {
        ...parcels(),
        amount_received: amount.replace(",", "."),
        picked_up_on: pickedUpOn,
        courier_reference: reference.trim(),
        notes: notes.trim(),
      }),
    onSuccess: () => {
      invalidate();
      setTrackingsText(""); setAmount(""); setReference(""); setNotes("");
      resetCheck();
      onClose();
    },
    onError: (err) => setProblems(readProblems(err)),
  });

  if (!open) return null;

  const count = parseTrackings(trackingsText).length;
  const difference = preview ? payoutDifference(amount, preview.expected_amount) : "";
  const amountValid = difference !== "" && parseFloat(amount.replace(",", ".")) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="manual-payout-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-dialog w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <h2 id="manual-payout-title">{t("deliveries.payout_manual_title")}</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_manual_intro")}</p>

          {accounts.length > 1 && (
            <div>
              <label className="form-label" htmlFor="manual-courier">{t("deliveries.col_courier")}</label>
              <select id="manual-courier" className="form-input" value={courier}
                onChange={(e) => { setCourier(e.target.value); resetCheck(); }}>
                {accounts.map((a) => <option key={a.courier} value={a.courier}>{a.courier_name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="form-label" htmlFor="manual-trackings">{t("deliveries.payout_step_trackings")}</label>
            <textarea id="manual-trackings" ref={textRef} rows={5} className="form-input font-mono" dir="ltr"
              placeholder={t("deliveries.payout_trackings_placeholder")} value={trackingsText}
              onChange={(e) => { setTrackingsText(e.target.value); resetCheck(); }} />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t("deliveries.payout_trackings_count", { count })}
              </span>
              <button type="button" className="btn-secondary btn-sm" disabled={!courier || count === 0 || check.isPending}
                onClick={() => check.mutate()}>
                {t("deliveries.payout_check")}
              </button>
            </div>
          </div>

          {problems && (
            <div role="alert" className="rounded-xl border p-3 text-sm space-y-1 bg-red-50 dark:bg-rose-950/40 text-red-800 dark:text-rose-300 border-red-200 dark:border-rose-800/60">
              <p className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{problems.message}</p>
              {problems.unknown.length > 0 && (
                <p className="font-mono text-xs break-all" dir="ltr">{t("deliveries.payout_unknown")}: {problems.unknown.join(", ")}</p>
              )}
              {problems.refused.length > 0 && (
                <p className="font-mono text-xs break-all" dir="ltr">{t("deliveries.payout_refused")}: {problems.refused.join(", ")}</p>
              )}
            </div>
          )}

          {preview && (
            <form className="space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4"
              onSubmit={(e) => { e.preventDefault(); if (amountValid) record.mutate(); }}>
              <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                {t("deliveries.payout_checked", {
                  count: preview.count, amount: formatMoney(preview.expected_amount, i18n.language),
                })}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="manual-amount">{t("deliveries.payout_amount_counted")}</label>
                  <input id="manual-amount" inputMode="decimal" className="form-input font-mono" dir="ltr"
                    value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="manual-date">{t("deliveries.payout_picked_up_on")}</label>
                  <input id="manual-date" type="date" className="form-input" max={getTrustedDateString()}
                    value={pickedUpOn} onChange={(e) => setPickedUpOn(e.target.value)} />
                </div>
              </div>
              <p className="text-sm">
                <span className="text-slate-500 dark:text-slate-400">{t("deliveries.payout_difference")} : </span>
                <span className={"font-mono font-semibold " + DIFF_CLASS[differenceTone(difference)]}>
                  {difference === "" ? "—" : formatMoney(difference, i18n.language)}
                </span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="manual-ref">{t("deliveries.payout_reference")}</label>
                  <input id="manual-ref" className="form-input" maxLength={64} value={reference}
                    onChange={(e) => setReference(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="manual-notes">{t("deliveries.payout_notes")}</label>
                  <input id="manual-notes" className="form-input" maxLength={500} value={notes}
                    onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
                <button type="submit" className="btn-primary" disabled={!amountValid || record.isPending}>
                  {t("deliveries.payout_confirm")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
