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
import { RecipesPage } from "./pages/recipes";

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
      { path: "imports/*", element: <ComingSoonPage title="Imports" phase={6} /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "reports/full-audit", element: <FullAuditPage /> },
      { path: "reports/*", element: <ComingSoonPage title="This report" phase={5} /> },
      { path: "items", element: <ItemsPage /> },
      { path: "suppliers", element: <SuppliersPage /> },
      { path: "settings", element: <ComingSoonPage title="Settings" phase={7} /> },
      { path: "admin/*", element: <ComingSoonPage title="Administration" phase={7} /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
