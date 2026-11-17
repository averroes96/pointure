import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type {
  CashStatus,
  ShipmentDetail,
  ShipmentFilters,
  ShipmentPage,
  ShipmentStatus,
  ShipmentSummary,
} from "./types";

export const EMPTY_FILTERS: ShipmentFilters = {
  status: "", cash_status: "", courier: "", date_from: "", date_to: "", search: "",
};

/** Statuses that usually need a phone call to the customer. */
export const FOLLOW_UP_STATUSES: ShipmentStatus[] = ["delivery_attempted", "on_hold"];
const FINAL: ShipmentStatus[] = ["delivered", "returned", "cancelled", "lost"];

/** Query parameters for the list: only non-empty filters, plus the page. */
export function buildShipmentParams(filters: ShipmentFilters, page = 1): Record<string, string> {
  const params: Record<string, string> = {};
  (Object.keys(filters) as (keyof ShipmentFilters)[]).forEach((key) => {
    const value = filters[key].trim();
    if (value) params[key] = value;
  });
  if (page > 1) params.page = String(page);
  return params;
}

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export function statusTone(status: ShipmentStatus): Tone {
  if (status === "delivered") return "success";
  if (status === "returned" || status === "cancelled" || status === "lost") return "danger";
  if (status === "delivery_attempted" || status === "on_hold" || status === "return_in_transit") return "warning";
  if (status === "picked_up" || status === "in_transit" || status === "at_hub" || status === "out_for_delivery") {
    return "info";
  }
  return "neutral";
}

export function cashTone(cash: CashStatus): Tone {
  if (cash === "paid") return "success";
  if (cash === "held_by_courier") return "warning";
  if (cash === "ready") return "info";
  return "neutral";
}

export const TONE_BADGE: Record<Tone, string> = {
  success: "badge badge-success",
  warning: "badge badge-warning",
  danger: "badge badge-danger",
  info: "badge badge-info",
  neutral: "badge badge-neutral",
};

/** Money strings ("8000.50") summed in cents, returned as a string with 2 decimals. */
function addMoney(a: string, b: string | undefined): string {
  const cents = (s: string | undefined) => Math.round(parseFloat(s || "0") * 100) || 0;
  return ((cents(a) + cents(b)) / 100).toFixed(2);
}

export interface SummaryCards {
  inProgress: number;
  followUp: number;
  held: { count: number; amount: string };
  ready: { count: number; amount: string };
  paid: { count: number; amount: string };
  returned: number;
}

/**
 * Totals across couriers for the summary cards. Money cards show what the courier
 * owes the store (`store_amount`), the figure the store actually receives.
 */
export function summarizeShipments(summary: ShipmentSummary | undefined): SummaryCards {
  const cards: SummaryCards = {
    inProgress: 0,
    followUp: 0,
    held: { count: 0, amount: "0.00" },
    ready: { count: 0, amount: "0.00" },
    paid: { count: 0, amount: "0.00" },
    returned: 0,
  };
  for (const courier of summary?.couriers || []) {
    for (const [status, n] of Object.entries(courier.by_status) as [ShipmentStatus, number][]) {
      if (!FINAL.includes(status)) cards.inProgress += n;
      if (FOLLOW_UP_STATUSES.includes(status)) cards.followUp += n;
      if (status === "returned") cards.returned += n;
    }
    const money = (cash: CashStatus, target: { count: number; amount: string }) => {
      const bucket = courier.by_cash[cash];
      if (!bucket) return;
      target.count += bucket.count;
      target.amount = addMoney(target.amount, bucket.store_amount);
    };
    money("held_by_courier", cards.held);
    money("ready", cards.ready);
    money("paid", cards.paid);
  }
  return cards;
}

/** Date and time in the user's language (same locale rule as formatDate in @/lib/api). */
export function formatDateTime(iso: string | null | undefined, lang?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const active = (lang || "fr").toLowerCase();
  const locale = active.startsWith("ar") ? "ar-DZ" : active.startsWith("en") ? "en-US" : "fr-DZ";
  return d.toLocaleString(locale, {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useShipmentSummary(filters: Pick<ShipmentFilters, "courier" | "date_from" | "date_to">) {
  return useQuery({
    queryKey: ["shipments-summary", filters],
    queryFn: async () =>
      (await api.get<ShipmentSummary>("/deliveries/shipments/summary/", {
        params: buildShipmentParams({ ...filters, status: "", cash_status: "", search: "" }),
      })).data,
    // While a courier is being read in the background, read again every 3 s.
    refetchInterval: (q) => (q.state.data?.accounts.some((a) => a.syncing) ? 3000 : false),
  });
}

export function useShipmentList(filters: ShipmentFilters, page: number, syncing: boolean) {
  return useQuery({
    queryKey: ["shipments", filters, page],
    queryFn: async () =>
      (await api.get<ShipmentPage>("/deliveries/shipments/", { params: buildShipmentParams(filters, page) })).data,
    placeholderData: (previous) => previous,
    refetchInterval: syncing ? 3000 : false,
  });
}

export function useShipmentDetail(id: string | null) {
  return useQuery({
    queryKey: ["shipment", id],
    queryFn: async () => (await api.get<ShipmentDetail>(`/deliveries/shipments/${id}/`)).data,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.refreshing ? 2000 : false),
  });
}
