/**
 * Tier-based pricing helper mirroring `backend/apps/inventory/services/pricing.py`.
 *
 * Tier fallback rules:
 * - `demi_gros`: `semi_wholesale_price` -> `wholesale_price` -> `sale_price`
 * - `gros`: `wholesale_price` -> `semi_wholesale_price` -> `sale_price`
 * - `detail` (default): `sale_price`
 */
import type { PriceTier, Product } from "@/types";

export type PricedProductLike = Pick<
  Product,
  "sale_price" | "semi_wholesale_price" | "wholesale_price"
>;

function positiveNumber(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === "") return null;
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

export function unitPriceFor(
  product: PricedProductLike | null | undefined,
  tier?: PriceTier | string | null,
): number {
  if (!product) return 0;

  const salePrice = positiveNumber(product.sale_price) ?? 0;
  const semiWholesale = positiveNumber(product.semi_wholesale_price);
  const wholesale = positiveNumber(product.wholesale_price);

  const normalizedTier = (tier || "detail").trim().toLowerCase();

  if (normalizedTier === "demi_gros") {
    if (semiWholesale !== null) return semiWholesale;
    if (wholesale !== null) return wholesale;
    return salePrice;
  }

  if (normalizedTier === "gros") {
    if (wholesale !== null) return wholesale;
    if (semiWholesale !== null) return semiWholesale;
    return salePrice;
  }

  return salePrice;
}

export function unitPriceStringFor(
  product: PricedProductLike | null | undefined,
  tier?: PriceTier | string | null,
): string {
  return String(unitPriceFor(product, tier));
}

