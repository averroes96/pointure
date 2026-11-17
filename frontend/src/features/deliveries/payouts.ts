import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import api, { formatDate } from "@/lib/api";
import type { CourierPayoutDetail, CourierPayoutToRecord, CourierToRecord, PayoutPage } from "./types";

/**
 * The courier's payment date, or "date not given (payout M-5)" for couriers that
 * report payment per parcel without a date (Yalidine family, P3.2).
 */
export function payoutDateLabel(
  t: TFunction, item: Pick<CourierPayoutToRecord, "paid_on" | "courier_payout_ref">, lang?: string,
): string {
  return item.paid_on
    ? formatDate(item.paid_on, lang)
    : t("deliveries.payout_no_date", { ref: item.courier_payout_ref });
}

/**
 * Tracking numbers pasted or scanned from the agency sheet: one per line, or
 * separated by spaces, commas or semicolons. Trimmed, de-duplicated, order kept.
 */
export function parseTrackings(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const value = part.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** received − expected, in cents, as a 2-decimal string ("" when the amount is not a number). */
export function payoutDifference(received: string, expected: string): string {
  const r = parseFloat(received.replace(",", "."));
  const e = parseFloat(expected);
  if (isNaN(r) || isNaN(e)) return "";
  return ((Math.round(r * 100) - Math.round(e * 100)) / 100).toFixed(2);
}

export function differenceTone(diff: string): "success" | "warning" | "danger" | "neutral" {
  if (diff === "") return "neutral";
  const n = parseFloat(diff);
  if (n === 0) return "success";
  return n < 0 ? "danger" : "warning";
}

export function usePayoutsToRecord(enabled: boolean) {
  return useQuery({
    queryKey: ["payouts-to-record"],
    queryFn: async () => (await api.get<{ couriers: CourierToRecord[] }>("/deliveries/payouts/to-record/")).data,
    enabled,
  });
}

export function usePayoutList(page: number) {
  return useQuery({
    queryKey: ["payouts", page],
    queryFn: async () =>
      (await api.get<PayoutPage>("/deliveries/payouts/", { params: page > 1 ? { page } : undefined })).data,
    placeholderData: (previous) => previous,
  });
}

export function usePayoutDetail(id: string | null) {
  return useQuery({
    queryKey: ["payout", id],
    queryFn: async () => (await api.get<CourierPayoutDetail>(`/deliveries/payouts/${id}/`)).data,
    enabled: !!id,
  });
}

/** Everything that changes when a payout is recorded or voided. */
export function useInvalidatePayouts() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ["payouts", "payout", "payouts-to-record", "shipments", "shipments-summary", "shipment"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}
