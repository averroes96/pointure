/** A courier from the dzship catalogue (GET /deliveries/couriers/). */
export interface CourierCatalogueEntry {
  key: string;
  name: string;
  platform: string;
  required_credentials: string[];
  capabilities: Record<string, boolean>;
  endpoint: string | null;
  requires_base_url: boolean;
  base_url_suffixes: string[];
}

export interface CourierCatalogue {
  couriers: CourierCatalogueEntry[];
  fetched_at: string | null;
  stale: boolean;
  refreshing: boolean;
}

/** POST /deliveries/provider-configs/{id}/test/ */
export type CourierTestResult =
  | { result: "ok"; capabilities: string[]; limited: boolean }
  | { result: "rate_limited"; retry_after: number }
  | { result: "not_supported"; reason: string }
  | { result: "refused" | "forbidden" | "unreachable" | "error" };

/** One courier account of the store (GET /deliveries/provider-configs/). Secrets are never returned. */
export interface CourierAccount {
  id: string;
  courier: string;
  courier_name: string;
  platform: string | null;
  required_credentials: string[];
  saved_credentials: string[];
  missing_credentials: string[];
  base_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Shipments (GET /deliveries/shipments/…, P1.10) ───────────────────────────

export const SHIPMENT_STATUSES = [
  "created", "pending_pickup", "picked_up", "in_transit", "at_hub", "out_for_delivery",
  "delivery_attempted", "delivered", "on_hold", "return_in_transit", "returned", "cancelled", "lost", "unknown",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const CASH_STATUSES = ["awaiting_delivery", "held_by_courier", "ready", "paid", "not_applicable"] as const;
export type CashStatus = (typeof CASH_STATUSES)[number];

export interface Shipment {
  id: string;
  courier: string;
  courier_name: string;
  tracking_number: string;
  reference: string;
  customer_order: string | null;
  recipient_name: string;
  recipient_phone: string;
  wilaya_code: string;
  commune: string;
  cod_amount: string | null;
  delivery_fee: string | null;
  store_amount: string | null;
  status: ShipmentStatus;
  raw_status: string;
  status_at: string | null;
  is_terminal: boolean;
  cash_status: CashStatus;
  courier_payout_ref: string;
  courier_paid_on: string | null;
  courier_updated_at: string | null;
  last_synced_at: string | null;
}

export interface ShipmentEvent {
  occurred_at: string;
  status: ShipmentStatus;
  raw_status: string;
  note: string;
}

export interface ShipmentDetail extends Shipment {
  events: ShipmentEvent[];
  refreshing: boolean;
}

export interface ShipmentPage {
  count: number;
  total_pages: number;
  current_page: number;
  results: Shipment[];
}

export interface CashBucket {
  count: number;
  cod_amount: string;
  store_amount: string;
}

export interface CourierSummary {
  courier: string;
  courier_name: string;
  total: number;
  by_status: Partial<Record<ShipmentStatus, number>>;
  by_cash: Partial<Record<CashStatus, CashBucket>>;
}

export interface CourierSyncState {
  courier: string;
  courier_name: string;
  last_synced_at: string | null;
  last_sync_error: string;
  syncing: boolean;
}

export interface ShipmentSummary {
  couriers: CourierSummary[];
  accounts: CourierSyncState[];
}

export interface ShipmentFilters {
  status: string;      // one ShipmentStatus or a comma list, "" = all
  cash_status: string; // one CashStatus, "" = all
  courier: string;
  date_from: string;   // YYYY-MM-DD
  date_to: string;
  search: string;
}

// ─── Courier payouts (GET /deliveries/payouts/…, P1.12) ───────────────────────

export interface CourierPayout {
  id: string;
  courier: string;
  courier_name: string;
  picked_up_on: string;
  amount_received: string;
  expected_amount: string;
  difference: string;
  courier_reference: string;
  notes: string;
  status: "recorded" | "voided";
  recorded_by_name: string;
  created_at: string;
  voided_at: string | null;
  voided_by_name: string;
  shipment_count: number;
  unconfirmed_count: number;
}

export interface PayoutShipment {
  id: string;
  tracking_number: string;
  recipient_name: string;
  cod_amount: string | null;
  delivery_fee: string | null;
  store_amount: string | null;
  courier_payout_ref: string;
  courier_paid_on: string | null;
}

export interface CourierPayoutDetail extends CourierPayout {
  shipments: PayoutShipment[];
}

export interface PayoutPage {
  count: number;
  total_pages: number;
  current_page: number;
  results: CourierPayout[];
}

export interface CourierPayoutToRecord {
  courier_payout_ref: string;
  paid_on: string | null;
  count: number;
  expected_amount: string;
}

export interface CourierToRecord {
  courier: string;
  courier_payouts: CourierPayoutToRecord[];
  held: { count: number; expected_amount: string } | null;
  ready: { count: number; expected_amount: string } | null;
}

export interface PayoutPreview {
  courier: string;
  count: number;
  expected_amount: string;
  shipment_ids: string[];
  trackings: string[];
}

/** What a payout covers: pasted tracking numbers and/or one courier payout. */
export interface PayoutParcels {
  courier: string;
  trackings: string[];
  courier_payout_ref: string;
}
