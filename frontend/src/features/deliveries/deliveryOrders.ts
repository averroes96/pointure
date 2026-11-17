/**
 * Delivery orders (docs/plans/delivery-v1-plan.md P2.6): types, the form's arithmetic
 * and checks, the request body, and the API hooks.
 *
 * Amounts shown before saving mirror the backend helpers (`lines_total`, `expected_cod`,
 * `check_cod` in delivery_integrations/models.py). The server recomputes them; the form
 * never sends a total, only the lines, the fee and an optional COD override.
 */
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { isValidAlgerianPhone } from "@/lib/phone";
import type { CashStatus, CourierAccount, ShipmentStatus } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderStatus = "draft" | "confirmed" | "dispatched" | "delivered" | "returned" | "rejected" | "failed";
export type DeliveryType = "home" | "stopdesk";
export type OrderAttention =
  | "" | "period_closed" | "returned_after_delivery" | "cancelled_after_pickup" | "lost"
  | "not_recorded" | "status_conflict" | "sale_failed";

export interface DeliveryOrderLine {
  id: string;
  variant: string;
  variant_label: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  subtotal: string;
}

export interface OrderShipmentSummary {
  id: string;
  status: ShipmentStatus;
  raw_status: string;
  status_at: string | null;
  cash_status: CashStatus;
  tracking_number: string;
}

export interface DeliveryOrder {
  id: string;
  source: string;
  customer_name: string;
  customer_phone: string;
  customer_phone2: string;
  wilaya: string;
  commune: string;
  address: string;
  customer_notes: string;
  delivery_type: DeliveryType;
  stop_desk_id: string;
  stop_desk_name: string;
  shipping_fee: string;
  quoted_fee: string | null;
  free_shipping: boolean;
  open_package: boolean;
  note_to_driver: string;
  cod_amount: string | null;
  lines: DeliveryOrderLine[];
  goods_total: string;
  expected_cod: string;
  cod_to_collect: string;
  status: OrderStatus;
  provider: string | null;
  tracking_number: string | null;
  sale: string | null;
  sale_receipt: string | null;
  shipment: OrderShipmentSummary | null;
  attention: OrderAttention;
  dispatched_at: string | null;
  created_at: string;
}

export interface OrderPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: DeliveryOrder[];
}

/** GET /deliveries/communes/?wilaya= */
export interface CourierCommuneName { name_fr: string; name_ar: string }
export interface CourierCommunes {
  wilaya: number;
  ship_wilaya: number;
  available: boolean;
  courier_communes: CourierCommuneName[];
  match: CourierCommuneName | null;
  refreshing: boolean;
}

export interface CourierDesk { id: string; name: string; wilaya_code: number; commune_name: string; address: string }

export interface CourierQuote {
  delivery_fee: string;
  return_fee: string | null;
  cod_fee: string | null;
  total: string | null;
  currency: string;
  delivery_type: DeliveryType;
  estimated_days: number | null;
}

// ─── Form state ───────────────────────────────────────────────────────────────

export interface FormLine {
  key: string;
  variant: string;
  label: string;
  stock: number | null;
  quantity: string;
  unit_price: string;
  discount_amount: string;
}

export interface OrderForm {
  customer_name: string;
  customer_phone: string;
  customer_phone2: string;
  wilaya: string;
  commune: string;
  address: string;
  customer_notes: string;
  delivery_type: DeliveryType;
  stop_desk_id: string;
  stop_desk_name: string;
  shipping_fee: string;
  quoted_fee: string;
  free_shipping: boolean;
  open_package: boolean;
  note_to_driver: string;
  /** "" = let the server use the expected COD. */
  cod_override: string;
  lines: FormLine[];
}

export function emptyForm(): OrderForm {
  return {
    customer_name: "", customer_phone: "", customer_phone2: "", wilaya: "", commune: "", address: "",
    customer_notes: "", delivery_type: "home", stop_desk_id: "", stop_desk_name: "", shipping_fee: "0",
    quoted_fee: "", free_shipping: false, open_package: false, note_to_driver: "", cod_override: "", lines: [],
  };
}

let lineSeq = 0;
export function newLineKey(): string {
  lineSeq += 1;
  return `line-${lineSeq}`;
}

