import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Bell, Building2, ChevronDown, Globe, LogOut, CreditCard, AlertTriangle, FileX,
  Menu, Keyboard, Download, ArrowRight, Trash2, Sun, Moon, Monitor, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useBranch } from "@/features/auth/BranchContext";
import { useTheme } from "@/hooks/useTheme";
import { applyDirection } from "@/lib/i18n";
import i18n from "i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import type { PaginatedResponse } from "@/lib/api";
import type { Notification } from "@/types";
import { useState, useEffect } from "react";
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

export default function Topbar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { branches, currentBranch, setCurrentBranch } = useBranch();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState<{ version?: string } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    const cleanup = window.electronAPI.onUpdateStatus((data) => {
      if (data.status === "downloaded") {
        setUpdateDownloaded({ version: data.version });
      }
    });
    return cleanup;
  }, []);

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

  const navigate = useNavigate();

  const handleNotificationClick = (notif: Notification) => {
    if (!notif.read) {
      markReadMutation.mutate(notif.id);
    }
    setShowNotifPanel(false);

    if (notif.type === "low_stock") {
      navigate("/inventory/low-stock");
    } else if (notif.type === "cheque_due") {
      navigate("/cheques");
    } else if (notif.type === "invoice_overdue") {
      if (notif.related_object_id) {
        navigate(`/invoices/${notif.related_object_id}/edit`);
      } else {
        navigate("/invoices");
      }
    }
  };

  const clearAllMutation = useMutation({
    mutationFn: () =>
      api.post("/notifications/clear-all/").then((r) => r.data),
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
      {/* Menu Toggle (F5) */}
      <button
        onClick={onToggleSidebar}
        title={`${t("nav.menu", "Menu")} (F5)`}
        aria-label="Toggle navigation menu"
        className="p-2 -ms-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
      >
        <Menu size={19} />
        <kbd className="hidden sm:inline-flex items-center text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 shadow-2xs">
          F5
        </kbd>
      </button>

      {/* Brand logo (visible on mobile / when sidebar is closed) */}
      <div className="flex items-center gap-2.5 me-auto">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary-600 to-primary-500 flex items-center justify-center text-white shadow-xs">
          <span className="text-base">👟</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">ShoeDZ</span>
          {currentBranch && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span className="truncate max-w-[150px] text-slate-700 dark:text-slate-200 font-semibold">{currentBranch.name}</span>
            </span>
          )}
        </div>
      </div>

      {/* Branch selector — only visible when tenant has multiple branches */}
      {branches.length > 1 && (
        <div className="relative mx-1">
          <button
            onClick={() => setShowBranchMenu(!showBranchMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all active:scale-98 shadow-xs cursor-pointer"
          >
            <Building2 size={14} className="text-primary-600 dark:text-primary-400" />
            <span className="hidden sm:inline max-w-[120px] truncate">
              {currentBranch?.name ?? "—"}
            </span>
            <ChevronDown size={13} className="text-slate-400" />
          </button>
          {showBranchMenu && (
            <div className="absolute start-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 min-w-[200px] p-1.5 animate-slide-up">
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("topbar.active_branch")}</span>
              </div>
              {branches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setCurrentBranch(b); setShowBranchMenu(false); }}
                  className={cn(
                    "w-full text-start px-3 py-2 text-xs rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 transition-colors cursor-pointer",
                    currentBranch?.id === b.id ? "font-bold text-primary-600 dark:text-primary-400 bg-primary-50/80 dark:bg-primary-950/50" : "text-slate-700 dark:text-slate-200"
                  )}
                >
                  <span className="truncate">{b.name}</span>
                  {b.is_headquarters && (
                    <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full shrink-0">HQ</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Right Actions */}
      <div className="flex items-center gap-1.5">
        {/* Desktop App Update Ready */}
        {updateDownloaded && (
          <button
            onClick={() => window.electronAPI?.installUpdate?.()}
            className="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex items-center gap-1.5 shadow-xs animate-pulse me-1 rounded-xl cursor-pointer"
            title="Cliquez pour redémarrer et appliquer la mise à jour ShoeDZ"
          >
            <Download size={13} />
            <span className="font-semibold hidden sm:inline">Mise à jour v{updateDownloaded.version} prête · Redémarrer</span>
            <span className="font-semibold sm:hidden">v{updateDownloaded.version}</span>
          </button>
        )}

        {/* Keyboard shortcuts trigger */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("app-toggle-shortcuts-modal"))}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          title={t("shortcuts.button_title", "Raccourcis clavier (F12)")}
        >
          <Keyboard size={16} />
          <kbd className="hidden md:inline-flex items-center text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 shadow-2xs">
            F12
          </kbd>
        </button>

        {/* Theme mode switcher */}
        <div className="relative">
          <button
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-all cursor-pointer"
            title={`Thème: ${theme === "system" ? "Automatique (OS)" : theme === "dark" ? "Sombre" : "Clair"}`}
          >
            {theme === "system" ? (
              <Monitor size={15} className="text-slate-500 dark:text-slate-400" />
            ) : resolvedTheme === "dark" ? (
              <Moon size={15} className="text-amber-400" />
            ) : (
              <Sun size={15} className="text-amber-500" />
            )}
            <span className="hidden sm:inline capitalize text-[11px]">
              {theme === "system" ? "Auto" : theme === "dark" ? "Sombre" : "Clair"}
            </span>
            <ChevronDown size={12} className="text-slate-400" />
          </button>
          {showThemeMenu && (
            <div className="absolute end-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 min-w-[170px] p-1.5 animate-slide-up">
              {[
                { mode: "system" as const, label: "Automatique", icon: Monitor, hint: "Suit l'OS" },
                { mode: "light" as const, label: "Mode Clair", icon: Sun, hint: "Lumineux" },
                { mode: "dark" as const, label: "Mode Sombre", icon: Moon, hint: "Obsidian" },
              ].map(({ mode, label, icon: Icon, hint }) => (
                <button
                  key={mode}
                  onClick={() => {
                    setTheme(mode);
                    setShowThemeMenu(false);
                  }}
                  className={cn(
                    "w-full text-start px-3 py-2 text-xs rounded-xl flex items-center justify-between transition-colors cursor-pointer",
                    theme === mode
                      ? "font-bold text-primary-600 dark:text-primary-400 bg-primary-50/80 dark:bg-primary-950/50"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={theme === mode ? "text-primary-600 dark:text-primary-400" : "text-slate-400"} />
                    <div className="flex flex-col">
                      <span>{label}</span>
                      <span className="text-[10px] text-slate-400 font-normal">{hint}</span>
                    </div>
                  </div>
                  {theme === mode && <span className="w-1.5 h-1.5 rounded-full bg-primary-600 dark:bg-primary-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Language selector */}
        <div className="relative">
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-all cursor-pointer"
          >
            <Globe size={15} className="text-slate-500" />
            <span className="hidden sm:inline uppercase">{i18n.language}</span>
            <ChevronDown size={12} className="text-slate-400" />
          </button>
          {showLangMenu && (
            <div className="absolute end-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 min-w-[150px] p-1.5 animate-slide-up">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => changeLanguage(lang.code)}
                  className={cn(
                    "w-full text-start px-3 py-2 text-xs rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between transition-colors cursor-pointer",
                    i18n.language === lang.code ? "font-bold text-primary-600 dark:text-primary-400 bg-primary-50/80 dark:bg-primary-950/50" : "text-slate-700 dark:text-slate-300"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{lang.flag}</span>
                    <span>{lang.label}</span>
                  </div>
                  {i18n.language === lang.code && <span className="w-1.5 h-1.5 rounded-full bg-primary-600 dark:bg-primary-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notifications bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifPanel(!showNotifPanel)}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 relative transition-all cursor-pointer"
            title={t("notification.title")}
          >
            <Bell size={18} />
            {(unreadCount ?? 0) > 0 && (
              <span className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 bg-red-600 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900 shadow-xs">
                {(unreadCount ?? 0) > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {showNotifPanel && (
            <div className="absolute end-0 top-full mt-2 w-88 max-h-[440px] overflow-hidden flex flex-col bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-2xl z-50 animate-slide-up">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">{t("notification.title")}</span>
                  {(unreadCount ?? 0) > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {(unreadCount ?? 0) > 0 && (
                    <button
                      onClick={() => markAllReadMutation.mutate()}
                      disabled={markAllReadMutation.isPending}
                      className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 disabled:opacity-50 cursor-pointer"
                    >
                      {t("notification.mark_all_read")}
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={() => clearAllMutation.mutate()}
                      disabled={clearAllMutation.isPending}
                      title="Effacer les notifications"
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Notification list */}
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
                  <Bell size={24} className="text-slate-300 dark:text-slate-600" />
                  <span>{t("notification.empty")}</span>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto">
                  {notifications.map((notif) => {
                    const Icon = NOTIF_ICON[notif.type] ?? Bell;
                    const accent = NOTIF_ACCENT[notif.type] ?? "text-blue-500 bg-blue-50 dark:bg-blue-950/40";
                    return (
                      <button
                        key={notif.id}
                        onClick={() => handleNotificationClick(notif)}
                        className="group w-full text-start px-4 py-3 hover:bg-slate-50/90 dark:hover:bg-slate-800/80 flex items-start gap-3 transition-colors cursor-pointer"
                      >
                        <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-transform group-hover:scale-105", accent)}>
                          <Icon size={15} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
                              {notif.title}
                            </p>
                            <ArrowRight size={12} className="text-slate-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0" />
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">{notif.body}</p>
                          <p className="text-[11px] font-medium text-slate-400 mt-1 font-mono">{relativeTime(notif.created_at, t)}</p>
                        </div>
                        {!notif.read && (
                          <span className="w-2 h-2 rounded-full bg-primary-600 dark:bg-primary-400 shrink-0 mt-2" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Panel footer link */}
              <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 text-center">
                <button
                  onClick={() => {
                    setShowNotifPanel(false);
                    navigate("/inventory/low-stock");
                  }}
                  className="text-2xs font-semibold text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer"
                >
                  {t("inventory.low_stock", "Stock bas")} →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1.5 ps-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs ring-2 ring-primary-500/10">
              {user?.first_name?.[0] ?? user?.email?.[0] ?? "U"}
            </div>
            <div className="hidden sm:flex flex-col text-start">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                {user?.first_name || user?.email?.split("@")[0]}
              </span>
              <span className="text-[10px] font-medium text-slate-400 capitalize leading-tight">
                {user?.role === "cashier" ? "Caissier" : user?.role === "manager" ? "Manager" : user?.role}
              </span>
            </div>
            <ChevronDown size={13} className="text-slate-400" />
          </button>

          {showUserMenu && (
            <div className="absolute end-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 min-w-[200px] p-2 animate-slide-up">
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{user?.full_name || user?.first_name}</div>
                <div className="text-[11px] text-slate-400 truncate mt-0.5">{user?.email}</div>
                <div className="mt-1.5 inline-block">
                  <span className="badge badge-neutral text-[10px]">
                    {user?.role === "cashier" ? "Caissier" : user?.role === "manager" ? "Manager" : user?.role}
                  </span>
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full text-start px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl flex items-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut size={14} />
                {t("auth.logout")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Close dropdowns on outside click */}
      {(showLangMenu || showUserMenu || showNotifPanel || showBranchMenu || showThemeMenu) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowLangMenu(false);
            setShowUserMenu(false);
            setShowNotifPanel(false);
            setShowBranchMenu(false);
            setShowThemeMenu(false);
          }}
        />
      )}
    </header>
  );
}
