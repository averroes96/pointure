import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { AuthProvider, useAuth } from "@/features/auth/AuthContext";
import { BranchProvider } from "@/features/auth/BranchContext";
import DashboardLayout from "@/components/layout/DashboardLayout";
import api from "@/lib/api";

// ── Setup redirect: checks once on mount whether setup is needed ─────────────
function SetupRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    api
      .get("/setup/status/")
      .then((r) => {
        if (r.data.needed) navigate("/setup", { replace: true });
      })
      .catch(() => {});
  }, [navigate]);
  return null;
}

// Lazy-loaded pages
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const SetupPage = lazy(() => import("@/features/auth/SetupPage"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/features/auth/ResetPasswordPage"));
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));

// Inventory
const ProductsPage = lazy(() => import("@/features/inventory/ProductsPage"));
const ProductDetailPage = lazy(() => import("@/features/inventory/ProductDetailPage"));
const ProductFormPage = lazy(() => import("@/features/inventory/ProductFormPage"));
const StockMovementsPage = lazy(() => import("@/features/inventory/StockMovementsPage"));
const StockTransferPage = lazy(() => import("@/features/inventory/StockTransferPage"));
const LowStockPage = lazy(() => import("@/features/inventory/LowStockPage"));

// Sales
const SalesPage = lazy(() => import("@/features/sales/SalesPage"));
const SalesHistoryPage = lazy(() => import("@/features/sales/SalesHistoryPage"));

// Invoicing
const InvoiceListPage = lazy(() => import("@/features/invoicing/InvoiceListPage"));
const InvoiceBuilderPage = lazy(() => import("@/features/invoicing/InvoiceBuilderPage"));
const DeliveryNotesPage = lazy(() => import("@/features/invoicing/DeliveryNotesPage"));
const DeliveryNoteFormPage = lazy(() => import("@/features/invoicing/DeliveryNoteFormPage"));
const CreditNotesPage = lazy(() => import("@/features/invoicing/CreditNotesPage"));
const CreditNoteFormPage = lazy(() => import("@/features/invoicing/CreditNoteFormPage"));

// Clients
const ClientsPage = lazy(() => import("@/features/clients/ClientsPage"));
const ClientDetailPage = lazy(() => import("@/features/clients/ClientDetailPage"));
const ClientFormPage = lazy(() => import("@/features/clients/ClientFormPage"));
const DebtAgeingPage = lazy(() => import("@/features/clients/DebtAgeingPage"));
const ChequePage = lazy(() => import("@/features/clients/ChequePage"));

// Suppliers
const SuppliersPage = lazy(() => import("@/features/suppliers/SuppliersPage"));
const SupplierDetailPage = lazy(() => import("@/features/suppliers/SupplierDetailPage"));
const SupplierFormPage = lazy(() => import("@/features/suppliers/SupplierFormPage"));
const PurchaseOrderListPage = lazy(() => import("@/features/suppliers/PurchaseOrderListPage"));
const PurchaseOrderFormPage = lazy(() => import("@/features/suppliers/PurchaseOrderFormPage"));
const PurchaseOrderDetailPage = lazy(() => import("@/features/suppliers/PurchaseOrderDetailPage"));

// Reports
const DailyReportPage = lazy(() => import("@/features/reports/DailyReportPage"));
const SalesReportPage = lazy(() => import("@/features/reports/SalesReportPage"));
const StockReportPage = lazy(() => import("@/features/reports/StockReportPage"));

// Settings
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const AuditLogPage = lazy(() => import("@/features/settings/AuditLogPage"));

// UI
const UpgradePromptModal = lazy(() => import("@/components/ui/UpgradePromptModal"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-text-muted text-sm">Chargement...</div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageFallback />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Suspense fallback={null}><UpgradePromptModal /></Suspense>
      <SetupRedirect />
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />

          {/* Sales */}
          <Route path="sales">
            <Route index element={<SalesHistoryPage />} />
            <Route path="new" element={<SalesPage />} />
          </Route>

          {/* Invoicing */}
          <Route path="invoices">
            <Route index element={<InvoiceListPage />} />
            <Route path="new" element={<InvoiceBuilderPage />} />
          </Route>
          <Route path="delivery-notes">
            <Route index element={<DeliveryNotesPage />} />
            <Route path="new" element={<DeliveryNoteFormPage />} />
          </Route>
          <Route path="credit-notes">
            <Route index element={<CreditNotesPage />} />
            <Route path="new" element={<CreditNoteFormPage />} />
          </Route>

          {/* Inventory */}
          <Route path="inventory">
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/new" element={<ProductFormPage />} />
            <Route path="products/:id" element={<ProductDetailPage />} />
            <Route path="products/:id/edit" element={<ProductFormPage />} />
            <Route path="movements" element={<StockMovementsPage />} />
            <Route path="transfers" element={<StockTransferPage />} />
            <Route path="low-stock" element={<LowStockPage />} />
          </Route>

          {/* Clients */}
          <Route path="clients">
            <Route index element={<ClientsPage />} />
            <Route path="new" element={<ClientFormPage />} />
            <Route path=":id" element={<ClientDetailPage />} />
            <Route path=":id/edit" element={<ClientFormPage />} />
            <Route path="ageing" element={<DebtAgeingPage />} />
          </Route>
          <Route path="cheques" element={<ChequePage />} />

          {/* Suppliers */}
          <Route path="suppliers">
            <Route index element={<SuppliersPage />} />
            <Route path="new" element={<SupplierFormPage />} />
            <Route path=":id" element={<SupplierDetailPage />} />
            <Route path=":id/edit" element={<SupplierFormPage />} />
          </Route>

          {/* Purchase Orders */}
          <Route path="purchase-orders">
            <Route index element={<PurchaseOrderListPage />} />
            <Route path="new" element={<PurchaseOrderFormPage />} />
            <Route path=":id" element={<PurchaseOrderDetailPage />} />
          </Route>

          {/* Reports */}
          <Route path="reports">
            <Route path="daily" element={<DailyReportPage />} />
            <Route path="sales" element={<SalesReportPage />} />
            <Route path="stock" element={<StockReportPage />} />
          </Route>

          {/* Settings */}
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/audit-log" element={<AuditLogPage />} />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BranchProvider>
          <AppRoutes />
        </BranchProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
