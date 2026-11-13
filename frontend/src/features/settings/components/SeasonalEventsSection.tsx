import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api, { getApiError } from "@/lib/api";

interface SeasonalEvent {
  id: string;
  kind: string;
  date: string;
  label: string;
  is_estimated: boolean;
  seed_key: string;
}

export default function SeasonalEventsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [label, setLabel] = useState("");
  const [customDate, setCustomDate] = useState("");

  const { data, isLoading } = useQuery<SeasonalEvent[]>({
    queryKey: ["seasonal-events"],
    queryFn: () => api.get("/reports/seasonal-events/").then((response) => response.data),
  });

  const save = useMutation({
    mutationFn: async ({ id, date }: { id: string; date: string }) => {
      await api.patch(`/reports/seasonal-events/${id}/`, { date });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["seasonal-events"] }),
  });

  const createCustom = useMutation({
    mutationFn: async () => {
      await api.post("/reports/seasonal-events/", { date: customDate, label });
    },
    onSuccess: () => {
      setLabel("");
      setCustomDate("");
      queryClient.invalidateQueries({ queryKey: ["seasonal-events"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/reports/seasonal-events/${id}/`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["seasonal-events"] }),
  });

  const events = (Array.isArray(data) ? data : []).filter((event) => event.date.startsWith(year));
  const years = Array.from({ length: 16 }, (_, index) => String(2020 + index));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t("seasonal.settings_title")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("seasonal.settings_help")}</p>
      </div>
      <label className="block max-w-xs">
        <span className="form-label">{t("seasonal.year")}</span>
        <select className="form-input" value={year} onChange={(event) => setYear(event.target.value)}>
          {years.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">{t("report.loading_report")}</p>}
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900 dark:text-white">
                {event.kind === "custom" ? event.label : t(`seasonal.kind.${event.kind}`)}
              </div>
              {event.is_estimated && (
                <div className="text-xs text-amber-700 dark:text-amber-300">{t("seasonal.estimated")}</div>
              )}
            </div>
            <input
              type="date"
              className="form-input sm:w-44"
              defaultValue={event.date}
              key={`${event.id}-${event.date}`}
              onBlur={(input) => {
                if (input.target.value && input.target.value !== event.date) {
                  save.mutate({ id: event.id, date: input.target.value });
                }
              }}
            />
            {event.kind === "custom" && (
              <button type="button" className="btn-secondary" onClick={() => remove.mutate(event.id)}>
                {t("seasonal.delete")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          createCustom.mutate();
        }}
      >
        <label className="block">
          <span className="form-label">{t("seasonal.custom_label")}</span>
          <input className="form-input" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="block">
          <span className="form-label">{t("seasonal.date")}</span>
          <input className="form-input" type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={!label.trim() || !customDate || createCustom.isPending}>
          {t("seasonal.add")}
        </button>
      </form>
      {(save.isError || createCustom.isError || remove.isError) && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {getApiError(save.error || createCustom.error || remove.error)}
        </p>
      )}
    </section>
  );
}
