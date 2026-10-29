/**
 * POS Sales Screen
 * - Left panel: product search (by name or barcode HID input)
 * - Right panel: client selector, cart, loyalty redemption, payment
 * - Keyboard: F2 = focus search, F10 = confirm sale
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, X, Plus, Minus, ShoppingBag, Check, Printer, User, Gift, Medal, Star, Trophy, UserCircle, UserPlus, Tag, AlertTriangle, Trash2, CreditCard, Smartphone, ArrowDownUp, Receipt, Coins, Bookmark, BookmarkCheck } from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import { printReceipt } from "@/lib/receipt";
import { printBonVersement, printBonReservation } from "@/lib/versement";
import { getPrinterConfig } from "@/lib/printerConfig";
import { useBranch } from "@/features/auth/BranchContext";
import type { Client, Product, Sale, StoreSettings, Variant, LoyaltyAccountSummary, LoyaltyProgram, CashSession } from "@/types";
import { cn, normalizeNumericInput, extractDigitFromKeyEvent } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { usePlan } from "@/hooks/usePlan";
import ManagerPinModal from "@/components/ui/ManagerPinModal";

interface CartItem {
  variant: Variant;
  product: Product;
  quantity: number;
  unit_price: number;
  discount: number;
  promoName?: string;
}

const PAYMENT_METHOD_KEYS = ["cash", "tpe", "baridimob", "ccp", "virement", "cheque"] as const;
type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

interface PaymentLine {
  method: PaymentMethodKey;
  amount: number;
  chequeNumber?: string;
  chequeBank?: string;
  chequeDueDate?: string;
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
  subtitle,
  onCreated,
  onClose,
}: {
  prefillName: string;
  subtitle?: string;
  onCreated: (c: Client) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(prefillName);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const { data: existingClients } = useQuery<PaginatedResponse<Client>>({
    queryKey: ["clients", "modal-search", name],
    queryFn: () =>
      api.get(`/clients/?search=${encodeURIComponent(name.trim())}&page_size=4`).then((r) => r.data),
    enabled: name.trim().length >= 2,
  });

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
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden border border-slate-200">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-slate-50/70">
          <div className="w-9 h-9 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
            <UserPlus size={17} className="text-primary-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-slate-900 text-sm">{t("sales.new_client")}</h3>
            {subtitle && (
              <p className="text-2xs text-amber-700 font-semibold truncate">{subtitle}</p>
            )}
          </div>
          <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary cursor-pointer">
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

          {existingClients && existingClients.results.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                Clients existants (cliquer pour sélectionner)
              </div>
              <div className="max-h-28 overflow-y-auto divide-y divide-slate-200/60">
                {existingClients.results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onCreated(c)}
                    className="w-full px-2 py-1.5 text-left text-xs hover:bg-primary-50 rounded-lg flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="font-bold text-slate-800 truncate">{c.name}</span>
                    {c.phone && <span className="text-2xs font-mono text-slate-500 ms-2">{c.phone}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const { canAccess } = usePlan();

  // Keep a ref to currentBranch so the scanner keydown handler (stable closure) always
  // reads the latest selection without being re-registered on every branch change.
  const currentBranchRef = useRef(currentBranch);
  useEffect(() => { currentBranchRef.current = currentBranch; }, [currentBranch]);
  const hasLoyalty = canAccess("pro_retail");
  const branchQs = currentBranch ? `&branch_id=${currentBranch.id}` : "";

  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: 0 }]);
  const [cashTendered, setCashTendered] = useState<string>("");
  const [receipt, setReceipt] = useState<(Sale & { points_earned?: number; points_redeemed?: number }) | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [isVersement, setIsVersement] = useState(false);
  const [isLayaway, setIsLayaway] = useState(false);
  const [layawayDurationDays, setLayawayDurationDays] = useState<number | undefined>(undefined);
  const [isFormal, setIsFormal] = useState(false);
  const [scanStatus, setScanStatus] = useState<"idle" | "found" | "not_found">("idle");
  const [negativeStockAlert, setNegativeStockAlert] = useState<{
    items: Array<{ item: CartItem; deficit: number; newStock: number }>;
    quickMode: boolean;
  } | null>(null);
  const [showClearCartModal, setShowClearCartModal] = useState(false);
  const [stockWarningToast, setStockWarningToast] = useState<string | null>(null);
  const managerPinRef = useRef<string | null>(null);
  const [managerPinPrompt, setManagerPinPrompt] = useState<{
    isOpen: boolean;
    reason: string;
    actionDescription?: string;
    quickMode: boolean;
  }>({
    isOpen: false,
    reason: "",
    actionDescription: "",
    quickMode: false,
  });

  const [showMovementModal, setShowMovementModal] = useState(false);
  const [showOpenSessionModal, setShowOpenSessionModal] = useState(false);
  const [showVersementClientModal, setShowVersementClientModal] = useState(false);
  const [sessionOpeningFloat, setSessionOpeningFloat] = useState("0");
  const [movementType, setMovementType] = useState<"in" | "out">("out");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementCategory, setMovementCategory] = useState("Dépense magasin");
  const [movementNotes, setMovementNotes] = useState("");
  const [movementError, setMovementError] = useState<string | null>(null);
  const movementAmountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showMovementModal) return;
    const focusAmount = () => {
      movementAmountRef.current?.focus();
    };
    const raf = requestAnimationFrame(focusAmount);
    const timer = setTimeout(focusAmount, 40);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [showMovementModal]);

  // Cash Session Query
  const { data: currentSession } = useQuery<CashSession | null>({
    queryKey: ["cash-session-current", currentBranch?.id],
    queryFn: () =>
      api.get(`/sales/sessions/current/${currentBranch?.id ? `?branch=${currentBranch.id}` : ""}`).then((r) => r.data),
    staleTime: 15_000,
  });

  const openSessionMutation = useMutation({
    mutationFn: () =>
      api.post("/sales/sessions/open_session/", {
        opening_float: sessionOpeningFloat || "0",
        branch_id: currentBranch?.id ?? null,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      setShowOpenSessionModal(false);
      setSessionOpeningFloat("0");
    },
  });

  const movementMutation = useMutation({
    mutationFn: () =>
      api.post(`/sales/sessions/${currentSession?.id}/movement/`, {
        type: movementType,
        amount: movementAmount,
        category: movementCategory,
        notes: movementNotes,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      setShowMovementModal(false);
      setMovementAmount("");
      setMovementNotes("");
      setMovementError(null);
    },
    onError: (err) => setMovementError(getApiError(err)),
  });

  // Keep a ref so addToCart (useCallback) can read current cart without stale closure
  const cartRef = useRef<CartItem[]>([]);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  // Ensure search input is always focused on mount or whenever returning to this page
  useEffect(() => {
    const focusSearch = () => {
      window.electronAPI?.focusWindow?.();
      searchRef.current?.focus();
    };
    focusSearch();
    const raf = requestAnimationFrame(focusSearch);
    const timer = setTimeout(focusSearch, 60);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

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
    setTimeout(() => {
      window.electronAPI?.focusWindow?.();
      searchRef.current?.focus();
    }, 40);
  }, [applyPromo]);

  const enableVariants = storeSettings?.enable_variants ?? false;
  const allowNegativeStock = storeSettings?.allow_negative_stock ?? false;

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

  // Auto-sync first payment line to total (skip in versement or layaway mode)
  useEffect(() => {
    if (isVersement || isLayaway) return;
    if (payments.length === 1 && payments[0].method === "cash") {
      setPayments([{ method: "cash", amount: Math.max(0, total) }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, isVersement, isLayaway]);

  const isSubmittingRef = useRef(false);
  const isQuickModeRef = useRef(false);
  const quickSaleToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quickSaleToast, setQuickSaleToast] = useState<{
    receiptNumber: string;
    total: number;
    itemsCount: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (quickSaleToastTimerRef.current) {
        clearTimeout(quickSaleToastTimerRef.current);
      }
    };
  }, []);

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
          ...(p.method === "cheque"
            ? {
                cheque_number: p.chequeNumber || "",
                cheque_bank: p.chequeBank || "",
                ...(p.chequeDueDate ? { cheque_due_date: p.chequeDueDate } : {}),
              }
            : {}),
        })),
        cart_discount: Number(cartDiscount || 0).toFixed(2),
        is_formal: isFormal,
        is_versement: isVersement,
        is_layaway: isLayaway,
        layaway_duration_days: layawayDurationDays ?? storeSettings?.layaway_duration_days ?? 7,
        ...(managerPinRef.current ? { manager_pin: managerPinRef.current } : {}),
      }).then((r) => r.data);
    },
    onSuccess: (data) => {
      managerPinRef.current = null;
      const wasQuickMode = isQuickModeRef.current;
      if (wasQuickMode) {
        // Dot (.) quick sale: don't render receipt modal, show confirmation toast
        setReceipt(null);
        if (quickSaleToastTimerRef.current) {
          clearTimeout(quickSaleToastTimerRef.current);
        }
        setQuickSaleToast({
          receiptNumber: data.receipt_number || "",
          total: Number(data.total_amount) || 0,
          itemsCount: data.items?.length || 0,
        });
        quickSaleToastTimerRef.current = setTimeout(() => {
          setQuickSaleToast(null);
        }, 4000);
        searchRef.current?.focus();
        searchRef.current?.select();
      } else {
        setReceipt(data);
      }

      // Auto-print receipt if enabled in printer preferences
      try {
        const printerCfg = getPrinterConfig();
        if (printerCfg.ticket.autoPrint) {
          if (data.status === "layaway" || data.is_layaway) {
            printBonReservation(data, user?.tenant?.name ?? "ShoeDZ");
          } else if (data.status === "partially_paid") {
            printBonVersement(data, user?.tenant?.name ?? "ShoeDZ");
          } else {
            printReceipt(data, user?.tenant?.name ?? "ShoeDZ");
          }
        }
      } catch (err) {
        console.warn("Auto-print ticket failed:", err);
      }

      setCart([]);
      setCartDiscount(0);
      setRedeemPoints(0);
      setCashTendered("");
      setPayments([{ method: "cash", amount: 0 }]);
      setSelectedClient(null);
      setIsVersement(false);
      setIsLayaway(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty-account-summary"] });
      queryClient.invalidateQueries({ queryKey: ["cash-session-current"] });
      queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["cheques"] });
    },
    onSettled: () => {
      isSubmittingRef.current = false;
    },
  });

  function executeSaleSubmission(quickMode = false) {
    if (cart.length === 0 || saleMutation.isPending || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    isQuickModeRef.current = quickMode;
    saleMutation.mutate();
  }

  function handleConfirmSale(quickMode = false) {
    if (cart.length === 0 || saleMutation.isPending || isSubmittingRef.current) return;

    // Check for items that will result in negative stock
    const negativeItems = cart
      .filter((item) => item.quantity > (item.variant.stock_qty ?? 0))
      .map((item) => ({
        item,
        deficit: item.quantity - (item.variant.stock_qty ?? 0),
        newStock: (item.variant.stock_qty ?? 0) - item.quantity,
      }));

    if (negativeItems.length > 0) {
      if (allowNegativeStock) {
        // Show confirmation alert modal before validating
        setNegativeStockAlert({ items: negativeItems, quickMode });
        return;
      } else {
        setStockWarningToast(
          "Impossible de valider : certains articles dépassent le stock disponible. Vous pouvez autoriser le stock négatif dans les Paramètres."
        );
        setTimeout(() => setStockWarningToast(null), 4000);
        return;
      }
    }

    // Cashier permission & Manager PIN check
    if (user?.role === "cashier" && !managerPinRef.current) {
      const grossTotal = cart.reduce((s, i) => s + (Number(i.unit_price) * i.quantity), 0);
      const totalDiscount = (Number(cartDiscount) || 0) + cart.reduce((s, i) => s + (Number(i.discount) || 0), 0);
      const discountPct = grossTotal > 0 ? (totalDiscount / grossTotal) * 100 : 0;
      const maxAllowed = user.max_discount_pct ?? storeSettings?.default_max_discount_pct ?? 10;
      const requirePinForDiscounts = storeSettings?.require_manager_pin_for_discounts ?? true;

      if (requirePinForDiscounts && discountPct > maxAllowed) {
        setManagerPinPrompt({
          isOpen: true,
          reason: `Remise totale (${discountPct.toFixed(1)}%) supérieure à votre plafond autorisé (${maxAllowed}%)`,
          actionDescription: "La validation d'un responsable par code PIN est nécessaire pour accorder cette remise.",
          quickMode,
        });
        return;
      }

      if (user.can_modify_price === false) {
        const altered = cart.find(
          (i) => Math.abs(Number(i.unit_price) - parseFloat(i.product.sale_price)) > 0.01
        );
        if (altered) {
          setManagerPinPrompt({
            isOpen: true,
            reason: `Prix unitaire modifié pour "${altered.product.name}" (${Number(altered.unit_price).toFixed(2)} DA vs ${parseFloat(altered.product.sale_price).toFixed(2)} DA)`,
            actionDescription: "La modification des prix du catalogue nécessite l'approbation d'un responsable.",
            quickMode,
          });
          return;
        }
      }
    }

    executeSaleSubmission(quickMode);
  }

  const handleClearCart = useCallback(() => {
    if (cart.length === 0) return;
    setShowClearCartModal(true);
  }, [cart.length]);

  const confirmClearCart = useCallback(() => {
    managerPinRef.current = null;
    setCart([]);
    setCartDiscount(0);
    setRedeemPoints(0);
    setSearch("");
    setSelectedProduct(null);
    setShowClearCartModal(false);
    setTimeout(() => {
      window.electronAPI?.focusWindow?.();
      searchRef.current?.focus();
    }, 40);
  }, []);

  const cancelClearCart = useCallback(() => {
    setShowClearCartModal(false);
    setTimeout(() => {
      window.electronAPI?.focusWindow?.();
      searchRef.current?.focus();
    }, 40);
  }, []);

  const activateVersementWithClient = useCallback((client: Client) => {
    setSelectedClient(client);
    setRedeemPoints(0);
    setIsVersement(true);
    setIsLayaway(false);
    setShowOptions(true);
    const minAmt = Math.ceil(total * (storeSettings?.min_versement_pct ?? 30) / 100);
    setPayments([{ method: "cash", amount: minAmt }]);
    setShowVersementClientModal(false);
  }, [total, storeSettings?.min_versement_pct]);

  const handleVersementShortcut = useCallback(() => {
    if (isVersement) {
      setIsVersement(false);
      setPayments([{ method: "cash", amount: Math.max(0, total) }]);
      return;
    }
    if (!selectedClient) {
      setShowVersementClientModal(true);
    } else {
      setIsVersement(true);
      setIsLayaway(false);
      setShowOptions(true);
      const minAmt = Math.ceil(total * (storeSettings?.min_versement_pct ?? 30) / 100);
      setPayments([{ method: "cash", amount: minAmt }]);
    }
  }, [isVersement, selectedClient, total, storeSettings?.min_versement_pct]);

  const handleMovementShortcut = useCallback(() => {
    if (currentSession) {
      setMovementError(null);
      setShowMovementModal((prev) => !prev);
    } else {
      setShowOpenSessionModal(true);
    }
  }, [currentSession]);

  // Keyboard shortcuts integration (F2 = search, F10 = confirm sale, F1 = new sale, V = versement, M = mouvement, Escape = clear/empty)
  useEffect(() => {
    const onSearch = () => {
      window.electronAPI?.focusWindow?.();
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    const onConfirm = () => {
      if (showClearCartModal) {
        confirmClearCart();
        return;
      }
      if (receipt) {
        setReceipt(null);
        searchRef.current?.focus();
        return;
      }
      if (negativeStockAlert) {
        const qm = negativeStockAlert.quickMode;
        setNegativeStockAlert(null);
        executeSaleSubmission(qm);
        return;
      }
      handleConfirmSale(false);
    };

    const onNewSale = () => {
      if (receipt) {
        setReceipt(null);
      }
      window.electronAPI?.focusWindow?.();
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    const onEscape = () => {
      if (showVersementClientModal) {
        setShowVersementClientModal(false);
      } else if (showMovementModal) {
        setShowMovementModal(false);
        setMovementError(null);
      } else if (showOpenSessionModal) {
        setShowOpenSessionModal(false);
      } else if (showClearCartModal) {
        cancelClearCart();
      } else if (negativeStockAlert) {
        setNegativeStockAlert(null);
        setTimeout(() => {
          window.electronAPI?.focusWindow?.();
          searchRef.current?.focus();
        }, 40);
      } else if (selectedProduct) {
        setSelectedProduct(null);
        setTimeout(() => {
          window.electronAPI?.focusWindow?.();
          searchRef.current?.focus();
        }, 40);
      } else if (search.trim() !== "") {
        setSearch("");
        window.electronAPI?.focusWindow?.();
        searchRef.current?.focus();
      } else if (cart.length > 0) {
        handleClearCart();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // If clear cart modal is open, intercept Enter and Escape directly
      if (showClearCartModal) {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmClearCart();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelClearCart();
          return;
        }
      }

      const anyDialogOpen =
        showVersementClientModal ||
        showMovementModal ||
        showOpenSessionModal ||
        showClearCartModal ||
        !!negativeStockAlert ||
        !!receipt ||
        managerPinPrompt.isOpen;

      // Direct local F2 / Alt+2 handler inside SalesPage
      if (e.key === "F2" || (e.altKey && e.key === "2")) {
        e.preventDefault();
        onSearch();
        return;
      }

      // Escape key: close dialogs, collapse variant picker, clear search, or empty cart
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }

      const target = e.target as HTMLElement;
      const isOtherInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.tagName === "SELECT");

      // When Mouvements modal is open, if cashier starts typing numbers while focus is on a button/backdrop,
      // automatically direct keystrokes into the Montant input.
      if (showMovementModal && !isOtherInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const digit = extractDigitFromKeyEvent(e);
        if (digit !== null) {
          e.preventDefault();
          movementAmountRef.current?.focus();
          setMovementAmount((prev) => `${prev}${digit}`);
          return;
        }
      }

      if (anyDialogOpen) return;

      const isSearch = target === searchRef.current;

      // Alt+V and Alt+M / Ctrl+M are dispatched globally by useGlobalShortcuts.
      // Here we additionally allow Ctrl/Cmd+Shift+V anywhere, or Ctrl/Cmd+V outside inputs, for Versement.
      const keyLower = e.key.toLowerCase();
      const isKeyV = e.code === "KeyV" || keyLower === "v";

      if (isKeyV && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const isPasteInInput = !e.shiftKey && isOtherInput;
        if (!isPasteInInput) {
          e.preventDefault();
          handleVersementShortcut();
          return;
        }
      }

      // POS Type-to-Search: if cashier starts typing characters while focus is outside inputs, seamlessly redirect to search
      if (!isOtherInput && target !== searchRef.current) {
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== " " && e.key !== ".") {
          e.preventDefault();
          window.electronAPI?.focusWindow?.();
          searchRef.current?.focus();
          setSearch((prev) => prev + e.key);
          return;
        }
      }

      const isPoint = (e.key === "." || e.code === "NumpadDecimal") && !e.ctrlKey && !e.altKey && !e.metaKey;

      if (isPoint) {
        // Allow '.' or NumpadDecimal to confirm sale if:
        // 1. Focus is outside any input field (cart, table, buttons)
        // 2. OR focus is inside the search box and search is empty (common right after barcode scan)
        if (!isOtherInput || (isSearch && search.trim() === "")) {
          if (cart.length > 0 || receipt) {
            e.preventDefault();
            if (receipt) {
              setReceipt(null);
              searchRef.current?.focus();
              return;
            }
            if (negativeStockAlert) {
              const qm = negativeStockAlert.quickMode;
              setNegativeStockAlert(null);
              executeSaleSubmission(qm);
              return;
            }
            // Dot (.) triggers quick sale mode directly!
            handleConfirmSale(true);
          }
        }
      } else if (e.key === "Enter" && negativeStockAlert) {
        e.preventDefault();
        const qm = negativeStockAlert.quickMode;
        setNegativeStockAlert(null);
        executeSaleSubmission(qm);
      }
    };

    const onVersementEvent = () => handleVersementShortcut();
    const onMovementEvent = () => handleMovementShortcut();

    // Note: F1, F2, F10, Alt+V, Alt+M are handled globally by useGlobalShortcuts and dispatched as custom events below.
    window.addEventListener("app-shortcut-search", onSearch);
    window.addEventListener("app-shortcut-confirm", onConfirm);
    window.addEventListener("app-shortcut-new-sale", onNewSale);
    window.addEventListener("app-shortcut-escape", onEscape);
    window.addEventListener("app-shortcut-versement", onVersementEvent);
    window.addEventListener("app-shortcut-movement", onMovementEvent);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("app-shortcut-search", onSearch);
      window.removeEventListener("app-shortcut-confirm", onConfirm);
      window.removeEventListener("app-shortcut-new-sale", onNewSale);
      window.removeEventListener("app-shortcut-escape", onEscape);
      window.removeEventListener("app-shortcut-versement", onVersementEvent);
      window.removeEventListener("app-shortcut-movement", onMovementEvent);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    receipt,
    cart,
    saleMutation.isPending,
    search,
    negativeStockAlert,
    allowNegativeStock,
    selectedProduct,
    handleClearCart,
    showClearCartModal,
    confirmClearCart,
    cancelClearCart,
    showVersementClientModal,
    showMovementModal,
    showOpenSessionModal,
    managerPinPrompt.isOpen,
    handleVersementShortcut,
    handleMovementShortcut,
  ]);

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
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl === searchRef.current) return;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) return;
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
    const isLayawayReceipt = receipt.status === "layaway" || !!receipt.is_layaway;

    if (isLayawayReceipt) {
      return (
        <div className="max-w-sm mx-auto text-center py-12">
          <div className="w-16 h-16 bg-indigo-50 border border-indigo-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <BookmarkCheck size={32} className="text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">Réservation Enregistrée</h2>
          <p className="text-text-muted text-sm mb-1">{t('sales.receipt')}: <strong>{receipt.receipt_number}</strong></p>
          {receipt.client_name ? (
            <p className="text-text-muted text-sm mb-1">{t('sales.client')}: <strong>{receipt.client_name}</strong></p>
          ) : receipt.notes ? (
            <p className="text-text-muted text-sm mb-1">Réf / Note: <strong>{receipt.notes}</strong></p>
          ) : null}
          <div className="mb-4 mt-3 rounded-xl bg-indigo-50/80 border border-indigo-200 p-3 text-sm space-y-1.5">
            <div className="inline-block px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-2xs font-bold uppercase tracking-wider">
              Stock consigné &amp; mis de côté
            </div>
            <p className="text-text-primary text-xs">
              Acompte versé: <strong className="font-mono text-sm">{formatDZD(receipt.amount_paid)} DZD</strong>
            </p>
            <p className="text-indigo-700 font-semibold text-xs">
              Solde au retrait: <span className="font-mono text-sm">{formatDZD(receipt.balance_due)} DZD</span>
            </p>
            {receipt.layaway_expires_at && (
              <p className="text-indigo-900 text-xs font-medium pt-1 border-t border-indigo-200/60">
                Date limite de retrait: <strong>{receipt.layaway_expires_at}</strong>
              </p>
            )}
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            <button className="btn-secondary" onClick={() => setReceipt(null)}>
              Nouvelle vente
            </button>
            <button
              className="btn-primary bg-indigo-600 hover:bg-indigo-700 flex items-center gap-2"
              onClick={() => printBonReservation(receipt, user?.tenant?.name ?? "ShoeDZ")}
            >
              <Printer size={16} />
              Bon de réservation
            </button>
          </div>
        </div>
      );
    }

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
    <div className="flex flex-col lg:flex-row gap-4 h-full min-h-[calc(100vh-100px)] relative">
      {/* ── Quick Sale Confirmation Toast ── */}
      {quickSaleToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-5 right-5 z-50 flex items-center gap-3.5 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700/80 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 max-w-md"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
            <Check size={20} className="stroke-[2.5]" />
          </div>
          <div className="flex-1 min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-white">{t("sales.sale_confirmed", "Vente validée")}</span>
              {quickSaleToast.receiptNumber && (
                <span className="font-mono text-2xs font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                  {quickSaleToast.receiptNumber}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 mt-0.5 truncate">
              {quickSaleToast.itemsCount} {quickSaleToast.itemsCount > 1 ? t("sales.articles_count", "articles") : t("sales.article_count", "article")} ·{" "}
              <strong className="text-white font-mono">{formatDZD(quickSaleToast.total)} DZD</strong>
            </p>
          </div>
          <button
            onClick={() => setQuickSaleToast(null)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Left: Product Search & Selection ── */}
      <div className="w-full lg:w-7/12 flex flex-col gap-3">
        {/* POS Header & Shortcuts */}
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">{t("nav.new_sale")}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs font-semibold text-slate-700">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-600">F2</kbd>
                <span>{t("sales.shortcut_search", "Rechercher")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs font-semibold text-slate-700">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-600">F10</kbd>
                <span className="text-[10px] text-slate-400">/</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-600">.</kbd>
                <span>{t("sales.shortcut_confirm", "Confirmer")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs font-semibold text-slate-700">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-600">F11</kbd>
                <span>{t("sales.shortcut_fullscreen", "Plein écran")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs font-semibold text-slate-700">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-600">Échap</kbd>
                <span>{t("sales.shortcut_clear", "Vider panier / Effacer")}</span>
              </span>
              <button
                type="button"
                onClick={handleVersementShortcut}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border shadow-2xs text-xs font-semibold transition-colors cursor-pointer",
                  isVersement
                    ? "bg-amber-50 border-amber-300 text-amber-800"
                    : "bg-white border-slate-200/80 text-slate-700 hover:bg-slate-50"
                )}
                title="Raccourci Alt+V : Créer / sélectionner un client et activer le mode Versement"
              >
                <kbd className={cn(
                  "px-1.5 py-0.5 text-[10px] font-mono font-bold border rounded",
                  isVersement
                    ? "bg-amber-200/70 border-amber-300 text-amber-900"
                    : "bg-slate-100 border-slate-200 text-slate-600"
                )}>Alt+V</kbd>
                <span>Versement</span>
              </button>
              <button
                type="button"
                onClick={handleMovementShortcut}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                title="Raccourci Alt+M (ou Ctrl+M) : Ouvrir le popup rapide des mouvements d'espèces"
              >
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-600">Alt+M</kbd>
                <span>Mouvements</span>
              </button>
            </div>
          </div>

          {/* Cash Register Shift Status & Quick Action */}
          <div className="flex items-center gap-2">
            {currentSession ? (
              <div className="flex items-center gap-1.5 bg-white border border-emerald-200/90 shadow-2xs rounded-2xl p-1.5 pr-2.5">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{currentSession.session_code}</span>
                  <span className="text-emerald-300">|</span>
                  <span className="font-mono">{formatDZD(currentSession.stats?.expected_cash ?? currentSession.expected_cash)} DZD</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMovementModal(true)}
                  className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Ajouter ou retirer des espèces (Raccourci : Alt+M)"
                >
                  <ArrowDownUp size={12} />
                  <span>Mouvement</span>
                  <kbd className="px-1 py-0.2 text-[9px] font-mono font-bold bg-white border border-slate-200 rounded text-slate-500">Alt+M</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/sales/reconciliation")}
                  className="px-2 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1 transition-colors"
                  title="Voir la caisse, lecture X et clôture Z"
                >
                  <Receipt size={12} />
                  <span>Caisse & Z</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-white border border-amber-200 shadow-2xs rounded-2xl p-1.5">
                <button
                  type="button"
                  onClick={() => setShowOpenSessionModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-2xs"
                >
                  <Coins size={13} />
                  <span>Ouvrir Caisse</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/sales/reconciliation")}
                  className="px-2 py-1.5 rounded-xl text-slate-500 hover:text-slate-800 text-xs font-medium transition-colors"
                  title="Historique des caisses"
                >
                  <Receipt size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search size={19} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            ref={searchRef}
            data-shortcut-search="true"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="form-input ps-11 pe-14 py-3.5 text-base shadow-xs rounded-2xl border-slate-200 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/15 bg-white text-slate-900 transition-all font-medium placeholder:text-slate-400"
            placeholder={t("sales.search_product")}
            autoFocus
          />
          {scanStatus === "idle" ? (
            <kbd className="absolute end-3.5 top-1/2 -translate-y-1/2 text-[11px] font-mono font-bold bg-slate-100 border border-slate-200 text-slate-500 px-2 py-1 rounded-md shadow-2xs pointer-events-none">
              F2
            </kbd>
          ) : (
            <div
              className={cn(
                "absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full pointer-events-none shadow-xs",
                scanStatus === "found" && "bg-emerald-50 text-emerald-700 border border-emerald-200",
                scanStatus === "not_found" && "bg-red-50 text-red-700 border border-red-200",
              )}
            >
              {scanStatus === "found" ? (
                <><Check size={13} className="stroke-[2.5]" /> {t("sales.pos_added")}</>
              ) : (
                <><X size={13} className="stroke-[2.5]" /> {t("sales.pos_not_found")}</>
              )}
            </div>
          )}
        </div>

        {/* Search results or Empty State */}
        {search.length >= 2 && productResults ? (
          <div className="card overflow-auto flex-1 divide-y divide-slate-100 rounded-2xl shadow-xs border border-slate-200/80 bg-white">
            {productResults.results.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                <p className="font-bold text-sm text-slate-700">Aucun produit trouvé pour &laquo;&nbsp;{search}&nbsp;&raquo;</p>
                <p className="text-xs text-slate-400 mt-1">Vérifiez l'orthographe ou scannez directement le code-barres.</p>
              </div>
            ) : (
              productResults.results.map((product) => {
                const isMultiVariant = enableVariants && product.variants && product.variants.length > 1;
                const isExpanded = selectedProduct?.id === product.id;

                return (
                  <div key={product.id} className="transition-colors hover:bg-slate-50/60">
                    <div
                      className="px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
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
                          <div className="font-extrabold text-slate-900 text-base truncate">
                            {product.brand && (
                              <span className="text-slate-500 font-semibold me-1.5">{product.brand}</span>
                            )}
                            {product.name}
                          </div>
                          {product.barcode && (
                            <span className="font-mono text-2xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              {product.barcode}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                          <span className="font-bold font-mono text-primary-700 bg-primary-50 px-2.5 py-0.5 rounded-lg border border-primary-100">
                            {formatDZD(product.sale_price)} DZD
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className={cn(
                            "font-mono font-semibold",
                            product.total_stock <= 0 ? "text-red-600" : product.has_low_stock ? "text-amber-600" : "text-slate-600"
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
                          className="text-xs font-bold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 px-3.5 py-2 rounded-xl transition-all active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer"
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
                          className="btn-primary text-xs font-extrabold py-2 px-3.5 rounded-xl shadow-xs hover:shadow active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          <Plus size={14} className="stroke-[2.5]" />
                          <span>{t("common.add", "Ajouter")}</span>
                        </button>
                      )}
                    </div>

                    {isMultiVariant && isExpanded && (
                      <div className="px-4 pb-4 pt-2 bg-slate-50/80 border-t border-slate-100">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                          {t("sales.choose_size_color")}
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                          {product.variants.map((variant) => (
                            <button
                              key={variant.id}
                              disabled={!allowNegativeStock && variant.stock_qty <= 0}
                              onClick={() => addToCart(variant, product)}
                              className={cn(
                                "p-2.5 text-xs rounded-xl border font-medium transition-all text-center flex flex-col items-center justify-center gap-1 cursor-pointer",
                                variant.stock_qty <= 0
                                  ? allowNegativeStock
                                    ? "border-amber-300 bg-amber-50/70 text-amber-900 hover:bg-amber-100 hover:border-amber-400 active:scale-95 shadow-2xs"
                                    : "border-slate-200 bg-slate-100 text-slate-400 opacity-50 cursor-not-allowed"
                                  : variant.is_low_stock
                                  ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 active:scale-95 shadow-2xs"
                                  : "border-slate-200 bg-white text-slate-800 hover:border-primary-500 hover:bg-primary-50 hover:text-primary-700 active:scale-95 shadow-2xs"
                              )}
                            >
                              <span className="font-black text-sm font-mono tracking-tight">T.{variant.size_eu}</span>
                              <span className="text-[11px] text-slate-500 truncate max-w-full font-medium">
                                {variant.colour === "N/A" ? t("common.na") : variant.colour}
                              </span>
                              <span className={cn(
                                "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md",
                                variant.stock_qty <= 0
                                  ? allowNegativeStock
                                    ? "text-rose-700 bg-rose-100 font-bold"
                                    : "text-slate-400"
                                  : variant.stock_qty <= 2
                                  ? "text-amber-800 bg-amber-100"
                                  : "text-slate-600 bg-slate-100"
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
          <div className="card p-8 flex flex-col items-center justify-center text-center flex-1 border-dashed border-2 border-slate-200 bg-slate-50/40 rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center mb-3.5 shadow-xs border border-primary-100">
              <Search size={24} />
            </div>
            <h3 className="font-extrabold text-slate-900 text-base">Prêt pour la vente</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
              Scannez directement avec votre douchette code-barres n'importe où, ou tapez au moins 2 lettres pour chercher un modèle.
            </p>
            <div className="flex gap-2 mt-5 text-[11px] text-slate-600 flex-wrap justify-center font-medium">
              <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl shadow-2xs">F2 = Rechercher</span>
              <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl shadow-2xs">Entrée = Ajouter au panier</span>
              <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl shadow-2xs">F10 / . = Confirmer</span>
              <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl shadow-2xs">F11 = Plein écran</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Cashier Cart & Prominent Total ── */}
      <div className="w-full lg:w-5/12 flex flex-col gap-3">
        <div className="card flex flex-col flex-1 overflow-hidden rounded-2xl shadow-xs border border-slate-200/80 bg-white">
          {/* Cart Header */}
          <div className="card-header bg-slate-50/80 py-3.5 px-4 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shadow-xs">
                <ShoppingBag size={16} />
              </div>
              <h2 className="font-extrabold text-slate-900 text-base">
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
                onClick={handleClearCart}
                className="text-xs text-slate-400 hover:text-red-600 flex items-center gap-1.5 px-2.5 py-1 rounded-xl hover:bg-red-50 transition-colors font-bold cursor-pointer"
                title="Vider tout le panier (Touche Échap)"
              >
                <X size={13} />
                <span>{t("sales.clear_cart", "Vider")}</span>
                <kbd className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-500">
                  Échap
                </kbd>
              </button>
            )}
          </div>

          {/* Client selector (compact) */}
          <div className="px-4 py-3 border-b border-slate-100 bg-white">
            <ClientSelector
              selected={selectedClient}
              onSelect={(c) => { setSelectedClient(c); setRedeemPoints(0); }}
              onClear={() => { setSelectedClient(null); setRedeemPoints(0); }}
            />

            {/* Loyalty points banner if client has loyalty */}
            {loyaltyAccount && loyaltyProgram?.is_active && (
              <div className="mt-2.5 flex flex-col gap-1.5 text-xs bg-primary-50/80 border border-primary-100 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Gift size={13} className="text-primary-600" />
                    <span className="text-primary-800 font-bold font-mono">
                      {loyaltyAccount.points_balance.toLocaleString("fr-DZ")}
                    </span>
                    <span className="text-slate-500 text-[11px] font-medium">pts fidélité</span>
                    <span className="text-2xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      ≈ {formatDZD(Math.floor((loyaltyAccount.points_balance / (loyaltyProgram.redemption_value || 100)) * 100))} DZD
                    </span>
                  </div>
                  {canRedeem && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setRedeemPoints(
                            redeemPoints === loyaltyAccount.points_balance
                              ? 0
                              : loyaltyAccount.points_balance,
                          )
                        }
                        className="px-2 py-0.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-2xs font-bold transition-colors cursor-pointer"
                      >
                        {redeemPoints === loyaltyAccount.points_balance ? "Annuler" : "Utiliser Max"}
                      </button>
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
                        className="w-16 px-2 py-0.5 text-xs bg-white border border-slate-200 rounded-lg text-center font-mono font-semibold"
                      />
                    </div>
                  )}
                </div>
                {redeemPoints > 0 && (
                  <div className="flex items-center justify-between text-2xs text-primary-800 font-bold border-t border-primary-100 pt-1">
                    <span>Remise fidélité appliquée :</span>
                    <span className="font-mono text-emerald-700">−{formatDZD(redemptionDzd)} DZD</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart items list (prominent cards with large Pointure tag) */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50/50">
            {cart.length === 0 ? (
              <div className="py-16 text-center flex flex-col items-center justify-center text-slate-400">
                <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-3 text-slate-300 shadow-xs">
                  <ShoppingBag size={28} className="opacity-50" />
                </div>
                <p className="font-extrabold text-slate-800 text-sm">{t("sales.empty_cart")}</p>
                <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
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
                    className="p-3.5 bg-white rounded-2xl border border-slate-200/90 hover:border-primary-400 transition-all shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* High-visibility Pointure / Size Badge only for sized products */}
                          {!isSimpleProduct && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-black font-mono bg-primary-100 text-primary-900 border border-primary-200 shadow-2xs">
                              EU {item.variant.size_eu}
                            </span>
                          )}
                          <span className="font-extrabold text-slate-900 text-sm truncate">
                            {item.product.brand && (
                              <span className="text-slate-500 font-semibold me-1.5">{item.product.brand}</span>
                            )}
                            {item.product.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500 flex-wrap">
                          {hasCustomColour && (
                            <span className="px-2 py-0.5 bg-slate-100 rounded-md border border-slate-200 text-2xs font-semibold text-slate-700">
                              {item.variant.colour}
                            </span>
                          )}
                          {item.variant.barcode && (
                            <span className="font-mono text-2xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              {item.variant.barcode}
                            </span>
                          )}
                          {item.promoName && (
                            <span className="flex items-center gap-1 text-2xs text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <Tag size={10} />
                              {item.promoName}
                            </span>
                          )}
                          <span className="font-mono text-2xs text-slate-400">
                            {formatDZD(item.unit_price)} DZD / u
                          </span>
                        </div>

                        {item.quantity > (item.variant.stock_qty ?? 0) && (
                          <div className="flex items-center gap-1.5 mt-2 text-2xs font-bold text-amber-900 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-lg">
                            <AlertTriangle size={12} className="shrink-0 text-amber-600" />
                            <span>
                              Stock insuffisant : {item.variant.stock_qty ?? 0} dispo ({item.quantity - (item.variant.stock_qty ?? 0)} en rupture)
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Line Total */}
                      <div className="text-end shrink-0">
                        <div className="text-base font-black font-mono text-slate-900 tracking-tight">
                          {formatDZD(item.unit_price * item.quantity - item.discount)} DZD
                        </div>
                        {item.discount > 0 && (
                          <div className="text-2xs text-slate-400 line-through font-mono">
                            {formatDZD(item.unit_price * item.quantity)} DZD
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quantity & Actions row */}
                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updateQuantity(item.variant.id, -1)}
                          className="w-7.5 h-7.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 active:scale-95 flex items-center justify-center transition-all cursor-pointer"
                          title="Diminuer la quantité"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-8 text-center text-sm font-black font-mono text-slate-900">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.variant.id, 1)}
                          className="w-7.5 h-7.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 active:scale-95 flex items-center justify-center transition-all cursor-pointer"
                          title="Augmenter la quantité"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      <button
                        onClick={() => removeItem(item.variant.id)}
                        className="text-xs text-slate-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 font-semibold cursor-pointer"
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
          <div className="border-t border-slate-100 p-4 bg-white space-y-3">
            {/* Quick options toolbar */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowOptions(!showOptions)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all text-xs font-bold cursor-pointer",
                    showOptions || cartDiscount > 0 || isFormal || isVersement || isLayaway
                      ? "bg-primary-50 border-primary-200 text-primary-700 shadow-2xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  )}
                >
                  <span>⚙️ Options de vente</span>
                  {(cartDiscount > 0 || isFormal || isVersement || isLayaway) && (
                    <span className="w-2 h-2 rounded-full bg-primary-600"></span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleVersementShortcut}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all text-xs font-bold cursor-pointer",
                    isVersement
                      ? "bg-amber-500 border-amber-600 text-white shadow-xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  )}
                  title="Raccourci Alt+V : Nouveau client + activer Versement"
                >
                  <span>Versement</span>
                  <kbd className={cn(
                    "px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border",
                    isVersement
                      ? "bg-white/20 border-white/30 text-white"
                      : "bg-white border-slate-200 text-slate-500"
                  )}>
                    Alt+V
                  </kbd>
                </button>
              </div>
            </div>

            {/* ── PROMINENT DISCOUNT (REMISE) BAR ── */}
            <div
              className={cn(
                "flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl border-2 transition-all",
                cartDiscount > 0
                  ? "bg-emerald-50/70 border-emerald-400 shadow-xs"
                  : "bg-slate-50/90 border-slate-200 hover:border-slate-300"
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border",
                    cartDiscount > 0
                      ? "bg-emerald-500 text-white border-emerald-600 shadow-2xs"
                      : "bg-white text-slate-600 border-slate-200"
                  )}
                >
                  <Tag size={17} className="stroke-[2.2]" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <span>Remise</span>
                    {cartDiscount > 0 && itemsTotal > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono text-[10px] font-black">
                        −{Math.min(100, Math.round((cartDiscount / itemsTotal) * 100))}%
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium truncate">
                    Réduction directe sur le total
                  </p>
                </div>
              </div>

              <div className="relative flex items-center shrink-0">
                <input
                  type="text"
                  inputMode="decimal"
                  value={cartDiscount || ""}
                  onChange={(e) => {
                    const cleaned = normalizeNumericInput(e.target.value);
                    setCartDiscount(Math.max(0, parseFloat(cleaned) || 0));
                  }}
                  placeholder="0"
                  className={cn(
                    "w-36 sm:w-44 pl-3 pr-14 py-2 text-lg font-black font-mono text-end rounded-xl border-2 transition-all focus:outline-none focus:ring-4",
                    cartDiscount > 0
                      ? "bg-white border-emerald-500 text-emerald-900 focus:ring-emerald-500/20"
                      : "bg-white border-slate-300 text-slate-900 focus:border-primary-500 focus:ring-primary-500/15"
                  )}
                />
                {cartDiscount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setCartDiscount(0)}
                    className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-lg bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                    title="Effacer la remise"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 font-mono text-xs font-extrabold text-slate-400 pointer-events-none">
                    DZD
                  </span>
                )}
              </div>
            </div>

            {/* Expandable Options Drawer */}
            {showOptions && (
              <div className="p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-3 animate-in fade-in duration-100">
                {/* Mode Réel switch */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-900">{t("sales.formal_mode")}</p>
                    <p className="text-2xs text-slate-500">{t("sales.formal_mode_desc")}</p>
                  </div>
                  <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors">
                    <input
                      type="checkbox"
                      checked={isFormal}
                      onChange={(e) => setIsFormal(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={cn("block h-4 w-8 rounded-full transition-colors", isFormal ? "bg-primary-600" : "bg-slate-200")}></div>
                    <div className={cn("absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform", isFormal ? "translate-x-4" : "translate-x-0")}></div>
                  </label>
                </div>

                {/* Versement (Acompte) switch */}
                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60">
                  <div>
                    <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <span>{t("sales.versement_acompte")}</span>
                      <kbd className="px-1.5 py-0.2 text-[9px] font-mono font-bold bg-white border border-slate-200 rounded text-slate-500">V</kbd>
                    </p>
                    <p className="text-2xs text-slate-500">
                      {t("sales.min_versement", { pct: storeSettings?.min_versement_pct ?? 30, dzd: formatDZD(total * (storeSettings?.min_versement_pct ?? 30) / 100) })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleVersementShortcut}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      isVersement ? "bg-amber-500" : "bg-slate-200"
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

                {/* Layaway (Réservation / Mise de côté) switch */}
                {storeSettings?.enable_layaway !== false && (
                  <div className="pt-2.5 border-t border-slate-200/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          <Bookmark size={13} className="text-indigo-600" />
                          <span>Mise de côté (Réservation)</span>
                        </p>
                        <p className="text-2xs text-slate-500">
                          Acompte min: {storeSettings?.min_layaway_deposit_pct ?? 20}% ({formatDZD(Math.ceil(total * (storeSettings?.min_layaway_deposit_pct ?? 20) / 100))} DZD) · Stock consigné
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !isLayaway;
                          setIsLayaway(next);
                          if (next) {
                            setIsVersement(false);
                            const minAmt = Math.ceil(total * (storeSettings?.min_layaway_deposit_pct ?? 20) / 100);
                            setPayments([{ method: "cash", amount: minAmt }]);
                          } else {
                            setPayments([{ method: "cash", amount: total }]);
                          }
                        }}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                          isLayaway ? "bg-indigo-600" : "bg-slate-200"
                        )}
                        role="switch"
                        aria-checked={isLayaway}
                      >
                        <span className={cn(
                          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform",
                          isLayaway ? "translate-x-4" : "translate-x-0"
                        )} />
                      </button>
                    </div>

                    {isLayaway && (
                      <div className="flex items-center gap-2 pl-4 text-2xs text-slate-600">
                        <span>Durée de réservation :</span>
                        {[3, 7, 14, 30].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setLayawayDurationDays(d)}
                            className={cn(
                              "px-2 py-0.5 rounded border font-mono transition-colors",
                              (layawayDurationDays ?? storeSettings?.layaway_duration_days ?? 7) === d
                                ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            {d}j
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Multiple payment methods */}
                <div className="pt-2.5 border-t border-slate-200/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Mode de règlement
                    </div>
                    {/* Quick payment pills */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPayments([{ method: "cash", amount: Math.max(0, total) }])}
                        className={cn(
                          "px-2 py-0.5 text-xs rounded-lg font-medium border transition-colors",
                          payments.length === 1 && payments[0].method === "cash"
                            ? "bg-emerald-600 text-white border-emerald-600 font-bold shadow-2xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        Espèces
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayments([{ method: "tpe", amount: Math.max(0, total) }])}
                        className={cn(
                          "px-2 py-0.5 text-xs rounded-lg font-medium border transition-colors flex items-center gap-1",
                          payments.length === 1 && payments[0].method === "tpe"
                            ? "bg-blue-600 text-white border-blue-600 font-bold shadow-2xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        )}
                        title="TPE (CIB / Edahabia)"
                      >
                        <CreditCard size={11} />
                        TPE
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayments([{ method: "baridimob", amount: Math.max(0, total) }])}
                        className={cn(
                          "px-2 py-0.5 text-xs rounded-lg font-medium border transition-colors flex items-center gap-1",
                          payments.length === 1 && payments[0].method === "baridimob"
                            ? "bg-amber-600 text-white border-amber-600 font-bold shadow-2xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        )}
                        title="BaridiMob"
                      >
                        <Smartphone size={11} />
                        BaridiMob
                      </button>
                    </div>
                  </div>
                  {payments.map((payment, i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={payment.method}
                          onChange={(e) =>
                            setPayments((prev) =>
                              prev.map((p, idx) =>
                                idx === i ? { ...p, method: e.target.value as PaymentLine["method"] } : p
                              )
                            )
                          }
                          className="form-input text-xs py-1.5 flex-1 rounded-xl"
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
                          className="w-24 px-2 py-1.5 text-xs border border-slate-200 rounded-xl font-mono text-end font-bold"
                          placeholder={formatDZD(total)}
                        />
                        <span className="text-2xs text-slate-400 font-mono">DZD</span>
                      </div>

                      {/* Inline Cheque Details when method === 'cheque' */}
                      {payment.method === "cheque" && (
                        <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={payment.chequeNumber || ""}
                            onChange={(e) =>
                              setPayments((prev) =>
                                prev.map((p, idx) =>
                                  idx === i ? { ...p, chequeNumber: e.target.value } : p
                                )
                              )
                            }
                            placeholder="N° Chèque *"
                            className="form-input h-8 text-2xs font-mono font-bold bg-white"
                          />
                          <input
                            type="text"
                            value={payment.chequeBank || ""}
                            onChange={(e) =>
                              setPayments((prev) =>
                                prev.map((p, idx) =>
                                  idx === i ? { ...p, chequeBank: e.target.value } : p
                                )
                              )
                            }
                            placeholder="Banque (ex: BNA, CPA...)"
                            className="form-input h-8 text-2xs bg-white"
                          />
                          <input
                            type="date"
                            value={payment.chequeDueDate || ""}
                            onChange={(e) =>
                              setPayments((prev) =>
                                prev.map((p, idx) =>
                                  idx === i ? { ...p, chequeDueDate: e.target.value } : p
                                )
                              )
                            }
                            title="Date d'échéance"
                            className="form-input h-8 text-2xs font-mono bg-white"
                          />
                        </div>
                      )}

                      {/* Cash Change Calculator (Monnaie à rendre) when method === 'cash' */}
                      {payment.method === "cash" && total > 0 && (
                        <div className="p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-200/80 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-2xs font-bold text-slate-600">Espèces reçues :</span>
                            <div className="flex items-center gap-1 flex-wrap">
                              {[500, 1000, 2000, 5000].map((bill) => (
                                <button
                                  key={bill}
                                  type="button"
                                  onClick={() =>
                                    setCashTendered(
                                      String((parseFloat(cashTendered) || 0) + bill),
                                    )
                                  }
                                  className="px-2 py-0.5 rounded-md bg-white hover:bg-emerald-100 border border-emerald-200 text-2xs font-mono font-bold text-emerald-800 cursor-pointer"
                                >
                                  +{bill}
                                </button>
                              ))}
                              <input
                                type="number"
                                value={cashTendered}
                                onChange={(e) => setCashTendered(e.target.value)}
                                placeholder={String(total)}
                                className="w-20 h-7 px-2 rounded-lg bg-white border border-slate-200 font-mono font-bold text-xs text-end"
                              />
                              {cashTendered && (
                                <button
                                  type="button"
                                  onClick={() => setCashTendered("")}
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                          {parseFloat(cashTendered) > total && (
                            <div className="flex items-center justify-between text-xs font-extrabold text-emerald-800 border-t border-emerald-200/70 pt-1.5">
                              <span>Monnaie à rendre :</span>
                              <span className="font-mono text-sm">
                                {formatDZD(parseFloat(cashTendered) - total)} DZD
                              </span>
                            </div>
                          )}
                        </div>
                      )}
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
                  "text-xs px-3 py-2 rounded-xl border font-semibold flex items-center justify-between",
                  belowMin ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                )}>
                  <span>Acompte minimum ({minPct}%): {formatDZD(Math.ceil(minAmt))} DZD</span>
                  <span>Solde: {formatDZD(Math.max(0, total - paymentTotal))} DZD</span>
                </div>
              );
            })()}

            {/* Layaway minimum warning & info */}
            {isLayaway && (() => {
              const minPct = storeSettings?.min_layaway_deposit_pct ?? 20;
              const minAmt = total * minPct / 100;
              const belowMin = paymentTotal < minAmt;
              const duration = layawayDurationDays ?? storeSettings?.layaway_duration_days ?? 7;
              return (
                <div className={cn(
                  "text-xs px-3 py-2.5 rounded-xl border font-medium space-y-1",
                  belowMin ? "bg-red-50 text-red-800 border-red-200" : "bg-indigo-50 text-indigo-900 border-indigo-200"
                )}>
                  <div className="flex items-center justify-between font-bold">
                    <span className="flex items-center gap-1.5">
                      <Bookmark size={13} className="text-indigo-600" />
                      Mise de côté ({minPct}% min): {formatDZD(Math.ceil(minAmt))} DZD
                    </span>
                    <span>Solde au retrait: {formatDZD(Math.max(0, total - paymentTotal))} DZD</span>
                  </div>
                  <div className="flex items-center justify-between text-2xs opacity-80">
                    <span>Conserve le stock en réserve sans le vendre</span>
                    <span>Expiration : J+{duration}</span>
                  </div>
                </div>
              );
            })()}

            {/* ── HIGH VISIBILITY GRAND TOTAL DISPLAY ── */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 text-white rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  {t("sales.total_to_pay", "Total à payer")}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-white font-mono text-[11px] font-bold">
                  {totalItems} {totalItems > 1 ? t("sales.articles_count", "articles") : t("sales.article_count", "article")}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2 my-1">
                <div className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-white">
                  {formatDZD(total)}
                </div>
                <div className="text-xl font-black font-mono text-primary-400">
                  DZD
                </div>
              </div>

              {(cartDiscount > 0 || redemptionDzd > 0 || timbreFiscal > 0) && (
                <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-1 text-2xs font-mono text-slate-300 font-medium">
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
              <div className="text-xs text-red-700 bg-red-50 px-3 py-2.5 rounded-xl border border-red-200 font-semibold">
                {getApiError(saleMutation.error)}
              </div>
            )}

            {/* ── Big Confirm Sale Button ── */}
            <button
              onClick={() => handleConfirmSale(false)}
              disabled={
                cart.length === 0 ||
                saleMutation.isPending ||
                (isVersement && paymentTotal < total * (storeSettings?.min_versement_pct ?? 30) / 100) ||
                (isLayaway && paymentTotal < total * (storeSettings?.min_layaway_deposit_pct ?? 20) / 100)
              }
              className={cn(
                "w-full py-4 px-5 rounded-2xl font-extrabold text-base tracking-wide flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] cursor-pointer",
                cart.length === 0
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                  : "bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white shadow-primary-500/25 hover:shadow-lg"
              )}
            >
              {saleMutation.isPending ? (
                <span>{t("common.processing")}</span>
              ) : isLayaway ? (
                <>
                  <BookmarkCheck size={20} className="stroke-[2.5]" />
                  <span>Valider la réservation ({formatDZD(paymentTotal)} DZD)</span>
                  <kbd className="ms-2 px-2 py-0.5 text-xs font-mono font-bold rounded-lg bg-white/20 text-white border border-white/30">
                    F10
                  </kbd>
                </>
              ) : isVersement ? (
                <>
                  <Check size={20} className="stroke-[2.5]" />
                  <span>{t("sales.versement_btn", { amount: formatDZD(paymentTotal) })}</span>
                  <kbd className="ms-2 px-2 py-0.5 text-xs font-mono font-bold rounded-lg bg-white/20 text-white border border-white/30">
                    F10 / .
                  </kbd>
                </>
              ) : (
                <>
                  <Check size={20} className="stroke-[2.5]" />
                  <span>{t("sales.confirm_sale")}</span>
                  <span className="font-mono text-white/90">— {formatDZD(total)} DZD</span>
                  <kbd className="ms-2 px-2 py-0.5 text-xs font-mono font-bold rounded-lg bg-white/20 text-white border border-white/30">
                    F10 / .
                  </kbd>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Negative Stock Warning Modal */}
      {negativeStockAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-amber-200">
            <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200/80">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                <AlertTriangle size={22} className="stroke-[2.5]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-text-primary text-base">
                  Vente en stock négatif
                </h3>
                <p className="text-xs text-amber-900">
                  Certains articles dépassent le stock actuellement disponible en rayon.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNegativeStockAlert(null)}
                className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-white/60 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-text-secondary leading-relaxed">
                Voulez-vous autoriser la validation de cette vente ? Les stocks suivants passeront en négatif dans l'inventaire :
              </p>

              <div className="max-h-60 overflow-y-auto space-y-2 border border-border/80 rounded-xl p-2.5 bg-slate-50">
                {negativeStockAlert.items.map(({ item, newStock }) => {
                  const sizeLabel = item.variant.size_eu && item.variant.size_eu > 0 ? `T.${item.variant.size_eu}` : null;
                  const colorLabel = item.variant.colour && item.variant.colour !== "N/A" ? item.variant.colour : null;
                  return (
                    <div
                      key={item.variant.id}
                      className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white border border-border/60 text-xs shadow-2xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-text-primary truncate">
                          {item.product.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-2xs text-text-muted mt-0.5">
                          {sizeLabel && (
                            <span className="font-mono font-bold px-1 rounded bg-slate-100 text-slate-700">
                              {sizeLabel}
                            </span>
                          )}
                          {colorLabel && <span>{colorLabel}</span>}
                          <span>• Qté demandée: <strong className="text-text-primary font-mono">{item.quantity}</strong></span>
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <div className="text-2xs text-text-muted">
                          Stock actuel : <span className="font-mono font-medium">{item.variant.stock_qty ?? 0}</span>
                        </div>
                        <div className="text-xs font-black font-mono text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 mt-0.5">
                          Nouveau: {newStock}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setNegativeStockAlert(null)}
                  className="btn-secondary px-4 py-2.5 text-xs font-semibold rounded-xl"
                >
                  Annuler <span className="opacity-60 text-2xs">(Échap)</span>
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    const qm = negativeStockAlert.quickMode;
                    setNegativeStockAlert(null);
                    executeSaleSubmission(qm);
                  }}
                  className="btn-primary bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 text-xs font-bold rounded-xl shadow-sm flex items-center gap-1.5"
                >
                  <Check size={15} className="stroke-[2.5]" />
                  <span>Confirmer la vente</span>
                  <span className="opacity-80 text-2xs font-mono">(Entrée / .)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Stock Exceeded Notification Toast */}
      {stockWarningToast && (
        <div className="fixed bottom-6 start-1/2 -translate-x-1/2 z-50 bg-rose-600 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-bold animate-in fade-in slide-in-from-bottom-2 duration-150">
          <AlertTriangle size={18} className="shrink-0 stroke-[2.5]" />
          <span>{stockWarningToast}</span>
        </div>
      )}

      {/* In-App Clear Cart Confirmation Modal (Prevents Win32 modal popup focus lock) */}
      {showClearCartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3 shadow-xs">
                <Trash2 size={24} />
              </div>
              <h3 className="font-extrabold text-slate-900 text-base mb-1">
                Vider le panier en cours ?
              </h3>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                Tous les articles ({totalItems}) ajoutés au panier seront retirés. Cette action est irréversible.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelClearCart}
                  className="btn-secondary flex-1 py-2.5 text-xs font-bold rounded-xl"
                >
                  Annuler <span className="opacity-60 text-2xs">(Échap)</span>
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={confirmClearCart}
                  className="btn-primary bg-red-600 hover:bg-red-700 text-white flex-1 py-2.5 text-xs font-bold rounded-xl shadow-xs"
                >
                  Vider <span className="opacity-80 text-2xs font-mono">(Entrée)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Open Cash Session Modal ── */}
      {showOpenSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Coins size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Ouvrir la session de caisse</h3>
                  <p className="text-2xs text-slate-500">Démarrer une nouvelle vacation / shift</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOpenSessionModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Fond de caisse initial (Espèces de départ)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={sessionOpeningFloat}
                    onChange={(e) => setSessionOpeningFloat(normalizeNumericInput(e.target.value))}
                    placeholder="0.00"
                    className="form-input text-base font-bold font-mono py-2.5 pl-3 pr-14 rounded-xl w-full"
                    autoFocus
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400">
                    DZD
                  </span>
                </div>
                {/* Presets */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[0, 2000, 5000, 10000, 20000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setSessionOpeningFloat(String(amt))}
                      className={cn(
                        "px-2.5 py-1 text-2xs font-bold rounded-lg border transition-colors",
                        sessionOpeningFloat === String(amt)
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      {amt === 0 ? "0 DZD" : `${amt.toLocaleString("fr-DZ")} DZD`}
                    </button>
                  ))}
                </div>
              </div>

              {openSessionMutation.isError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{getApiError(openSessionMutation.error)}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOpenSessionModal(false)}
                  className="btn-secondary flex-1 py-2.5 text-xs font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => openSessionMutation.mutate()}
                  disabled={openSessionMutation.isPending}
                  className="btn-primary flex-1 py-2.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-xs"
                >
                  {openSessionMutation.isPending ? "Ouverture..." : "Confirmer l'ouverture"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Versement Quick-Create Client Modal (Shortcut V) ── */}
      {showVersementClientModal && (
        <CreateClientModal
          prefillName=""
          subtitle="Créez ou sélectionnez un client pour activer le Versement"
          onCreated={activateVersementWithClient}
          onClose={() => setShowVersementClientModal(false)}
        />
      )}

      {/* ── Quick Petty Cash Movement Modal (Shortcut M) ── */}
      {showMovementModal && currentSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center",
                  movementType === "in" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                )}>
                  <ArrowDownUp size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Mouvement d'espèces</h3>
                  <p className="text-2xs text-slate-500">Session {currentSession.session_code}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowMovementModal(false); setMovementError(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const parsedAmount = parseFloat(normalizeNumericInput(movementAmount));
                if (!parsedAmount || parsedAmount <= 0) {
                  setMovementError("Veuillez saisir un montant valide.");
                  return;
                }
                movementMutation.mutate();
              }}
              className="p-6 space-y-4"
            >
              {/* Type Switcher */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setMovementType("out");
                    setMovementCategory("Dépense magasin");
                    movementAmountRef.current?.focus();
                  }}
                  className={cn(
                    "py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer",
                    movementType === "out" ? "bg-red-600 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <Minus size={13} />
                  <span>Dépense / Retrait (-)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMovementType("in");
                    setMovementCategory("Apport monnaie");
                    movementAmountRef.current?.focus();
                  }}
                  className={cn(
                    "py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer",
                    movementType === "in" ? "bg-emerald-600 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <Plus size={13} />
                  <span>Apport d'espèces (+)</span>
                </button>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Montant (DZD) *
                </label>
                <div className="relative">
                  <input
                    ref={movementAmountRef}
                    type="text"
                    inputMode="decimal"
                    value={movementAmount}
                    onChange={(e) => {
                      setMovementAmount(normalizeNumericInput(e.target.value));
                      if (movementError) setMovementError(null);
                    }}
                    onKeyDown={(e) => {
                      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                        const digit = extractDigitFromKeyEvent(e);
                        if (digit !== null && !/^[0-9]$/.test(e.key)) {
                          e.preventDefault();
                          setMovementAmount((prev) => `${prev}${digit}`);
                          if (movementError) setMovementError(null);
                        }
                      }
                    }}
                    placeholder="0.00"
                    className="form-input text-base font-bold font-mono py-2 pl-3 pr-14 rounded-xl w-full"
                    autoFocus
                  />
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400 pointer-events-none">
                    DZD
                  </span>
                </div>
                {/* Quick amount pills */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {[100, 200, 500, 1000, 2000, 5000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setMovementAmount((prev) => String((parseFloat(prev) || 0) + preset));
                        if (movementError) setMovementError(null);
                        movementAmountRef.current?.focus();
                      }}
                      className="px-2 py-1 text-2xs font-mono font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                    >
                      +{preset.toLocaleString("fr-DZ")}
                    </button>
                  ))}
                  {movementAmount && (
                    <button
                      type="button"
                      onClick={() => {
                        setMovementAmount("");
                        movementAmountRef.current?.focus();
                      }}
                      className="px-2 py-1 text-2xs font-bold rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors cursor-pointer ms-auto"
                    >
                      Effacer
                    </button>
                  )}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Motif / Catégorie *
                </label>
                <select
                  value={movementCategory}
                  onChange={(e) => setMovementCategory(e.target.value)}
                  className="form-input text-xs py-2 rounded-xl w-full"
                >
                  {movementType === "out" ? (
                    <>
                      <option value="Dépense magasin">Dépense magasin (café, transport, fournitures...)</option>
                      <option value="Paiement fournisseur">Paiement fournisseur direct</option>
                      <option value="Retrait patron / coffre">Retrait gérant / versement coffre</option>
                      <option value="Autre retrait">Autre dépense / retrait</option>
                    </>
                  ) : (
                    <>
                      <option value="Apport monnaie">Apport de monnaie (pièces / billets)</option>
                      <option value="Apport fond de caisse">Apport fond de caisse supplémentaire</option>
                      <option value="Remboursement prêt">Remboursement prêt ou avance</option>
                      <option value="Autre apport">Autre apport</option>
                    </>
                  )}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Observation / Détails (optionnel)
                </label>
                <input
                  type="text"
                  value={movementNotes}
                  onChange={(e) => setMovementNotes(e.target.value)}
                  placeholder="Ex : Achat papier ticket + café caissiers"
                  className="form-input text-xs py-2 rounded-xl w-full"
                />
              </div>

              {movementError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{movementError}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowMovementModal(false); setMovementError(null); }}
                  className="btn-secondary flex-1 py-2.5 text-xs font-bold rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={movementMutation.isPending}
                  className={cn(
                    "flex-1 py-2.5 text-xs font-bold rounded-xl text-white shadow-xs transition-colors",
                    movementType === "out" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                  )}
                >
                  {movementMutation.isPending ? "Enregistrement..." : "Enregistrer le mouvement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manager PIN Modal for Cashier Authorizations */}
      <ManagerPinModal
        isOpen={managerPinPrompt.isOpen}
        reason={managerPinPrompt.reason}
        actionDescription={managerPinPrompt.actionDescription}
        onSuccess={(pin) => {
          managerPinRef.current = pin;
          setManagerPinPrompt((prev) => ({ ...prev, isOpen: false }));
          executeSaleSubmission(managerPinPrompt.quickMode);
        }}
        onCancel={() => {
          setManagerPinPrompt((prev) => ({ ...prev, isOpen: false }));
        }}
      />
    </div>
  );
}
