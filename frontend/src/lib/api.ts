/**
 * Axios instance pre-configured for the ShoeDZ API.
 * - Base URL from VITE_API_URL env var
 * - Attaches JWT token from localStorage
 * - Handles 401 → redirect to login
 * - Handles 403 → show permission error
 */
import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { updateServerTimeOffset } from "./time";
import i18n from "./i18n";

const BASE_URL = import.meta.env.VITE_API_URL !== undefined
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.DEV ? "http://localhost:8000" : "");

const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// ── Request interceptor: attach JWT token ──────────────────────────────────
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem("access_token");
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

// ── Response interceptor: handle auth errors & sync clock offset ───────────
api.interceptors.response.use(
  (response: AxiosResponse) => {
    const serverDate = response.headers?.date;
    if (serverDate) {
      updateServerTimeOffset(serverDate);
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = localStorage.getItem("refresh_token");

      if (!refreshToken) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
        const publicRoutes = ["/login", "/setup", "/forgot-password", "/reset-password"];
        if (!publicRoutes.includes(window.location.pathname)) {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          subscribeTokenRefresh((newToken) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
            }
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const response = await axios.post(`${BASE_URL}/api/v1/auth/refresh/`, {
          refresh: refreshToken,
        });
        const { access, refresh } = response.data;
        localStorage.setItem("access_token", access);
        if (refresh) {
          localStorage.setItem("refresh_token", refresh);
        }
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access}`;
        }
        isRefreshing = false;
        onRefreshed(access);
        return api(originalRequest);
      } catch (refreshErr) {
        isRefreshing = false;
        refreshSubscribers = [];
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("user");
        const publicRoutes = ["/login", "/setup", "/forgot-password", "/reset-password"];
        if (!publicRoutes.includes(window.location.pathname)) {
          window.location.href = "/login";
        }
        return Promise.reject(refreshErr);
      }
    }

    if (
      error.response?.status === 403 &&
      (error.response?.data as { error?: string })?.error === "plan_upgrade_required"
    ) {
      window.dispatchEvent(
        new CustomEvent("plan-upgrade-required", {
          detail: error.response.data,
        })
      );
    }

    return Promise.reject(error);
  }
);

export default api;

// ── Typed API helpers ──────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  total_pages: number;
  current_page: number;
  results: T[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    status_code: number;
  };
}

/** Extract the API error message from an axios error.
 *
 * Handles DRF error shapes in priority order:
 *   1. {error: {message: "..."}}   — custom error envelope
 *   2. {detail: "..."}             — DRF default
 *   3. ["msg1", "msg2"]            — top-level array
 *   4. {field: ["msg"], ...}       — field-level / non_field_errors
 */
export function getApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;

    if (data?.error?.message) return String(data.error.message);
    if (data?.detail) return String(data.detail);

    if (Array.isArray(data)) {
      const msgs = data.filter((v) => typeof v === "string");
      if (msgs.length) return msgs.join(" ");
    }

    if (data && typeof data === "object" && !Array.isArray(data)) {
      const messages: string[] = [];
      for (const value of Object.values(data as Record<string, unknown>)) {
        if (Array.isArray(value)) messages.push(...value.map(String));
        else if (typeof value === "string") messages.push(value);
      }
      if (messages.length) return messages.join(" ");
    }
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

/** Format DZD amount with locale-aware grouping */
export function formatDZD(amount: number | string | null | undefined, lang?: string): string {
  if (amount == null) return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "—";
  const active = (lang || i18n?.language || localStorage.getItem("i18nextLng") || "fr").toLowerCase();
  const locale = active.startsWith("ar") ? "ar-DZ" : active.startsWith("en") ? "en-US" : "fr-DZ";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(num);
}

/** Format date as DD/MM/YYYY with locale-aware calendar formatting */
export function formatDate(dateStr: string | null | undefined, lang?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const active = (lang || i18n?.language || localStorage.getItem("i18nextLng") || "fr").toLowerCase();
  const locale = active.startsWith("ar") ? "ar-DZ" : active.startsWith("en") ? "en-US" : "fr-DZ";
  return d.toLocaleDateString(locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}
