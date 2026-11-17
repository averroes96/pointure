import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api, { formatDate, getApiError } from "@/lib/api";
import { formatMoney } from "../shipments";
import { useInvalidatePayouts } from "../payouts";
import type { CourierPayoutToRecord, CourierToRecord } from "../types";
import ConfirmPayoutModal from "./ConfirmPayoutModal";

interface Props {
  courier: CourierToRecord;
  courierName: string;
}

/**
 * Payouts a courier reported but the store has not confirmed yet: one row each,
 * a Confirm button, and a bulk "confirm as expected" for an old backlog.
 */
export default function PayoutsToConfirm({ courier, courierName }: Props) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePayouts();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<CourierPayoutToRecord | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const rows = courier.courier_payouts;
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const selectedRows = rows.filter((r) => selected.includes(r.courier_payout_ref));
  const selectedTotal = selectedRows.reduce((sum, r) => sum + Math.round(parseFloat(r.expected_amount) * 100), 0) / 100;

  const bulk = useMutation({
    mutationFn: async (refs: string[]) =>
      (await api.post<{ created: string[]; failed: unknown[] }>("/deliveries/payouts/confirm-courier-payouts/", {
        courier: courier.courier, refs, notes: t("deliveries.payout_bulk_note"),
      })).data,
    onSuccess: (data) => {
      invalidate();
      setSelected([]);
      setMessage(data.failed.length
        ? { kind: "error", text: t("deliveries.payout_bulk_partial", { ok: data.created.length, failed: data.failed.length }) }
        : { kind: "ok", text: t("deliveries.payout_bulk_done", { count: data.created.length }) });
    },
    onError: (err) => setMessage({ kind: "error", text: getApiError(err) }),
  });

  const toggle = (ref: string) =>
    setSelected((s) => (s.includes(ref) ? s.filter((x) => x !== ref) : [...s, ref]));

  return (
    <section className="card overflow-hidden">
      <div className="card-header flex-wrap gap-2">
        <div>
          <h3>{t("deliveries.payout_to_confirm", { courier: courierName, count: rows.length })}</h3>
          {courier.held && (
            <p className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {t("deliveries.payout_still_held", {
                count: courier.held.count, amount: formatMoney(courier.held.expected_amount, i18n.language),
              })}
            </p>
          )}
        </div>
        {selected.length > 0 && (
          <button type="button" className="btn-secondary btn-sm" disabled={bulk.isPending}
            onClick={() => {
              const text = t("deliveries.payout_bulk_confirm", {
                count: selected.length, amount: formatMoney(selectedTotal.toFixed(2), i18n.language),
              });
              if (window.confirm(text)) bulk.mutate(selected);
            }}>
            {t("deliveries.payout_bulk_button", { count: selected.length })}
          </button>
        )}
      </div>

      {message && (
        <p role="status" className={"px-5 pt-3 text-sm " + (message.kind === "ok"
          ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-rose-400")}>
          {message.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">{t("deliveries.payout_nothing_to_confirm")}</p>
      ) : (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="data-table">
            <thead className="sticky top-0">
              <tr>
                <th className="w-10">
                  <input type="checkbox" aria-label={t("deliveries.payout_select_all")} checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.courier_payout_ref))} />
                </th>
                <th>{t("deliveries.payout_paid_on")}</th>
                <th className="text-end">{t("deliveries.payout_parcels")}</th>
                <th className="text-end">{t("deliveries.payout_expected")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.courier_payout_ref}>
                  <td>
                    <input type="checkbox" aria-label={formatDate(r.paid_on, i18n.language)}
                      checked={selected.includes(r.courier_payout_ref)} onChange={() => toggle(r.courier_payout_ref)} />
                  </td>
                  <td className="whitespace-nowrap">{formatDate(r.paid_on, i18n.language)}</td>
                  <td className="text-end">{r.count}</td>
                  <td className="text-end font-mono whitespace-nowrap">{formatMoney(r.expected_amount, i18n.language)}</td>
                  <td className="text-end">
                    <button type="button" className="btn-primary btn-sm" onClick={() => setConfirming(r)}>
                      {t("deliveries.payout_confirm_one")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmPayoutModal courier={courier.courier} courierName={courierName} item={confirming}
        onClose={() => setConfirming(null)} />
    </section>
  );
}
