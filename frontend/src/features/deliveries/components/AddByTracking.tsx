import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PackagePlus, X } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { parseTrackings } from "../payouts";
import type { CourierSyncState } from "../types";

/** Most trackings the server takes in one call (MAX_ADD_BY_TRACKING). */
export const MAX_TRACKINGS = 50;

export interface AddByTrackingResult {
  added: string[];
  already_followed: string[];
  unknown: string[];
}

/**
 * For couriers with no parcel list (NOEST, P3.14): follow parcels created in the courier's
 * own dashboard by pasting or scanning their tracking numbers. Renders nothing otherwise.
 */
export default function AddByTracking({ accounts }: { accounts: CourierSyncState[] }) {
  const { t } = useTranslation();
  const eligible = accounts.filter((a) => a.by_tracking);
  const [open, setOpen] = useState(false);
  if (eligible.length === 0) return null;
  return (
    <>
      <button type="button" className="btn-secondary inline-flex items-center gap-2 focus-visible:ring-2"
              onClick={() => setOpen(true)}>
        <PackagePlus className="w-4 h-4" aria-hidden /> {t("deliveries.add_by_tracking")}
      </button>
      {open && <AddByTrackingModal accounts={eligible} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AddByTrackingModal({ accounts, onClose }: { accounts: CourierSyncState[]; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [text, setText] = useState("");
  const [result, setResult] = useState<AddByTrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    textRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trackings = parseTrackings(text);
  const tooMany = trackings.length > MAX_TRACKINGS;

  const add = useMutation({
    mutationFn: async () =>
      (await api.post<AddByTrackingResult>("/deliveries/shipments/add-by-tracking/", {
        provider_config: accountId, trackings,
      })).data,
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      if (data.added.length > 0) {
        setText("");
        queryClient.invalidateQueries({ queryKey: ["shipments-summary"] });
        queryClient.invalidateQueries({ queryKey: ["shipments"] });
      }
    },
    onError: (err) => { setError(getApiError(err)); setResult(null); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
         role="dialog" aria-modal="true" aria-labelledby="abt-title">
      <div className="modal-dialog w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="modal-header flex items-center justify-between">
          <h2 id="abt-title">{t("deliveries.add_by_tracking")}</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <form className="modal-body space-y-4 overflow-y-auto"
              onSubmit={(e) => { e.preventDefault(); if (trackings.length && !tooMany && accountId) add.mutate(); }}>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("deliveries.add_by_tracking_help")}</p>
          {accounts.length > 1 && (
            <div>
              <label className="form-label" htmlFor="abt-account">{t("deliveries.col_courier")}</label>
              <select id="abt-account" className="form-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.courier_name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="form-label" htmlFor="abt-trackings">{t("deliveries.add_by_tracking_numbers")}</label>
            <textarea id="abt-trackings" ref={textRef} className="form-input font-mono" rows={6} dir="ltr"
                      value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} />
            <p className={"mt-1 text-xs " + (tooMany ? "text-red-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400")}>
              {tooMany ? t("deliveries.add_by_tracking_too_many", { max: MAX_TRACKINGS })
                : t("deliveries.add_by_tracking_count", { count: trackings.length })}
            </p>
          </div>

          {error && (
            <p role="alert" className="p-3 rounded-xl text-sm border bg-red-50 dark:bg-rose-950/40 text-red-800 dark:text-rose-300 border-red-200 dark:border-rose-800/60">
              {error}
            </p>
          )}
          {result && (
            <div role="status" className="space-y-1 text-sm rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
              <p className="text-emerald-700 dark:text-emerald-400">{t("deliveries.add_by_tracking_added", { count: result.added.length })}</p>
              {result.already_followed.length > 0 && (
                <p className="text-slate-600 dark:text-slate-400">
                  {t("deliveries.add_by_tracking_already", { list: result.already_followed.join(", ") })}
                </p>
              )}
              {result.unknown.length > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  {t("deliveries.add_by_tracking_unknown", { list: result.unknown.join(", ") })}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t("common.close")}</button>
            <button type="submit" className="btn-primary"
                    disabled={add.isPending || trackings.length === 0 || tooMany || !accountId}>
              {add.isPending ? t("deliveries.add_by_tracking_checking") : t("deliveries.add_by_tracking_submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
