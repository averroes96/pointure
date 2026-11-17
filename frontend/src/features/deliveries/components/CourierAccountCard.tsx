import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, KeyRound, PlugZap, Trash2 } from "lucide-react";
import type { CourierAccount, CourierTestResult } from "../types";
import { credentialLabel } from "../credentialLabels";
import { testResultMessage } from "../testResultMessage";

interface Props {
  account: CourierAccount;
  saving: boolean;
  onSaveCredential: (name: string, value: string) => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onTest: () => void;
  testing: boolean;
  testResult?: CourierTestResult;
}

const TONE_CLASS = { success: "badge badge-success", warning: "badge badge-warning", danger: "badge badge-danger" };

/**
 * One configured courier. Saved secrets are never shown: each credential reads
 * "saved" with a Replace button, and missing ones can be filled in place.
 */
export default function CourierAccountCard({
  account,
  saving,
  onSaveCredential,
  onToggleActive,
  onDelete,
  onTest,
  testing,
  testResult,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");

  const names = account.required_credentials.length
    ? account.required_credentials
    : account.saved_credentials;

  const startEdit = (name: string) => {
    setEditing(name);
    setValue("");
  };

  const save = () => {
    if (!editing || !value.trim()) return;
    onSaveCredential(editing, value.trim());
    setEditing(null);
    setValue("");
  };

  return (
    <div className="card card-body space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-sm text-slate-900 dark:text-white">{account.courier_name}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{account.courier}</div>
          {account.base_url && (
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 break-all">
              {account.base_url}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={account.is_active ? "badge badge-success" : "badge badge-neutral"}>
            {account.is_active ? t("common.active") : t("common.inactive")}
          </span>
          <button type="button" className="btn-secondary" onClick={onToggleActive} disabled={saving}>
            {account.is_active ? t("deliveries.deactivate") : t("deliveries.activate")}
          </button>
          <button
            type="button"
            className="btn-ghost text-red-600 dark:text-rose-400"
            onClick={onDelete}
            title={t("deliveries.delete_provider")}
            aria-label={t("deliveries.delete_provider")}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!account.platform && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t("deliveries.courier_not_in_catalogue")}</p>
      )}

      {account.missing_credentials.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {t("deliveries.credentials_missing", {
              names: account.missing_credentials.map((n) => credentialLabel(t, n)).join(", "),
            })}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={onTest}
          disabled={testing || account.missing_credentials.length > 0}
        >
          <PlugZap className="w-4 h-4" />
          <span>{testing ? t("deliveries.test_running") : t("deliveries.test_connection")}</span>
        </button>
        {testResult && !testing && (
          <span role="status" className={TONE_CLASS[testResultMessage(t, testResult).tone]}>
            {testResultMessage(t, testResult).text}
          </span>
        )}
      </div>

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {names.map((name) => {
          const saved = account.saved_credentials.includes(name);
          return (
            <li key={name} className="py-2 flex flex-wrap items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
              <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 min-w-[8rem]">
                {credentialLabel(t, name)}
              </span>
              {editing === name ? (
                <>
                  <input
                    type="password"
                    autoComplete="off"
                    autoFocus
                    className="form-input font-mono max-w-xs"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save()}
                  />
                  <button type="button" className="btn-primary" onClick={save} disabled={!value.trim() || saving}>
                    {t("common.save")}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <span className={saved ? "badge badge-success" : "badge badge-warning"}>
                    {saved ? t("deliveries.credential_saved") : t("deliveries.credential_missing")}
                  </span>
                  <button type="button" className="btn-secondary" onClick={() => startEdit(name)}>
                    {saved ? t("deliveries.credential_replace") : t("common.add")}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
