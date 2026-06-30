import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell, Forbidden } from "./components/AppShell";
import { useApp } from "./context/AppContext";
import type { Role } from "./types";
import { ForgotPasswordPage, LoginPage, OnboardingPage, SelectSitePage } from "./pages/AuthPages";
import { OverviewPage } from "./pages/OverviewPage";
import { InventoryItemPage, InventoryPage, StockActionPage } from "./pages/InventoryPages";
import { AuditsPage, AuditWorkspace, NewAuditPage } from "./pages/AuditPages";
import { PurchaseEditor, PurchasesPage, UsageEditor, UsagePage } from "./pages/OperationsPages";
import { ImportsPage, ImportWorkspace, NewImportPage } from "./pages/ImportPages";
import { ItemEditor, ItemsPage, RecipeEditor, RecipesPage, SupplierEditor, SuppliersPage, UnitsPage } from "./pages/CatalogPages";
import {
  ApprovalDetailPage, ApprovalsPage, AuditLogPage, HelpPage, OrganizationPage,
  ReportsPage, ReportViewer, SettingsPage, StockyPage, TeamPage
} from "./pages/ReportsAdminPages";

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { role } = useApp();
  return roles.includes(role) ? children : <Forbidden />;
}

function NotFound() {
  return <div className="grid min-h-[65vh] place-items-center text-center"><div><p className="text-sm font-bold uppercase tracking-widest text-brand-600">404</p><h1 className="mt-3 text-3xl font-bold">Page not found</h1><p className="mt-2 text-slate-500">The requested prototype route does not exist.</p></div></div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/select-site" element={<SelectSitePage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/items/:itemId" element={<InventoryItemPage />} />
        <Route path="/inventory/actions/new" element={<RequireRole roles={["owner","staff"]}><StockActionPage /></RequireRole>} />
        <Route path="/audits" element={<AuditsPage />} />
        <Route path="/audits/new" element={<RequireRole roles={["owner","staff"]}><NewAuditPage /></RequireRole>} />
        <Route path="/audits/:auditId" element={<AuditWorkspace />} />
        <Route path="/audits/:auditId/count" element={<RequireRole roles={["owner","staff"]}><AuditWorkspace /></RequireRole>} />
        <Route path="/audits/:auditId/review" element={<RequireRole roles={["owner","staff"]}><AuditWorkspace /></RequireRole>} />
        <Route path="/audits/:auditId/reconcile" element={<AuditWorkspace />} />
        <Route path="/audits/:auditId/report" element={<AuditWorkspace />} />
        <Route path="/purchases" element={<RequireRole roles={["owner","staff"]}><PurchasesPage /></RequireRole>} />
        <Route path="/purchases/new" element={<RequireRole roles={["owner","staff"]}><PurchaseEditor /></RequireRole>} />
        <Route path="/purchases/:purchaseId" element={<RequireRole roles={["owner","staff"]}><PurchaseEditor /></RequireRole>} />
        <Route path="/usage" element={<RequireRole roles={["owner","staff"]}><UsagePage /></RequireRole>} />
        <Route path="/usage/new" element={<RequireRole roles={["owner","staff"]}><UsageEditor /></RequireRole>} />
        <Route path="/usage/:usageId" element={<RequireRole roles={["owner","staff"]}><UsageEditor /></RequireRole>} />
        <Route path="/imports" element={<RequireRole roles={["owner","staff"]}><ImportsPage /></RequireRole>} />
        <Route path="/imports/new" element={<RequireRole roles={["owner","staff"]}><NewImportPage /></RequireRole>} />
        <Route path="/imports/:importId/review" element={<RequireRole roles={["owner","staff"]}><ImportWorkspace /></RequireRole>} />
        <Route path="/imports/:importId/mapping" element={<RequireRole roles={["owner","staff"]}><ImportWorkspace /></RequireRole>} />
        <Route path="/imports/:importId/summary" element={<RequireRole roles={["owner","staff"]}><ImportWorkspace /></RequireRole>} />
        <Route path="/catalog/items" element={<RequireRole roles={["owner","staff"]}><ItemsPage /></RequireRole>} />
        <Route path="/catalog/items/new" element={<RequireRole roles={["owner"]}><ItemEditor /></RequireRole>} />
        <Route path="/catalog/items/:itemId" element={<RequireRole roles={["owner","staff"]}><ItemEditor /></RequireRole>} />
        <Route path="/catalog/units" element={<RequireRole roles={["owner"]}><UnitsPage /></RequireRole>} />
        <Route path="/recipes" element={<RequireRole roles={["owner","staff"]}><RecipesPage /></RequireRole>} />
        <Route path="/recipes/new" element={<RequireRole roles={["owner","staff"]}><RecipeEditor /></RequireRole>} />
        <Route path="/recipes/:recipeId" element={<RequireRole roles={["owner","staff"]}><RecipeEditor /></RequireRole>} />
        <Route path="/recipes/:recipeId/versions" element={<RequireRole roles={["owner","staff"]}><RecipeEditor /></RequireRole>} />
        <Route path="/suppliers" element={<RequireRole roles={["owner","staff"]}><SuppliersPage /></RequireRole>} />
        <Route path="/suppliers/new" element={<RequireRole roles={["owner"]}><SupplierEditor /></RequireRole>} />
        <Route path="/suppliers/:supplierId" element={<RequireRole roles={["owner","staff"]}><SupplierEditor /></RequireRole>} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:reportKey" element={<ReportViewer />} />
        <Route path="/approvals" element={<RequireRole roles={["owner"]}><ApprovalsPage /></RequireRole>} />
        <Route path="/approvals/:approvalId" element={<RequireRole roles={["owner"]}><ApprovalDetailPage /></RequireRole>} />
        <Route path="/audit-log" element={<AuditLogPage />} />
        <Route path="/audit-log/:logId" element={<AuditLogPage />} />
        <Route path="/team" element={<RequireRole roles={["owner"]}><TeamPage /></RequireRole>} />
        <Route path="/team/roles" element={<RequireRole roles={["owner"]}><TeamPage /></RequireRole>} />
        <Route path="/team/:memberId" element={<RequireRole roles={["owner"]}><TeamPage /></RequireRole>} />
        <Route path="/organization/sites" element={<RequireRole roles={["owner"]}><OrganizationPage /></RequireRole>} />
        <Route path="/organization/locations" element={<RequireRole roles={["owner"]}><OrganizationPage /></RequireRole>} />
        <Route path="/settings/:section" element={<RequireRole roles={["owner"]}><SettingsPage /></RequireRole>} />
        <Route path="/stocky" element={<StockyPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/help/:article" element={<HelpPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
