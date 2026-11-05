import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { canAccessPath } from "@/lib/roleAccess";

export const ACCESS_DENIED_EVENT = "app-access-denied";

/**
 * Route guard enforcing the role matrix (see `@/lib/roleAccess`).
 * Redirects to `/` and raises a translated notice when the current user's
 * role cannot open the requested path.
 */
export default function RequireRole({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const allowed = canAccessPath(user?.role, location.pathname);

  useEffect(() => {
    if (!allowed) window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT));
  }, [allowed]);

  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Global notice shown after a role-based redirect. Mount once near the app root. */
export function AccessDeniedNotice() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onDenied = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), 4000);
    };
    window.addEventListener(ACCESS_DENIED_EVENT, onDenied);
    return () => {
      window.removeEventListener(ACCESS_DENIED_EVENT, onDenied);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 start-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-slate-900 px-4 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-300 shadow-lg"
    >
      <ShieldAlert size={16} className="shrink-0" />
      {t("auth.access_denied", "You don't have permission to access this page.")}
    </div>
  );
}

