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
    if (!name.trim()) { setError("Le nom est obligatoire."); return; }
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
          <h3 className="font-semibold text-text-primary">Nouveau client</h3>
          <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-3">
          {error && (
            <div className="text-xs text-danger bg-danger-light rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <label className="form-label">Nom <span className="text-danger">*</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
              placeholder="Nom complet"
              autoFocus
            />
          </div>
          <div>
            <label className="form-label">Téléphone</label>
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
              {mutation.isPending ? "Création…" : "Créer et sélectionner"}
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
            placeholder="Rechercher un client (nom, téléphone)…"
            className="flex-1 text-sm outline-none bg-transparent text-text-primary placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex-shrink-0 text-xs flex items-center gap-1 text-primary-500 hover:text-primary-700 font-medium"
            title="Créer un nouveau client"
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
                  Créer "{search}"
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => { setShowCreate(true); setOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-3 text-left text-primary-600 hover:bg-primary-50 transition-colors text-sm font-medium"
              >
                <UserPlus size={14} />
                Créer le client "{search}"
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
  const [scanStatus, setScanStatus] = useState<"idle" | "found" | "not_found">("idle");

  // Keep a ref so addToCart (useCallback) can read current cart without stale closure
  const cartRef = useRef<CartItem[]>([]);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  const { user } = useAuth();
  const { currentBranch } = useBranch();
  const { canAccess } = usePlan();
  const hasLoyalty = canAccess("pro_retail");

  // F2 / F10 keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F10") { e.preventDefault(); handleConfirmSale(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Product search
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
  const total = Math.max(0, itemsTotal - cartDiscount - redemptionDzd);
  const paymentTotal = payments.reduce((s, p) => s + p.amount, 0);

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

  // Sale mutation
  const saleMutation = useMutation({
    mutationFn: () => {
      const effectivePayments = payments.filter((p: PaymentLine) => p.amount > 0);
      const paymentLines: PaymentLine[] = effectivePayments.length > 0
        ? effectivePayments
        : [{ method: "cash", amount: Math.max(0, total) }];

      return api.post("/sales/", {
        branch: currentBranch?.id ?? null,
        client_id: selectedClient?.id ?? null,
        redeem_points: redeemPoints,
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
  });

  function handleConfirmSale() {
    if (cart.length === 0) return;
    saleMutation.mutate();
  }

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
          api.get(`/inventory/variants/?barcode=${encodeURIComponent(code)}`).then((r) => {
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
          <h2 className="text-xl font-bold text-text-primary mb-2">Versement enregistre!</h2>
          <p className="text-text-muted text-sm mb-1">Recu: <strong>{receipt.receipt_number}</strong></p>
          {receipt.client_name && (
            <p className="text-text-muted text-sm mb-1">Client: <strong>{receipt.client_name}</strong></p>
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
        <h2 className="text-xl font-bold text-text-primary mb-2">Vente confirmee!</h2>
        <p className="text-text-muted text-sm mb-3">Recu: <strong>{receipt.receipt_number}</strong></p>

        {(ptsEarned > 0 || ptsRedeemed > 0) && (
          <div className="mb-4 rounded-xl bg-primary-50 border border-primary-100 p-3 text-sm">
            {ptsRedeemed > 0 && (
              <p className="text-primary-700">
                <Gift size={14} className="inline mr-1" />
                {ptsRedeemed} points rachetes (−{redemptionDzd} DZD)
              </p>
            )}
            {ptsEarned > 0 && (
              <p className="text-success font-semibold mt-1">
                +{ptsEarned} points de fidelite gagnes
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
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* Left: Product Search */}
      <div className="w-full lg:w-1/2 xl:w-3/5 flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("nav.new_sale")}</h1>
          <p className="text-xs text-text-muted">F2 = rechercher · F10 = confirmer · scanner code-barres partout</p>
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
          {scanStatus !== "idle" && (
            <div
              className={cn(
                "absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full pointer-events-none",
                scanStatus === "found" && "bg-success-light text-success",
                scanStatus === "not_found" && "bg-danger-light text-danger",
              )}
            >
              {scanStatus === "found" ? (
                <><Check size={11} /> Ajouté</>
              ) : (
                <><X size={11} /> Introuvable</>
              )}
            </div>
          )}
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

          {/* Client selector */}
          <div className="px-4 py-3 border-b border-border">
            <ClientSelector
              selected={selectedClient}
              onSelect={(c) => { setSelectedClient(c); setRedeemPoints(0); }}
              onClear={() => { setSelectedClient(null); setRedeemPoints(0); }}
            />

            {/* Loyalty account info */}
            {loyaltyAccount && loyaltyProgram?.is_active && (
              <div className="mt-2.5 flex items-center gap-2">
                {(() => {
                  const TierIcon = TIER_ICON[loyaltyAccount.tier];
                  return (
                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold", TIER_COLOUR[loyaltyAccount.tier])}>
                      <TierIcon size={11} />
                      {loyaltyAccount.tier_display}
                    </span>
                  );
                })()}
                <span className="text-xs text-text-muted">
                  <strong className="text-text-primary">{loyaltyAccount.points_balance.toLocaleString()}</strong> pts disponibles
                </span>

                {canRedeem && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <Gift size={13} className="text-primary-500" />
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
                      className="w-20 px-2 py-1 text-xs border border-border rounded text-center font-mono"
                    />
                    {redeemPoints > 0 && (
                      <span className="text-xs text-primary-600 font-medium whitespace-nowrap">
                        = −{redemptionDzd} DZD
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart items */}
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
                      {item.promoName && (
                        <span className="flex items-center gap-0.5 text-2xs text-success font-semibold bg-success/10 px-1.5 py-0.5 rounded-full">
                          <Tag size={9} />
                          {item.promoName}
                        </span>
                      )}
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
                  {item.discount > 0 && (
                    <span className="line-through text-text-muted text-xs me-1">
                      {formatDZD(item.unit_price * item.quantity)}
                    </span>
                  )}
                  = {formatDZD(item.unit_price * item.quantity - item.discount)} DZD
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

            {/* Redemption row */}
            {redemptionDzd > 0 && (
              <div className="flex items-center gap-2 text-primary-600">
                <Gift size={13} />
                <span className="text-sm flex-1">Remise fidélité ({redeemPoints} pts)</span>
                <span className="text-sm font-mono font-medium">−{formatDZD(redemptionDzd)} DZD</span>
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between py-2 border-t border-border">
              <span className="font-semibold">{t("sales.total")}</span>
              <span className="text-xl font-bold font-mono text-primary-500">
                {formatDZD(total)} DZD
              </span>
            </div>

            {/* Versement toggle */}
            <div className={cn(
              "flex items-center justify-between py-1.5 border rounded-lg px-3",
              storeSettings?.versement_requires_client && !selectedClient ? "opacity-50" : ""
            )}>
              <div>
                <p className="text-sm font-medium text-text-primary">Versement (acompte)</p>
                <p className="text-xs text-text-muted">
                  Min. {storeSettings?.min_versement_pct ?? 30}% = {formatDZD(total * (storeSettings?.min_versement_pct ?? 30) / 100)} DZD
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
                  "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  isVersement ? "bg-warning" : "bg-border",
                  storeSettings?.versement_requires_client && !selectedClient ? "cursor-not-allowed" : ""
                )}
                role="switch"
                aria-checked={isVersement}
                title={storeSettings?.versement_requires_client && !selectedClient ? "Selectionnez un client pour activer le versement" : ""}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform",
                  isVersement ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
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

            {/* Versement minimum warning */}
            {isVersement && (() => {
              const minPct = storeSettings?.min_versement_pct ?? 30;
              const minAmt = total * minPct / 100;
              const belowMin = paymentTotal < minAmt;
              return (
                <div className={cn(
                  "text-xs px-2 py-1.5 rounded",
                  belowMin ? "bg-danger-light text-danger" : "bg-success/10 text-success"
                )}>
                  {belowMin
                    ? `Acompte minimum: ${formatDZD(Math.ceil(minAmt))} DZD`
                    : `Solde restant: ${formatDZD(total - paymentTotal)} DZD`
                  }
                </div>
              );
            })()}

            {/* Confirm */}
            {saleMutation.isError && (
              <div className="text-xs text-danger bg-danger-light px-2 py-1.5 rounded">
                {getApiError(saleMutation.error)}
              </div>
            )}

            <button
              onClick={handleConfirmSale}
              disabled={
                cart.length === 0 ||
                saleMutation.isPending ||
                (isVersement && paymentTotal < total * (storeSettings?.min_versement_pct ?? 30) / 100)
              }
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {saleMutation.isPending ? (
                "Traitement..."
              ) : isVersement ? (
                <>
                  <Check size={18} />
                  Versement — {formatDZD(paymentTotal)} DZD
                </>
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
