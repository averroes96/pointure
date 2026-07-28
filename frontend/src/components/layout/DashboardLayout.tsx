import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { cn } from "@/lib/utils";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

export default function DashboardLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  useGlobalShortcuts();

  return (
    <div className={cn("dashboard-wrapper", isSidebarOpen ? "sidebar-open" : "sidebar-closed")}>
      <Topbar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar />
      <main className="layout-main transition-all duration-300">
        <div className="p-5 max-w-screen-2xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
