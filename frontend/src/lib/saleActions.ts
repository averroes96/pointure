import type { Role } from "@/types";

/**
 * Whether the sales history offers the Return and Exchange buttons for a sale.
 *
 * Every role may start them on a completed sale. A cashier then goes through the same screens as a manager,
 * and the server decides who needs a manager PIN (the user's `can_process_returns` flag and the store
 * setting `require_manager_pin_for_returns`). The buttons used to be shown to owners and managers only,
 * so a cashier with the permission could never open the return dialog.
 */
export function canStartReturnOrExchange(role: Role | undefined | null, saleStatus: string): boolean {
  return saleStatus === "completed" && (role === "owner" || role === "manager" || role === "cashier");
}
