export interface BulkAdjustment {
  variant: string;
  quantity_delta: number;
}

/**
 * Body lines of POST /inventory/movements/bulk-adjust/ from the quantities typed per variant.
 *
 * Variant ids are UUID strings and arrive here as object keys: keep them as they are. Running them through
 * Number() turned every id into NaN (sent as null) or, for an id starting with digits, into a wrong number,
 * so the grouped restock could never reach the right variants. Lines without a positive quantity are dropped.
 */
export function toBulkAdjustments(quantities: Record<string | number, number>): BulkAdjustment[] {
  return Object.entries(quantities)
    .map(([variant, quantity]) => ({ variant, quantity_delta: Number(quantity) }))
    .filter((adjustment) => adjustment.quantity_delta > 0);
}
