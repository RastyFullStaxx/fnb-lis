import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ClipboardCheck, FileUp, PackagePlus, Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { activity, items, reportTrend } from "../data/fixtures";
import { money } from "../lib/utils";
import { Badge, Button, Card, CardHeader, PageHeader, Progress, StatCard, TableShell } from "../components/ui";
import { useApp } from "../context/AppContext";

export function OverviewPage() {
  const { role, approvals } = useApp();
  const pending = approvals.filter((item) => item.status === "Pending").length;
  const stockValue = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="page-grid">
      <PageHeader eyebrow="Tuesday, June 30" title={`Good morning${role === "owner" ? ", Lourd" : ""}`} description="Start with the work that needs attention. Every number below links back to its source." actions={<><Link to="/audits/AUD-2026-0628/count"><Button variant="secondary"><ClipboardCheck className="size-4" />Continue count</Button></Link><Link to="/purchases/new"><Button><PackagePlus className="size-4" />Receive purchase</Button></Link></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Audit progress" value="72%" detail="43 of 60 scoped items counted" tone="info" />
        <StatCard label="Inventory value" value={money(stockValue)} detail="Across 5 active locations" tone="success" />
        <StatCard label="Needs attention" value="7" detail="2 low stock · 3 variances · 2 imports" tone="warning" />
        <StatCard label="Pending approvals" value={role === "owner" ? String(pending) : "—"} detail={role === "owner" ? "Oldest waiting 1 hour" : "Owner-only queue"} tone={pending ? "danger" : "neutral"} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader title="Audit period health" description="Physical depletion compared with explained activity." action={<Link to="/reports/audit-reconciliation" className="text-sm font-semibold text-brand-600">Open report →</Link>} />
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={reportTrend}><CartesianGrid vertical={false} stroke="#e2e8f0" /><XAxis dataKey="period" tickLine={false} axisLine={false} fontSize={12} /><YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => `₱${value / 1000}k`} /><Tooltip formatter={(value: number) => money(value)} /><Bar dataKey="usage" name="Physical depletion" fill="#1d4ed8" radius={[4,4,0,0]} /><Bar dataKey="explained" name="Explained" fill="#93c5fd" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Priority queue" description="Ranked by operational risk." />
          <div className="divide-y">
            {[
              ["Resolve 3 audit variances", "Before audit close", "/audits/AUD-2026-0628/reconcile", "danger"],
              ["Map 2 POS import rows", "IMP-308 · 42 minutes", "/imports/IMP-308/mapping", "warning"],
              ["Review Dark Rum stock", "4.75 bottles below par", "/inventory/items/rum-750", "warning"],
              ["Confirm produce receipt", "RCV-1047 · 1 discrepancy", "/purchases/RCV-1047", "info"]
            ].map(([title, detail, to, tone]) => <Link key={title} to={to} className="flex items-center gap-3 p-4 hover:bg-slate-50"><span className="grid size-9 place-items-center rounded-lg bg-slate-100"><AlertTriangle className="size-4 text-slate-600" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{title}</strong><small className="text-slate-500">{detail}</small></span><Badge tone={tone as "danger" | "warning" | "info"}>Open</Badge></Link>)}
          </div>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_0.75fr]">
        <Card>
          <CardHeader title="Recent activity" description="Human-readable history with source records." action={<Link to="/audit-log" className="text-sm font-semibold text-brand-600">View all →</Link>} />
          <TableShell><table className="data-table"><thead><tr><th>Action</th><th>Record</th><th>Actor</th><th>When</th></tr></thead><tbody>{activity.map((row) => <tr key={row.id}><td className="font-medium">{row.action}</td><td>{row.subject}</td><td>{row.actor}</td><td className="text-slate-500">{row.time}</td></tr>)}</tbody></table></TableShell>
        </Card>
        <Card className="overflow-hidden bg-brand-950 text-white">
          <div className="p-6"><div className="flex items-center gap-2 text-blue-200"><Sparkles className="size-4" /><span className="text-xs font-bold uppercase tracking-widest">Stocky insight</span></div><h2 className="mt-5 text-2xl font-bold">Most unexplained value is concentrated in two items.</h2><p className="mt-3 leading-6 text-blue-100">Dark Rum and Beef Tenderloin represent 68% of the current draft variance. Review their count evidence before closing.</p><Link to="/audits/AUD-2026-0628/reconcile"><Button className="mt-6 bg-white text-brand-950 hover:bg-blue-50">Review variance <ArrowRight className="size-4" /></Button></Link></div>
          <div className="border-t border-blue-800 bg-brand-700/30 p-5"><div className="flex justify-between text-xs text-blue-100"><span>Audit completion</span><span>72%</span></div><div className="mt-2"><Progress value={72} /></div></div>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2"><Link to="/imports/new"><Button variant="secondary"><FileUp className="size-4" />Import a file</Button></Link><Link to="/stocky"><Button variant="ghost"><Sparkles className="size-4" />Ask Stocky</Button></Link></div>
    </div>
  );
}
