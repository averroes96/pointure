import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, Loader2 } from "lucide-react";
import api from "@/lib/api";
import type { Variant } from "@/types";
import { cn } from "@/lib/utils";

function formatVariantLabel(v: Variant | null): string {
  if (!v) return "";
  const name = v.product_name || "";
  if (v.size_eu > 0) {
    const col = v.colour && v.colour !== "N/A" && v.colour !== "Standard" ? ` ${v.colour}` : "";
    return `${name} — T${v.size_eu}${col}`;
  }
  if (v.colour && v.colour !== "Standard" && v.colour !== "N/A") {
    return `${name} (${v.colour})`;
  }
  return name;
}

export function VariantSearchInput({
  value,
  onSelect,
}: {
  value: Variant | null;
  onSelect: (v: Variant) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(formatVariantLabel(value));
  const [results, setResults] = useState<Variant[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) setQuery(formatVariantLabel(value));
  }, [value?.id]);

  function search(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/inventory/variants/?search=${encodeURIComponent(q)}&page_size=10`);
        setResults(res.data.results ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function pick(v: Variant) {
    setQuery(formatVariantLabel(v));
    setResults([]);
    setOpen(false);
    onSelect(v);
  }

  return (
    <div className="relative">
      <div className="relative">
        {loading
          ? <Loader2 size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
          : <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        }
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="form-input ps-9"
          placeholder="Produit, référence, code-barres..."
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
          {results.map((v) => (
            <button
              key={v.id}
              type="button"
              onMouseDown={() => pick(v)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface text-start transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm text-text-primary truncate">{v.product_name}</div>
                <div className="text-xs text-text-muted">
                  {v.size_eu > 0 ? (
                    `Pointure ${v.size_eu}${v.colour && v.colour !== "N/A" && v.colour !== "Standard" ? ` · ${v.colour}` : ""}`
                  ) : (
                    v.colour && v.colour !== "Standard" && v.colour !== "N/A"
                      ? v.colour
                      : v.barcode
                      ? `Code: ${v.barcode}`
                      : "Article standard"
                  )}
                </div>
              </div>
              <span className={cn(
                "badge text-xs flex-shrink-0",
                v.stock_qty <= 0 ? "badge-danger" : v.is_low_stock ? "badge-warning" : "badge-success"
              )}>
                {v.stock_qty} en stock
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
