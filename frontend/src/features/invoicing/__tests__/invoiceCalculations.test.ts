import { describe, it, expect } from "vitest";
import {
  computeLineTotal,
  computeInvoiceTotals,
  computeBalanceDue,
  TVA_RATE,
  type LineItem,
} from "@/lib/invoiceUtils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeLine(overrides: Partial<LineItem> = {}): LineItem {
  return {
    id: "line-1",
    description: "Chaussures Nike",
    variant_id: null,
    variant_label: "",
    quantity: "1",
    unit_price: "8000",
    discount_pct: "0",
    ...overrides,
  };
}

// ─── computeLineTotal ─────────────────────────────────────────────────────────

describe("computeLineTotal", () => {
  it("returns qty × price with no discount", () => {
    const line = makeLine({ quantity: "3", unit_price: "5000", discount_pct: "0" });
    expect(computeLineTotal(line)).toBe(15000);
  });

  it("applies percentage discount correctly", () => {
    // 1 × 10000 × (1 - 10/100) = 9000
    const line = makeLine({ quantity: "1", unit_price: "10000", discount_pct: "10" });
    expect(computeLineTotal(line)).toBeCloseTo(9000);
  });

  it("returns 0 for empty description and 0 price", () => {
    const line = makeLine({ quantity: "1", unit_price: "0", discount_pct: "0" });
    expect(computeLineTotal(line)).toBe(0);
  });

  it("returns 0 for invalid (non-numeric) quantity", () => {
    const line = makeLine({ quantity: "", unit_price: "8000", discount_pct: "0" });
    expect(computeLineTotal(line)).toBe(0);
  });

  it("handles fractional quantities", () => {
    // 2.5 × 4000 = 10000
    const line = makeLine({ quantity: "2.5", unit_price: "4000", discount_pct: "0" });
    expect(computeLineTotal(line)).toBeCloseTo(10000);
  });

  it("handles 100% discount", () => {
    const line = makeLine({ quantity: "2", unit_price: "8000", discount_pct: "100" });
    expect(computeLineTotal(line)).toBe(0);
  });

  it("handles mixed discount and multi-unit", () => {
    // 3 × 6000 × (1 - 20/100) = 14400
    const line = makeLine({ quantity: "3", unit_price: "6000", discount_pct: "20" });
    expect(computeLineTotal(line)).toBeCloseTo(14400);
  });
});

// ─── computeInvoiceTotals ─────────────────────────────────────────────────────

describe("computeInvoiceTotals", () => {
  it("returns correct subtotalHT for multiple lines without TVA", () => {
    const lines: LineItem[] = [
      makeLine({ id: "l1", quantity: "2", unit_price: "5000", discount_pct: "0" }),
      makeLine({ id: "l2", quantity: "1", unit_price: "3000", discount_pct: "0" }),
    ];
    // 10000 + 3000 = 13000
    const { subtotalHT, tvaAmount, totalTTC } = computeInvoiceTotals(lines, false);
    expect(subtotalHT).toBe(13000);
    expect(tvaAmount).toBe(0);
    expect(totalTTC).toBe(13000);
  });

  it("applies TVA at the configured rate", () => {
    const lines: LineItem[] = [
      makeLine({ id: "l1", quantity: "1", unit_price: "10000", discount_pct: "0" }),
    ];
    const { subtotalHT, tvaAmount, totalTTC } = computeInvoiceTotals(lines, true, TVA_RATE);
    expect(subtotalHT).toBe(10000);
    expect(tvaAmount).toBeCloseTo(1900); // 10000 × 19%
    expect(totalTTC).toBeCloseTo(11900);
  });

  it("does not apply TVA when applyTva is false", () => {
    const lines: LineItem[] = [
      makeLine({ id: "l1", quantity: "2", unit_price: "8000", discount_pct: "0" }),
    ];
    const { tvaAmount, totalTTC } = computeInvoiceTotals(lines, false);
    expect(tvaAmount).toBe(0);
    expect(totalTTC).toBe(16000);
  });

  it("accounts for line discounts in the subtotal", () => {
    const lines: LineItem[] = [
      makeLine({ id: "l1", quantity: "2", unit_price: "10000", discount_pct: "10" }),
    ];
    // 2 × 10000 × (1 - 0.1) = 18000
    const { subtotalHT } = computeInvoiceTotals(lines, false);
    expect(subtotalHT).toBeCloseTo(18000);
  });

  it("returns all zeros for an empty line list", () => {
    const { subtotalHT, tvaAmount, totalTTC } = computeInvoiceTotals([], false);
    expect(subtotalHT).toBe(0);
    expect(tvaAmount).toBe(0);
    expect(totalTTC).toBe(0);
  });

  it("skips lines with empty unit_price", () => {
    const lines: LineItem[] = [
      makeLine({ id: "l1", quantity: "1", unit_price: "5000", discount_pct: "0" }),
      makeLine({ id: "l2", quantity: "3", unit_price: "", discount_pct: "0" }), // empty
    ];
    const { subtotalHT } = computeInvoiceTotals(lines, false);
    expect(subtotalHT).toBe(5000);
  });

  it("supports a custom TVA rate", () => {
    const lines: LineItem[] = [
      makeLine({ id: "l1", quantity: "1", unit_price: "10000", discount_pct: "0" }),
    ];
    const { tvaAmount } = computeInvoiceTotals(lines, true, 9);
    expect(tvaAmount).toBeCloseTo(900); // 10000 × 9%
  });
});

// ─── computeBalanceDue ───────────────────────────────────────────────────────

describe("computeBalanceDue", () => {
  it("returns totalTTC minus paid amount", () => {
    expect(computeBalanceDue(10000, 4000)).toBe(6000);
  });

  it("returns 0 when fully paid", () => {
    expect(computeBalanceDue(10000, 10000)).toBe(0);
  });

  it("returns 0 when overpaid (no negative balance)", () => {
    expect(computeBalanceDue(10000, 12000)).toBe(0);
  });

  it("returns full totalTTC when nothing has been paid", () => {
    expect(computeBalanceDue(15000, 0)).toBe(15000);
  });
});
