import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, X } from "lucide-react";
import api, { type PaginatedResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Client } from "@/types";

interface ClientSelectorProps {
  value: Client | null;
  onChange: (c: Client | null) => void;
}

export function ClientSelector({ value, onChange }: ClientSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<PaginatedResponse<Client>>({
    queryKey: ["clients-search", query],
    queryFn: () =>
      api
        .get(`/clients/?search=${encodeURIComponent(query)}&page_size=10`)
        .then((r) => r.data),
    enabled: open,
  });

  const clients = data?.results ?? [];

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "input w-full flex items-center justify-between gap-2 text-start rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm",
          !value && "text-slate-400"
        )}
      >
        <span className="truncate">{value ? value.name : t("invoice.select_client")}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {value && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="p-0.5 hover:text-rose-600 transition-colors"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className={cn("text-slate-400 transition-transform duration-200", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60">
            <div className="relative">
              <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input w-full ps-8 py-1.5 text-xs rounded-lg border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                placeholder={t("common.search")}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {isFetching && (
              <div className="px-3 py-2 text-xs text-slate-400">{t("app.loading")}</div>
            )}
            {!isFetching && clients.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-400">{t("invoice.no_client_found")}</div>
            )}
            {clients.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-start px-3.5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                {c.phone && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{c.phone}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
