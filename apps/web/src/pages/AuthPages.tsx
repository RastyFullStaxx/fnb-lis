import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, PackageCheck, ShieldCheck, Sparkles } from "lucide-react";
import { Button, Card, Input, Select } from "../components/ui";

function BrandPanel() {
  return (
    <div className="hidden min-h-screen flex-col justify-between bg-brand-950 p-10 text-white lg:flex">
      <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-brand-500"><PackageCheck /></span><div><strong className="text-lg">FNB/LIS</strong><p className="text-xs text-blue-200">Inventory intelligence</p></div></div>
      <div className="max-w-lg">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">Know what changed. Know why.</p>
        <h1 className="mt-5 text-5xl font-bold leading-tight">Inventory work without the spreadsheet maze.</h1>
        <p className="mt-5 text-lg leading-8 text-blue-100">Count faster, reconcile every movement, and trace each result back to its source.</p>
      </div>
      <p className="text-xs text-blue-300">Secure prototype · No production data</p>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_0.85fr]">
      <BrandPanel />
      <main className="grid place-items-center p-6">
        <form className="w-full max-w-sm" onSubmit={(event) => { event.preventDefault(); navigate("/overview"); }}>
          <p className="text-sm font-semibold text-brand-600">Welcome back</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Sign in to FNB/LIS</h1>
          <p className="mt-2 text-sm text-slate-500">Use the prototype account to explore the system.</p>
          <label className="mt-7 block"><span className="field-label">Email or username</span><Input defaultValue="owner@lis.demo" /></label>
          <label className="mt-4 block"><span className="field-label">Password</span><Input type="password" defaultValue="prototype" /></label>
          <div className="mt-3 flex justify-end"><Link to="/forgot-password" className="text-sm font-semibold text-brand-600">Forgot password?</Link></div>
          <Button className="mt-6 w-full" size="lg" type="submit">Sign in <ArrowRight className="size-4" /></Button>
          <p className="mt-6 text-center text-xs text-slate-400">Prototype credentials are prefilled. No real authentication is performed.</p>
        </form>
      </main>
    </div>
  );
}

export function ForgotPasswordPage() {
  return <div className="grid min-h-screen place-items-center p-6"><Card className="w-full max-w-md p-7"><ShieldCheck className="size-9 text-brand-600" /><h1 className="mt-5 text-2xl font-bold">Reset your password</h1><p className="mt-2 text-sm text-slate-500">Enter your account email. Production will send a time-limited reset link.</p><label className="mt-6 block"><span className="field-label">Email</span><Input placeholder="name@company.com" /></label><Button className="mt-5 w-full" onClick={() => undefined}>Send reset link</Button><Link to="/login" className="mt-5 block text-center text-sm font-semibold text-brand-600">Back to sign in</Link></Card></div>;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  return <div className="min-h-screen p-6 md:p-10"><div className="mx-auto max-w-5xl"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white"><Sparkles /></span><strong>FNB/LIS setup</strong></div><div className="mt-12 grid gap-8 lg:grid-cols-[1fr_360px]"><div><p className="text-sm font-semibold text-brand-600">Step 1 of 3</p><h1 className="mt-2 text-3xl font-bold">Set up your organization</h1><p className="mt-2 text-slate-500">These defaults can be changed later without rewriting historical records.</p><div className="mt-8 grid gap-5 sm:grid-cols-2"><label><span className="field-label">Organization name</span><Input defaultValue="LIS Demo Hospitality" /></label><label><span className="field-label">First site</span><Input defaultValue="BGC Flagship" /></label><label><span className="field-label">Time zone</span><Select className="w-full"><option>Asia/Manila</option></Select></label><label><span className="field-label">Currency</span><Select className="w-full"><option>PHP — Philippine peso</option></Select></label></div><Button className="mt-8" size="lg" onClick={() => navigate("/overview")}>Create demo workspace <ArrowRight className="size-4" /></Button></div><Card className="h-fit p-6"><h2 className="font-semibold">What comes next</h2><div className="mt-5 space-y-4">{["Create storage locations","Add or import items","Configure measurement profiles","Take an opening count"].map((item) => <div key={item} className="flex gap-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="size-3.5" /></span>{item}</div>)}</div></Card></div></div></div>;
}

export function SelectSitePage() {
  const navigate = useNavigate();
  return <div className="grid min-h-screen place-items-center p-6"><div className="w-full max-w-2xl"><h1 className="text-3xl font-bold">Choose a site</h1><p className="mt-2 text-slate-500">Your inventory, audit period, and permissions follow the active site.</p><div className="mt-7 grid gap-4 sm:grid-cols-2">{["BGC Flagship","Makati Test Site"].map((site, index) => <button key={site} onClick={() => navigate("/overview")} className="rounded-xl border bg-white p-5 text-left shadow-panel transition hover:border-blue-300 hover:bg-blue-50"><strong>{site}</strong><p className="mt-1 text-sm text-slate-500">{index ? "Training data · 2 locations" : "Operational · 5 locations"}</p></button>)}</div></div></div>;
}
