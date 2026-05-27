import { useTranslation } from "react-i18next";
import { Bell, ChevronDown, Globe, LogOut, User } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { applyDirection } from "@/lib/i18n";
import i18n from "i18next";
import { useQuery } from "@tanstack/react-query";
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

export default function Topbar() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const { data: unreadCount } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api.get<{ count: number }>("/notifications/unread_count/").then((r) => r.data.count),
    refetchInterval: 60000,
  });

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    applyDirection(code);
    setShowLangMenu(false);
  };

  return (
    <header className="layout-topbar">
      {/* Logo (mobile) */}
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xl hidden xs:block">👟</span>
        <span className="font-bold text-primary-500 hidden xs:block">ShoeDZ</span>
      </div>

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
        <button className="btn-ghost btn-sm relative">
          <Bell size={18} />
          {(unreadCount ?? 0) > 0 && (
            <span className="absolute -top-0.5 -end-0.5 w-4 h-4 bg-danger rounded-full text-white text-2xs flex items-center justify-center font-bold">
              {(unreadCount ?? 0) > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

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
      {(showLangMenu || showUserMenu) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowLangMenu(false); setShowUserMenu(false); }}
        />
      )}
    </header>
  );
}
