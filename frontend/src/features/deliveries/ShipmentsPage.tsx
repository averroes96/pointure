import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PackageSearch } from "lucide-react";
import { getApiError } from "@/lib/api";
import api from "@/lib/api";
import ShipmentDrawer from "./components/ShipmentDrawer";
import ShipmentFiltersBar from "./components/ShipmentFiltersBar";
import ShipmentSummaryCards, { type CardKey } from "./components/ShipmentSummaryCards";
import ShipmentSyncBar from "./components/ShipmentSyncBar";
import ShipmentTable from "./components/ShipmentTable";
import {
  EMPTY_FILTERS,
  FOLLOW_UP_STATUSES,
  summarizeShipments,
  useShipmentList,
  useShipmentSummary,
} from "./shipments";
import { SHIPMENT_STATUSES } from "./types";
import type { ShipmentFilters } from "./types";

const IN_PROGRESS = SHIPMENT_STATUSES.filter((s) => !["delivered", "returned", "cancelled", "lost"].includes(s));

/** What each summary card filters on. */
const CARD_FILTERS: Record<CardKey, Partial<ShipmentFilters>> = {
  in_progress: { status: IN_PROGRESS.join(","), cash_status: "" },
  follow_up: { status: FOLLOW_UP_STATUSES.join(","), cash_status: "" },
  held: { status: "", cash_status: "held_by_courier" },
  ready: { status: "", cash_status: "ready" },
  paid: { status: "", cash_status: "paid" },
  returned: { status: "returned", cash_status: "" },
};

/** Deliveries → Shipments (docs/plans/delivery-v1-plan.md P1.11). Managers and owners. */
export default function ShipmentsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ShipmentFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [activeCard, setActiveCard] = useState<CardKey | null>(null);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce typing in the search box.
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  const summaryFilters = useMemo(
    () => ({ courier: filters.courier, date_from: filters.date_from, date_to: filters.date_to }),
    [filters.courier, filters.date_from, filters.date_to],
  );
  const summary = useShipmentSummary(summaryFilters);
  const accounts = summary.data?.accounts || [];
  const syncing = accounts.some((a) => a.syncing);
  const list = useShipmentList(filters, page, syncing);
  const cards = summarizeShipments(summary.data);

  const refresh = useMutation({
    mutationFn: () => api.post("/deliveries/shipments/refresh/", null, {
      params: filters.courier ? { courier: filters.courier } : undefined,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shipments-summary"] }),
    onError: (err) => setError(getApiError(err)),
  });

  const changeFilters = (next: ShipmentFilters) => {
    setActiveCard(null);
    setFilters(next);
    setPage(1);
  };

  const selectCard = (key: CardKey | null) => {
    setActiveCard(key);
    setFilters((f) => ({ ...f, status: "", cash_status: "", ...(key ? CARD_FILTERS[key] : {}) }));
    setPage(1);
  };

  const reset = () => {
    setActiveCard(null);
    setSearchInput("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const noAccount = summary.isSuccess && accounts.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {t("deliveries.shipments_title")}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("deliveries.shipments_subtitle")}</p>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl text-sm border bg-red-50 dark:bg-rose-950/40 text-red-800 dark:text-rose-300 border-red-200 dark:border-rose-800/60">
          {error}
        </div>
      )}

      {noAccount ? (
        <div className="card card-body text-center space-y-3 py-10">
          <PackageSearch className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("deliveries.no_courier_configured")}</p>
          <Link to="/settings" className="btn-primary inline-flex">{t("deliveries.open_delivery_settings")}</Link>
        </div>
      ) : (
        <>
          <ShipmentSyncBar
            accounts={accounts}
            refreshing={refresh.isPending}
            onRefresh={() => { setError(null); refresh.mutate(); }}
          />
          <ShipmentSummaryCards cards={cards} active={activeCard} onSelect={selectCard} />
          <ShipmentFiltersBar
            filters={{ ...filters, search: searchInput }}
            accounts={accounts}
            onChange={(next) => {
              setSearchInput(next.search);
              changeFilters({ ...next, search: filters.search });
            }}
            onReset={reset}
          />

          <div className="card overflow-hidden">
            {list.isLoading ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">{t("common.loading")}</div>
            ) : list.data && list.data.results.length > 0 ? (
              <ShipmentTable rows={list.data.results} onOpen={setOpenId} />
            ) : (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                {syncing ? t("deliveries.syncing") : t("deliveries.no_shipments")}
              </div>
            )}
            {list.data && list.data.total_pages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  {t("deliveries.page_info", {
                    current: list.data.current_page, total: list.data.total_pages, count: list.data.count,
                  })}
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t("common.previous")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={page >= list.data.total_pages}
                    onClick={() => setPage(page + 1)}
                  >
                    {t("common.next")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <ShipmentDrawer shipmentId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
