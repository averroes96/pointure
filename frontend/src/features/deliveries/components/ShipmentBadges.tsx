import { useTranslation } from "react-i18next";
import { TONE_BADGE, cashTone, statusTone } from "../shipments";
import type { CashStatus, ShipmentStatus } from "../types";

/** Parcel status in Pointure's vocabulary; the courier's own wording is shown on hover. */
export function ShipmentStatusBadge({ status, raw }: { status: ShipmentStatus; raw?: string }) {
  const { t } = useTranslation();
  return (
    <span className={TONE_BADGE[statusTone(status)]} title={raw || undefined}>
      {t(`deliveries.shipment_status.${status}`)}
    </span>
  );
}

export function CashStatusBadge({ cash }: { cash: CashStatus }) {
  const { t } = useTranslation();
  return <span className={TONE_BADGE[cashTone(cash)]}>{t(`deliveries.cash_status.${cash}`)}</span>;
}
