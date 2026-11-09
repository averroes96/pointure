/**
 * Role-based route access matrix (plan decision D6).
 *
 * Cashiers may reach the POS, sales history, reconciliation, the product
 * catalogue (read-only), low-stock, the barcode scanner, stocktake (for scanning),
 * and clients (for lookup and creation at the till). Everything else
 * needs at least the manager role; the audit log is owner-only.
 * Keep in sync with the backend `apps.core.permissions` matrix.
 */
import type { Role } from "@/types";

const RANK: Record<Role, number> = { cashier: 0, manager: 1, owner: 2 };

/** Path prefixes (matched on whole segments) requiring a minimum role. */
const OWNER_PREFIXES = ["/settings/audit-log", "/closing"];

const MANAGER_PREFIXES = [
  "/inventory/movements",
  "/inventory/transfers",
  "/inventory/defects",
  "/inventory/products/new",
  "/promotions",
  "/deliveries",
  "/invoices",
  "/quotes",
  "/delivery-notes",
  "/credit-notes",
  "/clients/ledger",
  "/clients/ageing",
  "/cheques",
  "/loyalty",
  "/suppliers",
  "/purchase-orders",
  "/reports",
  "/settings",
];

/** Product edit pages: /inventory/products/:id/edit */
const MANAGER_PATTERNS = [/^\/inventory\/products\/[^/]+\/edit$/];

function normalize(pathname: string): string {
  const clean = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Minimum role needed to open `pathname`, or `null` when every role may. */
export function requiredRoleForPath(pathname: string): Role | null {
  const path = normalize(pathname);
  if (OWNER_PREFIXES.some((p) => matchesPrefix(path, p))) return "owner";
  if (
    MANAGER_PREFIXES.some((p) => matchesPrefix(path, p)) ||
    MANAGER_PATTERNS.some((re) => re.test(path))
  ) {
    return "manager";
  }
  return null;
}

export function canAccessPath(role: Role | undefined | null, pathname: string): boolean {
  const required = requiredRoleForPath(pathname);
  if (!required) return true;
  if (!role) return false;
  return RANK[role] >= RANK[required];
}

