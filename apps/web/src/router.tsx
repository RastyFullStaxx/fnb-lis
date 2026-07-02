import { createBrowserRouter, Navigate } from "react-router";
import { LoginPage } from "./pages/login";
import { AppShell } from "./components/app-shell";
import { RootRedirect } from "./pages/root-redirect";
import { DashboardPage } from "./pages/dashboard";
import { ComingSoonPage } from "./pages/coming-soon";
import { ItemsPage } from "./pages/items";
import { StockPage } from "./pages/stock";
import { SuppliersPage } from "./pages/suppliers";

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
      { path: "counts/*", element: <ComingSoonPage title="Counts" phase={3} /> },
      { path: "purchases/*", element: <ComingSoonPage title="Purchases" phase={3} /> },
      { path: "sales/*", element: <ComingSoonPage title="Sales" phase={3} /> },
      { path: "recipes/*", element: <ComingSoonPage title="Recipes" phase={4} /> },
      { path: "imports/*", element: <ComingSoonPage title="Imports" phase={6} /> },
      { path: "reports/*", element: <ComingSoonPage title="Reports" phase={3} /> },
      { path: "items", element: <ItemsPage /> },
      { path: "suppliers", element: <SuppliersPage /> },
      { path: "settings", element: <ComingSoonPage title="Settings" phase={7} /> },
      { path: "admin/*", element: <ComingSoonPage title="Administration" phase={7} /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
