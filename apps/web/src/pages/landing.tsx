import { Link, Navigate } from "react-router";
import { ArrowRight, ExternalLink, PlayCircle } from "lucide-react";
import { useMe } from "@/api/auth";
import { Button } from "@/components/ui/button";
import lisLogo from "@/assets/lis-logo.png";

// ── Marketing assets (client req #8) ─────────────────────────────────────────
// ponytail: both are placeholders until the client sends the real assets —
// swap FACEBOOK_URL for the page link and set PROMO_VIDEO_SRC to an imported
// mp4 (plus a poster image) to light up the video block. Nothing else changes.
const FACEBOOK_URL: string | null = null;
const PROMO_VIDEO_SRC: string | null = null;

/**
 * Public landing page (client req #8). Royal-ink drench — the brand's one
 * committed surface carries the whole page, and the hero imagery is the
 * product itself: a Full Audit verdict card with the numbers the engine
 * actually produces (the golden fixture). Renders instantly for visitors; a
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
        <Button
          asChild
          variant="outline"
          className="border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Link to="/login">Sign In</Link>
        </Button>
      </header>

      {/* Hero — copy left, the product's own verdict card as the imagery */}
      <section className="relative overflow-hidden">
        {/* One quiet royal glow anchors the hero; never on a control. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 right-[-10%] size-[42rem] rounded-full bg-primary/20 blur-[140px]"
        />
        <div className="relative mx-auto grid max-w-5xl items-center gap-12 px-6 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div>
            <p className="landing-rise text-sm font-medium uppercase tracking-widest text-sidebar-foreground/60">
              Liquor Inventory Solution
            </p>
            <h1 className="landing-rise landing-rise-2 mt-4 max-w-xl text-balance text-[clamp(2.5rem,5vw,3.75rem)] font-semibold leading-[1.06] tracking-[-0.02em]">
              Your partner in inventory management
            </h1>
            <p className="landing-rise landing-rise-3 mt-5 max-w-md text-pretty text-base leading-7 text-sidebar-foreground/75">
              Audit-grade bar, kitchen, and asset inventory for hospitality — physical counts at 2 AM to
              reconciled reports your accountants sign at 9.
            </p>
            <div className="landing-rise landing-rise-4 mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="min-h-11">
                <Link to="/login">
                  Open the System <ArrowRight className="size-4" />
                </Link>
              </Button>
              {FACEBOOK_URL && (
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="min-h-11 border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <a href={FACEBOOK_URL} target="_blank" rel="noreferrer">
                    Find Us on Facebook <ExternalLink className="size-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>

          <VerdictCard />
        </div>
      </section>

      {/* The math IS the brand — the reconciliation, typeset as the monument */}
      <section className="border-t border-sidebar-border/60 bg-sidebar-accent/20">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <p className="text-xs font-medium uppercase tracking-widest text-sidebar-foreground/50">
            The math every report stands on
          </p>
          <div className="mt-6 space-y-3 font-mono text-[clamp(0.95rem,2.2vw,1.35rem)] leading-relaxed">
            <p>
              <span className="text-sidebar-foreground/90">Beginning + Purchases + Returns + Transfers − Ending</span>
              <span className="text-sidebar-foreground/50"> = </span>
              <span className="font-semibold text-sidebar-primary-foreground">Usage</span>
            </p>
            <p>
              <span className="text-sidebar-foreground/90">(Sold + Recipes + Comps) − Usage</span>
              <span className="text-sidebar-foreground/50"> = </span>
              <span className="font-semibold text-[oklch(0.78_0.13_25)]">Variance</span>
            </p>
          </div>
          <div className="mt-10 grid gap-x-12 gap-y-4 text-sm leading-6 text-sidebar-foreground/70 sm:grid-cols-3">
            <p>Full units or straight off the scale — bar bottles by density, kitchen items by net weight.</p>
            <p>Every variance drills to its source records: sales, transfers, spillage. Nothing unexplained.</p>
            <p>Excel, CSV, and print exports — watermarked and stamped for view-only client access.</p>
          </div>
        </div>
      </section>

      {/* Promo video slot — lights up when the client's asset lands */}
      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="overflow-hidden rounded-xl border border-sidebar-border/60">
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

/**
 * The hero imagery: the product's own Full Audit verdict, drawn with the
 * numbers the reconciliation engine really produces for the golden fixture —
 * truthful marketing, and no stock photo could say "audit-grade" better.
 */
function VerdictCard() {
  const rows = [
    { name: "Jack Daniel's Old No. 7 700 ml", pct: "−7.53%", width: "100%" },
    { name: "Absolut Vodka 700 ml", pct: "−3.52%", width: "65%" },
    { name: "San Miguel Pale Pilsen 330 ml", pct: "−3.03%", width: "29%" },
  ];
  return (
    <div
      aria-hidden="true"
      className="landing-rise landing-rise-3 select-none rounded-xl border border-sidebar-border/40 bg-background p-6 text-foreground shadow-[0_24px_80px_oklch(0.1_0.05_264/0.55)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Full Audit · Main Bar</p>
        <p className="text-xs text-muted-foreground tnum">Jun 1 – Jun 8</p>
      </div>
      <p className="mt-3 text-[34px] font-semibold leading-10 tracking-tight text-destructive">−₱330.69</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        variance at cost · 4 items short · ₱17,520.00 revenue
      </p>
      <div className="mt-5 space-y-3 border-t pt-4">
        {rows.map((row) => (
          <div key={row.name}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium">{row.name}</p>
              <p className="text-xs font-medium text-destructive tnum">{row.pct}</p>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-destructive" style={{ width: row.width }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between border-t pt-4">
        <p className="text-xs text-muted-foreground">Every number drills to its source record</p>
        <span className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground">
          Open Full Audit
        </span>
      </div>
    </div>
  );
}
