import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { TONE_BADGE } from "../shipments";
import type { OrderAttention, OrderStatus } from "../deliveryOrders";

const STATUS_TONE: Record<OrderStatus, keyof typeof TONE_BADGE> = {
  draft: "neutral",
  confirmed: "info",
  dispatched: "info",
  delivered: "success",
  returned: "danger",
  rejected: "danger",
  failed: "danger",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return <span className={TONE_BADGE[STATUS_TONE[status] ?? "neutral"]}>{t(`delivery_orders.status.${status}`)}</span>;
}

/** Why the lifecycle (P2.5) left this order for the owner. */
export function AttentionBadge({ attention }: { attention: OrderAttention }) {
  const { t } = useTranslation();
  if (!attention) return null;
  return (
    <span className="inline-flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
      <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
      {t(`delivery_orders.attention.${attention}`)}
    </span>
  );
}
