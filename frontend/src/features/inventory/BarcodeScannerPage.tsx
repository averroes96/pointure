/**
 * BarcodeScannerPage — /inventory/scanner
 *
 * Quick stock-lookup by barcode. Works with USB/Bluetooth HID scanners
 * (they emulate a keyboard and send Enter after the code) and manual input.
 */
import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ScanBarcode, Search, Loader2, AlertTriangle, X,
  Package, Layers, ShoppingBag, ArrowUpRight,
} from "lucide-react";
import api, { formatDZD } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ScanResult {
  variant: {
    id: number;
    barcode: string;
    size_eu: number;
    colour: string;
    stock_qty: number;
    alert_threshold: number;
    is_low_stock: boolean;
    is_out_of_stock: boolean;
  };
  product: {
    id: number;
    name: string;
    brand: string;
    category: string;
    sale_price: string;
    purchase_price?: string;
  };
  stock_by_branch: Array<{
    branch_id: number;
    branch_name: string;
    stock_qty: number;
  }>;
}

export default function BarcodeScannerPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-focus so a HID scanner works immediately on page load
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function lookup(barcode: string) {
    const code = barcode.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.get(`/mobile/scan/?barcode=${encodeURIComponent(code)}`);
      setResult(res.data as ScanResult);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setError(`Aucun article trouvé pour le code-barres « ${code} ».`);
      } else {
        setError("Erreur de connexion. Vérifiez votre réseau.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") lookup(query);
  }

  function reset() {
    setQuery("");
    setResult(null);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const v = result?.variant;
  const p = result?.product;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
          <ScanBarcode size={20} />
          Scanner code-barres
        </h1>
        <p className="text-sm text-text-muted">
          Scannez ou saisissez un code-barres pour consulter le stock en temps réel.
        </p>
      </div>

      {/* Search bar */}
      <div className="card p-4 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="form-input ps-9 font-mono"
              placeholder="Code-barres (scan ou saisie manuelle)…"
              autoComplete="off"
            />
          </div>
          <button
            onClick={() => lookup(query)}
            disabled={loading || !query.trim()}
            className="btn-primary"
          >
            {loading
              ? <Loader2 size={14} className="animate-spin" />
              : <Search size={14} />
            }
            {loading ? "…" : "Chercher"}
          </button>
          {(result || error) && (
            <button onClick={reset} className="btn-secondary" title="Effacer">
              <X size={14} />
            </button>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Appuyez sur{" "}
          <kbd className="px-1 py-0.5 rounded border border-border font-mono text-xs bg-surface">
            Entrée
          </kbd>{" "}
          ou utilisez un scanner USB/Bluetooth — la frappe est automatiquement capturée.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Result */}
      {result && v && p && (
        <div className="space-y-4">

          {/* Product header */}
          <div className="card p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package size={18} className="text-primary-500" />
                </div>
                <div>
                  <div className="font-bold text-text-primary text-base leading-tight">{p.name}</div>
                  <div className="text-sm text-text-muted">{p.brand}{p.category && ` · ${p.category}`}</div>
                </div>
              </div>
              <Link
                to={`/inventory/products/${p.id}`}
                className="btn-secondary btn-sm flex items-center gap-1 flex-shrink-0"
              >
                Voir fiche
                <ArrowUpRight size={13} />
              </Link>
            </div>

            {/* Variant detail grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface border border-border p-3">
                <div className="text-xs text-text-muted mb-1">Code-barres</div>
                <div className="font-mono text-sm text-text-primary break-all">{v.barcode}</div>
              </div>
              <div className="rounded-lg bg-surface border border-border p-3">
                <div className="text-xs text-text-muted mb-1">Pointure / Couleur</div>
                <div className="text-sm text-text-primary font-medium">
                  EU {v.size_eu}{v.colour ? ` · ${v.colour}` : ""}
                </div>
              </div>
              <div className="rounded-lg bg-surface border border-border p-3">
                <div className="text-xs text-text-muted mb-1">Prix de vente</div>
                <div className="font-mono font-bold text-text-primary">
                  {formatDZD(p.sale_price)} <span className="text-xs font-normal text-text-muted">DZD</span>
                </div>
              </div>
              {p.purchase_price && (
                <div className="rounded-lg bg-surface border border-border p-3">
                  <div className="text-xs text-text-muted mb-1">Prix d'achat</div>
                  <div className="font-mono text-text-primary">
                    {formatDZD(p.purchase_price)} <span className="text-xs text-text-muted">DZD</span>
                  </div>
                </div>
              )}
            </div>

            {/* Stock status */}
            <div className="flex items-center gap-2 flex-wrap">
              {v.is_out_of_stock ? (
                <span className="badge badge-danger">Rupture de stock</span>
              ) : v.is_low_stock ? (
                <span className="badge badge-warning">Stock bas</span>
              ) : (
                <span className="badge badge-success">En stock</span>
              )}
              <span className="text-sm text-text-muted">
                {v.stock_qty} unité{v.stock_qty !== 1 ? "s" : ""} au total
                {v.alert_threshold > 0 && ` · seuil d'alerte : ${v.alert_threshold}`}
              </span>
            </div>
          </div>

          {/* Stock by branch */}
          {result.stock_by_branch.length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-text-muted" />
                  <span className="font-semibold text-text-primary text-sm">Stock par agence</span>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agence</th>
                    <th className="text-end">Quantité</th>
                  </tr>
                </thead>
                <tbody>
                  {result.stock_by_branch.map((b) => (
                    <tr key={b.branch_id}>
                      <td className="text-text-primary">{b.branch_name}</td>
                      <td className={cn(
                        "text-end font-mono font-semibold",
                        b.stock_qty === 0
                          ? "text-danger"
                          : b.stock_qty <= v.alert_threshold
                            ? "text-warning"
                            : "text-success"
                      )}>
                        {b.stock_qty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Quick action: create PO when stock is critical */}
          {(v.is_low_stock || v.is_out_of_stock) && (
            <Link
              to="/purchase-orders/new"
              state={{
                lines: [{
                  description: `${p.name} — EU${v.size_eu}${v.colour ? ` / ${v.colour}` : ""}`,
                  quantity_ordered: String(Math.max(1, v.alert_threshold - v.stock_qty)),
                  agreed_unit_price: "",
                }],
              }}
              className="btn-secondary btn-sm inline-flex items-center gap-1"
            >
              <ShoppingBag size={13} />
              Commander ce produit
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
