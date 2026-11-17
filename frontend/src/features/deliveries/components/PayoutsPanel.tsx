import { Fragment, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { formatMoney } from "../shipments";
import { ChevronDown, ChevronRight } from "lucide-react";
import api, { formatDate, getApiError } from "@/lib/api";
import { differenceTone, useInvalidatePayouts, usePayoutDetail, usePayoutList } from "../payouts";

const TONE = {
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-rose-400",
  neutral: "text-slate-500 dark:text-slate-400",
};

function PayoutParcels({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = usePayoutDetail(id);
  if (isLoading || !data) return <p className="text-xs text-slate-500 dark:text-slate-400">{t("common.loading")}</p>;
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
      {data.shipments.map((s) => (
        <li key={s.id} className="flex justify-between gap-3">
          <span className="font-mono text-slate-700 dark:text-slate-300">{s.tracking_number}</span>
          <span className="text-slate-500 dark:text-slate-400 truncate">{s.recipient_name}</span>
          <span className="font-mono">{formatMoney(s.store_amount, i18n.language)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Payouts picked up at the agency: history, parcels, void (P1.13). */
export default function PayoutsPanel() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = usePayoutList(page);
  const invalidate = useInvalidatePayouts();

  const voidPayout = useMutation({
    mutationFn: (id: string) => api.post(`/deliveries/payouts/${id}/void/`),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (err) => setError(getApiError(err)),
  });

  if (list.isLoading) return <div className="card card-body text-sm text-slate-500 dark:text-slate-400">{t("common.loading")}</div>;
  const rows = list.data?.results || [];

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="p-3 rounded-xl text-sm border bg-red-50 dark:bg-rose-950/40 text-red-800 dark:text-rose-300 border-red-200 dark:border-rose-800/60">
          {error}
        </div>
      )}
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">{t("deliveries.payout_none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th><span className="sr-only">{t("deliveries.payout_parcels")}</span></th>
                  <th>{t("deliveries.payout_picked_up_on")}</th>
                  <th>{t("deliveries.col_courier")}</th>
                  <th className="text-end">{t("deliveries.payout_parcels")}</th>
                  <th className="text-end">{t("deliveries.payout_expected")}</th>
                  <th className="text-end">{t("deliveries.payout_received")}</th>
                  <th className="text-end">{t("deliveries.payout_difference")}</th>
                  <th>{t("common.status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const expanded = openId === p.id;
                  const voided = p.status === "voided";
                  return (
                    <Fragment key={p.id}>
                      <tr className={voided ? "opacity-60" : undefined}>
                        <td>
                          <button type="button" className="btn-ghost btn-sm" aria-expanded={expanded}
                            aria-label={t("deliveries.payout_parcels")} onClick={() => setOpenId(expanded ? null : p.id)}>
                            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rtl:rotate-180" />}
                          </button>
                        </td>
                        <td className="whitespace-nowrap">
                          <div>{formatDate(p.picked_up_on, i18n.language)}</div>
                          {p.courier_reference && <div className="text-xs text-slate-500 dark:text-slate-400">{p.courier_reference}</div>}
                        </td>
                        <td>{p.courier_name}</td>
                        <td className="text-end">
                          {p.shipment_count}
                          {!voided && p.unconfirmed_count > 0 && (
                            <div className="text-xs text-amber-700 dark:text-amber-400">
                              {t("deliveries.payout_unconfirmed", { count: p.unconfirmed_count })}
                            </div>
                          )}
                        </td>
                        <td className="text-end font-mono whitespace-nowrap">{formatMoney(p.expected_amount, i18n.language)}</td>
                        <td className="text-end font-mono whitespace-nowrap">{formatMoney(p.amount_received, i18n.language)}</td>
                        <td className={"text-end font-mono whitespace-nowrap font-semibold " + TONE[differenceTone(p.difference)]}>
                          {formatMoney(p.difference, i18n.language)}
                        </td>
                        <td>
                          <span className={voided ? "badge badge-neutral" : "badge badge-success"}>
                            {voided ? t("deliveries.payout_status_voided") : t("deliveries.payout_status_recorded")}
                          </span>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {voided ? p.voided_by_name : p.recorded_by_name}
                          </div>
                        </td>
                        <td className="text-end">
                          {!voided && (
                            <button type="button" className="btn-ghost btn-sm text-red-600 dark:text-rose-400"
                              disabled={voidPayout.isPending}
                              onClick={() => window.confirm(t("deliveries.payout_void_confirm")) && voidPayout.mutate(p.id)}>
                              {t("deliveries.payout_void")}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={9} className="bg-slate-50/60 dark:bg-slate-800/40">
                            {p.notes && <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">{p.notes}</p>}
                            <PayoutParcels id={p.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total_pages > 1 && (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t("common.previous")}
            </button>
            <button type="button" className="btn-secondary btn-sm" disabled={page >= list.data.total_pages}
              onClick={() => setPage(page + 1)}>
              {t("common.next")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
