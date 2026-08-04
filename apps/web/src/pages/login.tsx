import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Eye, EyeOff, KeyRound } from "lucide-react";
import { isMfaChallenge, loginRequest, type LoginRequest, type MeResponse } from "@fnb/core";
import { useLogin } from "@/api/auth";
import { ApiError } from "@/api/http";
import { MfaChallengeForm } from "./login-mfa";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InventoryIllustration } from "@/components/brand/inventory-illustration";
import { DesktopPinSignIn } from "./login-pin";
import { SignInSuccess } from "@/components/sign-in-success";
import lisLogo from "@/assets/lis-logo.png";

// ── Per-module login flyers (client reqs #6/#7) ──────────────────────────────
// ponytail: placeholder map until the client sends the flyer files. When they
// arrive, drop them in src/assets/flyers/ and register them here, e.g.:
//   import barFlyer from "@/assets/flyers/bar.png";
//   const FLYERS: Record<string, string> = { bar: barFlyer, kitchen: kitchenFlyer };
// Deep links then select them: /login?m=bar or /login?m=kitchen. Unknown or
// missing keys fall back to the built-in illustration.
const FLYERS: Record<string, string> = {};

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("expired") === "1";
  const flyer = FLYERS[searchParams.get("m") ?? ""] ?? null;
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const [rememberMe, setRememberMe] = useState(false);

  /**
   * On the offline desktop the credential is a PIN, not a password — so the
   * left panel swaps its contents and everything else on this page stays put.
   *
   * Reusing this page rather than building a second sign-in screen is the whole
   * point: the brand panel, the illustration and the layout have exactly one
   * definition, so the desktop cannot drift from the web on the first screen
   * anyone sees. False in a browser, where `window.lis` does not exist.
   */
  const isDesktop = Boolean((window as { lis?: { isDesktop?: boolean } }).lis?.isDesktop);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequest),
    defaultValues: { username: "", password: "" },
  });

  /** Set once the credential is accepted; the overlay then hands off. */
  const [success, setSuccess] = useState<{ name: string; to: string } | null>(null);

  /**
   * Held in memory only, never in the URL or storage: this is the token that
   * stands between a proved password and a session.
   */
  const [challenge, setChallenge] = useState<string | null>(null);

  /** Where to land once a session actually exists. Shared by both sign-in paths. */
  const landOn = (me: MeResponse) => {
    const first = me.clients.flatMap((c) => c.locations)[0];
    // Someone who must enrol has no usable location yet — every other route
    // 403s until they do — so send them straight at the setup screen.
    setSuccess({
      name: me.user.firstName,
      to: me.mfaSetupRequired ? "/account/security" : first ? `/l/${first.id}/dashboard` : "/",
    });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await login.mutateAsync({ ...values, rememberMe });
      // An enrolled account gets a challenge, NOT a session — branch before
      // assuming otherwise.
      if (isMfaChallenge(res)) {
        setChallenge(res.challenge);
        return;
      }
      // The destination is resolved BEFORE the overlay shows, so the animation
      // covers work already done rather than adding a wait in front of it.
      landOn(res);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  });

  if (success) {
    return <SignInSuccess name={success.name} onDone={() => navigate(success.to, { replace: true })} />;
  }

  return (
    // `lg:h-dvh lg:overflow-hidden` — the WINDOW never scrolls on desktop.
    // `min-h-dvh` alone let the panel grow past the viewport and take the whole
    // page with it, which is why a sign-in holding ~390px of content still had a
    // scrollbar. It also could not cope with the variant that actually needs the
    // room: the PIN screen lists every member of staff, so its height is data,
    // not a constant — no amount of padding tuning fixes a list of twenty.
    // So the page is pinned to the viewport and the panel scrolls INSIDE itself.
    // Below `lg` the columns stack, where ordinary page scroll is correct.
    <div className="grid min-h-dvh lg:h-dvh lg:overflow-hidden lg:grid-cols-[7fr_9fr]">
      {/* Form panel — now blue (sidebar color) */}
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16 lg:py-10 bg-sidebar lg:min-h-0 lg:overflow-y-auto">
        <div className="-mt-2 -ml-3 flex items-center gap-2.5">
          <img src={lisLogo} alt="" className="size-[84px] object-contain" />
          <span className="text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase">
            Liquor Inventory Solution
          </span>
          {/* A way back out. Without it the sign-in page is a dead end for
              anyone who arrived by accident or wants to re-read the landing
              page — and on the desktop, where this is the first screen after
              the front door, there was no route back at all. */}
          <Link
            to="/"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
        </div>

        {/* `min-h-0` so this block may SHRINK rather than force the panel taller
            than the viewport, and a smaller optical offset than pb-16.
            At this app's 18px root, pb-16 is 72px (not 64), and together with
            lg:py-10 (45px a side) the panel measured 627px against a 600px
            viewport — the desktop window's own minHeight — so the sign-in page
            scrolled despite holding only ~390px of content. */}
        <div className="flex min-h-0 flex-1 items-center pb-8 lg:pb-10">
          <div className="mx-auto w-full max-w-sm">
            {/* Above the branch, not inside one: the desktop signs in with a PIN
                and used to land on the keypad with no word about WHY it had
                signed the person out. Same 401, same explanation, either
                credential. */}
            {sessionExpired && !showForgotPassword && (
              <p role="status" className="mb-6 rounded-md bg-white/95 px-3 py-2.5 text-sm font-medium text-foreground">
                Your session ended — sign in again to continue.
              </p>
            )}
            {showForgotPassword ? (
              <div className="text-center">
                <KeyRound className="mx-auto mb-3 size-8 text-sidebar-foreground/50" />
                <h1 className="text-balance text-xl font-semibold tracking-tight text-sidebar-foreground">
                  Password resets aren't self-service
                </h1>
                <p className="mt-1 text-sm text-sidebar-foreground/70">
                  Ask the administrator who created your account to reset your password.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-6 min-h-11 border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  onClick={() => setShowForgotPassword(false)}
                >
                  <ArrowLeft className="size-4" />
                  Back to Sign In
                </Button>
              </div>
            ) : challenge ? (
              <MfaChallengeForm
                challenge={challenge}
                onVerified={landOn}
                onCancel={() => {
                  setChallenge(null);
                  form.reset();
                }}
              />
            ) : isDesktop ? (
              <DesktopPinSignIn />
            ) : (
              <>
                <div className="mb-8">
                  <h1 className="text-xl font-semibold tracking-tight text-balance text-sidebar-foreground">
                    Welcome back
                  </h1>
                  <p className="mt-1 max-w-sm text-sm text-sidebar-foreground/70">
                    Sign in to continue to your assigned inventory locations.
                  </p>
                </div>

                <form onSubmit={onSubmit} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-sidebar-foreground">Username</Label>
                    <Input
                      id="username"
                      autoComplete="username"
                      autoFocus
                      aria-invalid={!!form.formState.errors.username}
                      aria-describedby={form.formState.errors.username ? "username-error" : undefined}
                      className="min-h-11 border-sidebar-border bg-white text-foreground placeholder:text-muted-foreground focus-visible:ring-sidebar-ring"
                      {...form.register("username")}
                    />
                    {form.formState.errors.username && (
                      <p
                        id="username-error"
                        className="rounded-md bg-white px-3 py-2 text-sm font-medium text-destructive"
                      >
                        {form.formState.errors.username.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sidebar-foreground">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        aria-invalid={!!form.formState.errors.password}
                        aria-describedby={form.formState.errors.password ? "password-error" : undefined}
                        className="min-h-11 border-sidebar-border bg-white pr-11 text-foreground placeholder:text-muted-foreground focus-visible:ring-sidebar-ring"
                        {...form.register("password")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        className="absolute inset-y-0 right-0 flex w-11 translate-y-px items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
                      >
                        {showPassword ? (
                          <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />
                        ) : (
                          <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {form.formState.errors.password && (
                      <p
                        id="password-error"
                        className="rounded-md bg-white px-3 py-2 text-sm font-medium text-destructive"
                      >
                        {form.formState.errors.password.message}
                      </p>
                    )}
                  </div>

                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <div className="flex min-h-11 items-center gap-2">
                      <Checkbox
                        id="remember-me"
                        checked={rememberMe}
                        onCheckedChange={(v) => setRememberMe(v === true)}
                        className="border-sidebar-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                      <Label htmlFor="remember-me" className="flex min-h-11 cursor-pointer items-center font-normal text-sidebar-foreground/70">
                        Remember me
                      </Label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                      className="min-h-11 rounded-md text-sm font-medium text-sidebar-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
                    >
                      Forgot password?
                    </button>
                  </div>

                  {serverError && (
                    <p
                      role="alert"
                      className="rounded-md bg-white px-3 py-2 text-sm font-medium text-destructive"
                    >
                      {serverError}
                    </p>
                  )}

                  <Button type="submit" className="min-h-11 w-full" disabled={login.isPending}>
                    {login.isPending ? "Signing in…" : "Sign In"}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-sidebar-foreground/60 lg:text-left">
          © {new Date().getFullYear()} Liquor Inventory Solution. All rights reserved.
        </p>
      </div>

      {/* Brand panel — white; shows the module flyer when one is configured */}
      <div className="relative hidden flex-col items-center justify-center gap-10 overflow-hidden bg-background px-12 py-16 lg:flex">
        {flyer ? (
          <img src={flyer} alt="" className="max-h-full w-full max-w-lg rounded-xl object-contain shadow-md" />
        ) : (
          <>
            <InventoryIllustration className="w-full max-w-md shrink-0 -mt-5" />

            <div className="-mt-9 max-w-sm text-center">
              <h2 className="text-xl font-semibold tracking-tight text-foreground text-balance">
                Know what changed between counts.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Count, review, reconcile, and trace every variance to its source.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
