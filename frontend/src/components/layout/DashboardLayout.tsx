import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { cn } from "@/lib/utils";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import ShortcutsModal from "@/components/ui/ShortcutsModal";
import TimeAnomalyBanner from "@/components/ui/TimeAnomalyBanner";

export default function DashboardLayout() {
  const location = useLocation();
  // On New Sale (POS), collapse sidebar by default to maximize cashier screen estate
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => location.pathname !== "/sales/new");
  useGlobalShortcuts();

  // Whenever user navigates to /sales/new, automatically hide the sidebar
  useEffect(() => {
    if (location.pathname === "/sales/new") {
      setIsSidebarOpen(false);
    }
  }, [location.pathname]);

  const closeSidebar = () => {
    setIsSidebarOpen(false);
    const sidebarEl = document.querySelector(".layout-sidebar");
    if (sidebarEl && sidebarEl.contains(document.activeElement)) {
      (document.activeElement as HTMLElement)?.blur();
      window.dispatchEvent(new CustomEvent("app-shortcut-search"));
    }
  };

  useEffect(() => {
    const handleToggle = () => {
      const sidebarEl = document.querySelector(".layout-sidebar");
      const isFocusedInSidebar = !!(sidebarEl && sidebarEl.contains(document.activeElement));

      if (isSidebarOpen && isFocusedInSidebar) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("app-focus-sidebar"));
        }, 50);
      }
    };

    const handleOpen = () => {
      setIsSidebarOpen(true);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("app-focus-sidebar"));
      }, 50);
    };

    const handleClose = () => {
      setIsSidebarOpen(false);
    };

    window.addEventListener("app-toggle-sidebar", handleToggle);
    window.addEventListener("app-open-sidebar", handleOpen);
    window.addEventListener("app-close-sidebar", handleClose);

    return () => {
      window.removeEventListener("app-toggle-sidebar", handleToggle);
      window.removeEventListener("app-open-sidebar", handleOpen);
      window.removeEventListener("app-close-sidebar", handleClose);
    };
  }, [isSidebarOpen]);

  return (
    <div className={cn("dashboard-wrapper", isSidebarOpen ? "sidebar-open" : "sidebar-closed")}>
      <Topbar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      {/* Click-away backdrop when sidebar is open */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 transition-opacity lg:hidden"
          onClick={closeSidebar}
        />
      )}
      <Sidebar onItemClick={closeSidebar} isOpen={isSidebarOpen} />
      <main className="layout-main transition-all duration-300">
        <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
          <TimeAnomalyBanner />
          <Outlet />
        </div>
      </main>
      <ShortcutsModal />
    </div>
  );
}
