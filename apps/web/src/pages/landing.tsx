import { Link, Navigate } from "react-router";
import { ArrowRight, BarChart3, ClipboardList, ExternalLink, PlayCircle, SearchCheck } from "lucide-react";
import { useMe } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { InventoryIllustration } from "@/components/brand/inventory-illustration";
import lisLogo from "@/assets/lis-logo.png";

// ── Marketing assets (client req #8) ─────────────────────────────────────────
// ponytail: both are placeholders until the client sends the real assets —
// swap FACEBOOK_URL for the page link and set PROMO_VIDEO_SRC to an imported
// mp4 (plus a poster image) to light up the video block. Nothing else changes.
const FACEBOOK_URL: string | null = null;
const PROMO_VIDEO_SRC: string | null = null;

const STEPS = [
  {
    icon: ClipboardList,
    title: "Count",
    text: "Fast physical counts — full units or straight off the scale, bar bottles and kitchen weights alike.",
  },
  {
    icon: BarChart3,
    title: "Reconcile",
    text: "Beginning + purchases + returns − ending, against what was sold and used. The math the audit stands on.",
  },
  {
    icon: SearchCheck,
    title: "Trace",
    text: "Every variance drills to its source records — sales, transfers, spillage — nothing unexplained.",
  },
];

/**
 * Public landing page (client req #8). Renders instantly for visitors; a
 * signed-in user hitting "/" is bounced straight to their dashboard once the
 * background session probe resolves.
 */
export function LandingPage() {
  const me = useMe();
  const firstLocation = me.data?.clients.flatMap((c) => c.locations)[0];
  if (firstLocation) return <Navigate to={`/l/${firstLocation.id}/dashboard`} replace />;
  // Signed in, but no location to land on — say so instead of silently
  // looping between the landing and the login form.
  const signedInNoLocations = Boolean(me.data) && !firstLocation;

  return (
    <div className="min-h-dvh bg-sidebar text-sidebar-foreground">
      {signedInNoLocations && (
        <div role="status" className="bg-background px-6 py-2.5 text-center text-sm text-foreground">
          You're signed in as {me.data!.user.username}, but no client locations are assigned to your account yet —
          ask an administrator to assign you.
        </div>
      )}
      {/* Top bar */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="-ml-3 flex items-center gap-2.5">
          <img src={lisLogo} alt="" className="size-[64px] object-contain" />
          <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/60">FNB/LIS</span>
        </div>
        <Button asChild variant="outline" className="border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Link to="/login">Sign in</Link>
        </Button>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-5xl items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:py-20">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-sidebar-foreground/60">
            Liquor Inventory Solution
          </p>
          <h1 className="mt-3 text-balance text-4xl font-semibold leading-tight tracking-tight">
            Your partner in inventory management
          </h1>
          <p className="mt-4 max-w-md text-pretty text-base text-sidebar-foreground/75">
            Audit-grade bar, kitchen, and asset inventory for hospitality — physical counts to reconciled
            reports your accountants and auditors can stand behind.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="min-h-11">
              <Link to="/login">
                Open the system <ArrowRight className="size-4" />
              </Link>
            </Button>
            {FACEBOOK_URL && (
              <Button asChild variant="outline" size="lg" className="min-h-11 border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <a href={FACEBOOK_URL} target="_blank" rel="noreferrer">
                  Find us on Facebook <ExternalLink className="size-4" />
                </a>
              </Button>
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-background p-8 text-foreground shadow-lg">
          <InventoryIllustration className="w-full" />
        </div>
      </section>

      {/* The three-step product truth */}
      <section className="border-t border-sidebar-border/60 bg-sidebar-accent/20">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-12 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.title}>
              <s.icon className="size-6 text-sidebar-foreground/70" aria-hidden />
              <h2 className="mt-3 text-lg font-semibold">{s.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-sidebar-foreground/70">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Promo video slot — lights up when the client's asset lands */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="overflow-hidden rounded-2xl border border-sidebar-border/60">
          {PROMO_VIDEO_SRC ? (
            <video controls preload="metadata" className="aspect-video w-full bg-black" src={PROMO_VIDEO_SRC} />
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-sidebar-accent/30 text-sidebar-foreground/60">
              <PlayCircle className="size-10" aria-hidden />
              <p className="text-sm">A short tour of our products and services is on its way.</p>
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-sidebar-border/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-sidebar-foreground/60">
          <span>© {new Date().getFullYear()} Liquor Inventory Solution. All rights reserved.</span>
          <span>Your partner in inventory management</span>
        </div>
      </footer>
    </div>
  );
}
