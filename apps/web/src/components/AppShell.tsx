import { useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Archive, BarChart3, Bell, Bot, Boxes, Building2, CheckSquare, ChevronDown,
  ClipboardCheck, FileClock, FileUp, HelpCircle, Menu, Package, PanelLeftClose,
  ReceiptText, Search, Settings, ShieldCheck, ShoppingCart, Tags, Users, Utensils,
  X
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { cn } from "../lib/utils";
import type { NavItem } from "../types";
import { Badge, Button, Input, Select } from "./ui";

const icons = {
  overview: BarChart3,
  audits: ClipboardCheck,
  inventory: Boxes,
  purchases: ShoppingCart,
  usage: ReceiptText,
  imports: FileUp,
  reports: BarChart3,
  items: Package,
  recipes: Utensils,
  suppliers: Building2,
  approvals: CheckSquare,
  log: FileClock,
  team: Users,
  organization: Archive,
  settings: Settings,
  help: HelpCircle
};

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { label: "Overview", to: "/overview", icon: "overview" },
      { label: "Audits", to: "/audits", icon: "audits" },
      { label: "Inventory", to: "/inventory", icon: "inventory" },
      { label: "Purchases", to: "/purchases", icon: "purchases", roles: ["owner", "staff"] },
      { label: "Usage & Sales", to: "/usage", icon: "usage", roles: ["owner", "staff"] },
      { label: "Imports", to: "/imports", icon: "imports", roles: ["owner", "staff"] }
    ]
  },
  {
    label: "Analyze",
    items: [{ label: "Reports", to: "/reports", icon: "reports" }]
  },
  {
    label: "Manage",
    items: [
      { label: "Items", to: "/catalog/items", icon: "items", roles: ["owner", "staff"] },
      { label: "Recipes", to: "/recipes", icon: "recipes", roles: ["owner", "staff"] },
      { label: "Suppliers", to: "/suppliers", icon: "suppliers", roles: ["owner", "staff"] },
      { label: "Approvals", to: "/approvals", icon: "approvals", roles: ["owner"], badge: "3" },
      { label: "Audit Log", to: "/audit-log", icon: "log" }
    ]
  }
];

