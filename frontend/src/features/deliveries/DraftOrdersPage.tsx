import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ORDER_TABS, useDeliveryOrders, type DeliveryOrder, type OrderTab } from "./deliveryOrders";
import DeliveryOrderModal from "./components/DeliveryOrderModal";
import DeliveryOrderTable from "./components/DeliveryOrderTable";

/** Delivery orders: prepare, send to the courier, follow (docs/plans/delivery-v1-plan.md P2.6). */
export default function DraftOrdersPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<OrderTab>("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DeliveryOrder | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data, isLoading, isError } = useDeliveryOrders(tab, page);
  const orders = data?.results ?? [];

  const done = (message: string) => {
    setEditing(null);
    setNotice(message);
    window.setTimeout(() => setNotice(null), 6000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("delivery_orders.title")}</h1>
          <p className="text-sm text-text-muted dark:text-slate-400">{t("delivery_orders.subtitle")}</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2 focus-visible:ring-2"
                onClick={() => setEditing("new")}>
          <Plus size={16} aria-hidden /> {t("delivery_orders.new")}
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="tablist">
        {ORDER_TABS.map((key) => (
          <button
            key={key} type="button" role="tab" aria-selected={tab === key}
            onClick={() => { setTab(key); setPage(1); }}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-2",
              tab === key
                ? "bg-primary-600 text-white dark:bg-primary-500"
                : "bg-bg-alt text-text-secondary hover:bg-border dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800",
            )}
          >
            {t(`delivery_orders.tab.${key}`)}
          </button>
        ))}
      </div>

      <div className="card p-0 bg-white dark:bg-slate-900 dark:border-slate-800">
        {isLoading ? (
          <p className="p-6 text-sm text-text-muted dark:text-slate-400">{t("common.loading")}</p>
        ) : isError ? (
          <p className="p-6 text-sm text-red-600 dark:text-rose-400">{t("delivery_orders.load_error")}</p>
        ) : orders.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-muted dark:text-slate-400">{t("delivery_orders.empty")}</p>
        ) : (
          <DeliveryOrderTable orders={orders} onOpen={(order) => setEditing(order)} />
        )}
      </div>

      {data && (data.next || data.previous) && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" className="btn-secondary btn-sm" disabled={!data.previous} onClick={() => setPage((p) => p - 1)}>
            {t("delivery_orders.previous")}
          </button>
          <span className="text-text-muted dark:text-slate-400">{t("delivery_orders.page", { page })}</span>
          <button type="button" className="btn-secondary btn-sm" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
            {t("delivery_orders.next")}
          </button>
        </div>
      )}

      {editing && (
        <DeliveryOrderModal
          key={editing === "new" ? "new" : editing.id}
          order={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
