import type { TFunction } from "i18next";

/**
 * Translated label for a courier credential name from the dzship catalogue.
 * Unknown names fall back to the raw name (the catalogue may add new ones).
 */
const KNOWN: Record<string, string> = {
  apiId: "deliveries.cred_apiId",
  apiKey: "deliveries.cred_apiKey",
  apiSecret: "deliveries.cred_apiSecret",
  apiToken: "deliveries.cred_apiToken",
  guid: "deliveries.cred_guid",
  key: "deliveries.cred_key",
  publicKey: "deliveries.cred_publicKey",
  tenantId: "deliveries.cred_tenantId",
  token: "deliveries.cred_token",
};

export function credentialLabel(t: TFunction, name: string): string {
  const key = KNOWN[name];
  return key ? t(key) : name;
}
