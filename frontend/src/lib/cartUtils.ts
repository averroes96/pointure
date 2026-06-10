/**
 * Pure cart logic utilities.
 * Extracted from SalesPage so they can be tested without rendering.
 */

import type { Product, Variant } from "@/types";

export interface CartItem {
  variant: Variant;
  product: Product;
  quantity: number;
  unit_price: number;
  discount: number;
}

/**
 * Add a variant to the cart.
 * If the variant is already in the cart, its quantity is incremented.
 * Returns a new array (immutable update).
 */
export function addItemToCart(
  cart: CartItem[],
  variant: Variant,
  product: Product
): CartItem[] {
  const existing = cart.find((i) => i.variant.id === variant.id);
  if (existing) {
    return cart.map((i) =>
      i.variant.id === variant.id ? { ...i, quantity: i.quantity + 1 } : i
    );
  }
  return [
    ...cart,
    {
      variant,
      product,
      quantity: 1,
      unit_price: parseFloat(product.sale_price),
      discount: 0,
    },
  ];
}

/**
 * Change the quantity of a line item by `delta`.
 * Quantity is clamped to a minimum of 1.
 */
export function updateItemQuantity(
  cart: CartItem[],
  variantId: number,
  delta: number
): CartItem[] {
  return cart.map((i) =>
    i.variant.id === variantId
      ? { ...i, quantity: Math.max(1, i.quantity + delta) }
      : i
  );
}

/**
 * Remove a variant from the cart entirely.
 */
export function removeItemFromCart(
  cart: CartItem[],
  variantId: number
): CartItem[] {
  return cart.filter((i) => i.variant.id !== variantId);
}

/**
 * Compute the cart total after per-line discounts and a global cart discount.
 */
export function computeCartTotal(
  cart: CartItem[],
  cartDiscount: number
): number {
  const lineSum = cart.reduce(
    (sum, item) => sum + item.unit_price * item.quantity - item.discount,
    0
  );
  return lineSum - cartDiscount;
}

/**
 * Validate payment total against sale total.
 * Returns an error string or null if valid.
 */
export function validatePaymentTotal(
  paymentTotal: number,
  saleTotal: number
): string | null {
  if (paymentTotal > saleTotal * 1.1) {
    return "Le montant payé dépasse largement le total de la vente.";
  }
  return null;
}
