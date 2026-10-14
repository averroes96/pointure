import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { cn } from "@/lib/utils";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import ShortcutsModal from "@/components/ui/ShortcutsModal";

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

  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div className={cn("dashboard-wrapper", isSidebarOpen ? "sidebar-open" : "sidebar-closed")}>
      <Topbar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      {/* Click-away backdrop when sidebar is open */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 backdrop-blur-xs transition-opacity lg:hidden"
          onClick={closeSidebar}
        />
      )}
      <Sidebar onItemClick={closeSidebar} />
      <main className="layout-main transition-all duration-300">
        <div className="p-4 md:p-5 max-w-screen-2xl mx-auto">
          <Outlet />
        </div>
      </main>
      <ShortcutsModal />
    </div>
  );
}
