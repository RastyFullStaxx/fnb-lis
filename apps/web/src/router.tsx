import { createBrowserRouter, Navigate } from "react-router";
import { LoginPage } from "./pages/login";
import { AppShell } from "./components/app-shell";
import { RootRedirect } from "./pages/root-redirect";
import { DashboardPage } from "./pages/dashboard";
import { ComingSoonPage } from "./pages/coming-soon";
import { ItemsPage } from "./pages/items";
import { StockPage } from "./pages/stock";
import { SuppliersPage } from "./pages/suppliers";
import { CountsPage } from "./pages/counts";
import { CountSessionPage } from "./pages/counts/session";
import { PurchasesPage } from "./pages/purchases";
import { PurchaseEditorPage } from "./pages/purchases/editor";
import { SalesPage } from "./pages/sales";
import { ReportsPage } from "./pages/reports";
import { FullAuditPage } from "./pages/reports/full-audit";
import { SalesReportPage } from "./pages/reports/sales";
import { PurchaseReportPage } from "./pages/reports/purchases";
import { NonRevenueReportPage } from "./pages/reports/non-revenue";
import { OnHandReportPage } from "./pages/reports/on-hand";
import { RecipesPage } from "./pages/recipes";
import { ImportsPage } from "./pages/imports";
import { ImportReviewPage } from "./pages/imports/review";
import { SettingsPage } from "./pages/settings";
import { AdminClientsPage } from "./pages/admin/clients";
import { AdminUsersPage } from "./pages/admin/users";
import { AdminActivityPage } from "./pages/admin/activity";
import { AdminSubscriptionsPage } from "./pages/admin/subscriptions";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <RootRedirect /> },
  {
    path: "/l/:locationId",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "stock", element: <StockPage /> },
      { path: "counts", element: <CountsPage /> },
      { path: "counts/:sessionId", element: <CountSessionPage /> },
      { path: "purchases", element: <PurchasesPage /> },
      { path: "purchases/:purchaseId", element: <PurchaseEditorPage /> },
      { path: "sales", element: <SalesPage /> },
      { path: "recipes", element: <RecipesPage /> },
      { path: "imports", element: <ImportsPage /> },
      { path: "imports/:batchId", element: <ImportReviewPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "reports/full-audit", element: <FullAuditPage /> },
      { path: "reports/sales", element: <SalesReportPage /> },
      { path: "reports/purchases", element: <PurchaseReportPage /> },
      { path: "reports/non-revenue", element: <NonRevenueReportPage /> },
      { path: "reports/on-hand", element: <OnHandReportPage /> },
      { path: "reports/*", element: <ComingSoonPage title="This report" phase={5} /> },
      { path: "items", element: <ItemsPage /> },
      { path: "suppliers", element: <SuppliersPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "admin/clients", element: <AdminClientsPage /> },
      { path: "admin/users", element: <AdminUsersPage /> },
      { path: "admin/subscriptions", element: <AdminSubscriptionsPage /> },
      { path: "admin/activity", element: <AdminActivityPage /> },
      { path: "admin/*", element: <ComingSoonPage title="Administration" phase={7} /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
