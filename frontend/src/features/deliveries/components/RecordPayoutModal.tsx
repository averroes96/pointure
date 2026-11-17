import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import axios from "axios";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";
import { getTrustedDateString } from "@/lib/time";
import { differenceTone, parseTrackings, payoutDifference, usePayoutsToRecord, useInvalidatePayouts } from "../payouts";
import type { CourierSyncState, PayoutParcels, PayoutPreview } from "../types";

interface Props {
  open: boolean;
  accounts: CourierSyncState[];
  onClose: () => void;
  onRecorded: () => void;
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
 * Record cash picked up at a courier's agency (P1.13): choose the parcels (a payout the
 * courier reported, and/or tracking numbers from the agency sheet), check them, then
 * enter the amount actually counted. The server computes the expected amount.
 */
export default function RecordPayoutModal({ open, accounts, onClose, onRecorded }: Props) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePayouts();
  const toRecord = usePayoutsToRecord(open);
  const firstField = useRef<HTMLSelectElement>(null);

  const [courier, setCourier] = useState("");
  const [courierPayoutRef, setCourierPayoutRef] = useState("");
  const [trackingsText, setTrackingsText] = useState("");
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const [problems, setProblems] = useState<Problems | null>(null);
  const [amount, setAmount] = useState("");
  const [pickedUpOn, setPickedUpOn] = useState(getTrustedDateString());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Escape closes. The handler reads the latest onClose through a ref, so parent
  // re-renders (every few seconds while a sync runs) never re-run the focus below.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) setCourier((c) => c || accounts[0]?.courier || "");
  }, [open, accounts]);

  // Any change to the parcels invalidates the check.
  const resetCheck = () => {
    setPreview(null);
    setProblems(null);
  };

  const parcels = (): PayoutParcels => ({
    courier,
    trackings: parseTrackings(trackingsText),
    courier_payout_ref: courierPayoutRef,
  });

  const check = useMutation({
    mutationFn: async () => (await api.post<PayoutPreview>("/deliveries/payouts/preview/", parcels())).data,
    onSuccess: (data) => {
      setPreview(data);
      setProblems(null);
      setAmount((a) => a || data.expected_amount);
    },
    onError: (err) => {
      setPreview(null);
      setProblems(readProblems(err));
    },
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
      onRecorded();
      setCourierPayoutRef(""); setTrackingsText(""); setAmount(""); setReference(""); setNotes("");
      resetCheck();
    },
    onError: (err) => setProblems(readProblems(err)),
  });

  if (!open) return null;

  const courierData = toRecord.data?.couriers.find((c) => c.courier === courier);
  const difference = preview ? payoutDifference(amount, preview.expected_amount) : "";
  const hasParcels = !!courierPayoutRef || parseTrackings(trackingsText).length > 0;
  const amountValid = amount.trim() !== "" && !isNaN(parseFloat(amount.replace(",", "."))) && parseFloat(amount.replace(",", ".")) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog"
      aria-modal="true" aria-labelledby="record-payout-title">
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-xl card">
        <div className="card-header">
          <h2 id="record-payout-title">{t("deliveries.payout_record_title")}</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="card-body space-y-5">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_record_intro")}</p>

          {accounts.length > 1 && (
            <div>
              <label className="form-label" htmlFor="payout-courier">{t("deliveries.col_courier")}</label>
              <select id="payout-courier" ref={firstField} className="form-input" value={courier}
                onChange={(e) => { setCourier(e.target.value); setCourierPayoutRef(""); resetCheck(); }}>
                {accounts.map((a) => <option key={a.courier} value={a.courier}>{a.courier_name}</option>)}
              </select>
            </div>
          )}

          {/* 1. A payout the courier reported */}
          <section className="space-y-2">
            <h3 className="form-label">{t("deliveries.payout_step_courier")}</h3>
            {courierData && courierData.courier_payouts.length > 0 ? (
              <ul className="space-y-2">
                {courierData.courier_payouts.map((p) => {
                  const chosen = courierPayoutRef === p.courier_payout_ref;
                  return (
                    <li key={p.courier_payout_ref}>
                      <button type="button" aria-pressed={chosen}
                        onClick={() => { setCourierPayoutRef(chosen ? "" : p.courier_payout_ref); resetCheck(); }}
                        className={"w-full text-start rounded-xl border px-3 py-2 text-sm transition-colors " + (chosen
                          ? "border-primary-500 bg-primary-50 dark:bg-primary-950/30 text-slate-900 dark:text-white"
                          : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300")}>
                        {t("deliveries.payout_courier_choice", {
                          date: formatDate(p.paid_on, i18n.language), count: p.count,
                          amount: formatDZD(p.expected_amount, i18n.language),
                        })}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("deliveries.payout_no_courier_payout")}</p>
            )}
            {courierData?.held && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("deliveries.payout_still_held", {
                  count: courierData.held.count, amount: formatDZD(courierData.held.expected_amount, i18n.language),
                })}
              </p>
            )}
          </section>

          {/* 2. Tracking numbers from the agency sheet */}
          <section className="space-y-2">
            <label className="form-label" htmlFor="payout-trackings">{t("deliveries.payout_step_trackings")}</label>
            <textarea id="payout-trackings" rows={4} className="form-input font-mono" dir="ltr"
              placeholder={t("deliveries.payout_trackings_placeholder")} value={trackingsText}
              onChange={(e) => { setTrackingsText(e.target.value); resetCheck(); }} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("deliveries.payout_trackings_count", { count: parseTrackings(trackingsText).length })}
            </p>
          </section>

          <button type="button" className="btn-secondary" disabled={!courier || !hasParcels || check.isPending}
            onClick={() => check.mutate()}>
            {t("deliveries.payout_check")}
          </button>

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

          {/* 3. Amount actually counted */}
          {preview && (
            <section className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                {t("deliveries.payout_checked", {
                  count: preview.count, amount: formatDZD(preview.expected_amount, i18n.language),
                })}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="payout-amount">{t("deliveries.payout_amount_counted")}</label>
                  <input id="payout-amount" inputMode="decimal" className="form-input font-mono" dir="ltr"
                    value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("deliveries.payout_amount_hint")}</p>
                </div>
                <div>
                  <label className="form-label" htmlFor="payout-date">{t("deliveries.payout_picked_up_on")}</label>
                  <input id="payout-date" type="date" className="form-input" max={getTrustedDateString()}
                    value={pickedUpOn} onChange={(e) => setPickedUpOn(e.target.value)} />
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_expected")}</dt>
                  <dd className="font-mono text-slate-900 dark:text-white">{formatDZD(preview.expected_amount, i18n.language)}</dd></div>
                <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_received")}</dt>
                  <dd className="font-mono text-slate-900 dark:text-white">{amountValid ? formatDZD(amount.replace(",", "."), i18n.language) : "—"}</dd></div>
                <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_difference")}</dt>
                  <dd className={"font-mono font-semibold " + DIFF_CLASS[differenceTone(difference)]}>
                    {difference === "" ? "—" : formatDZD(difference, i18n.language)}
                  </dd></div>
              </dl>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="payout-ref">{t("deliveries.payout_reference")}</label>
                  <input id="payout-ref" className="form-input" maxLength={64} value={reference}
                    onChange={(e) => setReference(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="payout-notes">{t("deliveries.payout_notes")}</label>
                  <input id="payout-notes" className="form-input" maxLength={500} value={notes}
                    onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
                <button type="button" className="btn-primary" disabled={!amountValid || record.isPending}
                  onClick={() => record.mutate()}>
                  {t("deliveries.payout_confirm")}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
