/**
 * Time synchronization and clock anti-tamper utilities for ShoeDZ.
 *
 * Ensures the frontend always uses trusted time synchronized with
 * the backend and reliable network time sources, even if the OS clock
 * is misconfigured or a CMOS battery has failed.
 */
import { useQuery } from "@tanstack/react-query";
import api from "./api";

let _serverOffsetMs = 0;
let _hasSynced = false;

export interface TimeStatusResponse {
  current_time: string;
  current_time_display: string;
  timezone: string;
  is_online: boolean;
  is_synchronized: boolean;
  sync_source: string | null;
  skew_seconds: number;
  anomaly_detected: boolean;
  anomaly_type: string | null;
  anomaly_message: string;
  last_known_transaction: string | null;
  os_time: string;
}

/**
 * Updates the trusted time offset from an HTTP Date header or server timestamp.
 */
export function updateServerTimeOffset(serverDateInput: string | number): void {
  try {
    const serverMs =
      typeof serverDateInput === "number"
        ? serverDateInput
        : new Date(serverDateInput).getTime();

    if (!isNaN(serverMs)) {
      _serverOffsetMs = serverMs - Date.now();
      _hasSynced = true;
    }
  } catch {
    // Ignore invalid header format
  }
}

/**
 * Get current trusted date/time adjusted by server skew.
 */
export function getTrustedNow(): Date {
  return new Date(Date.now() + _serverOffsetMs);
}

/**
 * Get current trusted ISO date string formatted as YYYY-MM-DD.
 */
export function getTrustedDateString(): string {
  const now = getTrustedNow();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get current trusted epoch timestamp in milliseconds.
 */
export function getTrustedTimestamp(): number {
  return Date.now() + _serverOffsetMs;
}

/**
 * Returns whether at least one sync with the server has taken place.
 */
export function isTimeSynchronized(): boolean {
  return _hasSynced;
}

/**
 * React hook to observe server time sync, detect clock anomalies,
 * and trigger manual resynchronization.
 */
export function useTimeSyncStatus(pollIntervalMs: number = 300000) {
  const query = useQuery<TimeStatusResponse>({
    queryKey: ["core", "time"],
    queryFn: () => api.get("/core/time/").then((r) => r.data),
    refetchInterval: pollIntervalMs,
    staleTime: 60000,
  });

  // Keep offset aligned with server's verified current_time
  if (query.data?.current_time) {
    updateServerTimeOffset(query.data.current_time);
  }

  const resync = async () => {
    // If in Electron, also signal Windows w32tm to correct PC clock
    if (window.electronAPI?.resyncSystemClock) {
      try {
        await window.electronAPI.resyncSystemClock();
      } catch {
        // Continue to API sync
      }
    }
    const res = await api.get("/core/time/?resync=true");
    if (res.data?.current_time) {
      updateServerTimeOffset(res.data.current_time);
    }
    return query.refetch();
  };

  return {
    ...query,
    resync,
    anomalyDetected: query.data?.anomaly_detected ?? false,
    anomalyMessage: query.data?.anomaly_message ?? "",
    skewSeconds: query.data?.skew_seconds ?? 0,
    isSynchronized: query.data?.is_synchronized ?? false,
    isOnline: query.data?.is_online ?? false,
    syncSource: query.data?.sync_source,
    currentTimeDisplay: query.data?.current_time_display,
    trustedNow: getTrustedNow(),
  };
}
