import { createBrowserRouter, Navigate } from "react-router";
import { LoginPage } from "./pages/login";
import { AppShell } from "./components/app-shell";
import { LandingPage } from "./pages/landing";
import { DashboardPage } from "./pages/dashboard";
import { ComingSoonPage } from "./pages/coming-soon";
import { ItemsPage } from "./pages/items";
import { StockPage } from "./pages/stock";
import { SuppliersPage } from "./pages/suppliers";
import { CountsPage } from "./pages/counts";
import { CountSessionPage } from "./pages/counts/session";
import { PurchasesPage } from "./pages/purchases";
import { PurchaseEditorPage } from "./pages/purchases/editor";
import { TransfersPage } from "./pages/transfers";
import { TransferEditorPage } from "./pages/transfers/editor";
import { SalesPage } from "./pages/sales";
import { ReportsPage } from "./pages/reports";
import { FullAuditPage } from "./pages/reports/full-audit";
import { SalesReportPage } from "./pages/reports/sales";
import { PurchaseReportPage } from "./pages/reports/purchases";
import { NonRevenueReportPage } from "./pages/reports/non-revenue";
import { TransferReportPage } from "./pages/reports/transfers";
import { CostAnalysisPage } from "./pages/reports/cost-analysis";
import { OnHandReportPage } from "./pages/reports/on-hand";
import { TopSellersPage } from "./pages/reports/top-sellers";
import { CostSnapshotPage } from "./pages/reports/cost-snapshot";
import { ForfeitsReportPage } from "./pages/reports/forfeits";
import { UsageCostReportPage } from "./pages/reports/usage-cost";
import { SalesByItemReportPage } from "./pages/reports/sales-by-item";
import { RecipesPage } from "./pages/recipes";
import { ImportsPage } from "./pages/imports";
import { ImportReviewPage } from "./pages/imports/review";
import { SettingsPage } from "./pages/settings";
import { AdminClientsPage } from "./pages/admin/clients";
import { AdminUsersPage } from "./pages/admin/users";
import { AdminActivityPage } from "./pages/admin/activity";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  // "/" is the public marketing landing (client req #8); signed-in visitors
  // are bounced to their dashboard by the landing's session probe.
  { path: "/", element: <LandingPage /> },
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
      { path: "transfers", element: <TransfersPage /> },
      { path: "transfers/:transferId", element: <TransferEditorPage /> },
      { path: "sales", element: <SalesPage /> },
      { path: "recipes", element: <RecipesPage /> },
      { path: "imports", element: <ImportsPage /> },
      { path: "imports/:batchId", element: <ImportReviewPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "reports/full-audit", element: <FullAuditPage /> },
      { path: "reports/sales", element: <SalesReportPage /> },
      { path: "reports/purchases", element: <PurchaseReportPage /> },
      { path: "reports/non-revenue", element: <NonRevenueReportPage /> },
      { path: "reports/transfers", element: <TransferReportPage /> },
      { path: "reports/cost-analysis", element: <CostAnalysisPage /> },
      { path: "reports/on-hand", element: <OnHandReportPage /> },
      { path: "reports/top-sellers", element: <TopSellersPage /> },
      { path: "reports/cost-snapshot", element: <CostSnapshotPage /> },
      { path: "reports/forfeits", element: <ForfeitsReportPage /> },
      { path: "reports/usage-cost", element: <UsageCostReportPage /> },
      { path: "reports/sales-by-item", element: <SalesByItemReportPage /> },
      { path: "reports/*", element: <ComingSoonPage title="This report" phase={5} /> },
      { path: "items", element: <ItemsPage /> },
      { path: "suppliers", element: <SuppliersPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "admin/clients", element: <AdminClientsPage /> },
      { path: "admin/users", element: <AdminUsersPage /> },
      // Subscriptions are now managed inline on the Clients page.
      // Redirect old bookmarks so nothing hard-404s.
      { path: "admin/subscriptions", element: <Navigate to="../clients" replace /> },
      { path: "admin/activity", element: <AdminActivityPage /> },
      { path: "admin/*", element: <ComingSoonPage title="Administration" phase={7} /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
