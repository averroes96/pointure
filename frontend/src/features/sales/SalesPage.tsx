/**
 * POS Sales Screen
 * - Left panel: product search (by name or barcode HID input)
 * - Right panel: cart with line items, discount, payment split
 * - Keyboard: F2 = focus search, F10 = confirm sale
 * - Fully operable via keyboard alone (barcode scanner workflows)
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, X, Plus, Minus, ShoppingBag, Check, Printer } from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import { printReceipt } from "@/lib/receipt";
import type { Product, Sale, Variant } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

interface CartItem {
  variant: Variant;
  product: Product;
  quantity: number;
  unit_price: number;
  discount: number;
}

const PAYMENT_METHOD_KEYS = ["cash", "ccp", "virement", "cheque"] as const;
type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

interface PaymentLine {
  method: PaymentMethodKey;
  amount: number;
}

export default function SalesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: 0 }]);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const { user } = useAuth();

  // F2 / F10 keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F10") { e.preventDefault(); handleConfirmSale(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Product search query
  const { data: productResults } = useQuery<PaginatedResponse<Product>>({
    queryKey: ["products", "pos-search", search],
    queryFn: () =>
      api.get(`/inventory/products/?search=${encodeURIComponent(search)}&page_size=10`).then((r) => r.data),
    enabled: search.length >= 2,
  });

  // Barcode lookup
  const { data: barcodeResult } = useQuery<PaginatedResponse<Variant>>({
    queryKey: ["variant", "barcode", search],
    queryFn: () =>
      api.get(`/inventory/variants/?barcode=${encodeURIComponent(search)}`).then((r) => r.data),
    enabled: search.length >= 8 && /^\d+$/.test(search),
  });

  const total = cart.reduce((sum, item) => sum + item.unit_price * item.quantity - item.discount, 0) - cartDiscount;
  const paymentTotal = payments.reduce((sum, p) => sum + p.amount, 0);

  const addToCart = (variant: Variant, product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.variant.id === variant.id);
      if (existing) {
        return prev.map((i) =>
          i.variant.id === variant.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, {
        variant,
        product,
        quantity: 1,
        unit_price: parseFloat(product.sale_price),
        discount: 0,
      }];
    });
    setSearch("");
    setSelectedProduct(null);
    // Sync the cash payment to the new cart total.
    // We compute the new total from the updater function's result rather than
    // reading the stale `total` closure, so we use a functional setCart pattern.
    // The easiest correct approach: reset to 0 here and let the useEffect below
    // keep it in sync whenever cart changes.
  };

  const updateQuantity = (variantId: number, delta: number) => {
    setCart((prev) =>
      prev.map((i) =>
        i.variant.id === variantId
          ? { ...i, quantity: Math.max(1, i.quantity + delta) }
          : i
      )
    );
  };

  const removeItem = (variantId: number) => {
    setCart((prev) => prev.filter((i) => i.variant.id !== variantId));
  };

  // Keep the first payment line in sync with the cart total whenever the cart
  // or discount changes. Only auto-update if the user hasn't manually edited
  // a non-cash payment or split the payment across multiple methods.
  useEffect(() => {
    if (payments.length === 1 && payments[0].method === "cash") {
      setPayments([{ method: "cash", amount: Math.max(0, total) }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  // Sale mutation
  const saleMutation = useMutation({
    mutationFn: () => {
      // Guarantee at least one payment line — fall back to full total in cash
      // if the user left all amounts at 0.
      const effectivePayments = payments.filter((p: PaymentLine) => p.amount > 0);
      const paymentLines: PaymentLine[] = effectivePayments.length > 0
        ? effectivePayments
        : [{ method: "cash", amount: Math.max(0, total) }];

      return api.post("/sales/", {
        items: cart.map((i) => ({
          variant_id: i.variant.id,
          quantity: i.quantity,
          unit_price: i.unit_price.toFixed(2),
          discount_amount: i.discount.toFixed(2),
        })),
        payments: paymentLines.map((p: PaymentLine) => ({
          method: p.method,
          amount: Number(p.amount).toFixed(2),
        })),
        cart_discount: cartDiscount.toFixed(2),
      }).then((r) => r.data);
    },
    onSuccess: (data) => {
      setReceipt(data);
      setCart([]);
      setCartDiscount(0);
      setPayments([{ method: "cash", amount: 0 }]);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  function handleConfirmSale() {
    if (cart.length === 0) return;
    saleMutation.mutate();
  }

  // After barcode scan, auto-add to cart
  useEffect(() => {
    if (barcodeResult?.results?.length === 1) {
      const variant = barcodeResult.results[0];
      // Fetch product info
      api.get(`/inventory/products/${variant.product}/`).then((r) => {
        addToCart(variant, r.data);
      });
    }
  }, [barcodeResult]);

  if (receipt) {
    return (
      <div className="max-w-sm mx-auto text-center py-12">
        <div className="w-16 h-16 bg-success-light rounded-full flex items-center justify-center mx-auto mb-4">
          <Check size={32} className="text-success" />
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2">Vente confirmée!</h2>
        <p className="text-text-muted text-sm mb-4">Reçu: <strong>{receipt.receipt_number}</strong></p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button className="btn-secondary" onClick={() => setReceipt(null)}>
            Nouvelle vente
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => printReceipt(receipt, user?.tenant?.name ?? "ShoeDZ")}
          >
            <Printer size={16} />
            Imprimer
          </button>
          <button
            className="btn-secondary flex items-center gap-2"
            onClick={() => {
              const message = `🧾 Reçu de vente — ShoeDZ\nN° ${receipt.receipt_number}\nTotal: ${receipt.total_amount} DZD\n${receipt.items?.length} article(s)\nMerci pour votre achat! 👟`;
              const link = `https://wa.me/?text=${encodeURIComponent(message)}`;
              window.open(link, "_blank");
            }}
          >
            📲 {t("sales.share_whatsapp")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* Left: Product Search */}
      <div className="w-full lg:w-1/2 xl:w-3/5 flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.new_sale")}</h1>
          <p className="text-xs text-text-muted">F2 = rechercher · F10 = confirmer</p>
        </div>

        <div className="relative">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input ps-9 text-base"
            placeholder={t("sales.search_product")}
            autoFocus
          />
        </div>

        {/* Search results */}
        {search.length >= 2 && productResults && (
          <div className="card overflow-auto flex-1">
            {productResults.results.map((product) => (
              <div key={product.id} className="border-b border-border last:border-0">
                <div
                  className="px-4 py-3 hover:bg-surface cursor-pointer"
                  onClick={() => setSelectedProduct(
                    selectedProduct?.id === product.id ? null : product
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-text-primary">
                        {product.brand} {product.name}
                      </div>
                      <div className="text-sm text-text-muted">
                        {product.total_stock} en stock · {formatDZD(product.sale_price)} DZD
                      </div>
                    </div>
                    <span className="text-xs text-primary-500">Voir tailles →</span>
                  </div>
                </div>

                {/* Variant selector */}
                {selectedProduct?.id === product.id && (
                  <div className="px-4 pb-3 bg-primary-50">
                    <div className="text-xs text-text-muted mb-2">Choisir pointure et couleur:</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {product.variants.map((variant) => (
                        <button
                          key={variant.id}
                          disabled={variant.stock_qty <= 0}
                          onClick={() => addToCart(variant, product)}
                          className={cn(
                            "px-2 py-1.5 text-xs rounded border font-medium transition-colors",
                            variant.stock_qty <= 0
                              ? "border-border bg-surface text-text-muted cursor-not-allowed"
                              : variant.is_low_stock
                              ? "border-warning bg-warning-light text-warning hover:bg-warning hover:text-white"
                              : "border-primary-200 bg-white text-primary-600 hover:bg-primary-500 hover:text-white hover:border-primary-500"
                          )}
                        >
                          EU{variant.size_eu}<br />
                          <span className="text-2xs">{variant.colour}</span><br />
                          <span className="text-2xs opacity-70">×{variant.stock_qty}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: Cart */}
      <div className="lg:w-1/2 xl:w-2/5 flex flex-col gap-3">
        <div className="card flex flex-col flex-1 overflow-hidden">
          <div className="card-header">
            <h2 className="font-semibold flex items-center gap-2">
              <ShoppingBag size={16} />
              {t("sales.cart")}
              {cart.length > 0 && (
                <span className="badge badge-info">{cart.length}</span>
              )}
            </h2>
          </div>

          <div className="flex-1 overflow-auto divide-y divide-border">
            {cart.length === 0 && (
              <div className="py-12 text-center text-text-muted text-sm">
                Panier vide — recherchez un article
              </div>
            )}
            {cart.map((item) => (
              <div key={item.variant.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {item.product.brand} {item.product.name}
                    </div>
                    <div className="text-xs text-text-muted">
                      EU{item.variant.size_eu} · {item.variant.colour}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) =>
                          setCart((prev) =>
                            prev.map((i) =>
                              i.variant.id === item.variant.id
                                ? { ...i, unit_price: parseFloat(e.target.value) || 0 }
                                : i
                            )
                          )
                        }
                        className="w-24 px-2 py-1 text-xs border border-border rounded font-mono"
                        step="100"
                      />
                      <span className="text-xs text-text-muted">DZD</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateQuantity(item.variant.id, -1)}
                      className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-surface"
                    >
                      <Minus size={10} />
                    </button>
                    <span className="w-8 text-center text-sm font-mono">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.variant.id, 1)}
                      className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-surface"
                    >
                      <Plus size={10} />
                    </button>
                    <button
                      onClick={() => removeItem(item.variant.id)}
                      className="w-6 h-6 rounded text-danger hover:bg-danger-light flex items-center justify-center ms-1"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
                <div className="text-end text-sm font-mono font-medium mt-1">
                  = {formatDZD(item.unit_price * item.quantity)} DZD
                </div>
              </div>
            ))}
          </div>

          {/* Totals + payment */}
          <div className="border-t border-border p-4 space-y-3">
            {/* Cart discount */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted flex-1">Remise panier</span>
              <input
                type="number"
                value={cartDiscount}
                onChange={(e) => setCartDiscount(parseFloat(e.target.value) || 0)}
                className="w-24 px-2 py-1 text-sm border border-border rounded font-mono text-end"
                min="0"
              />
              <span className="text-xs">DZD</span>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between py-2 border-t border-border">
              <span className="font-semibold">{t("sales.total")}</span>
              <span className="text-xl font-bold font-mono text-primary-500">
                {formatDZD(total)} DZD
              </span>
            </div>

            {/* Payment methods */}
            <div className="space-y-2">
              {payments.map((payment, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={payment.method}
                    onChange={(e) =>
                      setPayments((prev) =>
                        prev.map((p, idx) =>
                          idx === i ? { ...p, method: e.target.value as PaymentLine["method"] } : p
                        )
                      )
                    }
                    className="form-input text-sm py-1.5 flex-1"
                  >
                    {PAYMENT_METHOD_KEYS.map((key) => (
                      <option key={key} value={key}>{t(`payment_method.${key}`)}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={payment.amount || ""}
                    onChange={(e) =>
                      setPayments((prev) =>
                        prev.map((p, idx) =>
                          idx === i ? { ...p, amount: parseFloat(e.target.value) || 0 } : p
                        )
                      )
                    }
                    className="w-28 px-2 py-1.5 text-sm border border-border rounded font-mono text-end"
                    placeholder={formatDZD(total)}
                  />
                </div>
              ))}
            </div>

            {/* Confirm */}
            {saleMutation.isError && (
              <div className="text-xs text-danger bg-danger-light px-2 py-1.5 rounded">
                {getApiError(saleMutation.error)}
              </div>
            )}

            <button
              onClick={handleConfirmSale}
              disabled={cart.length === 0 || saleMutation.isPending}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {saleMutation.isPending ? (
                "Traitement..."
              ) : (
                <>
                  <Check size={18} />
                  {t("sales.confirm_sale")} — {formatDZD(total)} DZD
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
