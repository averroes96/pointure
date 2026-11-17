import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { getTrustedDateString } from "@/lib/time";
import { formatMoney } from "../shipments";
import { differenceTone, payoutDateLabel, payoutDifference, useInvalidatePayouts } from "../payouts";
import type { CourierPayoutToRecord } from "../types";

interface Props {
  courier: string;
  courierName: string;
  item: CourierPayoutToRecord | null;
  onClose: () => void;
}

const DIFF_CLASS = {
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-rose-400",
  neutral: "text-slate-500 dark:text-slate-400",
};

/** Confirm one payout the courier reported: amount counted (prefilled), date, note. */
export default function ConfirmPayoutModal({ courier, courierName, item, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePayouts();
  const amountRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [amount, setAmount] = useState("");
  const [pickedUpOn, setPickedUpOn] = useState(getTrustedDateString());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setAmount(item.expected_amount);
    setPickedUpOn(getTrustedDateString());
    setReference("");
    setNotes("");
    setError(null);
    amountRef.current?.focus();
    amountRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item]);

  const save = useMutation({
    mutationFn: () =>
      api.post("/deliveries/payouts/", {
        courier,
        courier_payout_ref: item?.courier_payout_ref,
        amount_received: amount.replace(",", "."),
        picked_up_on: pickedUpOn,
        courier_reference: reference.trim(),
        notes: notes.trim(),
      }),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err) => setError(getApiError(err)),
  });

  if (!item) return null;
  const difference = payoutDifference(amount, item.expected_amount);
  const amountValid = difference !== "" && parseFloat(amount.replace(",", ".")) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-payout-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-dialog w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="modal-header">
          <h2 id="confirm-payout-title">{t("deliveries.payout_confirm_title", { courier: courierName })}</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <form className="modal-body space-y-4" onSubmit={(e) => { e.preventDefault(); if (amountValid) save.mutate(); }}>
          <dl className="grid grid-cols-3 gap-3 text-sm rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_paid_on")}</dt>
              <dd className="font-medium">{payoutDateLabel(t, item, i18n.language)}</dd></div>
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_parcels")}</dt>
              <dd className="font-medium">{item.count}</dd></div>
            <div><dt className="text-xs text-slate-500 dark:text-slate-400">{t("deliveries.payout_expected")}</dt>
              <dd className="font-mono font-medium">{formatMoney(item.expected_amount, i18n.language)}</dd></div>
          </dl>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="confirm-amount">{t("deliveries.payout_amount_counted")}</label>
              <input id="confirm-amount" ref={amountRef} inputMode="decimal" className="form-input font-mono" dir="ltr"
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="confirm-date">{t("deliveries.payout_picked_up_on")}</label>
              <input id="confirm-date" type="date" className="form-input" max={getTrustedDateString()}
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
              <label className="form-label" htmlFor="confirm-ref">{t("deliveries.payout_reference")}</label>
              <input id="confirm-ref" className="form-input" maxLength={64} value={reference}
                onChange={(e) => setReference(e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="confirm-notes">{t("deliveries.payout_notes")}</label>
              <input id="confirm-notes" className="form-input" maxLength={500} value={notes}
                onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="btn-primary" disabled={!amountValid || save.isPending}>
              {t("deliveries.payout_confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
