import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Send, Trash2, Unlink } from "lucide-react";
import api, { getApiError } from "@/lib/api";

interface TelegramChat {
  chat_id: string;
  label: string;
}

interface PendingLink {
  code: string;
  expires_at: string;
}

interface AlertSettings {
  telegram_digest_time: string;
  alert_cash_gap_enabled: boolean;
  alert_cash_gap_amount: string;
  alert_cancel_enabled: boolean;
  alert_refund_enabled: boolean;
  alert_refund_amount: string;
  alert_discount_enabled: boolean;
  alert_discount_pct: number;
  alert_year_open_enabled: boolean;
  alert_backup_stale_enabled: boolean;
}

interface TelegramStatus {
  has_token: boolean;
  bot_username: string;
  chats: TelegramChat[];
  max_chats: number;
  pending_link: PendingLink | null;
  linked?: boolean;
  limit_reached?: boolean;
}

export default function RemotePatronSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const dismissedCode = useRef<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["telegram-link"],
    queryFn: async () => (await api.get<TelegramStatus>("/desktop/telegram/")).data,
  });
  const status = statusQuery.data;
  const atLimit = (status?.chats.length ?? 0) >= (status?.max_chats ?? 3);

  useEffect(() => {
    const code = status?.pending_link?.code;
    if (code && code !== dismissedCode.current && !atLimit) setPolling(true);
  }, [status?.pending_link?.code, atLimit]);

  useEffect(() => {
    if (!polling) return;
    let stopped = false;

    const tick = async () => {
      try {
        const { data } = await api.post<TelegramStatus>("/desktop/telegram/poll/");
        if (stopped) return;
        queryClient.setQueryData(["telegram-link"], data);
        if (data.linked) {
          setPolling(false);
          setNotice(t("settings.remote_owner.linked_ok"));
          setError("");
        } else if (data.limit_reached || !data.pending_link) {
          setPolling(false);
          if (data.limit_reached) setError(t("settings.remote_owner.limit"));
        }
      } catch (err) {
        if (stopped) return;
        setPolling(false);
        setError(getApiError(err));
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [polling, queryClient, t]);

  const saveToken = useMutation({
    mutationFn: async () => (await api.post<TelegramStatus>("/desktop/telegram/token/", { token })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["telegram-link"], data);
      setToken("");
      setError("");
      setNotice(t("settings.remote_owner.token_saved"));
    },
    onError: (err) => setError(getApiError(err)),
  });

  const startLink = useMutation({
    mutationFn: async () => (await api.post<TelegramStatus>("/desktop/telegram/link/")).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["telegram-link"], data);
      setError("");
      setNotice("");
      setPolling(true);
    },
    onError: (err) => setError(getApiError(err)),
  });

  const removeChat = useMutation({
    mutationFn: async (chatId: string) => (await api.delete<TelegramStatus>(`/desktop/telegram/chats/${chatId}/`)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["telegram-link"], data);
      setError("");
    },
    onError: (err) => setError(getApiError(err)),
  });

  const sendTest = useMutation({
    mutationFn: async (chatId: string) => (await api.post(`/desktop/telegram/chats/${chatId}/test/`)).data,
    onSuccess: () => {
      setError("");
      setNotice(t("settings.remote_owner.test_ok"));
    },
    onError: (err) => setError(getApiError(err)),
  });

  const pending = status?.pending_link;
  const settingsQuery = useQuery({
    queryKey: ["store-settings"],
    queryFn: async () => (await api.get<AlertSettings>("/core/store-settings/current/")).data,
  });
  const [alerts, setAlerts] = useState<AlertSettings | null>(null);
  useEffect(() => {
    if (settingsQuery.data) setAlerts(settingsQuery.data);
  }, [settingsQuery.data]);
  const saveAlerts = useMutation({
    mutationFn: async () => {
      if (!alerts) return null;
      const { data } = await api.patch<AlertSettings>("/core/store-settings/update_settings/", {
        telegram_digest_time: alerts.telegram_digest_time?.slice(0, 5),
        alert_cash_gap_enabled: alerts.alert_cash_gap_enabled,
        alert_cash_gap_amount: alerts.alert_cash_gap_amount,
        alert_cancel_enabled: alerts.alert_cancel_enabled,
        alert_refund_enabled: alerts.alert_refund_enabled,
        alert_refund_amount: alerts.alert_refund_amount,
        alert_discount_enabled: alerts.alert_discount_enabled,
        alert_discount_pct: alerts.alert_discount_pct,
        alert_year_open_enabled: alerts.alert_year_open_enabled,
        alert_backup_stale_enabled: alerts.alert_backup_stale_enabled,
      });
      return data;
    },
    onSuccess: (data) => {
      if (data) {
        setAlerts(data);
        queryClient.setQueryData(["store-settings"], data);
      }
      setError("");
      setNotice(t("settings.remote_owner.alerts_saved"));
    },
    onError: (err) => setError(getApiError(err)),
  });

  return (
    <section className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {t("settings.remote_owner.intro")}
      </p>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-slate-950 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-slate-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {notice}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
        <label htmlFor="telegram-token" className="form-label">
          {t("settings.remote_owner.token_label")}
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {status?.has_token
            ? t("settings.remote_owner.bot", { username: status.bot_username || "—" })
            : t("settings.remote_owner.no_token")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="telegram-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={t("settings.remote_owner.token_placeholder")}
            className="form-input flex-1"
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!token.trim() || saveToken.isPending}
            onClick={() => saveToken.mutate()}
          >
            {saveToken.isPending ? t("settings.remote_owner.validating") : t("settings.remote_owner.validate")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            {t("settings.remote_owner.chats")}
          </h3>
          <button
            type="button"
            className="btn-secondary"
            disabled={!status?.has_token || atLimit || startLink.isPending}
            onClick={() => startLink.mutate()}
          >
            {startLink.isPending ? t("settings.remote_owner.waiting") : t("settings.remote_owner.link")}
          </button>
        </div>
        {atLimit && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("settings.remote_owner.limit")}</p>
        )}
        {pending && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-4 py-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">{t("settings.remote_owner.code_help")}</p>
            <p className="mt-2 font-mono text-lg text-slate-900 dark:text-slate-100 select-all">
              /start {pending.code}
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
              {polling && <Loader2 size={14} className="animate-spin" />}
              {t("settings.remote_owner.waiting")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                void navigator.clipboard.writeText(`/start ${pending.code}`).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t("settings.remote_owner.copied") : t("settings.remote_owner.copy")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                dismissedCode.current = pending.code;
                setPolling(false);
              }}
            >
              <Unlink size={14} />
              {t("settings.remote_owner.cancel")}
            </button>
            </div>
          </div>
        )}
        {status?.chats.length === 0 && !pending && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("settings.remote_owner.empty")}</p>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {status?.chats.map((chat) => (
            <li key={chat.chat_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="text-sm text-slate-800 dark:text-slate-200">
                {chat.label || chat.chat_id}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={sendTest.isPending}
                  onClick={() => sendTest.mutate(chat.chat_id)}
                >
                  <Send size={14} />
                  {t("settings.remote_owner.test")}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={removeChat.isPending}
                  onClick={() => removeChat.mutate(chat.chat_id)}
                >
                  <Trash2 size={14} />
                  {t("settings.remote_owner.remove")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {alerts && (
        <form
          className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveAlerts.mutate();
          }}
        >
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            {t("settings.remote_owner.alerts_title")}
          </h3>
          <label className="block text-sm text-slate-700 dark:text-slate-300">
            {t("settings.remote_owner.digest_time")}
            <input
              type="time"
              className="form-input mt-1"
              value={alerts.telegram_digest_time?.slice(0, 5) || "21:00"}
              onChange={(event) => setAlerts({ ...alerts, telegram_digest_time: event.target.value })}
            />
          </label>
          <AlertRow
            label={t("settings.remote_owner.alert_gap")}
            enabled={alerts.alert_cash_gap_enabled}
            onToggle={(value) => setAlerts({ ...alerts, alert_cash_gap_enabled: value })}
            amount={alerts.alert_cash_gap_amount}
            onAmount={(value) => setAlerts({ ...alerts, alert_cash_gap_amount: value })}
          />
          <AlertRow
            label={t("settings.remote_owner.alert_cancel")}
            enabled={alerts.alert_cancel_enabled}
            onToggle={(value) => setAlerts({ ...alerts, alert_cancel_enabled: value })}
          />
          <AlertRow
            label={t("settings.remote_owner.alert_refund")}
            enabled={alerts.alert_refund_enabled}
            onToggle={(value) => setAlerts({ ...alerts, alert_refund_enabled: value })}
            amount={alerts.alert_refund_amount}
            onAmount={(value) => setAlerts({ ...alerts, alert_refund_amount: value })}
          />
          <AlertRow
            label={t("settings.remote_owner.alert_discount")}
            enabled={alerts.alert_discount_enabled}
            onToggle={(value) => setAlerts({ ...alerts, alert_discount_enabled: value })}
            amount={String(alerts.alert_discount_pct)}
            onAmount={(value) => setAlerts({ ...alerts, alert_discount_pct: Number(value) || 0 })}
            suffix="%"
          />
          <AlertRow
            label={t("settings.remote_owner.alert_year")}
            enabled={alerts.alert_year_open_enabled}
            onToggle={(value) => setAlerts({ ...alerts, alert_year_open_enabled: value })}
          />
          <AlertRow
            label={t("settings.remote_owner.alert_backup")}
            enabled={alerts.alert_backup_stale_enabled}
            onToggle={(value) => setAlerts({ ...alerts, alert_backup_stale_enabled: value })}
          />
          <button type="submit" className="btn-primary" disabled={saveAlerts.isPending}>
            {t("settings.remote_owner.alerts_save")}
          </button>
        </form>
      )}
    </section>
  );
}

function AlertRow({
  label,
  enabled,
  onToggle,
  amount,
  onAmount,
  suffix,
}: {
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  amount?: string;
  onAmount?: (value: string) => void;
  suffix?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
        {label}
      </label>
      {onAmount && (
        <input
          type="number"
          min="0"
          step="0.01"
          className="form-input w-32"
          value={amount ?? ""}
          onChange={(event) => onAmount(event.target.value)}
          aria-label={suffix ? `${label} ${suffix}` : label}
        />
      )}
    </div>
  );
}
