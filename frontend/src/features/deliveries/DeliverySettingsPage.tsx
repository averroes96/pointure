import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Truck } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import AddCourierForm from "./components/AddCourierForm";
import CourierAccountCard from "./components/CourierAccountCard";
import type { CourierAccount, CourierTestResult } from "./types";
import { useCourierCatalogue } from "./useCourierCatalogue";

const ACCOUNTS_KEY = ["provider-configs"];

/** Settings → Delivery: the store's courier accounts (docs/plans/delivery-v1-plan.md P1.4). */
export default function DeliverySettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const catalogue = useCourierCatalogue();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => {
      const res = await api.get("/deliveries/provider-configs/");
      return (res.data.results || res.data) as CourierAccount[];
    },
  });

  const flash = (kind: "ok" | "error", text: string) => {
    setNotice({ kind, text });
    if (kind === "ok") setTimeout(() => setNotice(null), 3000);
  };

  const onDone = () => {
    queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    flash("ok", t("deliveries.settings_saved"));
  };

  const createMutation = useMutation({
    mutationFn: (payload: { courier: string; credentials: Record<string, string>; base_url?: string }) =>
      api.post("/deliveries/provider-configs/", payload),
    onSuccess: onDone,
    onError: (err) => flash("error", getApiError(err)),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/deliveries/provider-configs/${id}/`, payload),
    onSuccess: onDone,
    onError: (err) => flash("error", getApiError(err)),
  });

  const [testResults, setTestResults] = useState<Record<string, CourierTestResult>>({});
  const testMutation = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<CourierTestResult>(`/deliveries/provider-configs/${id}/test/`)).data,
    onSuccess: (data, id) => setTestResults((prev) => ({ ...prev, [id]: data })),
    onError: (err) => flash("error", getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/provider-configs/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
    onError: (err) => flash("error", getApiError(err)),
  });

  if (isLoading) {
    return <div className="text-slate-400 dark:text-slate-500 py-4">{t("common.loading")}</div>;
  }

  const saving = createMutation.isPending || patchMutation.isPending;

  return (
    <div className="space-y-8 max-w-2xl">
      {notice && (
        <div
          role="status"
          className={
            notice.kind === "ok"
              ? "p-3.5 rounded-xl text-sm font-medium flex items-center gap-2.5 border bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60"
              : "p-3.5 rounded-xl text-sm font-medium flex items-center gap-2.5 border bg-red-50 dark:bg-rose-950/40 text-red-800 dark:text-rose-300 border-red-200 dark:border-rose-800/60"
          }
        >
          {notice.kind === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      <section className="space-y-4">
        <div>
          <h3 className="font-bold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
            <Truck className="w-4 h-4 text-primary-600" />
            {t("deliveries.add_new_provider")}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("deliveries.courier_settings_desc")}</p>
        </div>
        <AddCourierForm
          couriers={catalogue.data?.couriers || []}
          configuredKeys={accounts.map((a) => a.courier)}
          catalogueLoading={catalogue.isLoading}
          catalogueRefreshing={!!catalogue.data?.refreshing}
          onRetryCatalogue={() => catalogue.forceRefresh().catch((err) => flash("error", getApiError(err)))}
          saving={createMutation.isPending}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t("deliveries.configured_providers")}
        </h3>
        {accounts.map((account) => (
          <CourierAccountCard
            key={account.id}
            account={account}
            saving={saving}
            onSaveCredential={(name, value) =>
              patchMutation.mutate({ id: account.id, payload: { credentials: { [name]: value } } })
            }
            onToggleActive={() => patchMutation.mutate({ id: account.id, payload: { is_active: !account.is_active } })}
            onDelete={() => {
              if (window.confirm(t("deliveries.delete_courier_confirm"))) deleteMutation.mutate(account.id);
            }}
            onTest={() => testMutation.mutate(account.id)}
            testing={testMutation.isPending && testMutation.variables === account.id}
            testResult={testResults[account.id]}
          />
        ))}
        {accounts.length === 0 && (
          <div className="text-center p-8 text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            {t("deliveries.no_providers")}
          </div>
        )}
      </section>
    </div>
  );
}
