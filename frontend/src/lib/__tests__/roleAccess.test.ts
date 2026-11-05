import { describe, it, expect } from "vitest";
import { canAccessPath, requiredRoleForPath } from "../roleAccess";

describe("roleAccess", () => {
  it("lets every role open POS, history, reconciliation, catalogue and scanner", () => {
    for (const p of [
      "/", "/sales", "/sales/new", "/sales/reconciliation",
      "/inventory/products", "/inventory/products/42",
      "/inventory/low-stock", "/inventory/scanner",
    ]) {
      expect(canAccessPath("cashier", p)).toBe(true);
    }
  });

  it("blocks cashiers from restricted pages typed by URL", () => {
    for (const p of [
      "/settings", "/settings/webhooks", "/reports/daily", "/reports/builder",
      "/inventory/products/new", "/inventory/products/42/edit",
      "/inventory/stocktake", "/clients", "/clients/new", "/invoices/new",
      "/suppliers/payables", "/purchase-orders", "/promotions", "/loyalty",
      "/cheques", "/deliveries/drafts", "/settings/", "/reports/stock?x=1",
    ]) {
      expect(canAccessPath("cashier", p)).toBe(false);
    }
  });

  it("lets managers in but keeps the audit log owner-only", () => {
    expect(canAccessPath("manager", "/settings")).toBe(true);
    expect(canAccessPath("manager", "/inventory/products/new")).toBe(true);
    expect(canAccessPath("manager", "/settings/audit-log")).toBe(false);
    expect(canAccessPath("owner", "/settings/audit-log")).toBe(true);
    expect(requiredRoleForPath("/settings/audit-log")).toBe("owner");
  });

  it("does not match unrelated paths sharing a prefix and denies unknown roles", () => {
    expect(requiredRoleForPath("/clientsfoo")).toBeNull();
    expect(canAccessPath(undefined, "/reports/daily")).toBe(false);
  });
});
