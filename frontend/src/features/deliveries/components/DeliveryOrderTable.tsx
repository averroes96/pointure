import { useTranslation } from "react-i18next";
import { Pencil, Store, Home } from "lucide-react";
import { formatMoney, formatDateTime } from "../shipments";
import type { DeliveryOrder } from "../deliveryOrders";
import { ShipmentStatusBadge } from "./ShipmentBadges";
import { AttentionBadge, OrderStatusBadge } from "./OrderStatusBadges";

interface Props {
  orders: DeliveryOrder[];
  onOpen: (order: DeliveryOrder) => void;
}

/** Delivery orders with their parcel and sale (P2.6). Drafts open in the form. */
export default function DeliveryOrderTable({ orders, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-start text-xs text-text-muted dark:text-slate-400 border-b border-border dark:border-slate-800">
            <th className="py-2 px-3 text-start font-medium">{t("delivery_orders.col.customer")}</th>
            <th className="py-2 px-3 text-start font-medium">{t("delivery_orders.col.destination")}</th>
            <th className="py-2 px-3 text-end font-medium">{t("delivery_orders.col.cod")}</th>
            <th className="py-2 px-3 text-start font-medium">{t("delivery_orders.col.status")}</th>
            <th className="py-2 px-3 text-start font-medium">{t("delivery_orders.col.parcel")}</th>
            <th className="py-2 px-3" />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const editable = order.status === "draft";
            return (
              <tr
                key={order.id}
                className="border-b border-border dark:border-slate-800 last:border-0 align-top hover:bg-bg-alt/50 dark:hover:bg-slate-800/40"
              >
                <td className="py-2.5 px-3">
                  <div className="font-medium text-text-primary">{order.customer_name}</div>
                  <div className="text-xs text-text-muted dark:text-slate-400" dir="ltr">{order.customer_phone}</div>
                </td>
                <td className="py-2.5 px-3">
                  <div className="text-text-primary">
                    {order.wilaya ? `${order.wilaya} · ${order.commune || "—"}` : "—"}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-text-muted dark:text-slate-400">
                    {order.delivery_type === "stopdesk" ? <Store size={12} aria-hidden /> : <Home size={12} aria-hidden />}
                    {order.delivery_type === "stopdesk"
                      ? order.stop_desk_name || t("delivery_orders.stopdesk")
                      : t("delivery_orders.home")}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-end whitespace-nowrap">
                  <div className="font-medium text-text-primary">{formatMoney(order.cod_to_collect)}</div>
                  <div className="text-xs text-text-muted dark:text-slate-400">
                    {t("delivery_orders.articles_count", { count: order.lines.length })}
                  </div>
                </td>
                <td className="py-2.5 px-3 space-y-1">
                  <OrderStatusBadge status={order.status} />
                  {order.sale_receipt && (
                    <div className="text-xs text-text-muted dark:text-slate-400">
                      {t("delivery_orders.sale_receipt", { receipt: order.sale_receipt })}
                    </div>
                  )}
                  <AttentionBadge attention={order.attention} />
                </td>
                <td className="py-2.5 px-3 space-y-1">
                  {order.shipment ? (
                    <>
                      <ShipmentStatusBadge status={order.shipment.status} raw={order.shipment.raw_status} />
                      <div className="text-xs text-text-muted dark:text-slate-400" dir="ltr">
                        {order.shipment.tracking_number}
                      </div>
                    </>
                  ) : order.tracking_number ? (
                    <div className="text-xs text-text-muted dark:text-slate-400" dir="ltr">{order.tracking_number}</div>
                  ) : (
                    <span className="text-xs text-text-muted dark:text-slate-400">—</span>
                  )}
                  {order.dispatched_at && (
                    <div className="text-xs text-text-muted dark:text-slate-400">
                      {t("delivery_orders.sent_on", { date: formatDateTime(order.dispatched_at, i18n.language) })}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-3 text-end">
                  {editable && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm inline-flex items-center gap-1.5 focus-visible:ring-2"
                      onClick={() => onOpen(order)}
                    >
                      <Pencil size={14} aria-hidden /> {t("delivery_orders.open")}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
