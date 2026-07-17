import { useTranslation } from "react-i18next";
import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { COLOURS, getColourLabel, getColourHex, type Colour } from "@/lib/colours";

interface ColourPickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

function Swatch({ colour, size = 16 }: { colour: Colour | null; size?: number }) {
  if (!colour || !colour.hex) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-border flex-shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.6 }}
      >
        🎨
      </span>
    );
  }
  const isLight = colour.value === "white" || colour.value === "ivory" || colour.value === "cream" || colour.value === "cream_yellow";
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: colour.hex,
        border: isLight ? "1px solid #e5e7eb" : "none",
      }}
    />
  );
}

export default function ColourPicker({
  value,
  onChange,
  placeholder = "Couleur",
  className = "",
}: ColourPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = COLOURS.find((c) => c.value === value) ?? null;

  const filtered = search.trim()
    ? COLOURS.filter(
        (c) =>
          c.label.toLowerCase().includes(search.toLowerCase()) ||
          c.value.toLowerCase().includes(search.toLowerCase())
      )
    : COLOURS;

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  function select(colour: Colour) {
    onChange(colour.value);
    setOpen(false);
    setSearch("");
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="form-input flex items-center gap-2 w-full text-left text-sm cursor-pointer"
      >
        <Swatch colour={selected} size={16} />
        <span className={selected ? "text-text-primary" : "text-text-muted"}>
          {selected ? selected.label : placeholder}
        </span>
        {selected && (
          <span
            className="ml-auto p-0.5 text-text-muted hover:text-text-primary"
            onClick={clear}
          >
            <X size={12} />
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une couleur…"
              className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-surface outline-none focus:border-primary-400"
            />
          </div>

          {/* Colour grid */}
          <div className="p-2 max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-center text-sm text-text-muted py-4">Aucune couleur trouvée.</p>
            )}
            <div className="grid grid-cols-2 gap-0.5">
              {filtered.map((colour) => (
                <button
                  key={colour.value}
                  type="button"
                  onClick={() => select(colour)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    value === colour.value
                      ? "bg-primary-50 text-primary-700 font-semibold"
                      : "hover:bg-surface text-text-primary"
                  }`}
                >
                  <Swatch colour={colour} size={18} />
                  <span className="truncate">{colour.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline swatch + label display for read-only contexts (variant lists, etc.) */
export function ColourTag({ value }: { value: string }) {
  if (!value) return <span className="text-text-muted">—</span>;
  const hex = getColourHex(value);
  const label = getColourLabel(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      {hex ? (
        <span
          className="inline-block w-3 h-3 rounded-full flex-shrink-0"
          style={{
            background: hex,
            border: value === "white" || value === "ivory" || value === "cream" ? "1px solid #e5e7eb" : "none",
          }}
        />
      ) : null}
      <span>{label}</span>
    </span>
  );
}
