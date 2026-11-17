import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { formatDateTime } from "../shipments";
import type { CourierSyncState } from "../types";

interface Props {
  accounts: CourierSyncState[];
  refreshing: boolean;
  onRefresh: () => void;
}

const KNOWN_ERRORS = [
  "auth_refused", "forbidden", "unreachable", "rate_limited", "key_scope", "unknown_courier",
  "no_connector", "no_base_url", "partial", "connector_error", "error",
];

/** One line per courier account: last update, problem if any, and the Refresh button. */
export default function ShipmentSyncBar({ accounts, refreshing, onRefresh }: Props) {
  const { t, i18n } = useTranslation();
  const anySyncing = accounts.some((a) => a.syncing);

  return (
    <div className="card card-body flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
      <ul className="space-y-1 text-sm">
        {accounts.map((a) => {
          const error = a.last_sync_error
            ? t(`deliveries.sync_error.${KNOWN_ERRORS.includes(a.last_sync_error) ? a.last_sync_error : "error"}`)
            : "";
          return (
            <li key={a.courier} className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-white">{a.courier_name}</span>
              {a.syncing ? (
                <span className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("deliveries.syncing")}
                </span>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">
                  {a.last_synced_at
                    ? t("deliveries.last_sync", { when: formatDateTime(a.last_synced_at, i18n.language) })
                    : t("deliveries.never_synced")}
                </span>
              )}
              {!a.syncing && error && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {error}
                </span>
              )}
              {!a.syncing && !error && a.last_synced_at && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn-secondary shrink-0" onClick={onRefresh} disabled={refreshing || anySyncing}>
        <RefreshCw className={"w-4 h-4" + (anySyncing ? " animate-spin" : "")} />
        <span>{anySyncing ? t("deliveries.syncing") : t("common.refresh")}</span>
      </button>
    </div>
  );
}