export function formFromOrder(order: DeliveryOrder): OrderForm {
  return {
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || "",
    customer_phone2: order.customer_phone2 || "",
    wilaya: order.wilaya || "",
    commune: order.commune || "",
    address: order.address || "",
    customer_notes: order.customer_notes || "",
    delivery_type: order.delivery_type || "home",
    stop_desk_id: order.stop_desk_id || "",
    stop_desk_name: order.stop_desk_name || "",
    shipping_fee: order.shipping_fee || "0",
    quoted_fee: order.quoted_fee || "",
    free_shipping: !!order.free_shipping,
    open_package: !!order.open_package,
    note_to_driver: order.note_to_driver || "",
    cod_override: order.cod_amount ?? "",
    lines: (order.lines || []).map((l) => ({
      key: newLineKey(), variant: l.variant, label: l.variant_label, stock: null,
      quantity: String(l.quantity), unit_price: l.unit_price, discount_amount: l.discount_amount,
    })),
  };
}

// ─── Money (in cents, like the backend's Decimal) ─────────────────────────────

/** "4 500,50" / "4500.5" → 450050; null when not a number. */
export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s/g, "").replace(",", ".");
  if (text === "" || !/^-?\d+(\.\d{0,2})?$/.test(text)) return null;
  return Math.round(parseFloat(text) * 100);
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function quantityOf(line: Pick<FormLine, "quantity">): number {
  const n = Number(line.quantity);
  return Number.isInteger(n) ? n : 0;
}

export function lineSubtotalCents(line: FormLine): number {
  return (toCents(line.unit_price) ?? 0) * quantityOf(line) - (toCents(line.discount_amount) ?? 0);
}

export function goodsTotalCents(lines: FormLine[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotalCents(line), 0);
}

export function expectedCodCents(form: OrderForm): number {
  const fee = form.free_shipping ? 0 : toCents(form.shipping_fee) ?? 0;
  return goodsTotalCents(form.lines) + fee;
}

/** What the courier will collect: the override, or the expected amount. */
export function codToCollectCents(form: OrderForm): number {
  const override = toCents(form.cod_override);
  return form.cod_override.trim() !== "" && override !== null ? override : expectedCodCents(form);
}

// ─── Checks ───────────────────────────────────────────────────────────────────

/** Field → i18n key. "draft" checks what the server needs to save; "send" what a parcel needs. */
export type FormErrors = Partial<Record<string, string>>;

export function validateOrder(form: OrderForm, mode: "draft" | "send"): FormErrors {
  const errors: FormErrors = {};
  if (!form.customer_name.trim()) errors.customer_name = "delivery_orders.errors.required";
  if (!isValidAlgerianPhone(form.customer_phone)) errors.customer_phone = "delivery_orders.errors.phone";
  if (form.customer_phone2.trim() && !isValidAlgerianPhone(form.customer_phone2)) {
    errors.customer_phone2 = "delivery_orders.errors.phone";
  }
  if (toCents(form.shipping_fee) === null || (toCents(form.shipping_fee) ?? 0) < 0) {
    errors.shipping_fee = "delivery_orders.errors.amount";
  }
  form.lines.forEach((line) => {
    const qty = Number(line.quantity);
    const price = toCents(line.unit_price);
    const discount = toCents(line.discount_amount || "0");
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) errors[`line.${line.key}`] = "delivery_orders.errors.quantity";
    else if (price === null || price < 0) errors[`line.${line.key}`] = "delivery_orders.errors.price";
    else if (discount === null || discount < 0 || discount > price * qty) {
      errors[`line.${line.key}`] = "delivery_orders.errors.discount";
    }
  });
  if (form.cod_override.trim() !== "") {
    const cod = toCents(form.cod_override);
    if (cod === null || cod < 0) errors.cod_override = "delivery_orders.errors.amount";
    else if (cod % 100 !== 0) errors.cod_override = "delivery_orders.errors.cod_whole";
    else if (cod > expectedCodCents(form)) errors.cod_override = "delivery_orders.errors.cod_too_high";
  }
  if (mode === "send") {
    if (!form.wilaya) errors.wilaya = "delivery_orders.errors.required";
    if (!form.commune) errors.commune = "delivery_orders.errors.required";
    if (form.lines.length === 0) errors.lines = "delivery_orders.errors.no_lines";
    if (form.delivery_type === "stopdesk" && !form.stop_desk_id) errors.stop_desk_id = "delivery_orders.errors.desk";
  }
  return errors;
}

// ─── Request body ─────────────────────────────────────────────────────────────

