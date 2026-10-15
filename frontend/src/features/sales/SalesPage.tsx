/**
 * POS Sales Screen
 * - Left panel: product search (by name or barcode HID input)
 * - Right panel: client selector, cart, loyalty redemption, payment
 * - Keyboard: F2 = focus search, F10 = confirm sale
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, X, Plus, Minus, ShoppingBag, Check, Printer, User, Gift, Medal, Star, Trophy, UserCircle, UserPlus, Tag } from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import { printReceipt } from "@/lib/receipt";
import { printBonVersement } from "@/lib/versement";
import { useBranch } from "@/features/auth/BranchContext";
import type { Client, Product, Sale, StoreSettings, Variant, LoyaltyAccountSummary, LoyaltyProgram } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { usePlan } from "@/hooks/usePlan";

interface CartItem {
  variant: Variant;
  product: Product;
  quantity: number;
  unit_price: number;
  discount: number;
  promoName?: string;
}

const PAYMENT_METHOD_KEYS = ["cash", "ccp", "virement", "cheque"] as const;
type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

interface PaymentLine {
  method: PaymentMethodKey;
  amount: number;
}

const TIER_ICON = { bronze: Medal, silver: Star, gold: Trophy } as const;
const TIER_COLOUR = {
  bronze: "text-amber-700 bg-amber-50",
  silver: "text-slate-600 bg-slate-100",
  gold: "text-yellow-700 bg-yellow-50",
} as const;

// ── Quick-create client modal ─────────────────────────────────────────────

function CreateClientModal({
  prefillName,
  onCreated,
  onClose,
}: {
  prefillName: string;
  onCreated: (c: Client) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(prefillName);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/clients/", { name: name.trim(), phone: phone.trim() }).then((r) => r.data),
    onSuccess: (client: Client) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      onCreated(client);
    },
    onError: (err) => setError(getApiError(err)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t("sales.client_name_required")); return; }
    setError("");
    mutation.mutate();
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
            <UserPlus size={16} className="text-primary-500" />
          </div>
          <h3 className="font-semibold text-text-primary">{t("sales.new_client")}</h3>
          <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-3">
          {error && (
            <div className="text-xs text-danger bg-danger-light rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <label className="form-label">{t('sales.client_name')} <span className="text-danger">*</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
              placeholder={t("sales.client_fullname_placeholder")}
              autoFocus
            />
          </div>
          <div>
            <label className="form-label">{t("sales.client_phone")}</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="form-input"
              placeholder="0x xx xx xx xx"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Annuler
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={mutation.isPending}>
              {mutation.isPending ? t("sales.client_creating") : t("sales.client_create_select")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Client selector combobox ──────────────────────────────────────────────

function ClientSelector({
  selected,
  onSelect,
  onClear,
}: {
  selected: Client | null;
  onSelect: (c: Client) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<PaginatedResponse<Client>>({
    queryKey: ["clients", "pos", search],
    queryFn: () =>
      api.get(`/clients/?search=${encodeURIComponent(search)}&page_size=6`).then((r) => r.data),
    enabled: search.length >= 2,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (selected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-50 border border-primary-100">
        <UserCircle size={15} className="text-primary-500 flex-shrink-0" />
        <span className="text-sm font-medium text-primary-700 flex-1 truncate">{selected.name}</span>
        {selected.phone && (
          <span className="text-xs text-primary-400">{selected.phone}</span>
        )}
        <button onClick={onClear} className="text-primary-400 hover:text-primary-600">
          <X size={13} />
        </button>
      </div>
    );
  }

  const hasResults = !!data && data.results.length > 0;
  const showDropdown = open && search.length >= 2 && !isFetching;

  return (
    <>
      {showCreate && (
        <CreateClientModal
          prefillName={search}
          onCreated={(c) => { onSelect(c); setSearch(""); setOpen(false); setShowCreate(false); }}
          onClose={() => setShowCreate(false)}
        />
      )}

      <div ref={ref} className="relative">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-white">
          <User size={14} className="text-text-muted flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={t("sales.client_search_placeholder")}
            className="flex-1 text-sm outline-none bg-transparent text-text-primary placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex-shrink-0 text-xs flex items-center gap-1 text-primary-500 hover:text-primary-700 font-medium"
            title={t("sales.client_create_title")}
          >
            <UserPlus size={14} />
          </button>
        </div>

        {showDropdown && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
            {hasResults ? (
              <>
                {data.results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { onSelect(c); setSearch(""); setOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-surface transition-colors border-b border-border last:border-0"
                  >
                    <UserCircle size={14} className="text-text-muted flex-shrink-0" />
                    <span className="text-sm font-medium text-text-primary">{c.name}</span>
                    {c.phone && <span className="text-xs text-text-muted ml-auto">{c.phone}</span>}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setShowCreate(true); setOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-left text-primary-600 hover:bg-primary-50 transition-colors text-sm font-medium"
                >
                  <UserPlus size={14} />
                  {t("sales.client_create_search", { search })}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => { setShowCreate(true); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-3 text-left text-primary-600 hover:bg-primary-50 transition-colors text-sm font-medium"
              >
                <UserPlus size={14} />
                {t("sales.client_create_search_full", { search })}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function SalesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: 0 }]);
  const [receipt, setReceipt] = useState<(Sale & { points_earned?: number; points_redeemed?: number }) | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [isVersement, setIsVersement] = useState(false);
  const [isFormal, setIsFormal] = useState(false);
  const [scanStatus, setScanStatus] = useState<"idle" | "found" | "not_found">("idle");

  // Keep a ref so addToCart (useCallback) can read current cart without stale closure
  const cartRef = useRef<CartItem[]>([]);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const { canAccess } = usePlan();

  // Keep a ref to currentBranch so the scanner keydown handler (stable closure) always
  // reads the latest selection without being re-registered on every branch change.
  const currentBranchRef = useRef(currentBranch);
  useEffect(() => { currentBranchRef.current = currentBranch; }, [currentBranch]);
  const hasLoyalty = canAccess("pro_retail");


  const branchQs = currentBranch ? `&branch_id=${currentBranch.id}` : "";

  // Product search
  const { data: productResults } = useQuery<PaginatedResponse<Product>>({
    queryKey: ["products", "pos-search", search, currentBranch?.id],
    queryFn: () =>
      api.get(`/inventory/products/?search=${encodeURIComponent(search)}&page_size=10${branchQs}`).then((r) => r.data),
    enabled: search.length >= 2,
  });

  // Barcode lookup
  const { data: barcodeResult } = useQuery<PaginatedResponse<Variant>>({
    queryKey: ["variant", "barcode", search, currentBranch?.id],
    queryFn: () =>
      api.get(`/inventory/variants/?barcode=${encodeURIComponent(search)}${branchQs}`).then((r) => r.data),
    enabled: search.length >= 8 && /^\d+$/.test(search),
  });

  // Loyalty program config — only fetch for pro_retail+ plans
  const { data: programData } = useQuery<{ results: LoyaltyProgram[] }>({
    queryKey: ["loyalty-program"],
    queryFn: () => api.get("/loyalty/programs/").then((r) => r.data),
    enabled: hasLoyalty,
    staleTime: 5 * 60 * 1000,
  });
  const loyaltyProgram = programData?.results?.[0] ?? null;

  // Store settings (versement config)
  const { data: storeSettings } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => api.get("/core/store-settings/current/").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Client's loyalty account — only when a client is selected and plan allows it
  const { data: loyaltyAccount } = useQuery<LoyaltyAccountSummary>({
    queryKey: ["loyalty-account-summary", selectedClient?.id],
    queryFn: () =>
      api.get(`/loyalty/accounts/by-client/?client_id=${selectedClient!.id}`).then((r) => r.data),
    enabled: hasLoyalty && !!selectedClient && !!loyaltyProgram?.is_active,
    retry: false,
  });

  // Redemption DZD: floor(pts / redemption_value * 100)
  const redemptionDzd = redeemPoints > 0 && loyaltyProgram
    ? Math.floor(redeemPoints / loyaltyProgram.redemption_value * 100)
    : 0;

  const itemsTotal = cart.reduce((s, i) => s + i.unit_price * i.quantity - i.discount, 0);
  const totalAfterCartDisc = Math.max(0, itemsTotal - cartDiscount - redemptionDzd);
  
  const isCash = payments.some(p => p.method === "cash");
  const timbreFiscal = isFormal && isCash 
    ? Math.min(totalAfterCartDisc * 0.01, 2500) 
    : 0;
    
  const total = totalAfterCartDisc + timbreFiscal;
  const paymentTotal = payments.reduce((s, p) => s + p.amount, 0);
  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
  const [showOptions, setShowOptions] = useState(false);

  const applyPromo = useCallback(async (variantId: number, qty: number) => {
    try {
      const res = await api.get(`/promotions/applicable/?variant=${variantId}&qty=${qty}`);
      if (res.status === 200 && res.data?.computed_discount != null) {
        const totalDiscount = Number(res.data.computed_discount) * qty;
        setCart((prev) =>
          prev.map((i) =>
            i.variant.id === variantId
              ? { ...i, promoName: res.data.name as string, discount: totalDiscount }
              : i
          )
        );
      } else {
        setCart((prev) =>
          prev.map((i) =>
            i.variant.id === variantId ? { ...i, promoName: undefined, discount: 0 } : i
          )
        );
      }
    } catch {
      // 404 (variant not found) or network error — don't clear existing manual discount
    }
  }, []);

  const addToCart = useCallback((variant: Variant, product: Product) => {
    const existing = cartRef.current.find((i) => i.variant.id === variant.id);
    const newQty = existing ? existing.quantity + 1 : 1;
    setCart((prev) => {
      if (existing) {
        return prev.map((i) =>
          i.variant.id === variant.id ? { ...i, quantity: newQty } : i
        );
      }
      return [...prev, { variant, product, quantity: 1, unit_price: parseFloat(product.sale_price), discount: 0 }];
    });
    setSearch("");
    setSelectedProduct(null);
    applyPromo(variant.id, newQty);
  }, [applyPromo]);

  const enableVariants = storeSettings?.enable_variants ?? false;

  const handleAddProduct = useCallback((product: Product) => {
    if (!product.variants || product.variants.length === 0) return;
    const inStock = product.variants.find((v) => v.stock_qty > 0);
    const variant = inStock || product.variants[0];
    addToCart(variant, product);
    setScanStatus("found");
    setTimeout(() => setScanStatus("idle"), 1200);
  }, [addToCart]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!productResults?.results?.length) return;

      const trimmed = search.trim().toLowerCase();
      // Match exact barcode, reference, or product name
      const exactMatch = productResults.results.find(
        (p) =>
          (p.barcode && p.barcode.toLowerCase() === trimmed) ||
          (p.reference && p.reference.toLowerCase() === trimmed) ||
          p.name.toLowerCase() === trimmed ||
          p.variants?.some((v) => v.barcode && v.barcode.toLowerCase() === trimmed)
      );

      const target = exactMatch || (productResults.results.length === 1 ? productResults.results[0] : null);

      if (target) {
        if (!enableVariants || !target.variants || target.variants.length <= 1) {
          handleAddProduct(target);
          setSearch("");
          searchRef.current?.focus();
        } else {
          setSelectedProduct(target);
        }
      } else if (productResults.results.length > 0) {
        const top = productResults.results[0];
        if (!enableVariants || !top.variants || top.variants.length <= 1) {
          handleAddProduct(top);
          setSearch("");
          searchRef.current?.focus();
        } else {
          setSelectedProduct(top);
        }
      }
    }
  };

  const updateQuantity = (variantId: number, delta: number) => {
    const existing = cart.find((i) => i.variant.id === variantId);
    if (!existing) return;
    const newQty = Math.max(1, existing.quantity + delta);
    setCart((prev) =>
      prev.map((i) =>
        i.variant.id === variantId ? { ...i, quantity: newQty } : i
      )
    );
    applyPromo(variantId, newQty);
  };

  const removeItem = (variantId: number) => {
    setCart((prev) => prev.filter((i) => i.variant.id !== variantId));
  };

  // Auto-sync first payment line to total (skip in versement mode)
  useEffect(() => {
    if (isVersement) return;
    if (payments.length === 1 && payments[0].method === "cash") {
      setPayments([{ method: "cash", amount: Math.max(0, total) }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, isVersement]);

  const isSubmittingRef = useRef(false);

  // Sale mutation
  const saleMutation = useMutation({
    mutationFn: () => {
      const currentCart = cartRef.current;
      if (!currentCart || currentCart.length === 0) {
        throw new Error("Le panier est vide.");
      }

      const effectivePayments = payments.filter((p: PaymentLine) => p.amount > 0);
      const paymentLines: PaymentLine[] = effectivePayments.length > 0
        ? effectivePayments
        : [{ method: "cash", amount: Math.max(0, total) }];

      return api.post("/sales/", {
        branch_id: currentBranch?.id ?? null,
        client_id: selectedClient?.id ?? null,
        redeem_points: redeemPoints,
        items: currentCart.map((i) => ({
          variant_id: i.variant.id,
          quantity: i.quantity,
          unit_price: Number(i.unit_price).toFixed(2),
          discount_amount: Number(i.discount || 0).toFixed(2),
        })),
        payments: paymentLines.map((p: PaymentLine) => ({
          method: p.method,
          amount: Number(p.amount).toFixed(2),
        })),
        cart_discount: Number(cartDiscount || 0).toFixed(2),
        is_formal: isFormal,
        is_versement: isVersement,
      }).then((r) => r.data);
    },
    onSuccess: (data) => {
      setReceipt(data);
      setCart([]);
      setCartDiscount(0);
      setRedeemPoints(0);
      setPayments([{ method: "cash", amount: 0 }]);
      setSelectedClient(null);
      setIsVersement(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty-account-summary"] });
    },
    onSettled: () => {
      isSubmittingRef.current = false;
    },
  });

  function handleConfirmSale() {
    if (cart.length === 0 || saleMutation.isPending || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    saleMutation.mutate();
  }

  // Keyboard shortcuts integration (F2 = search, F10 = confirm sale, F1 = new sale)
  useEffect(() => {
    const onSearch = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    const onConfirm = () => {
      if (receipt) {
        setReceipt(null);
        searchRef.current?.focus();
        return;
      }
      handleConfirmSale();
    };

    const onNewSale = () => {
      if (receipt) {
        setReceipt(null);
      }
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const isPoint = (e.key === "." || e.code === "NumpadDecimal") && !e.ctrlKey && !e.altKey && !e.metaKey;

      if (isPoint) {
        const target = e.target as HTMLElement;
        const isSearch = target === searchRef.current;
        const isOtherInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

        // Allow '.' or NumpadDecimal to confirm sale if:
        // 1. Focus is outside any input field (cart, table, buttons)
        // 2. OR focus is inside the search box and search is empty (common right after barcode scan)
        if (!isOtherInput || (isSearch && search.trim() === "")) {
          if (cart.length > 0 || receipt) {
            e.preventDefault();
            onConfirm();
          }
        }
      } else if (e.key === "Escape") {
        if (search) {
          setSearch("");
        }
      }
    };

    // Note: F1, F2, F10 are handled globally by useGlobalShortcuts and dispatched as custom events below.
    window.addEventListener("app-shortcut-search", onSearch);
    window.addEventListener("app-shortcut-confirm", onConfirm);
    window.addEventListener("app-shortcut-new-sale", onNewSale);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("app-shortcut-search", onSearch);
      window.removeEventListener("app-shortcut-confirm", onConfirm);
      window.removeEventListener("app-shortcut-new-sale", onNewSale);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [receipt, cart.length, saleMutation.isPending, search]);

  // React-Query barcode path: fires when the search input contains a full barcode
  useEffect(() => {
    if (barcodeResult?.results?.length === 1) {
      const variant = barcodeResult.results[0];
      api.get(`/inventory/products/${variant.product}/`).then((r) => {
        addToCart(variant, r.data);
        setScanStatus("found");
        setTimeout(() => setScanStatus("idle"), 1200);
      });
    }
  }, [barcodeResult, addToCart]);

  // Global keyboard-wedge scanner listener.
  // Scanners emit characters very fast (<50 ms apart) then send Enter.
  // This handles scans when focus is anywhere except the search input itself
  // (which already has the React-Query path above).
  useEffect(() => {
    const MIN_LEN = 6;
    const SPEED_MS = 50;
    let buffer = "";
    let lastAt = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === searchRef.current) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = Date.now();

      if (e.key === "Enter") {
        const code = buffer;
        buffer = "";
        if (code.length >= MIN_LEN) {
          e.preventDefault();
          const bqs = currentBranchRef.current ? `&branch_id=${currentBranchRef.current.id}` : "";
          api.get(`/inventory/variants/?barcode=${encodeURIComponent(code)}${bqs}`).then((r) => {
            const variants: Variant[] = r.data.results ?? [];
            if (variants.length === 1) {
              api.get(`/inventory/products/${variants[0].product}/`).then((pr) => {
                addToCart(variants[0], pr.data);
                setScanStatus("found");
                setTimeout(() => setScanStatus("idle"), 1200);
              });
            } else {
              setScanStatus("not_found");
              setTimeout(() => setScanStatus("idle"), 1500);
            }
          });
        }
      } else if (e.key.length === 1) {
        if (now - lastAt < SPEED_MS) {
          buffer += e.key;
        } else {
          buffer = e.key;
        }
        lastAt = now;
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [addToCart]);

  // ── Receipt screen ────────────────────────────────────────────────────

  if (receipt) {
    const ptsEarned = receipt.points_earned ?? 0;
    const ptsRedeemed = receipt.points_redeemed ?? 0;
    const isVersementReceipt = receipt.status === "partially_paid";

    if (isVersementReceipt) {
      return (
        <div className="max-w-sm mx-auto text-center py-12">
          <div className="w-16 h-16 bg-warning-light rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-warning" />
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">{t("sales.versement_recorded")}</h2>
          <p className="text-text-muted text-sm mb-1">{t('sales.receipt')}: <strong>{receipt.receipt_number}</strong></p>
          {receipt.client_name && (
            <p className="text-text-muted text-sm mb-1">{t('sales.client')}: <strong>{receipt.client_name}</strong></p>
          )}
          <div className="mb-4 mt-3 rounded-xl bg-warning-light border border-warning/30 p-3 text-sm space-y-1">
            <p className="text-text-primary">
              Acompte verse: <strong className="font-mono">{formatDZD(receipt.amount_paid)} DZD</strong>
            </p>
            <p className="text-danger font-semibold">
              Solde restant: <span className="font-mono">{formatDZD(receipt.balance_due)} DZD</span>
            </p>
            {receipt.due_date && (
              <p className="text-text-muted text-xs">Echeance: {receipt.due_date}</p>
            )}
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            <button className="btn-secondary" onClick={() => setReceipt(null)}>
              Nouvelle vente
            </button>
            <button
              className="btn-primary flex items-center gap-2"
              onClick={() => printBonVersement(receipt, user?.tenant?.name ?? "ShoeDZ")}
            >
              <Printer size={16} />
              Bon de versement
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-sm mx-auto text-center py-12">
        <div className="w-16 h-16 bg-success-light rounded-full flex items-center justify-center mx-auto mb-4">
          <Check size={32} className="text-success" />
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2">{t("sales.sale_confirmed")}</h2>
        <p className="text-text-muted text-sm mb-3">{t('sales.receipt')}: <strong>{receipt.receipt_number}</strong></p>

        {(ptsEarned > 0 || ptsRedeemed > 0) && (
          <div className="mb-4 rounded-xl bg-primary-50 border border-primary-100 p-3 text-sm">
            {ptsRedeemed > 0 && (
              <p className="text-primary-700">
                <Gift size={14} className="inline mr-1" />
                {t("sales.points_redeemed_text", { pts: ptsRedeemed, dzd: redemptionDzd })}
              </p>
            )}
            {ptsEarned > 0 && (
              <p className="text-success font-semibold mt-1">
                {t("sales.points_earned_text", { pts: ptsEarned })}
              </p>
            )}
          </div>
        )}

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
              const message = `Recu de vente — ShoeDZ\nN° ${receipt.receipt_number}\nTotal: ${receipt.total_amount} DZD\n${receipt.items?.length} article(s)\nMerci pour votre achat!`;
              const link = `https://wa.me/?text=${encodeURIComponent(message)}`;
              window.open(link, "_blank");
            }}
          >
            {t("sales.share_whatsapp")}
          </button>
        </div>
      </div>
    );
  }

  // ── POS layout ────────────────────────────────────────────────────────

  const canRedeem = !!loyaltyAccount &&
    !!loyaltyProgram?.is_active &&
    loyaltyAccount.points_balance >= (loyaltyProgram?.min_redemption_points ?? 999999);

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full min-h-[calc(100vh-100px)]">
      {/* ── Left: Product Search & Selection ── */}
      <div className="w-full lg:w-7/12 flex flex-col gap-3">
        {/* POS Header & Shortcuts */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold text-text-primary tracking-tight">{t("nav.new_sale")}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-text-muted">
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 text-2xs font-mono font-semibold bg-surface border border-border rounded text-text-secondary shadow-xs">F2</kbd>
                <span>{t("sales.shortcut_search", "Rechercher")}</span>
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 text-2xs font-mono font-semibold bg-surface border border-border rounded text-text-secondary shadow-xs">F10</kbd>
                <span className="text-2xs text-text-muted">/</span>
                <kbd className="px-1.5 py-0.5 text-2xs font-mono font-semibold bg-surface border border-border rounded text-text-secondary shadow-xs">.</kbd>
                <span>{t("sales.shortcut_confirm", "Confirmer")}</span>
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 text-2xs font-mono font-semibold bg-surface border border-border rounded text-text-secondary shadow-xs">F11</kbd>
                <span>{t("sales.shortcut_fullscreen", "Plein écran")}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search size={18} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            ref={searchRef}
            data-shortcut-search="true"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="form-input ps-10 pe-12 py-3 text-base shadow-xs rounded-xl border-border focus:border-primary-500"
            placeholder={t("sales.search_product")}
            autoFocus
          />
          {scanStatus === "idle" ? (
            <kbd className="absolute end-3 top-1/2 -translate-y-1/2 text-2xs font-mono bg-surface border border-border text-text-muted px-2 py-1 rounded shadow-xs pointer-events-none">
              F2
            </kbd>
          ) : (
            <div
              className={cn(
                "absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full pointer-events-none shadow-xs",
                scanStatus === "found" && "bg-success-light text-success",
                scanStatus === "not_found" && "bg-danger-light text-danger",
              )}
            >
              {scanStatus === "found" ? (
                <><Check size={12} /> {t("sales.pos_added")}</>
              ) : (
                <><X size={12} /> {t("sales.pos_not_found")}</>
              )}
            </div>
          )}
        </div>

        {/* Search results or Empty State */}
        {search.length >= 2 && productResults ? (
          <div className="card overflow-auto flex-1 divide-y divide-border rounded-xl shadow-xs">
            {productResults.results.length === 0 ? (
              <div className="p-8 text-center text-text-muted">
                <p className="font-semibold text-sm">Aucun produit trouvé pour &laquo;&nbsp;{search}&nbsp;&raquo;</p>
                <p className="text-xs text-text-muted mt-1">Vérifiez l'orthographe ou scannez directement le code-barres.</p>
              </div>
            ) : (
              productResults.results.map((product) => {
                const isMultiVariant = enableVariants && product.variants && product.variants.length > 1;
                const isExpanded = selectedProduct?.id === product.id;

                return (
                  <div key={product.id} className="transition-colors hover:bg-surface/50">
                    <div
                      className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer select-none"
                      onClick={() => {
                        if (isMultiVariant) {
                          setSelectedProduct(isExpanded ? null : product);
                        } else {
                          handleAddProduct(product);
                        }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-bold text-text-primary text-base truncate">
                            {product.brand && (
                              <span className="text-text-muted font-medium me-1">{product.brand}</span>
                            )}
                            {product.name}
                          </div>
                          {product.barcode && (
                            <span className="font-mono text-2xs text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border/60">
                              {product.barcode}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5 flex items-center gap-2">
                          <span className="font-semibold font-mono text-primary-600 bg-primary-50 px-2 py-0.5 rounded">
                            {formatDZD(product.sale_price)} DZD
                          </span>
                          <span>·</span>
                          <span className={cn(
                            "font-mono font-medium",
                            product.total_stock <= 0 ? "text-danger" : product.has_low_stock ? "text-amber-600" : "text-text-muted"
                          )}>
                            {product.total_stock} {t("sales.in_stock")}
                          </span>
                        </div>
                      </div>

                      {/* Action: direct 1-click addition or view sizes */}
                      {isMultiVariant ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedProduct(isExpanded ? null : product);
                          }}
                          className="text-xs font-semibold text-primary-600 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shrink-0"
                        >
                          <span>{isExpanded ? "Masquer pointures ↑" : t("sales.view_sizes")}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddProduct(product);
                          }}
                          className="btn-primary text-xs font-bold py-1.5 px-3 rounded-lg shadow-2xs hover:shadow-sm active:scale-95 flex items-center gap-1.5 shrink-0"
                        >
                          <Plus size={14} className="stroke-[2.5]" />
                          <span>{t("common.add", "Ajouter")}</span>
                        </button>
                      )}
                    </div>

                    {isMultiVariant && isExpanded && (
                      <div className="px-4 pb-3 pt-1 bg-slate-50 border-t border-border/60">
                        <div className="text-2xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                          {t("sales.choose_size_color")}
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                          {product.variants.map((variant) => (
                            <button
                              key={variant.id}
                              disabled={variant.stock_qty <= 0}
                              onClick={() => addToCart(variant, product)}
                              className={cn(
                                "p-2 text-xs rounded-xl border font-medium transition-all text-center flex flex-col items-center justify-center gap-0.5",
                                variant.stock_qty <= 0
                                  ? "border-border bg-surface text-text-muted opacity-50 cursor-not-allowed"
                                  : variant.is_low_stock
                                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 active:scale-95 shadow-2xs"
                                  : "border-border bg-white text-text-primary hover:border-primary-500 hover:bg-primary-50 hover:text-primary-700 active:scale-95 shadow-2xs"
                              )}
                            >
                              <span className="font-black text-sm font-mono">T.{variant.size_eu}</span>
                              <span className="text-2xs text-text-muted truncate max-w-full">
                                {variant.colour === "N/A" ? t("common.na") : variant.colour}
                              </span>
                              <span className={cn(
                                "text-2xs font-mono font-semibold px-1 rounded",
                                variant.stock_qty <= 2 ? "text-amber-700 bg-amber-100/60" : "text-text-muted"
                              )}>
                                Qté: {variant.stock_qty}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="card p-6 flex flex-col items-center justify-center text-center flex-1 border-dashed border-2 border-border/80 bg-surface/30 rounded-2xl">
            <div className="w-12 h-12 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center mb-3 shadow-xs">
              <Search size={22} />
            </div>
            <h3 className="font-bold text-text-primary text-sm">Prêt pour la vente</h3>
            <p className="text-xs text-text-muted mt-1 max-w-sm">
              Scannez directement avec votre douchette code-barres n'importe où, ou tapez au moins 2 lettres pour chercher un modèle.
            </p>
            <div className="flex gap-2 mt-4 text-2xs text-text-secondary flex-wrap justify-center">
              <span className="px-2 py-1 bg-white border border-border rounded-lg shadow-2xs">F2 = Rechercher</span>
              <span className="px-2 py-1 bg-white border border-border rounded-lg shadow-2xs">Entrée = Ajouter au panier</span>
              <span className="px-2 py-1 bg-white border border-border rounded-lg shadow-2xs">F10 / . = Confirmer</span>
              <span className="px-2 py-1 bg-white border border-border rounded-lg shadow-2xs">F11 = Plein écran</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Cashier Cart & Prominent Total ── */}
      <div className="w-full lg:w-5/12 flex flex-col gap-3">
        <div className="card flex flex-col flex-1 overflow-hidden rounded-2xl shadow-sm border border-border bg-white">
          {/* Cart Header */}
          <div className="card-header bg-surface-subtle py-3 px-4 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center shadow-xs">
                <ShoppingBag size={15} />
              </div>
              <h2 className="font-bold text-text-primary text-base">
                {t("sales.cart")}
              </h2>
              {cart.length > 0 && (
                <span className="px-2.5 py-0.5 text-xs font-black font-mono rounded-full bg-primary-100 text-primary-800 border border-primary-200">
                  {totalItems} {totalItems > 1 ? t("sales.articles_count", "articles") : t("sales.article_count", "article")}
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm("Voulez-vous vider le panier en cours ?")) {
                    setCart([]);
                    setCartDiscount(0);
                    setRedeemPoints(0);
                  }
                }}
                className="text-xs text-text-muted hover:text-danger flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-danger-light transition-colors font-medium"
                title="Vider tout le panier"
              >
                <X size={13} />
                <span>{t("sales.clear_cart", "Vider")}</span>
              </button>
            )}
          </div>

          {/* Client selector (compact) */}
          <div className="px-4 py-2.5 border-b border-border bg-white">
            <ClientSelector
              selected={selectedClient}
              onSelect={(c) => { setSelectedClient(c); setRedeemPoints(0); }}
              onClear={() => { setSelectedClient(null); setRedeemPoints(0); }}
            />

            {/* Loyalty points banner if client has loyalty */}
            {loyaltyAccount && loyaltyProgram?.is_active && (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs bg-primary-50/60 border border-primary-100 rounded-lg px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-primary-800 font-bold font-mono">
                    {loyaltyAccount.points_balance.toLocaleString()}
                  </span>
                  <span className="text-text-muted text-2xs">pts fidélité</span>
                </div>
                {canRedeem && (
                  <div className="flex items-center gap-1.5">
                    <Gift size={12} className="text-primary-600" />
                    <input
                      type="number"
                      value={redeemPoints || ""}
                      onChange={(e) => {
                        const v = Math.min(
                          parseInt(e.target.value) || 0,
                          loyaltyAccount.points_balance
                        );
                        setRedeemPoints(v);
                      }}
                      min={0}
                      max={loyaltyAccount.points_balance}
                      step={loyaltyProgram.min_redemption_points}
                      placeholder="Pts"
                      className="w-16 px-1.5 py-0.5 text-xs border border-border rounded text-center font-mono"
                    />
                    {redeemPoints > 0 && (
                      <span className="text-2xs text-primary-700 font-bold">
                        −{formatDZD(redemptionDzd)} DZD
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart items list (prominent cards with large Pointure tag) */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
            {cart.length === 0 ? (
              <div className="py-16 text-center flex flex-col items-center justify-center text-text-muted">
                <div className="w-14 h-14 rounded-2xl bg-white border border-border flex items-center justify-center mb-3 text-text-muted shadow-xs">
                  <ShoppingBag size={26} className="opacity-40 text-text-muted" />
                </div>
                <p className="font-bold text-text-primary text-sm">{t("sales.empty_cart")}</p>
                <p className="text-xs text-text-muted mt-1 max-w-xs">
                  Scannez un code-barres ou recherchez un modèle (F2) pour commencer la vente.
                </p>
              </div>
            ) : (
              cart.map((item) => {
                const isSimpleProduct = !item.variant.size_eu || item.variant.size_eu <= 0;
                const hasCustomColour = item.variant.colour && item.variant.colour !== "N/A" && item.variant.colour !== "Standard" && item.variant.colour !== "Unique";

                return (
                  <div
                    key={item.variant.id}
                    className="p-3 bg-white rounded-xl border border-border/80 hover:border-primary-300 transition-all shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* High-visibility Pointure / Size Badge only for sized products */}
                          {!isSimpleProduct && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black font-mono bg-primary-100 text-primary-900 border border-primary-200">
                              EU {item.variant.size_eu}
                            </span>
                          )}
                          <span className="font-bold text-text-primary text-sm truncate">
                            {item.product.brand && (
                              <span className="text-text-muted font-medium me-1">{item.product.brand}</span>
                            )}
                            {item.product.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-1.5 text-xs text-text-muted flex-wrap">
                          {hasCustomColour && (
                            <span className="px-1.5 py-0.5 bg-surface rounded border border-border text-2xs font-medium">
                              {item.variant.colour}
                            </span>
                          )}
                          {item.variant.barcode && (
                            <span className="font-mono text-2xs text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border/50">
                              {item.variant.barcode}
                            </span>
                          )}
                          {item.promoName && (
                            <span className="flex items-center gap-0.5 text-2xs text-success font-semibold bg-success/10 px-1.5 py-0.5 rounded-full">
                              <Tag size={10} />
                              {item.promoName}
                            </span>
                          )}
                          <span className="font-mono text-2xs text-text-muted">
                            {formatDZD(item.unit_price)} DZD / u
                          </span>
                        </div>
                      </div>

                      {/* Line Total */}
                      <div className="text-end shrink-0">
                        <div className="text-base font-black font-mono text-text-primary">
                          {formatDZD(item.unit_price * item.quantity - item.discount)} DZD
                        </div>
                        {item.discount > 0 && (
                          <div className="text-2xs text-text-muted line-through font-mono">
                            {formatDZD(item.unit_price * item.quantity)} DZD
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quantity & Actions row */}
                    <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/60">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updateQuantity(item.variant.id, -1)}
                          className="w-7 h-7 rounded-lg border border-border bg-surface hover:bg-slate-200 active:scale-95 flex items-center justify-center transition-all"
                          title="Diminuer la quantité"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-8 text-center text-sm font-black font-mono text-text-primary">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.variant.id, 1)}
                          className="w-7 h-7 rounded-lg border border-border bg-surface hover:bg-slate-200 active:scale-95 flex items-center justify-center transition-all"
                          title="Augmenter la quantité"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      <button
                        onClick={() => removeItem(item.variant.id)}
                        className="text-xs text-text-muted hover:text-danger hover:bg-danger-light px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                        title="Supprimer du panier"
                      >
                        <X size={12} />
                        <span>{t("common.delete", "Supprimer")}</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Cart Footer (Pinned: Grand Total & Confirm) ── */}
          <div className="border-t border-border p-3.5 bg-white space-y-3">
            {/* Quick options toolbar */}
            <div className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowOptions(!showOptions)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors font-medium",
                  showOptions || cartDiscount > 0 || isFormal || isVersement
                    ? "bg-primary-50 border-primary-200 text-primary-700 font-semibold"
                    : "bg-surface border-border text-text-secondary hover:bg-slate-100"
                )}
              >
                <span>⚙️ Options de vente</span>
                {(cartDiscount > 0 || isFormal || isVersement) && (
                  <span className="w-2 h-2 rounded-full bg-primary-600"></span>
                )}
              </button>

              <div className="flex items-center gap-2">
                {/* Remise input */}
                <div className="flex items-center gap-1 text-2xs text-text-muted">
                  <span>Remise:</span>
                  <input
                    type="number"
                    value={cartDiscount || ""}
                    onChange={(e) => setCartDiscount(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-16 px-1.5 py-1 text-xs border border-border rounded font-mono text-end"
                    min="0"
                  />
                  <span>DZD</span>
                </div>
              </div>
            </div>

            {/* Expandable Options Drawer */}
            {showOptions && (
              <div className="p-3 bg-surface rounded-xl border border-border space-y-2.5 animate-in fade-in duration-100">
                {/* Mode Réel switch */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-text-primary">{t("sales.formal_mode")}</p>
                    <p className="text-2xs text-text-muted">{t("sales.formal_mode_desc")}</p>
                  </div>
                  <label className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors">
                    <input
                      type="checkbox"
                      checked={isFormal}
                      onChange={(e) => setIsFormal(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={cn("block h-4 w-8 rounded-full transition-colors", isFormal ? "bg-primary-500" : "bg-border")}></div>
                    <div className={cn("absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform", isFormal ? "translate-x-4" : "translate-x-0")}></div>
                  </label>
                </div>

                {/* Versement (Acompte) switch */}
                <div className={cn(
                  "flex items-center justify-between pt-2 border-t border-border/60",
                  storeSettings?.versement_requires_client && !selectedClient ? "opacity-50" : ""
                )}>
                  <div>
                    <p className="text-xs font-semibold text-text-primary">{t("sales.versement_acompte")}</p>
                    <p className="text-2xs text-text-muted">
                      {t("sales.min_versement", { pct: storeSettings?.min_versement_pct ?? 30, dzd: formatDZD(total * (storeSettings?.min_versement_pct ?? 30) / 100) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (storeSettings?.versement_requires_client && !selectedClient) return;
                      const next = !isVersement;
                      setIsVersement(next);
                      if (next) {
                        const minAmt = Math.ceil(total * (storeSettings?.min_versement_pct ?? 30) / 100);
                        setPayments([{ method: "cash", amount: minAmt }]);
                      } else {
                        setPayments([{ method: "cash", amount: total }]);
                      }
                    }}
                    className={cn(
                      "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      isVersement ? "bg-warning" : "bg-border",
                      storeSettings?.versement_requires_client && !selectedClient ? "cursor-not-allowed" : ""
                    )}
                    role="switch"
                    aria-checked={isVersement}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform",
                      isVersement ? "translate-x-4" : "translate-x-0"
                    )} />
                  </button>
                </div>

                {/* Multiple payment methods */}
                <div className="pt-2 border-t border-border/60 space-y-1.5">
                  <div className="text-2xs font-semibold text-text-muted uppercase tracking-wider">
                    Mode de règlement
                  </div>
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
                        className="form-input text-xs py-1 flex-1"
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
                        className="w-24 px-2 py-1 text-xs border border-border rounded font-mono text-end"
                        placeholder={formatDZD(total)}
                      />
                      <span className="text-2xs text-text-muted">DZD</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Versement minimum warning */}
            {isVersement && (() => {
              const minPct = storeSettings?.min_versement_pct ?? 30;
              const minAmt = total * minPct / 100;
              const belowMin = paymentTotal < minAmt;
              return (
                <div className={cn(
                  "text-xs px-2.5 py-1.5 rounded-lg border font-medium flex items-center justify-between",
                  belowMin ? "bg-danger-light text-danger border-danger/20" : "bg-success/10 text-success border-success/20"
                )}>
                  <span>Acompte minimum ({minPct}%): {formatDZD(Math.ceil(minAmt))} DZD</span>
                  <span>Solde: {formatDZD(Math.max(0, total - paymentTotal))} DZD</span>
                </div>
              );
            })()}

            {/* ── HIGH VISIBILITY GRAND TOTAL DISPLAY ── */}
            <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-lg border border-slate-800 flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  {t("sales.total_to_pay", "Total à payer")}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-white font-mono text-2xs">
                  {totalItems} {totalItems > 1 ? t("sales.articles_count", "articles") : t("sales.article_count", "article")}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2 my-1">
                <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-white">
                  {formatDZD(total)}
                </div>
                <div className="text-lg font-bold font-mono text-primary-400">
                  DZD
                </div>
              </div>

              {(cartDiscount > 0 || redemptionDzd > 0 || timbreFiscal > 0) && (
                <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-1 text-2xs font-mono text-slate-300">
                  {cartDiscount > 0 && (
                    <span className="text-emerald-400">Remise: −{formatDZD(cartDiscount)} DZD</span>
                  )}
                  {redemptionDzd > 0 && (
                    <span className="text-sky-400">Fidélité: −{formatDZD(redemptionDzd)} DZD</span>
                  )}
                  {timbreFiscal > 0 && (
                    <span className="text-amber-300">Timbre (+1%): +{formatDZD(timbreFiscal)} DZD</span>
                  )}
                </div>
              )}
            </div>

            {/* Error banner */}
            {saleMutation.isError && (
              <div className="text-xs text-danger bg-danger-light px-3 py-2 rounded-lg border border-danger/20 font-medium">
                {getApiError(saleMutation.error)}
              </div>
            )}

            {/* ── Big Confirm Sale Button ── */}
            <button
              onClick={handleConfirmSale}
              disabled={
                cart.length === 0 ||
                saleMutation.isPending ||
                (isVersement && paymentTotal < total * (storeSettings?.min_versement_pct ?? 30) / 100)
              }
              className={cn(
                "w-full py-3.5 px-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99]",
                cart.length === 0
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300"
                  : "btn-primary hover:shadow-lg"
              )}
            >
              {saleMutation.isPending ? (
                <span>{t("common.processing")}</span>
              ) : isVersement ? (
                <>
                  <Check size={20} className="stroke-[2.5]" />
                  <span>{t("sales.versement_btn", { amount: formatDZD(paymentTotal) })}</span>
                  <kbd className="ms-2 px-2 py-0.5 text-xs font-mono font-bold rounded bg-white/20 text-white border border-white/30">
                    F10 / .
                  </kbd>
                </>
              ) : (
                <>
                  <Check size={20} className="stroke-[2.5]" />
                  <span>{t("sales.confirm_sale")}</span>
                  <span className="font-mono text-white/90">— {formatDZD(total)} DZD</span>
                  <kbd className="ms-2 px-2 py-0.5 text-xs font-mono font-bold rounded bg-white/20 text-white border border-white/30">
                    F10 / .
                  </kbd>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
