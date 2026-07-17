import { useTranslation } from "react-i18next";
import { Bell, Building2, ChevronDown, Globe, LogOut, CreditCard, AlertTriangle, FileX, type LucideIcon } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import { applyDirection } from "@/lib/i18n";
import i18n from "i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import type { PaginatedResponse } from "@/lib/api";
import type { Notification } from "@/types";
import { useState } from "react";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "ar", label: "العربية", flag: "🇩🇿" },
  { code: "en", label: "English", flag: "🇬🇧" },
];

function relativeTime(isoStr: string, t: (key: string, options?: any) => string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("topbar.just_now");
  if (m < 60) return t("topbar.minutes_ago", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("topbar.hours_ago", { count: h });
  return t("topbar.days_ago", { count: Math.floor(h / 24) });
}

const NOTIF_ICON: Record<string, LucideIcon> = {
  cheque_due: CreditCard,
  low_stock: AlertTriangle,
  invoice_overdue: FileX,
  general: Bell,
};

const NOTIF_ACCENT: Record<string, string> = {
  cheque_due: "text-yellow-500 bg-yellow-50",
  low_stock: "text-orange-500 bg-orange-50",
  invoice_overdue: "text-red-500 bg-red-50",
  general: "text-blue-500 bg-blue-50",
};

export default function Topbar() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { branches, currentBranch, setCurrentBranch } = useBranch();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const queryClient = useQueryClient();

  const { data: unreadCount } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api.get<{ count: number }>("/notifications/unread_count/").then((r) => r.data.count),
    refetchInterval: 60000,
  });

  const { data: notifData } = useQuery<PaginatedResponse<Notification>>({
    queryKey: ["notifications", "list"],
    queryFn: () => api.get("/notifications/?page_size=20").then((r) => r.data),
    enabled: showNotifPanel,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/notifications/${id}/mark-read/`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "list"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () =>
      api.post("/notifications/mark-all-read/").then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "list"] });
    },
  });

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    applyDirection(code);
    setShowLangMenu(false);
  };

  const notifications = notifData?.results ?? [];

  return (
    <header className="layout-topbar">
      {/* Logo (mobile) */}
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xl hidden xs:block">👟</span>
        <span className="font-bold text-primary-500 hidden xs:block">ShoeDZ</span>
      </div>

      {/* Branch selector — only visible when tenant has multiple branches */}
      {branches.length > 1 && (
        <div className="relative mx-2">
          <button
            onClick={() => setShowBranchMenu(!showBranchMenu)}
            className="btn-ghost btn-sm flex items-center gap-1.5 text-text-secondary"
          >
            <Building2 size={14} />
            <span className="hidden sm:inline text-xs font-medium max-w-[120px] truncate">
              {currentBranch?.name ?? "—"}
            </span>
            <ChevronDown size={12} />
          </button>
          {showBranchMenu && (
            <div className="absolute start-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-50 min-w-[180px]">
              <div className="px-3 py-1.5 border-b border-border">
                <span className="text-xs text-text-muted font-medium">{t("topbar.active_branch")}</span>
              </div>
              {branches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setCurrentBranch(b); setShowBranchMenu(false); }}
                  className={cn(
                    "w-full text-start px-3 py-2 text-sm hover:bg-surface flex items-center justify-between gap-2",
                    currentBranch?.id === b.id && "font-semibold text-primary-500"
                  )}
                >
                  <span className="truncate">{b.name}</span>
                  {b.is_headquarters && (
                    <span className="text-2xs text-text-muted shrink-0">HQ</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Right Actions */}
      <div className="flex items-center gap-1">

        {/* Language selector */}
        <div className="relative">
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="btn-ghost btn-sm flex items-center gap-1"
          >
            <Globe size={15} />
            <span className="hidden sm:inline text-xs uppercase">{i18n.language}</span>
          </button>
          {showLangMenu && (
            <div className="absolute end-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-50 min-w-[140px]">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => changeLanguage(lang.code)}
                  className={cn(
                    "w-full text-start px-3 py-2 text-sm hover:bg-surface flex items-center gap-2",
                    i18n.language === lang.code && "font-semibold text-primary-500"
                  )}
                >
                  <span>{lang.flag}</span>
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notifications bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifPanel(!showNotifPanel)}
            className="btn-ghost btn-sm relative"
          >
            <Bell size={18} />
            {(unreadCount ?? 0) > 0 && (
              <span className="absolute -top-0.5 -end-0.5 w-4 h-4 bg-danger rounded-full text-white text-2xs flex items-center justify-center font-bold">
                {(unreadCount ?? 0) > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {showNotifPanel && (
            <div className="absolute end-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-white border border-border rounded-lg shadow-xl z-50">
              {/* Panel header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border sticky top-0 bg-white">
                <span className="text-sm font-semibold text-text-primary">{t("notification.title")}</span>
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  className="text-xs text-primary-500 hover:text-primary-700 font-medium"
                >
                  {t("notification.mark_all_read")}
                </button>
              </div>

              {/* Notification list */}
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-text-muted">
                  {t("notification.empty")}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((notif) => {
                    const Icon = NOTIF_ICON[notif.type] ?? Bell;
                    const accent = NOTIF_ACCENT[notif.type] ?? "text-blue-500 bg-blue-50";
                    return (
                      <button
                        key={notif.id}
                        onClick={() => markReadMutation.mutate(notif.id)}
                        className="w-full text-start px-3 py-3 hover:bg-surface flex items-start gap-3 transition-colors"
                      >
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", accent)}>
                          <Icon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{notif.title}</p>
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{notif.body}</p>
                          <p className="text-xs text-text-muted mt-1">{relativeTime(notif.created_at, t)}</p>
                        </div>
                        {!notif.read && (
                          <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0 mt-1.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="btn-ghost btn-sm flex items-center gap-2 ps-2"
          >
            <div className="w-7 h-7 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-xs font-semibold">
              {user?.first_name?.[0] ?? user?.email?.[0] ?? "?"}
            </div>
            <span className="hidden sm:inline text-sm font-medium text-text-primary">
              {user?.first_name || user?.email?.split("@")[0]}
            </span>
            <ChevronDown size={14} />
          </button>

          {showUserMenu && (
            <div className="absolute end-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-50 min-w-[180px]">
              <div className="px-3 py-2 border-b border-border">
                <div className="text-sm font-medium text-text-primary">{user?.full_name}</div>
                <div className="text-xs text-text-muted">{user?.email}</div>
                <div className="text-xs text-accent font-medium mt-0.5 capitalize">{user?.role}</div>
              </div>
              <button
                onClick={logout}
                className="w-full text-start px-3 py-2 text-sm text-danger hover:bg-danger-light flex items-center gap-2"
              >
                <LogOut size={14} />
                {t("auth.logout")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Close dropdowns on outside click */}
      {(showLangMenu || showUserMenu || showNotifPanel || showBranchMenu) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowLangMenu(false); setShowUserMenu(false); setShowNotifPanel(false); setShowBranchMenu(false); }}
        />
      )}
    </header>
  );
}
