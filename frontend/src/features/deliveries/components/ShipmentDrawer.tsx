import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { formatDate } from "@/lib/api";
import { formatDateTime, useShipmentDetail, formatMoney } from "../shipments";
import { CashStatusBadge, ShipmentStatusBadge } from "./ShipmentBadges";

interface Props {
  shipmentId: string | null;
  onClose: () => void;
}

/** Side panel with one shipment's details and tracking history (refreshed in the background). */
export default function ShipmentDrawer({ shipmentId, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useShipmentDetail(shipmentId);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!shipmentId) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shipmentId, onClose]);

  if (!shipmentId) return null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-slate-900 dark:text-slate-100 text-end">{value}</dd>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="shipment-drawer-title">
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={onClose} aria-hidden="true" />
      <aside className="relative h-full w-full max-w-md bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="shipment-drawer-title" className="font-bold text-slate-900 dark:text-white font-mono">
              {data?.tracking_number || "…"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{data?.courier_name}</p>
          </div>
          <button ref={closeRef} type="button" className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading || !data ? (
          <div className="p-5 text-sm text-slate-500 dark:text-slate-400">{t("common.loading")}</div>
        ) : (
          <div className="p-5 space-y-6">
            {data.refreshing && (
              <p className="inline-flex items-center gap-2 text-xs text-primary-700 dark:text-primary-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t("deliveries.syncing")}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <ShipmentStatusBadge status={data.status} raw={data.raw_status} />
              <CashStatusBadge cash={data.cash_status} />
            </div>

            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
              {row(t("deliveries.col_recipient"), data.recipient_name || "—")}
              {row(t("common.phone"), <span dir="ltr" className="font-mono">{data.recipient_phone || "—"}</span>)}
              {row(t("deliveries.col_destination"), [data.commune, data.wilaya_code].filter(Boolean).join(" · ") || "—")}
              {row(t("deliveries.courier_status"), data.raw_status || "—")}
            </dl>

            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
              {row(t("deliveries.amount_cod"), formatMoney(data.cod_amount, i18n.language))}
              {row(t("deliveries.amount_delivery_fee"), formatMoney(data.delivery_fee, i18n.language))}
              {row(t("deliveries.amount_store"), formatMoney(data.store_amount, i18n.language))}
              {data.courier_paid_on && row(t("deliveries.paid_on"), formatDate(data.courier_paid_on, i18n.language))}
              {data.courier_payout_ref && row(t("deliveries.payout_ref"), <span className="font-mono text-xs">{data.courier_payout_ref}</span>)}
            </dl>

            <section>
              <h3 className="form-label">{t("deliveries.history")}</h3>
              {data.events.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t("deliveries.no_history")}</p>
              ) : (
                <ol className="border-s border-slate-200 dark:border-slate-700 ms-1.5 space-y-3">
                  {[...data.events].reverse().map((e) => (
                    <li key={`${e.occurred_at}-${e.raw_status}`} className="ps-4 relative">
                      <span className="absolute -start-1.5 top-1.5 w-3 h-3 rounded-full bg-primary-500 border-2 border-white dark:border-slate-900" />
                      <div className="flex flex-wrap items-center gap-2">
                        <ShipmentStatusBadge status={e.status} raw={e.raw_status} />
                        <span className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(e.occurred_at, i18n.language)}</span>
                      </div>
                      {e.note && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{e.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
