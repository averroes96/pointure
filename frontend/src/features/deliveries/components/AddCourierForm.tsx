import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw, Search } from "lucide-react";
import type { CourierCatalogueEntry } from "../types";
import { credentialLabel } from "../credentialLabels";

interface Props {
  couriers: CourierCatalogueEntry[];
  configuredKeys: string[];
  catalogueLoading: boolean;
  catalogueRefreshing: boolean;
  onRetryCatalogue: () => void;
  saving: boolean;
  onSubmit: (payload: { courier: string; credentials: Record<string, string>; base_url?: string }) => void;
}

/** Pick a courier from the dzship catalogue and enter exactly the credentials it needs. */
export default function AddCourierForm({
  couriers,
  configuredKeys,
  catalogueLoading,
  catalogueRefreshing,
  onRetryCatalogue,
  saving,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [courierKey, setCourierKey] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState("");

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return couriers
      .filter((c) => !configuredKeys.includes(c.key))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.key.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [couriers, configuredKeys, search]);

  const selected = couriers.find((c) => c.key === courierKey) || null;
  const complete =
    !!selected &&
    selected.required_credentials.every((name) => (values[name] || "").trim() !== "") &&
    (!selected.requires_base_url || baseUrl.trim() !== "");

  const reset = () => {
    setCourierKey("");
    setValues({});
    setBaseUrl("");
    setSearch("");
  };

  const submit = () => {
    if (!selected || !complete) return;
    const credentials: Record<string, string> = {};
    selected.required_credentials.forEach((name) => (credentials[name] = values[name].trim()));
    onSubmit({
      courier: selected.key,
      credentials,
      ...(selected.requires_base_url ? { base_url: baseUrl.trim() } : {}),
    });
    reset();
  };

  if (couriers.length === 0) {
    return (
      <div className="card card-body text-sm text-slate-600 dark:text-slate-400 flex items-center justify-between gap-3">
        <span>
          {catalogueLoading || catalogueRefreshing
            ? t("deliveries.catalogue_loading")
            : t("deliveries.catalogue_unavailable")}
        </span>
        {!catalogueLoading && !catalogueRefreshing && (
          <button type="button" className="btn-secondary shrink-0" onClick={onRetryCatalogue}>
            <RefreshCw className="w-4 h-4" />
            <span>{t("common.refresh")}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card card-body space-y-4">
      <div>
        <label className="form-label" htmlFor="courier-search">
          {t("deliveries.select_courier")}
        </label>
        <div className="relative mb-2">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            id="courier-search"
            className="form-input ps-9"
            placeholder={t("deliveries.search_courier")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          value={courierKey}
          onChange={(e) => {
            setCourierKey(e.target.value);
            setValues({});
            setBaseUrl("");
          }}
        >
          <option value="">{t("deliveries.select_courier")}</option>
          {available.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <>
          {selected.required_credentials.map((name) => (
            <div key={name}>
              <label className="form-label" htmlFor={`cred-${name}`}>
                {credentialLabel(t, name)}
              </label>
              <input
                id={`cred-${name}`}
                type="password"
                autoComplete="off"
                className="form-input font-mono"
                value={values[name] || ""}
                onChange={(e) => setValues({ ...values, [name]: e.target.value })}
              />
            </div>
          ))}
          {selected.requires_base_url && (
            <div>
              <label className="form-label" htmlFor="courier-base-url">
                {t("deliveries.base_url")}
              </label>
              <input
                id="courier-base-url"
                className="form-input font-mono"
                placeholder={`https://…${selected.base_url_suffixes[0] || ""}`}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t("deliveries.base_url_hint", { suffixes: selected.base_url_suffixes.join(", ") })}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={reset}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={!complete || saving}>
              <Plus className="w-4 h-4" />
              <span>{t("common.add")}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
