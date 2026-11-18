/**
 * Requests of the defects page (anomalies, 2nd-choice sales, supplier return claims).
 *
 * Ids are UUID strings: never run them through parseInt/Number (`parseInt("0285e8f8-…")` is 285).
 * Routes and body keys follow `DefectItemViewSet` in apps/inventory/views.py.
 */
import api from "@/lib/api";

export interface LogDefectInput {
  variantId: string | number;
  branchId?: string;
  supplierId?: string;
  defectReason: string;
  quantity: number;
  costPrice?: number;
  notes: string;
}

/** POST /inventory/defects/ */
export function logDefect(input: LogDefectInput) {
  return api.post("/inventory/defects/", {
    variant: input.variantId,
    branch: input.branchId || undefined,
    supplier: input.supplierId || null,
    defect_reason: input.defectReason,
    quantity: input.quantity,
    cost_price: input.costPrice,
    notes: input.notes,
  });
}

/** Mark a quarantined defect as a total loss (rebut). */
export function writeOffDefect(id: string | number) {
  return api.post(`/inventory/defects/${id}/resolve-write-off/`);
}

/** Mark a quarantined defect as sold at a discount (2ème choix). */
export function sellDefectAtDiscount(id: string | number) {
  return api.post(`/inventory/defects/${id}/resolve-discount-sale/`);
}

/** Batch the selected defects into a supplier return claim (bon de retour). */
export function createSupplierClaim(itemIds: Array<string | number>, supplierId: string, notes: string) {
  return api.post("/inventory/defects/create-supplier-claim/", {
    item_ids: itemIds,
    supplier_id: supplierId,
    notes,
  });
}
