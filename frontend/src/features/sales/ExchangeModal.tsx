/**
 * ExchangeModal — return-as-exchange for completed sales.
 * Customer returns one or more items from the original sale and receives
 * different items in exchange. Price difference is handled as:
 *   - new > returned  → customer pays the difference (chosen payment method)
 *   - returned > new  → store refunds the difference in cash
 *   - equal           → perfect swap, no money moves
 */
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Search, Plus, Trash2 } from "lucide-react";
import api, { formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import type { Sale, SaleItem, Variant, PaymentMethod } from "@/types";
import { cn } from "@/lib/utils";

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Espèces" },
  { value: "cheque", label: "Chèque" },
  { value: "ccp", label: "CCP" },
  { value: "virement", label: "Virement" },
  { value: "account", label: "Compte client" },
];

interface ReturnedItemState {
  item: SaleItem;
  selected: boolean;
  quantity: number;
}

interface NewItemState {
  variant_id: number;
  variant_str: string;
  quantity: number;
  unit_price: string;
}

export default function ExchangeModal({
  sale,
  onClose,
}: {
  sale: Sale;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  // ── Returned items state (from original sale) ──────────────────────────────
  const [returnedItems, setReturnedItems] = useState<ReturnedItemState[]>(
    (sale.items ?? []).map((item) => ({
      item,
      selected: false,
      quantity: item.quantity,
    }))
  );

  // ── New items state (searched + added) ─────────────────────────────────────
  const [newItems, setNewItems] = useState<NewItemState[]>([]);

  // ── Variant search ─────────────────────────────────────────────────────────
  const [variantSearch, setVariantSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(variantSearch), 300);
    return () => clearTimeout(t);
  }, [variantSearch]);

  const { data: searchData } = useQuery<PaginatedResponse<Variant>>({
    queryKey: ["variants-search", debouncedSearch],
    queryFn: () =>
      api
        .get(`/inventory/variants/?search=${encodeURIComponent(debouncedSearch)}&page_size=10`)
        .then((r) => r.data),
    enabled: debouncedSearch.length >= 2,
  });
  const searchResults = searchData?.results ?? [];

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Misc state ─────────────────────────────────────────────────────────────
  const [reason, setReason] = useState("");
  const [extraPaymentMethod, setExtraPaymentMethod] =
    useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);

  // ── Price calculations ─────────────────────────────────────────────────────
  const selectedReturned = returnedItems.filter((s) => s.selected);

  const returnedValue = selectedReturned.reduce(
    (sum, s) => sum + parseFloat(s.item.unit_price) * s.quantity,
    0
  );
  const newValue = newItems.reduce(
    (sum, i) => sum + parseFloat(i.unit_price) * i.quantity,
    0
  );
  const diff = newValue - returnedValue; // positive = customer pays

  // ── Mutation ───────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/sales/${sale.id}/exchange/`, {
        returned_items: selectedReturned.map((s) => ({
          variant_id: s.item.variant,
          quantity: s.quantity,
        })),
        new_items: newItems.map((i) => ({
          variant_id: i.variant_id,
          quantity: i.quantity,
          unit_price: parseFloat(i.unit_price).toFixed(2),
        })),
        reason,
        ...(diff > 0 ? { extra_payment_method: extraPaymentMethod } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
      queryClient.invalidateQueries({ queryKey: ["product-branch-stock"] });
      queryClient.invalidateQueries({ queryKey: ["variants"] });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      onClose();
    },
    onError: (err) => setError(getApiError(err)),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function updateReturned(index: number, patch: Partial<ReturnedItemState>) {
    setReturnedItems((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  }

  function addNewItem(variant: Variant) {
    setShowDropdown(false);
    setVariantSearch("");
    // If already in list, bump quantity
    const existing = newItems.findIndex((i) => i.variant_id === variant.id);
    if (existing >= 0) {
      setNewItems((prev) =>
        prev.map((i, idx) =>
          idx === existing ? { ...i, quantity: i.quantity + 1 } : i
        )
      );
      return;
    }
    setNewItems((prev) => [
      ...prev,
      {
        variant_id: variant.id,
        variant_str: `${variant.product_name} — EU ${variant.size_eu}${variant.colour ? ` ${variant.colour}` : ""}`,
        quantity: 1,
        unit_price: variant.product_sale_price,
      },
    ]);
  }

  function removeNewItem(index: number) {
    setNewItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateNewItem(
    index: number,
    patch: Partial<Pick<NewItemState, "quantity" | "unit_price">>
  ) {
    setNewItems((prev) =>
      prev.map((i, idx) => (idx === index ? { ...i, ...patch } : i))
    );
  }

  const canSubmit =
    selectedReturned.length > 0 &&
    newItems.length > 0 &&
    !mutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-text-primary">Traiter un échange</h2>
            <p className="text-xs text-text-muted">
              Reçu {sale.receipt_number || `#${sale.id}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost btn-sm text-text-muted"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* ── Grid: returned / new ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left — articles to return */}
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Articles à rendre
              </p>
              <div className="space-y-2">
                {returnedItems.map((s, i) => (
                  <div
                    key={s.item.id}
                    className={cn(
                      "border border-border rounded-lg p-3 transition-colors",
                      s.selected && "border-primary-300 bg-primary-50/30"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={s.selected}
                        onChange={(e) =>
                          updateReturned(i, { selected: e.target.checked })
                        }
                        className="mt-0.5 accent-primary-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-primary truncate">
                          {s.item.variant_str}
                        </div>
                        <div className="text-xs text-text-muted">
                          {s.item.quantity} × {formatDZD(s.item.unit_price)} DZD
                        </div>
                      </div>
                    </div>
                    {s.selected && (
                      <div className="mt-2 ms-7 flex items-center gap-2 text-xs">
                        <span className="text-text-muted">Qté :</span>
                        <input
                          type="number"
                          min={1}
                          max={s.item.quantity}
                          value={s.quantity}
                          onChange={(e) =>
                            updateReturned(i, {
                              quantity: Math.min(
                                Math.max(1, parseInt(e.target.value) || 1),
                                s.item.quantity
                              ),
                            })
                          }
                          className="w-16 px-2 py-1 border border-border rounded text-center font-mono"
                        />
                        <span className="text-text-muted">/ {s.item.quantity}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right — new items */}
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Nouveaux articles
              </p>

              {/* Variant search */}
              <div className="relative mb-3">
                <Search
                  size={14}
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={variantSearch}
                  onChange={(e) => {
                    setVariantSearch(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  className="form-input ps-8 text-sm"
                  placeholder="Rechercher un article…"
                />
                {showDropdown && searchResults.length > 0 && (
                  <div
                    ref={dropdownRef}
                    className="absolute z-10 top-full mt-1 w-full bg-white border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto"
                  >
                    {searchResults.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => addNewItem(v)}
                        className={cn(
                          "w-full text-start px-3 py-2 text-sm hover:bg-surface transition-colors",
                          v.is_out_of_stock && "opacity-50"
                        )}
                      >
                        <div className="font-medium text-text-primary">
                          {v.product_name}
                        </div>
                        <div className="text-xs text-text-muted flex items-center gap-2">
                          <span>EU {v.size_eu}</span>
                          {v.colour && <span>{v.colour}</span>}
                          <span
                            className={cn(
                              "font-mono",
                              v.is_out_of_stock
                                ? "text-danger"
                                : "text-success"
                            )}
                          >
                            stock: {v.stock_qty}
                          </span>
                          <span className="font-mono text-primary-600">
                            {formatDZD(v.product_sale_price)} DZD
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Added items list */}
              {newItems.length === 0 ? (
                <div className="text-xs text-text-muted text-center py-6 border border-dashed border-border rounded-lg">
                  Recherchez et sélectionnez les articles à donner au client.
                </div>
              ) : (
                <div className="space-y-2">
                  {newItems.map((item, i) => (
                    <div
                      key={item.variant_id}
                      className="border border-border rounded-lg p-3 bg-success/5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">
                          {item.variant_str}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeNewItem(i)}
                          className="text-text-muted hover:text-danger flex-shrink-0"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs">
                        <label className="flex items-center gap-1.5">
                          <span className="text-text-muted">Qté :</span>
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) =>
                              updateNewItem(i, {
                                quantity: Math.max(
                                  1,
                                  parseInt(e.target.value) || 1
                                ),
                              })
                            }
                            className="w-16 px-2 py-1 border border-border rounded text-center font-mono"
                          />
                        </label>
                        <label className="flex items-center gap-1.5 flex-1">
                          <span className="text-text-muted">P.U. :</span>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={item.unit_price}
                            onChange={(e) =>
                              updateNewItem(i, { unit_price: e.target.value })
                            }
                            className="w-28 px-2 py-1 border border-border rounded font-mono text-right"
                          />
                          <span className="text-text-muted">DZD</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Price summary ─────────────────────────────────────────────── */}
          {(selectedReturned.length > 0 || newItems.length > 0) && (
            <div className="rounded-lg bg-surface p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Valeur rendue</span>
                <span className="font-mono">{formatDZD(returnedValue)} DZD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Valeur nouveaux articles</span>
                <span className="font-mono">{formatDZD(newValue)} DZD</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>Différence</span>
                <span
                  className={cn(
                    "font-mono",
                    diff > 0
                      ? "text-danger"
                      : diff < 0
                      ? "text-success"
                      : "text-text-muted"
                  )}
                >
                  {diff > 0 ? "+" : ""}
                  {formatDZD(Math.abs(diff))} DZD
                </span>
              </div>
              {diff > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-text-muted text-xs">
                    À encaisser :
                  </span>
                  <select
                    value={extraPaymentMethod}
                    onChange={(e) =>
                      setExtraPaymentMethod(e.target.value as PaymentMethod)
                    }
                    className="form-input py-1 text-xs flex-1"
                  >
                    {PAYMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {diff < 0 && (
                <p className="text-xs text-success pt-1">
                  À rembourser en espèces : {formatDZD(Math.abs(diff))} DZD
                </p>
              )}
              {diff === 0 && selectedReturned.length > 0 && newItems.length > 0 && (
                <p className="text-xs text-text-muted pt-1">
                  Échange parfait — aucune différence de prix.
                </p>
              )}
            </div>
          )}

          {/* ── Reason ────────────────────────────────────────────────────── */}
          <div>
            <label className="form-label">Motif de l'échange (optionnel)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="form-input"
              placeholder="Ex : Pointure incorrecte, défaut…"
            />
          </div>

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error && (
            <div className="text-xs text-danger bg-danger-light rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            {selectedReturned.length} rendu{selectedReturned.length !== 1 ? "s" : ""}
            {newItems.length > 0 && (
              <> · {newItems.length} nouveau{newItems.length !== 1 ? "x" : ""}</>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="btn-secondary btn-sm"
              disabled={mutation.isPending}
            >
              Annuler
            </button>
            <button
              onClick={() => {
                setError(null);
                mutation.mutate();
              }}
              className="btn-primary btn-sm"
              disabled={!canSubmit}
            >
              {mutation.isPending ? "Traitement…" : "Confirmer l'échange"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
