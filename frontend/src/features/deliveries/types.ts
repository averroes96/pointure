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
