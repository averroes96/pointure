/**
 * Pure invoice calculation utilities.
 * Extracted from InvoiceBuilderPage so they can be tested without rendering.
 */

export interface LineItem {
  id: string;
  description: string;
  variant_id: number | null;
  variant_label: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
}

export const TVA_RATE = 19;

/**
 * Compute the HT total for a single invoice line.
 * Formula: qty × unit_price × (1 - discount_pct / 100)
 */
export function computeLineTotal(line: LineItem): number {
  const qty = parseFloat(line.quantity) || 0;
  const price = parseFloat(line.unit_price) || 0;
  const disc = parseFloat(line.discount_pct) || 0;
  return qty * price * (1 - disc / 100);
}

/**
 * Compute aggregate invoice totals from a set of line items.
 */
export function computeInvoiceTotals(
  lines: LineItem[],
  applyTva: boolean,
  tvaRate: number = TVA_RATE
): {
  subtotalHT: number;
  tvaAmount: number;
  totalTTC: number;
} {
  const subtotalHT = lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
  const tvaAmount = applyTva ? subtotalHT * (tvaRate / 100) : 0;
  const totalTTC = subtotalHT + tvaAmount;
  return { subtotalHT, tvaAmount, totalTTC };
}

/**
 * Compute balance due after a partial payment.
 */
export function computeBalanceDue(
  totalTTC: number,
  paidAmount: number
): number {
  return Math.max(0, totalTTC - paidAmount);
}
