/**
 * PurchaseOrderDetailPage — /purchase-orders/:id
 *
 * Displays PO details with lines. Allows:
 *   - Receive lines: POST /suppliers/purchase-orders/{id}/receive/
 *   - Update status: PATCH /suppliers/purchase-orders/{id}/update-status/
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle, AlertTriangle, X,
  Factory, Calendar, FileText, Truck, ChevronDown,
  Search, Plus, SkipForward, Download, MessageCircle,
} from "lucide-react";
import api, { formatDZD, formatDate, getApiError } from "@/lib/api";
import ColourPicker from "@/components/ui/ColourPicker";
import { getColourHex, getColourLabel } from "@/lib/colours";
import type { PurchaseOrder, POLine, POStatus } from "@/types";
import { cn } from "@/lib/utils";
import { CartonPanel, CartonConfig, DEFAULT_CARTON, getSizeRange, ProductResult } from "./components/CartonPanel";
import i18n from "@/lib/i18n";
const t = i18n.t.bind(i18n);

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<POStatus, string> = {
  draft: "badge-neutral",
  sent: "badge-info",
  partial: "badge-warning",
  received: "badge-success",
  cancelled: "badge",
};

const STATUS_LABEL: Record<POStatus, string> = {
  draft: t("supplier.draft"),
  sent: t("supplier.sent"),
  partial: t("supplier.partial"),
  received: t("supplier.received"),
  cancelled: t("supplier.cancelled"),
};

// Status transitions the user can manually trigger
const STATUS_TRANSITIONS: Partial<Record<POStatus, { to: POStatus; label: string; variant: string }[]>> = {
  draft: [
    { to: "sent", label: t("supplier.mark_as_sent"), variant: "btn-primary" },
    { to: "cancelled", label: t("supplier.cancel_order"), variant: "btn-secondary text-danger" },
  ],
  sent: [
    { to: "draft", label: t("supplier.revert_draft"), variant: "btn-secondary" },
    { to: "cancelled", label: t("supplier.cancel_order"), variant: "btn-secondary text-danger" },
  ],
  partial: [
    { to: "cancelled", label: t("supplier.cancel_order"), variant: "btn-secondary text-danger" },
  ],
};

// ── Receive form ──────────────────────────────────────────────────────────────

interface Discrepancy {
  line_id: number;
  description: string;
  ordered: number;
  received: number;
  shortage: number;
}

// ── Line resolution types ─────────────────────────────────────────────────────

interface VariantOption { id: number; label: string; }

type ResolutionMode = "link" | "create" | "skip";

interface NewVariantForm {
  product_name: string;
  brand: string;
  category: string;
  size_eu: string;
  colour: string;
  purchase_price: string;
  sale_price: string;
}

interface LineResolution {
  mode: ResolutionMode;
  variantId?: number;
  variantLabel?: string;
  newVariant?: NewVariantForm;
}

const EMPTY_NEW_VARIANT: NewVariantForm = {
  product_name: "", brand: "", category: "sneakers",
  size_eu: "", colour: "", purchase_price: "", sale_price: "",
};

const CATEGORIES = [
  { value: "sneakers", label: "Sneakers" },
  { value: "boots", label: "Boots" },
  { value: "sandals", label: "Sandales" },
  { value: "formal", label: "Chaussures formelles" },
  { value: "sport", label: "Sport" },
  { value: "kids", label: "Enfants" },
  { value: "slippers", label: "Chaussons" },
  { value: "other", label: "Autre" },
];

// ── Variant search dropdown ───────────────────────────────────────────────────

function VariantSearch({
  onSelect,
}: {
  onSelect: (v: VariantOption) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { data, isFetching } = useQuery<{ results: { id: number; product_name: string; size_eu: string; colour: string }[] }>({
    queryKey: ["variants-search", query],
    queryFn: () =>
      api.get(`/inventory/variants/?search=${encodeURIComponent(query)}&page_size=8`).then((r) => r.data),
    enabled: query.length >= 2,
  });

  const results = data?.results ?? [];

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          className="form-input pl-8 text-sm w-full"
          placeholder={t("supplier.search_item")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {isFetching && <div className="p-3 text-xs text-text-muted">Chargement…</div>}
          {!isFetching && results.length === 0 && (
            <div className="p-3 text-xs text-text-muted">Aucun résultat pour « {query} »</div>
          )}
          {results.map((v) => {
            const label = `${v.product_name} · EU${v.size_eu}${v.colour ? ` · ${v.colour}` : ""}`;
            return (
              <button
                key={v.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors"
                onMouseDown={() => { onSelect({ id: v.id, label }); setQuery(label); setOpen(false); }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Per-line resolution row ───────────────────────────────────────────────────

function LineResolutionRow({
  line,
  resolution,
  onChange,
}: {
  line: POLine;
  resolution: LineResolution | undefined;
  onChange: (r: LineResolution) => void;
}) {
  const { t } = useTranslation();
  const mode = resolution?.mode ?? "skip";

  return (
    <div className="border border-border rounded-lg p-3 space-y-2 bg-surface">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary truncate">{line.description}</span>
        <div className="flex gap-1 flex-shrink-0">
          {([["link", Search, t("supplier.link_variant")], ["create", Plus, t("supplier.create_variant")], ["skip", SkipForward, t("supplier.skip_variant")]] as const).map(
            ([m, Icon, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ mode: m as ResolutionMode, newVariant: EMPTY_NEW_VARIANT })}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${
                  mode === m
                    ? "bg-primary-600 text-white border-primary-600"
                    : "bg-white text-text-muted border-border hover:border-primary-400"
                }`}
              >
                <Icon size={11} />
                {label}
              </button>
            )
          )}
        </div>
      </div>

      {mode === "link" && (
        <VariantSearch
          onSelect={(v) => onChange({ mode: "link", variantId: v.id, variantLabel: v.label })}
        />
      )}

      {mode === "create" && (
        <div className="grid grid-cols-2 gap-2">
          {(["product_name", "brand", "size_eu", "purchase_price", "sale_price"] as const).map((field) => (
            <input
              key={field}
              type={field === "size_eu" || field.includes("price") ? "number" : "text"}
              placeholder={
                { product_name: t("supplier.product_name_req"), brand: t("supplier.brand"), size_eu: t("supplier.size_eu_req"), purchase_price: t("supplier.purchase_price_req"), sale_price: t("supplier.sale_price_req") }[field]
              }
              className="form-input text-xs py-1.5"
              value={(resolution?.newVariant as any)?.[field] ?? ""}
              onChange={(e) =>
                onChange({ mode: "create", newVariant: { ...EMPTY_NEW_VARIANT, ...resolution?.newVariant, [field]: e.target.value } })
              }
            />
          ))}
          <ColourPicker
            value={resolution?.newVariant?.colour ?? ""}
            onChange={(v) => onChange({ mode: "create", newVariant: { ...EMPTY_NEW_VARIANT, ...resolution?.newVariant, colour: v } })}
            placeholder={t("supplier.colour")}
            className="col-span-1"
          />
          <select
            className="form-input text-xs py-1.5 col-span-2"
            value={resolution?.newVariant?.category ?? "sneakers"}
            onChange={(e) =>
              onChange({
                mode: "create",
                newVariant: { ...EMPTY_NEW_VARIANT, ...resolution?.newVariant, category: e.target.value },
              })
            }
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      )}

      {mode === "skip" && (
        <p className="text-xs text-text-muted">{t("supplier.line_skip_desc")}</p>
      )}
    </div>
  );
}

// ── Product search (for carton mode) ─────────────────────────────────────────

// ── Main receive form ─────────────────────────────────────────────────────────

function ReceiveForm({ po, onSuccess }: { po: PurchaseOrder; onSuccess: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<number, number>>(
    Object.fromEntries(po.lines.map((l) => [l.id, l.quantity_received]))
  );
  const [blReference, setBlReference] = useState("");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);

  // Resolution state for lines that have no catalog variant linked
  const unlinkedLines = po.lines.filter((l) => !l.variant);
  const [resolutions, setResolutions] = useState<Record<number, LineResolution>>(() =>
    Object.fromEntries(unlinkedLines.map((l) => [l.id, { mode: "skip" as ResolutionMode }]))
  );

  // Carton mode — replaces LineResolutionRow for unlinked lines
  const [cartonMode, setCartonMode] = useState(false);
  const [cartonConfigs, setCartonConfigs] = useState<Record<number, CartonConfig>>(() =>
    Object.fromEntries(unlinkedLines.map((l) => [l.id, { ...DEFAULT_CARTON, product_name: l.description }]))
  );

  // Sync if po.lines change (refetch after successful mutation)
  useEffect(() => {
    setQuantities(Object.fromEntries(po.lines.map((l) => [l.id, l.quantity_received])));
  }, [po.lines.map((l) => `${l.id}:${l.quantity_received}`).join(",")]);

  const mutation = useMutation({
    mutationFn: () => {
      const lines = po.lines.map((l) => {
        const base = { id: l.id, quantity_received: quantities[l.id] ?? l.quantity_received };
        if (l.variant) return base; // already linked — no extra resolution needed

        // Carton mode: flatten 2-D (colour × size) matrix into carton_sizes
        if (cartonMode) {
          const cfg = cartonConfigs[l.id];
          if (!cfg) return base;
          const sizes = getSizeRange(cfg.size_from, cfg.size_to);
          const carton_sizes = cfg.colours.flatMap((colour) =>
            sizes
              .filter((s) => (cfg.quantities[colour]?.[s] ?? 0) > 0)
              .map((s) => ({
                size_eu: s,
                quantity: cfg.quantities[colour][s],
                new_variant: {
                  product_id: cfg.product_id ?? null,
                  product_name: cfg.product_name,
                  brand: cfg.brand,
                  category: cfg.category,
                  size_eu: s,
                  colour,
                  purchase_price: parseFloat(cfg.purchase_price) || 0,
                  sale_price: parseFloat(cfg.sale_price) || 0,
                },
              }))
          );
          const total = carton_sizes.reduce((sum, cs) => sum + cs.quantity, 0);
          return { id: l.id, quantity_received: total, carton_sizes };
        }

        // Standard mode: single variant resolution
        const res = resolutions[l.id];
        if (res?.mode === "link" && res.variantId)
          return { ...base, variant_id: res.variantId };
        if (res?.mode === "create" && res.newVariant)
          return {
            ...base,
            new_variant: {
              ...res.newVariant,
              purchase_price: parseFloat(res.newVariant.purchase_price) || 0,
              sale_price: parseFloat(res.newVariant.sale_price) || 0,
            },
          };
        return base; // skip
      });
      return api.post(`/suppliers/purchase-orders/${po.id}/receive/`, {
        lines,
        bl_reference: blReference.trim(),
      }).then((r) => r.data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order", po.id] });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      if (data.discrepancies?.length) {
        setDiscrepancies(data.discrepancies);
      } else {
        setOk(true);
        setTimeout(() => { setOk(false); onSuccess(); }, 1200);
      }
    },
    onError: (err) => setErrMsg(getApiError(err)),
  });

  const canReceive = po.status !== "cancelled" && po.status !== "received";

  // Partial reception detection — used to show confirmation popup
  const [showPartialConfirm, setShowPartialConfirm] = useState(false);

  function handleConfirmClick() {
    const wouldBePartial = po.lines.some((l) => {
      const received = quantities[l.id] ?? l.quantity_received;
      return received < l.quantity_ordered;
    });
    if (wouldBePartial) {
      setShowPartialConfirm(true);
    } else {
      mutation.mutate();
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck size={15} className="text-primary-500" />
          <h3 className="font-semibold text-text-primary">{t("supplier.order_lines")}</h3>
        </div>
        {canReceive && (
          <span className="text-xs text-text-muted">Saisissez les quantités reçues puis confirmez</span>
        )}
      </div>

      {errMsg && (
        <div className="mx-5 mt-4 flex items-center gap-2 px-3 py-2 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
          <AlertTriangle size={13} />
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setErrMsg(null)}><X size={13} /></button>
        </div>
      )}

      {ok && (
        <div className="mx-5 mt-4 flex items-center gap-2 px-3 py-2 bg-success/10 border border-success/30 rounded-lg text-sm text-success">
          <CheckCircle size={13} /> Réception enregistrée — stock mis à jour automatiquement.
        </div>
      )}

      {discrepancies.length > 0 && (
        <div className="mx-5 mt-4 space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-sm text-warning font-medium">
            <AlertTriangle size={13} />
            {discrepancies.length} écart{discrepancies.length > 1 ? "s" : ""} détecté{discrepancies.length > 1 ? "s" : ""} — stock mis à jour avec les quantités reçues.
          </div>
          <div className="border border-warning/30 rounded-lg overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-warning/5">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-text-muted">Article</th>
                  <th className="text-center px-3 py-2 font-semibold text-text-muted">{t("supplier.ordered")}</th>
                  <th className="text-center px-3 py-2 font-semibold text-text-muted">{t("supplier.received")}</th>
                  <th className="text-center px-3 py-2 font-semibold text-warning">Manquant</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map((d) => (
                  <tr key={d.line_id} className="border-t border-warning/20">
                    <td className="px-3 py-1.5 text-text-primary">{d.description}</td>
                    <td className="px-3 py-1.5 text-center font-mono">{d.ordered}</td>
                    <td className="px-3 py-1.5 text-center font-mono">{d.received}</td>
                    <td className="px-3 py-1.5 text-center font-mono font-bold text-warning">-{d.shortage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn-secondary btn-sm w-full"
            onClick={() => { setDiscrepancies([]); onSuccess(); }}
          >
            Fermer
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("supplier.description")}</th>
              <th className="text-center">{t("supplier.ordered")}</th>
              <th className="text-center">{t("supplier.received")}</th>
              <th className="text-end">Prix unit.</th>
              <th className="text-end">Total ligne</th>
              <th className="text-center">{t("supplier.status")}</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((line) => {
              const qtyReceived = quantities[line.id] ?? line.quantity_received;
              const isDone = qtyReceived >= line.quantity_ordered;
              return (
                <tr key={line.id}>
                  <td className="font-medium">{line.description}</td>
                  <td className="text-center font-mono text-sm">{line.quantity_ordered}</td>
                  <td className="text-center">
                    {canReceive ? (
                      <input
                        type="number"
                        value={qtyReceived}
                        min={0}
                        max={line.quantity_ordered}
                        onChange={(e) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [line.id]: Math.min(
                              parseInt(e.target.value) || 0,
                              line.quantity_ordered
                            ),
                          }))
                        }
                        className="form-input py-1 text-sm text-center w-20 mx-auto font-mono"
                      />
                    ) : (
                      <span className="font-mono text-sm">{line.quantity_received}</span>
                    )}
                  </td>
                  <td className="text-end font-mono text-sm text-text-muted">
                    {formatDZD(line.agreed_unit_price)} DZD
                  </td>
                  <td className="text-end font-mono text-sm">
                    {formatDZD(line.line_total)} DZD
                  </td>
                  <td className="text-center">
                    {isDone ? (
                      <span className="badge badge-success text-xs">{t("supplier.received")}</span>
                    ) : qtyReceived > 0 ? (
                      <span className="badge badge-warning text-xs">Partiel</span>
                    ) : (
                      <span className="badge badge-neutral text-xs">En attente</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canReceive && (
        <div className="card-body border-t border-border space-y-4">
          {/* Resolution panel for unlinked lines */}
          {unlinkedLines.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  {unlinkedLines.length} ligne{unlinkedLines.length > 1 ? "s" : ""} sans article catalogue
                </p>
                <button
                  type="button"
                  onClick={() => setCartonMode((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    cartonMode
                      ? "bg-primary-600 text-white border-primary-600"
                      : "border-border text-text-muted hover:border-primary-400"
                  }`}
                >
                  📦 Mode carton
                </button>
              </div>

              {cartonMode
                ? unlinkedLines.map((line) => (
                    <CartonPanel
                      key={line.id}
                      line={line}
                      config={cartonConfigs[line.id] ?? { ...DEFAULT_CARTON, product_name: line.description }}
                      onChange={(cfg) => setCartonConfigs((prev) => ({ ...prev, [line.id]: cfg }))}
                    />
                  ))
                : unlinkedLines.map((line) => (
                    <LineResolutionRow
                      key={line.id}
                      line={line}
                      resolution={resolutions[line.id]}
                      onChange={(r) => setResolutions((prev) => ({ ...prev, [line.id]: r }))}
                    />
                  ))}
            </div>
          )}

          {/* BL reference + confirm */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-text-secondary whitespace-nowrap">
              N° BL fournisseur
            </label>
            <input
              type="text"
              value={blReference}
              onChange={(e) => setBlReference(e.target.value)}
              placeholder="Référence bon de livraison (optionnel)"
              className="form-input flex-1 text-sm"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleConfirmClick}
              disabled={mutation.isPending}
              className="btn-primary"
            >
              {mutation.isPending
                ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
                : <><CheckCircle size={14} /> Confirmer la réception</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Partial reception confirmation dialog */}
      {showPartialConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-warning" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">Réception partielle</h3>
                <p className="text-sm text-text-muted mt-1">
                  Certaines lignes ont une quantité reçue inférieure à la quantité commandée.
                  La commande passera en statut <strong>Partiel</strong>.
                  Le stock sera mis à jour uniquement pour les quantités reçues.
                </p>
              </div>
            </div>

            <div className="border border-border rounded-lg overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-surface">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Article</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-text-muted">{t("supplier.ordered")}</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-warning">{t("supplier.received")}</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines
                    .filter((l) => (quantities[l.id] ?? l.quantity_received) < l.quantity_ordered)
                    .map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="px-3 py-2 text-text-primary">{l.description}</td>
                        <td className="px-3 py-2 text-center font-mono">{l.quantity_ordered}</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold text-warning">
                          {quantities[l.id] ?? l.quantity_received}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                className="btn-secondary"
                onClick={() => setShowPartialConfirm(false)}
              >
                Modifier les quantités
              </button>
              <button
                className="btn-primary"
                onClick={() => { setShowPartialConfirm(false); mutation.mutate(); }}
              >
                Confirmer quand même
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Status action menu ────────────────────────────────────────────────────────

function StatusActions({ po }: { po: PurchaseOrder }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const transitions = STATUS_TRANSITIONS[po.status] ?? [];

  const mutation = useMutation({
    mutationFn: (newStatus: POStatus) =>
      api.patch(`/suppliers/purchase-orders/${po.id}/update-status/`, { status: newStatus }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order", po.id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setOpen(false);
    },
    onError: (err) => setErrMsg(getApiError(err)),
  });

  if (transitions.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-secondary flex items-center gap-1.5"
      >
        Changer statut
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute end-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg min-w-[200px] overflow-hidden">
          {errMsg && (
            <div className="px-3 py-2 text-xs text-danger">{errMsg}</div>
          )}
          {transitions.map((t) => (
            <button
              key={t.to}
              onClick={() => mutation.mutate(t.to)}
              disabled={mutation.isPending}
              className={cn(
                "w-full text-start px-4 py-2.5 text-sm hover:bg-surface transition-colors",
                t.to === "cancelled" ? "text-danger" : "text-text-primary"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PDF + WhatsApp share ──────────────────────────────────────────────────────

function PoShareActions({ po }: { po: PurchaseOrder }) {
  const [loadingPdf, setLoadingPdf] = useState(false);

  async function openPdf() {
    setLoadingPdf(true);
    try {
      const res = await api.get(`/suppliers/purchase-orders/${po.id}/pdf/`, { responseType: "blob" });
      const blob = new Blob([res.data as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!tab) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `commande-${po.reference || po.id}.pdf`;
        a.click();
      }
    } finally {
      setLoadingPdf(false);
    }
  }

  function shareWhatsApp() {
    const lines = po.lines
      .map((l, i) => `  ${i + 1}. ${l.description} × ${l.quantity_ordered} — ${formatDZD(l.agreed_unit_price)} DZD`)
      .join("\n");
    const msg =
      `*Bon de Commande — ${po.supplier_name}*\n` +
      `BC #${po.id}${po.reference ? ` · Réf. ${po.reference}` : ""}\n` +
      (po.expected_date ? `Livraison souhaitée : ${formatDate(po.expected_date)}\n` : "") +
      `\nArticles :\n${lines}\n\n` +
      `*Total : ${formatDZD(po.total_amount)} DZD*\n\n` +
      (po.notes ? `Notes : ${po.notes}\n\n` : "") +
      `Merci de confirmer la disponibilité.`;

    const phone = po.supplier_phone?.replace(/\D/g, "") ?? "";
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={openPdf}
        disabled={loadingPdf}
        className="btn-secondary btn-sm flex items-center gap-1.5"
        title={t("invoice.download_pdf")}
      >
        {loadingPdf
          ? <Loader2 size={14} className="animate-spin" />
          : <Download size={14} />
        }
        PDF
      </button>
      <button
        onClick={shareWhatsApp}
        className="btn-secondary btn-sm flex items-center gap-1.5 text-[#25D366]"
        title="Partager sur WhatsApp"
      >
        <MessageCircle size={14} />
        WhatsApp
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const poId = Number(id);

  const { data: po, isLoading, isError } = useQuery<PurchaseOrder>({
    queryKey: ["purchase-order", poId],
    queryFn: () => api.get(`/suppliers/purchase-orders/${poId}/`).then((r) => r.data),
    enabled: !isNaN(poId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">{t("common.loading")}</span>
      </div>
    );
  }

  if (isError || !po) {
    return (
      <div className="card px-6 py-10 text-center space-y-3">
        <AlertCircle size={32} className="text-danger mx-auto" />
        <p className="font-semibold text-text-primary">Commande introuvable</p>
        <button onClick={() => navigate("/purchase-orders")} className="btn-secondary">
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/purchase-orders")}
            className="btn-ghost btn-sm text-text-muted hover:text-text-primary"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-text-primary">
                Commande #{po.id}
              </h1>
              <span className={cn("badge", STATUS_BADGE[po.status])}>
                {STATUS_LABEL[po.status]}
              </span>
            </div>
            <p className="text-sm text-text-muted mt-0.5">
              {formatDate(po.created_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PoShareActions po={po} />
          <StatusActions po={po} />
        </div>
      </div>

      {/* Info row */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <Factory size={16} className="text-primary-500 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-text-muted">Fournisseur</div>
            <Link
              to={`/suppliers/${po.supplier}`}
              className="text-sm font-semibold text-primary-600 hover:underline truncate block"
            >
              {po.supplier_name}
            </Link>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <FileText size={16} className="text-primary-500 flex-shrink-0" />
          <div>
            <div className="text-xs text-text-muted">{t("supplier.reference")}</div>
            <div className="text-sm font-medium font-mono">{po.reference || "—"}</div>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <Calendar size={16} className="text-primary-500 flex-shrink-0" />
          <div>
            <div className="text-xs text-text-muted">Livraison attendue</div>
            <div className="text-sm font-medium">
              {po.expected_date ? formatDate(po.expected_date) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {po.notes && (
        <div className="card p-4">
          <p className="text-xs text-text-muted mb-1">{t("common.notes")}</p>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{po.notes}</p>
        </div>
      )}

      {/* Lines */}
      {po.lines.length > 0 ? (
        <ReceiveForm
          po={po}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] })}
        />
      ) : (
        <div className="card px-6 py-8 text-center text-text-muted text-sm">
          Aucune ligne dans cette commande.
        </div>
      )}

      {/* Total */}
      <div className="flex justify-end">
        <div className="card p-4 flex items-center gap-6">
          <span className="text-sm text-text-muted">Total commande</span>
          <span className="text-xl font-bold font-mono text-text-primary">
            {formatDZD(po.total_amount)}{" "}
            <span className="text-sm font-normal text-text-muted">DZD</span>
          </span>
        </div>
      </div>
    </div>
  );
}
