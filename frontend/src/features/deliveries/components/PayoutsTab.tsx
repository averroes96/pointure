import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList } from "lucide-react";
import { usePayoutsToRecord } from "../payouts";
import type { CourierSyncState } from "../types";
import ManualPayoutModal from "./ManualPayoutModal";
import PayoutsPanel from "./PayoutsPanel";
import PayoutsToConfirm from "./PayoutsToConfirm";

/**
 * Payouts tab (P1.13): what the courier reported and is waiting for confirmation,
 * the manual entry from an agency sheet, and the history of recorded payouts.
 */
export default function PayoutsTab({ accounts }: { accounts: CourierSyncState[] }) {
  const { t } = useTranslation();
  const [manualOpen, setManualOpen] = useState(false);
  const toRecord = usePayoutsToRecord(true);
  const names = Object.fromEntries(accounts.map((a) => [a.courier, a.courier_name]));
  const couriers = (toRecord.data?.couriers || []).filter((c) => c.courier_payouts.length > 0 || c.held);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button type="button" className="btn-secondary" onClick={() => setManualOpen(true)}>
          <ClipboardList className="w-4 h-4" />
          <span>{t("deliveries.payout_manual_button")}</span>
        </button>
      </div>

      {couriers.map((c) => (
        <PayoutsToConfirm key={c.courier} courier={c} courierName={names[c.courier] || c.courier} />
      ))}

      <section className="space-y-2">
        <h3 className="form-label">{t("deliveries.payout_history")}</h3>
        <PayoutsPanel />
      </section>

      <ManualPayoutModal open={manualOpen} accounts={accounts} onClose={() => setManualOpen(false)} />
    </div>
  );
}
