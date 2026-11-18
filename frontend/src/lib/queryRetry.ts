import axios from "axios";

const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

/**
 * Retry rule for queries: one retry, but only when a second try can succeed.
 *
 * A 400-499 answer (not found, forbidden, plan upgrade, validation) is the server's final word, so
 * repeating it only doubled the requests (every 403/404 in a store's log came twice, a second apart).
 * A request that never got an answer (offline, server restarting) and a 5xx are retried once; so are
 * 408 and 429. A cancelled request is not retried. (A 401 is handled by the api interceptor, which
 * refreshes the token and replays the request itself.)
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (axios.isCancel(error)) return false;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined && status >= 400 && status < 500) {
      return RETRYABLE_CLIENT_STATUSES.has(status);
    }
  }
  return true;
}
