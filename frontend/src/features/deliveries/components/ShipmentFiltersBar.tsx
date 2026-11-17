import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { CASH_STATUSES, SHIPMENT_STATUSES } from "../types";
import type { CourierSyncState, ShipmentFilters } from "../types";

interface Props {
  filters: ShipmentFilters;
  accounts: CourierSyncState[];
  onChange: (next: ShipmentFilters) => void;
  onReset: () => void;
}

export default function ShipmentFiltersBar({ filters, accounts, onChange, onReset }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<ShipmentFilters>) => onChange({ ...filters, ...patch });
  const singleStatus = filters.status.includes(",") ? "" : filters.status;

  return (
    <div className="card card-body grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
      <div className="relative lg:col-span-2">
        <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute start-3 top-1/2 -translate-y-1/2" />
        <input
          className="form-input ps-9"
          placeholder={t("deliveries.search_shipments")}
          aria-label={t("common.search")}
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </div>
      <select
        className="form-input"
        aria-label={t("common.status")}
        value={singleStatus}
        onChange={(e) => set({ status: e.target.value })}
      >
        <option value="">{filters.status.includes(",") ? t("deliveries.filter_status_group") : t("deliveries.filter_status_all")}</option>
        {SHIPMENT_STATUSES.map((s) => (
          <option key={s} value={s}>{t(`deliveries.shipment_status.${s}`)}</option>
        ))}
      </select>
      <select
        className="form-input"
        aria-label={t("deliveries.col_cash")}
        value={filters.cash_status}
        onChange={(e) => set({ cash_status: e.target.value })}
      >
        <option value="">{t("deliveries.filter_cash_all")}</option>
        {CASH_STATUSES.map((c) => (
          <option key={c} value={c}>{t(`deliveries.cash_status.${c}`)}</option>
        ))}
      </select>
      {accounts.length > 1 ? (
        <select
          className="form-input"
          aria-label={t("deliveries.col_courier")}
          value={filters.courier}
          onChange={(e) => set({ courier: e.target.value })}
        >
          <option value="">{t("deliveries.filter_courier_all")}</option>
          {accounts.map((a) => (
            <option key={a.courier} value={a.courier}>{a.courier_name}</option>
          ))}
        </select>
      ) : (
        <div className="hidden lg:block" />
      )}
      <button type="button" className="btn-ghost" onClick={onReset}>
        {t("common.reset")}
      </button>
      <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400 lg:col-span-3 sm:col-span-1">
        {t("deliveries.changed_from")}
        <input type="date" className="form-input" value={filters.date_from} onChange={(e) => set({ date_from: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400 lg:col-span-3 sm:col-span-1">
        {t("deliveries.changed_to")}
        <input type="date" className="form-input" value={filters.date_to} onChange={(e) => set({ date_to: e.target.value })} />
      </label>
    </div>
  );
}