/** POST/PATCH body. No totals: the server computes them from the lines. */
export function buildOrderPayload(form: OrderForm, creating: boolean): Record<string, unknown> {
  const money = (value: string) => fromCents(toCents(value) ?? 0);
  const body: Record<string, unknown> = {
    customer_name: form.customer_name.trim(),
    customer_phone: form.customer_phone.trim(),
    customer_phone2: form.customer_phone2.trim(),
    wilaya: form.wilaya,
    commune: form.commune,
    address: form.address.trim(),
    customer_notes: form.customer_notes,
    delivery_type: form.delivery_type,
    stop_desk_id: form.delivery_type === "stopdesk" ? form.stop_desk_id : "",
    stop_desk_name: form.delivery_type === "stopdesk" ? form.stop_desk_name : "",
    shipping_fee: money(form.shipping_fee),
    quoted_fee: form.quoted_fee.trim() ? money(form.quoted_fee) : null,
    free_shipping: form.free_shipping,
    open_package: form.open_package,
    note_to_driver: form.note_to_driver.trim(),
    cod_amount: form.cod_override.trim() ? money(form.cod_override) : null,
    lines: form.lines.map((line) => ({
      variant: line.variant,
      quantity: Number(line.quantity),
      unit_price: money(line.unit_price),
      discount_amount: money(line.discount_amount || "0"),
    })),
  };
  if (creating) body.source = "manual";
  return body;
}

// ─── Errors from the courier ──────────────────────────────────────────────────

export interface DispatchProblem { code: string; courierMessage: string }

/** The error code and the courier's own reason (P2.4 `details.courier_message`), if any. */
export function readDispatchProblem(err: unknown): DispatchProblem {
  if (!axios.isAxiosError(err)) return { code: "", courierMessage: "" };
  const error = err.response?.data?.error || {};
  const code = typeof error.code === "string" ? error.code : "";
  const courierMessage = typeof error.details?.courier_message === "string" ? error.details.courier_message : "";
  return { code, courierMessage };
}

// ─── List filters ─────────────────────────────────────────────────────────────

export type OrderTab = "all" | "drafts" | "in_progress" | "delivered" | "returned" | "attention";
export const ORDER_TABS: OrderTab[] = ["all", "drafts", "in_progress", "delivered", "returned", "attention"];

export function tabParams(tab: OrderTab, page: number): Record<string, string> {
  const params: Record<string, string> = {};
  if (tab === "drafts") params.status = "draft";
  if (tab === "in_progress") params.status = "confirmed,dispatched";
  if (tab === "delivered") params.status = "delivered";
  if (tab === "returned") params.status = "returned,rejected";
  if (tab === "attention") params.attention = "true";
  if (page > 1) params.page = String(page);
  return params;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export const ORDERS_KEY = ["customer-orders"];

export function useDeliveryOrders(tab: OrderTab, page: number) {
  return useQuery({
    queryKey: [...ORDERS_KEY, tab, page],
    queryFn: async () => (await api.get<OrderPage>("/deliveries/customer-orders/", { params: tabParams(tab, page) })).data,
    placeholderData: (previous) => previous,
  });
}

export function useInvalidateOrders() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ORDERS_KEY });
}

/** Same query key and shape as the settings page: one cache entry for both. */
export function useCourierAccounts() {
  return useQuery({
    queryKey: ["provider-configs"],
    queryFn: async () => {
      const res = await api.get("/deliveries/provider-configs/");
      return (res.data.results || res.data) as CourierAccount[];
    },
  });
}

export function usableAccounts(accounts: CourierAccount[]): CourierAccount[] {
  return accounts.filter((a) => a.is_active && a.missing_credentials.length === 0);
}

export function useCourierCommunes(wilaya: string, name: string) {
  return useQuery({
    queryKey: ["delivery-communes", wilaya, name],
    queryFn: async () => {
      const params: Record<string, string> = { wilaya };
      if (name) params.name = name;
      return (await api.get<CourierCommunes>("/deliveries/communes/", { params })).data;
    },
    enabled: !!wilaya,
    staleTime: 60 * 60 * 1000,
    // While the server fetches dzship's list for the first time, ask again shortly.
    refetchInterval: (query) => (query.state.data && !query.state.data.available ? 3000 : false),
  });
}

export function useCourierDesks(accountId: string, shipWilaya: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["delivery-desks", accountId, shipWilaya],
    queryFn: async () =>
      (await api.get<{ desks: CourierDesk[] }>(`/deliveries/provider-configs/${accountId}/desks/`, {
        params: { wilaya: shipWilaya },
      })).data.desks,
    enabled: enabled && !!accountId && !!shipWilaya,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

export function useCourierQuote(
  accountId: string, shipWilaya: number | undefined, deliveryType: DeliveryType, commune: string,
) {
  return useQuery({
    queryKey: ["delivery-quote", accountId, shipWilaya, deliveryType, commune],
    queryFn: async () =>
      (await api.get<CourierQuote>(`/deliveries/provider-configs/${accountId}/rates/`, {
        params: { to_wilaya: shipWilaya, delivery_type: deliveryType, to_commune: commune },
      })).data,
    enabled: !!accountId && !!shipWilaya,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
