import api from "@/lib/api";
import { createRequestQueue } from "@/lib/requestQueue";

/** One lane for the heavy report reads (dashboard widgets): see requestQueue.ts. */
export const heavyRequests = createRequestQueue(1);

/** Priorities for the dashboard: the numbers people look at first go first. */
export const HEAVY_PRIORITY = { kpis: 0, chart: 1, ranking: 2, hint: 3 } as const;

/**
 * GET through the heavy-request queue; resolves with the response body. Meant for a React
 * Query `queryFn`: pass its `signal` so leaving the page drops waiting requests.
 */
export function heavyGet<T>(url: string, options: { priority: number; signal?: AbortSignal }): Promise<T> {
  return heavyRequests.enqueue(
    (signal) => api.get<T>(url, { signal }).then((response) => response.data),
    options,
  );
}
