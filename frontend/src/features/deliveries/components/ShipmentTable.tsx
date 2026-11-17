import { useTranslation } from "react-i18next";
import { formatDZD } from "@/lib/api";
import { formatDateTime } from "../shipments";
import type { Shipment } from "../types";
import { CashStatusBadge, ShipmentStatusBadge } from "./ShipmentBadges";

interface Props {
  rows: Shipment[];
  onOpen: (id: string) => void;
}

export default function ShipmentTable({ rows, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("deliveries.col_tracking")}</th>
            <th>{t("deliveries.col_recipient")}</th>
            <th>{t("deliveries.col_destination")}</th>
            <th className="text-end">{t("deliveries.col_amount")}</th>
            <th>{t("common.status")}</th>
            <th>{t("deliveries.col_cash")}</th>
            <th>{t("deliveries.col_updated")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              onClick={() => onOpen(row.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(row.id)}
              className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <td>
                <div className="font-mono text-slate-900 dark:text-white">{row.tracking_number || "—"}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{row.courier_name}</div>
              </td>
              <td>
                <div>{row.recipient_name || "—"}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono" dir="ltr">{row.recipient_phone}</div>
              </td>
              <td>{row.commune || "—"}</td>
              <td className="text-end font-mono whitespace-nowrap">{formatDZD(row.cod_amount, i18n.language)}</td>
              <td><ShipmentStatusBadge status={row.status} raw={row.raw_status} /></td>
              <td><CashStatusBadge cash={row.cash_status} /></td>
              <td className="whitespace-nowrap text-xs">{formatDateTime(row.courier_updated_at, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
