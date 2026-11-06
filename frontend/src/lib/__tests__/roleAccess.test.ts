import { describe, it, expect } from "vitest";
import { canAccessPath, requiredRoleForPath } from "../roleAccess";

describe("roleAccess", () => {
  it("lets every role open POS, history, reconciliation, catalogue, scanner, stocktake and clients", () => {
    for (const p of [
      "/", "/sales", "/sales/new", "/sales/reconciliation",
      "/inventory/products", "/inventory/products/42",
      "/inventory/low-stock", "/inventory/scanner",
      "/inventory/stocktake", "/clients", "/clients/new", "/clients/42",
    ]) {
      expect(canAccessPath("cashier", p)).toBe(true);
    }
    expect(requiredRoleForPath("/inventory/stocktake")).toBeNull();
    expect(requiredRoleForPath("/clients")).toBeNull();
  });

  it("blocks cashiers from restricted pages typed by URL", () => {
    for (const p of [
      "/settings", "/settings/webhooks", "/reports/daily", "/reports/builder",
      "/inventory/products/new", "/inventory/products/42/edit",
      "/clients/ledger", "/clients/ageing", "/invoices/new",
      "/suppliers/payables", "/purchase-orders", "/promotions", "/loyalty",
      "/cheques", "/deliveries/drafts", "/settings/", "/reports/stock?x=1",
      "/closing",
    ]) {
      expect(canAccessPath("cashier", p)).toBe(false);
    }
    expect(requiredRoleForPath("/clients/ledger")).toBe("manager");
    expect(requiredRoleForPath("/clients/ageing")).toBe("manager");
  });

  it("lets managers in but keeps the audit log and closing owner-only", () => {
    expect(canAccessPath("manager", "/settings")).toBe(true);
    expect(canAccessPath("manager", "/inventory/products/new")).toBe(true);
    expect(canAccessPath("manager", "/settings/audit-log")).toBe(false);
    expect(canAccessPath("owner", "/settings/audit-log")).toBe(true);
    expect(requiredRoleForPath("/settings/audit-log")).toBe("owner");
    expect(canAccessPath("manager", "/closing")).toBe(false);
    expect(canAccessPath("owner", "/closing")).toBe(true);
    expect(requiredRoleForPath("/closing")).toBe("owner");
  });

  it("does not match unrelated paths sharing a prefix and denies unknown roles", () => {
    expect(requiredRoleForPath("/clientsfoo")).toBeNull();
    expect(canAccessPath(undefined, "/reports/daily")).toBe(false);
  });
});
