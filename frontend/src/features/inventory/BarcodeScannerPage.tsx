/**
 * BarcodeScannerPage — /inventory/scanner
 *
 * Stock lookup by barcode. Works with:
 *  - Phone camera (BarcodeDetector API — Chrome 83+, Android, Edge)
 *  - USB/Bluetooth HID scanners (keyboard emulation)
 *  - Manual keyboard input
 */
import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ScanBarcode, Search, Loader2, AlertTriangle, X,
  Package, Layers, ShoppingBag, ArrowUpRight,
  Camera, CameraOff,
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

interface VariantSuggestion {
  id: number;
  barcode: string;
  product: number;
  product_name: string;
  product_brand?: string;
  product_reference?: string;
  product_sale_price: string;
  size_eu: number;
  colour: string;
  stock_qty: number;
  is_out_of_stock: boolean;
}

// BarcodeDetector is available in Chrome 83+, Edge 83+, Samsung Internet.
// Not available in Firefox or Safari. getUserMedia is needed for camera access.
const CAMERA_SUPPORTED =
  typeof window !== "undefined" &&
  "BarcodeDetector" in window &&
  "mediaDevices" in navigator &&
  typeof navigator.mediaDevices?.getUserMedia === "function";

export default function BarcodeScannerPage() {
  const { t } = useTranslation();
  const inputRef   = useRef<HTMLInputElement>(null);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const scanningRef  = useRef(false);
  const cooldownRef  = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detectorRef  = useRef<any>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const [query, setQuery]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<ScanResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError]   = useState<string | null>(null);
  const [lastCode, setLastCode]         = useState<string | null>(null);

  // Suggestions state
  const [suggestions, setSuggestions] = useState<VariantSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchingSuggestions, setSearchingSuggestions] = useState(false);

  // Auto-focus for HID scanners on desktop
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Stop camera on unmount
  useEffect(() => {
    return () => {
      scanningRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Debounced search for product name / reference / barcode suggestions
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingSuggestions(true);
      try {
        const res = await api.get(`/inventory/variants/?search=${encodeURIComponent(trimmed)}&page_size=8`);
        const items = res.data?.results ?? (Array.isArray(res.data) ? res.data : []);
        setSuggestions(items);
        setShowSuggestions(items.length > 0);
      } catch {
        // ignore errors on background suggestion lookup
      } finally {
        setSearchingSuggestions(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function lookup(barcodeOrRef: string, variantId?: number) {
    const code = barcodeOrRef.trim();
    if (!code && !variantId) return;
    setShowSuggestions(false);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams();
      if (code) params.set("barcode", code);
      if (variantId) params.set("variant_id", String(variantId));
      const res = await api.get(`/mobile/scan/?${params.toString()}`);
      setResult(res.data as ScanResult);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setError(`Aucun article trouvé pour « ${code} » (code-barres, référence ou nom).`);
      } else {
        setError("Erreur de connexion. Vérifiez votre réseau.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSelectSuggestion(item: VariantSuggestion) {
    setShowSuggestions(false);
    const displayQuery = item.barcode || item.product_reference || item.product_name;
    setQuery(displayQuery);
    lookup(displayQuery, item.id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setShowSuggestions(false);
      lookup(query);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  function reset() {
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    setResult(null);
    setError(null);
    setLastCode(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // ── Camera scanning ──────────────────────────────────────────────────────────

  async function startCamera() {
    setCameraError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detectorRef.current = new (window as any).BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      scanningRef.current = true;
      cooldownRef.current = false;
      setCameraActive(true);
      runScanLoop();
    } catch (err) {
      const msg = (err as Error)?.name ?? "";
      if (msg === "NotAllowedError") {
        setCameraError("Accès caméra refusé. Autorisez la caméra dans les paramètres du navigateur.");
      } else if (msg === "NotFoundError") {
        setCameraError("Aucune caméra détectée sur cet appareil.");
      } else {
        setCameraError("Impossible d'accéder à la caméra.");
      }
    }
  }

  function stopCamera() {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  // Scan loop: ~6fps detection, 2.5s cooldown after each hit
  async function runScanLoop() {
    while (scanningRef.current) {
      const video = videoRef.current;
      if (!cooldownRef.current && video && video.readyState >= 2) {
        try {
          const barcodes: Array<{ rawValue: string }> = await detectorRef.current.detect(video);
          if (barcodes.length && scanningRef.current) {
            const code = barcodes[0].rawValue;
            cooldownRef.current = true;
            setLastCode(code);
            setQuery(code);
            navigator.vibrate?.(60);
            lookup(code);
            await new Promise<void>((r) => setTimeout(r, 2500));
            cooldownRef.current = false;
          }
        } catch {
          // detection errors are transient (blurry frame, etc.) — ignore
        }
      }
      await new Promise<void>((r) => setTimeout(r, 150));
    }
  }

  const v = result?.variant;
  const p = result?.product;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
          <ScanBarcode size={20} />
          Scanner & Recherche Stock
        </h1>
        <p className="text-sm text-text-muted">
          Scannez un code-barres ou recherchez par <strong>nom</strong> ou <strong>référence</strong> pour consulter le stock en temps réel.
        </p>
      </div>

      {/* Input + camera toggle */}
      <div className="card p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              onKeyDown={handleKeyDown}
              className="form-input ps-9 pe-8 font-mono"
              placeholder="Scanner ou chercher par nom, référence ou code…"
              autoComplete="off"
              inputMode="text"
            />
            {searchingSuggestions && (
              <Loader2 size={13} className="animate-spin text-slate-400 absolute end-3 top-1/2 -translate-y-1/2" />
            )}

            {/* Suggestions Popover */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute top-full start-0 end-0 z-40 mt-1 max-h-80 overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 divide-y divide-slate-100"
              >
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-2xs font-semibold text-slate-400 uppercase tracking-wider">
                  Suggestions ({suggestions.length}) — cliquez pour sélectionner
                </div>
                {suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectSuggestion(item)}
                    className="w-full p-3 text-start hover:bg-slate-50 flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 text-sm truncate flex items-center gap-1.5">
                        {item.product_name}
                        {item.product_brand && (
                          <span className="text-xs text-slate-400 font-normal">· {item.product_brand}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 flex-wrap">
                        {item.product_reference && (
                          <span className="font-mono text-2xs bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-bold">
                            RÉF: {item.product_reference}
                          </span>
                        )}
                        <span className="font-medium text-slate-700">
                          {item.size_eu > 0 ? `EU ${item.size_eu}` : "Article"}
                          {item.colour && item.colour !== "N/A" && item.colour !== "Standard" ? ` · ${item.colour}` : ""}
                        </span>
                        {item.barcode && (
                          <span className="font-mono text-2xs text-slate-400">
                            {item.barcode}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-end flex-shrink-0">
                      <div className="font-mono font-bold text-sm text-slate-900 tabular-nums">
                        {formatDZD(item.product_sale_price)} <span className="text-2xs font-normal text-slate-400">DZD</span>
                      </div>
                      <div className="text-2xs font-medium mt-0.5">
                        {item.is_out_of_stock ? (
                          <span className="text-red-600 font-bold">Rupture (0)</span>
                        ) : (
                          <span className="text-emerald-600 font-bold">{item.stock_qty} en stock</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => lookup(query)}
            disabled={loading || !query.trim()}
            className="btn-primary"
          >
            {loading
              ? <Loader2 size={14} className="animate-spin" />
              : <Search size={14} />}
            {loading ? "…" : "Chercher"}
          </button>
          {(result || error) && (
            <button onClick={reset} className="btn-secondary" title="Effacer">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Camera button */}
        {CAMERA_SUPPORTED ? (
          <button
            onClick={cameraActive ? stopCamera : startCamera}
            className={cn(
              "btn-secondary w-full flex items-center justify-center gap-2",
              cameraActive && "bg-primary-50 border-primary-200 text-primary-700",
            )}
          >
            {cameraActive ? <CameraOff size={15} /> : <Camera size={15} />}
            {cameraActive ? "Arrêter la caméra" : "Scanner avec la caméra"}
          </button>
        ) : (
          <p className="text-xs text-text-muted">
            Caméra non disponible dans ce navigateur.
            Utilisez <strong>Chrome sur Android</strong> pour activer le scan caméra.
          </p>
        )}

        {!cameraActive && (
          <p className="text-xs text-text-muted">
            Appuyez sur{" "}
            <kbd className="px-1 py-0.5 rounded border border-border font-mono text-xs bg-surface">
              Entrée
            </kbd>{" "}
            ou utilisez un scanner USB/Bluetooth — la frappe est automatiquement capturée.
          </p>
        )}
      </div>

      {/* Camera feed (always in DOM when supported, hidden when inactive) */}
      {CAMERA_SUPPORTED && (
        <div className={cn("card overflow-hidden", !cameraActive && "hidden")}>
          <div className="relative bg-black">
            <video
              ref={videoRef}
              className="w-full aspect-video object-cover"
              muted
              playsInline
            />

            {/* Aim overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-56 h-36 border-2 border-white/50 rounded-lg relative">
                <span className="absolute -top-px -left-px w-5 h-5 border-t-2 border-l-2 border-white rounded-tl-lg" />
                <span className="absolute -top-px -right-px w-5 h-5 border-t-2 border-r-2 border-white rounded-tr-lg" />
                <span className="absolute -bottom-px -left-px w-5 h-5 border-b-2 border-l-2 border-white rounded-bl-lg" />
                <span className="absolute -bottom-px -right-px w-5 h-5 border-b-2 border-r-2 border-white rounded-br-lg" />
                {/* Scan line animation */}
                {cameraActive && (
                  <span
                    className="absolute left-0 right-0 h-0.5 bg-primary-400/80"
                    style={{ animation: "scanLine 2s ease-in-out infinite" }}
                  />
                )}
              </div>
            </div>

            {/* Last-scanned badge */}
            {lastCode && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                <span className="bg-success/90 text-white text-xs px-3 py-1 rounded-full font-mono backdrop-blur-sm">
                  ✓ {lastCode}
                </span>
              </div>
            )}
          </div>
          <p className="px-4 py-2 text-xs text-text-muted text-center">
            Pointez la caméra vers le code-barres — détection automatique
          </p>
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {cameraError}
        </div>
      )}

      {/* Lookup error */}
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
                  <div className="text-sm text-text-muted">
                    {p.brand}
                    {p.category && `${p.brand ? " · " : ""}${t(`category.${p.category}`, p.category)}`}
                  </div>
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
                <div className="text-xs text-text-muted mb-1">{v.size_eu > 0 ? "Pointure / Couleur" : "Déclinaison"}</div>
                <div className="text-sm text-text-primary font-medium">
                  {v.size_eu > 0
                    ? `EU ${v.size_eu}${v.colour ? ` · ${v.colour === "N/A" ? t("common.na") : v.colour}` : ""}`
                    : v.colour && v.colour !== "N/A" && v.colour !== "Standard"
                    ? v.colour
                    : "Standard"}
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
                    <th className="text-end">{t("sales.qty")}</th>
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
                            : "text-success",
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
                  description: v.size_eu > 0
                    ? `${p.name} — EU${v.size_eu}${v.colour && v.colour !== "N/A" && v.colour !== "Standard" ? ` / ${v.colour}` : ""}`
                    : (v.colour && v.colour !== "N/A" && v.colour !== "Standard" ? `${p.name} (${v.colour})` : p.name),
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
