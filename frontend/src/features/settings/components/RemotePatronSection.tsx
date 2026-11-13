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
    </section>
  );
}
