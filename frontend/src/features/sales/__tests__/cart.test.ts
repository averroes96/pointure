import { describe, it, expect } from "vitest";
import {
  addItemToCart,
  updateItemQuantity,
  removeItemFromCart,
  computeCartTotal,
  validatePaymentTotal,
  type CartItem,
} from "@/lib/cartUtils";
import type { Product, Variant } from "@/types";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 1,
    product: 1,
    product_name: "Nike Air Max",
    product_sale_price: "8000.00",
    size_eu: 42,
    colour: "Noir",
    barcode: "1234567890123",
    stock_qty: 10,
    alert_threshold: 2,
    is_active: true,
    is_low_stock: false,
    is_out_of_stock: false,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: "Air Max",
    brand: "Nike",
    reference: "AM-001",
    category: "sneakers",
    gender: "M",
    season: "all",
    sale_price: "8000.00",
    image: null,
    description: "",
    is_active: true,
    total_stock: 20,
    has_low_stock: false,
    variants: [],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── addItemToCart ────────────────────────────────────────────────────────────

describe("addItemToCart", () => {
  it("adds a new item with quantity 1 and unit_price from product.sale_price", () => {
    const variant = makeVariant();
    const product = makeProduct({ sale_price: "8000.00" });
    const cart = addItemToCart([], variant, product);

    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(1);
    expect(cart[0].unit_price).toBe(8000);
    expect(cart[0].discount).toBe(0);
    expect(cart[0].variant.id).toBe(variant.id);
  });

  it("increments quantity when the same variant is added again", () => {
    const variant = makeVariant({ id: 42 });
    const product = makeProduct();
    const cart1 = addItemToCart([], variant, product);
    const cart2 = addItemToCart(cart1, variant, product);

    expect(cart2).toHaveLength(1);
    expect(cart2[0].quantity).toBe(2);
  });

  it("keeps other items unchanged when adding a new variant", () => {
    const v1 = makeVariant({ id: 1 });
    const v2 = makeVariant({ id: 2 });
    const product = makeProduct();

    const cart = addItemToCart(addItemToCart([], v1, product), v2, product);

    expect(cart).toHaveLength(2);
    expect(cart.find((i) => i.variant.id === 1)?.quantity).toBe(1);
    expect(cart.find((i) => i.variant.id === 2)?.quantity).toBe(1);
  });

  it("does not mutate the original cart", () => {
    const variant = makeVariant();
    const product = makeProduct();
    const original: CartItem[] = [];

    addItemToCart(original, variant, product);
    expect(original).toHaveLength(0);
  });
});

// ─── updateItemQuantity ───────────────────────────────────────────────────────

describe("updateItemQuantity", () => {
  function cartWithItem(quantity: number): CartItem[] {
    return [
      {
        variant: makeVariant({ id: 1 }),
        product: makeProduct(),
        quantity,
        unit_price: 8000,
        discount: 0,
      },
    ];
  }

  it("increments quantity by delta", () => {
    const result = updateItemQuantity(cartWithItem(2), 1, +1);
    expect(result[0].quantity).toBe(3);
  });

  it("decrements quantity by delta", () => {
    const result = updateItemQuantity(cartWithItem(3), 1, -1);
    expect(result[0].quantity).toBe(2);
  });

  it("clamps quantity to a minimum of 1", () => {
    const result = updateItemQuantity(cartWithItem(1), 1, -5);
    expect(result[0].quantity).toBe(1);
  });

  it("does not affect other items", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 2, unit_price: 8000, discount: 0 },
      { variant: makeVariant({ id: 2 }), product: makeProduct(), quantity: 5, unit_price: 5000, discount: 0 },
    ];
    const result = updateItemQuantity(cart, 1, +3);
    expect(result[0].quantity).toBe(5);
    expect(result[1].quantity).toBe(5); // unchanged
  });
});

// ─── removeItemFromCart ───────────────────────────────────────────────────────

describe("removeItemFromCart", () => {
  it("removes the target variant from the cart", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 1, unit_price: 8000, discount: 0 },
      { variant: makeVariant({ id: 2 }), product: makeProduct(), quantity: 2, unit_price: 5000, discount: 0 },
    ];
    const result = removeItemFromCart(cart, 1);
    expect(result).toHaveLength(1);
    expect(result[0].variant.id).toBe(2);
  });

  it("returns an empty array when the only item is removed", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 1, unit_price: 8000, discount: 0 },
    ];
    expect(removeItemFromCart(cart, 1)).toHaveLength(0);
  });

  it("returns the cart unchanged when the variant is not found", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 1, unit_price: 8000, discount: 0 },
    ];
    expect(removeItemFromCart(cart, 99)).toHaveLength(1);
  });
});

// ─── computeCartTotal ─────────────────────────────────────────────────────────

describe("computeCartTotal", () => {
  it("returns 0 for an empty cart", () => {
    expect(computeCartTotal([], 0)).toBe(0);
  });

  it("sums unit_price × quantity for each line", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 2, unit_price: 8000, discount: 0 },
      { variant: makeVariant({ id: 2 }), product: makeProduct(), quantity: 1, unit_price: 5000, discount: 0 },
    ];
    // 2×8000 + 1×5000 = 21000
    expect(computeCartTotal(cart, 0)).toBe(21000);
  });

  it("subtracts per-line discount", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 1, unit_price: 10000, discount: 500 },
    ];
    expect(computeCartTotal(cart, 0)).toBe(9500);
  });

  it("subtracts the cart-level discount", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 2, unit_price: 5000, discount: 0 },
    ];
    // 10000 - 1000 cart discount = 9000
    expect(computeCartTotal(cart, 1000)).toBe(9000);
  });

  it("applies both line-level and cart-level discounts", () => {
    const cart: CartItem[] = [
      { variant: makeVariant({ id: 1 }), product: makeProduct(), quantity: 2, unit_price: 8000, discount: 200 },
    ];
    // (2×8000 - 200) - 300 = 15500
    expect(computeCartTotal(cart, 300)).toBe(15500);
  });
});

// ─── validatePaymentTotal ────────────────────────────────────────────────────

describe("validatePaymentTotal", () => {
  it("returns null when payment equals sale total", () => {
    expect(validatePaymentTotal(10000, 10000)).toBeNull();
  });

  it("returns null when payment is less than sale total (underpayment allowed)", () => {
    expect(validatePaymentTotal(5000, 10000)).toBeNull();
  });

  it("returns null when payment is exactly 110% of sale total", () => {
    expect(validatePaymentTotal(11000, 10000)).toBeNull();
  });

  it("returns an error when payment exceeds 110% of sale total", () => {
    const error = validatePaymentTotal(15000, 10000); // 150%
    expect(error).not.toBeNull();
    expect(error).toContain("dépasse");
  });

  it("handles zero sale total gracefully", () => {
    // 0 payment on 0 total is fine
    expect(validatePaymentTotal(0, 0)).toBeNull();
  });
});