export function AppShell() {
  const { role, setRole, site, setSite, toast } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [stockyOpen, setStockyOpen] = useState(false);
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return groups.flatMap((group) => group.items).filter((item) => item.label.toLowerCase().includes(q)).slice(0, 5);
  }, [query]);

  const sidebar = (
    <aside className={cn("flex h-full flex-col border-r bg-white transition-[width] duration-150", collapsed ? "w-[76px]" : "w-64")}>
      <div className="flex h-16 items-center justify-between border-b px-4">
        <Link to="/overview" className="flex items-center gap-3 overflow-hidden" aria-label="FNB/LIS home">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"><Tags className="size-5" /></span>
          {!collapsed ? <span><strong className="block leading-none">FNB/LIS</strong><small className="text-[10px] font-bold uppercase tracking-widest text-brand-600">Inventory intelligence</small></span> : null}
        </Link>
        {!collapsed ? <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar"><PanelLeftClose className="size-4" /></Button> : null}
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        {groups.map((group) => {
          const visible = group.items.filter((item) => !item.roles || item.roles.includes(role));
          return (
            <section key={group.label} className="mb-5">
              {!collapsed ? <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{group.label}</p> : null}
              <div className="space-y-1">
                {visible.map((item) => {
                  const Icon = icons[item.icon as keyof typeof icons];
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) => cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")}
                    >
                      <Icon className="size-4 shrink-0" />
                      {!collapsed ? <><span className="flex-1">{item.label}</span>{item.badge ? <Badge tone="warning">{item.badge}</Badge> : null}</> : null}
                    </NavLink>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <NavLink to="/settings/general" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"><Settings className="size-4" />{!collapsed ? "Settings" : null}</NavLink>
        <NavLink to="/help" className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"><HelpCircle className="size-4" />{!collapsed ? "Help" : null}</NavLink>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:block">{sidebar}</div>
      {mobileOpen ? <div className="fixed inset-0 z-50 flex bg-slate-950/35 lg:hidden"><div className="h-full">{sidebar}</div><button className="flex-1" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /></div> : null}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-white/90 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></Button>
          {collapsed ? <Button variant="ghost" className="hidden lg:inline-flex" onClick={() => setCollapsed(false)} aria-label="Expand navigation"><Menu className="size-5" /></Button> : null}
          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-3 size-4 text-slate-400" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search pages and records…" aria-label="Search" />
            {matches.length ? <div className="absolute top-12 z-50 w-full rounded-xl border bg-white p-2 shadow-xl">{matches.map((item) => <button key={item.to} onClick={() => { navigate(item.to); setQuery(""); }} className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">{item.label}</button>)}</div> : null}
          </div>
          <Select value={site} onChange={(event) => setSite(event.target.value)} aria-label="Active site" className="max-w-40">
            <option>BGC Flagship</option><option>Makati Test Site</option>
          </Select>
          <Select value={role} onChange={(event) => setRole(event.target.value as typeof role)} aria-label="Demo role" className="max-w-28">
            <option value="owner">Owner</option><option value="staff">Staff</option><option value="auditor">Auditor</option>
          </Select>
          <Button variant="ghost" aria-label="Notifications"><Bell className="size-4" /></Button>
          <Button variant="secondary" onClick={() => setStockyOpen(true)}><Bot className="size-4 text-brand-600" /><span className="hidden sm:inline">Stocky</span></Button>
          <div className="hidden size-9 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white sm:grid">LB</div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 md:p-6 lg:p-8" key={location.pathname}><Outlet /></main>
      </div>
      {stockyOpen ? <StockyDrawer onClose={() => setStockyOpen(false)} /> : null}
      {toast ? <div role="status" className="fixed bottom-5 right-5 z-[70] rounded-xl bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-xl">{toast}</div> : null}
    </div>
  );
}

function StockyDrawer({ onClose }: { onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("I can explain this audit, find a record, or help review an import. I will not post or approve work.");
  const ask = () => {
    const lower = question.toLowerCase();
    setAnswer(lower.includes("variance") ? "The June 28 variance is driven by Dark Rum and Beef Tenderloin. Open the reconciliation report to inspect beginning count, activity, and ending count." : lower.includes("import") ? "IMP-308 has two rows requiring review. No inventory has been changed because the batch is still staged." : "I found the closest workflow in FNB/LIS Help. I can take you there or summarize the relevant records.");
    setQuestion("");
  };
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-950/30">
      <button className="flex-1" onClick={onClose} aria-label="Close Stocky" />
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" aria-label="Stocky assistant">
        <div className="flex items-center justify-between border-b p-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white"><Bot /></span><div><strong>Stocky</strong><p className="text-xs text-emerald-600">Read-only assistant</p></div></div><Button variant="ghost" onClick={onClose} aria-label="Close Stocky"><X className="size-5" /></Button></div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5"><div className="rounded-2xl rounded-tl-sm bg-slate-100 p-4 text-sm leading-6 text-slate-700">{answer}</div><div className="grid gap-2">{["Why is this audit short?", "Which import rows need review?", "Explain open-bottle counting"].map((text) => <button key={text} onClick={() => setQuestion(text)} className="rounded-lg border p-3 text-left text-sm font-medium hover:bg-blue-50">{text}</button>)}</div><Link to="/stocky" onClick={onClose} className="block text-sm font-semibold text-brand-600">Open Stocky workspace →</Link></div>
        <form className="flex gap-2 border-t p-4" onSubmit={(event) => { event.preventDefault(); ask(); }}><Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your inventory…" /><Button type="submit" disabled={!question.trim()}>Ask</Button></form>
      </aside>
    </div>
  );
}

export function Forbidden() {
  return <div className="grid min-h-[65vh] place-items-center text-center"><div><ShieldCheck className="mx-auto size-10 text-slate-300" /><h1 className="mt-4 text-2xl font-bold">This view is restricted</h1><p className="mt-2 text-slate-500">Your current demo role does not have access to this workflow.</p><Link to="/overview" className="mt-5 inline-block font-semibold text-brand-600">Return to overview</Link></div></div>;
}
