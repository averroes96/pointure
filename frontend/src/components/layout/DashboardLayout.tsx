import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function DashboardLayout() {
  return (
    <>
      <Topbar />
      <Sidebar />
      <main className="layout-main">
        <div className="p-5 max-w-screen-2xl mx-auto">
          <Outlet />
        </div>
      </main>
    </>
  );
}
