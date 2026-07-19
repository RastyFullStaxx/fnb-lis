import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Eye, EyeOff, KeyRound } from "lucide-react";
import { loginRequest, type LoginRequest } from "@fnb/core";
import { useLogin } from "@/api/auth";
import { ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InventoryIllustration } from "@/components/brand/inventory-illustration";
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

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequest),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const me = await login.mutateAsync({ ...values, rememberMe });
      const first = me.clients.flatMap((c) => c.locations)[0];
      navigate(first ? `/l/${first.id}/dashboard` : "/", { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[7fr_9fr]">
      {/* Form panel — now blue (sidebar color) */}
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16 lg:py-10 bg-sidebar">
        <div className="-mt-2 -ml-3 flex items-center gap-2.5">
          <img src={lisLogo} alt="" className="size-[84px] object-contain" />
          <span className="text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase">
            FNB/LIS
          </span>
        </div>

        <div className="flex flex-1 items-center pb-16">
          <div className="mx-auto w-full max-w-sm">
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
                  Back to sign in
                </Button>
              </div>
            ) : (
              <>
                {sessionExpired && (
                  <p role="status" className="mb-6 rounded-md bg-white/95 px-3 py-2.5 text-sm font-medium text-foreground">
                    Your session ended — sign in again to continue.
                  </p>
                )}
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
                      className="min-h-11 text-sm font-medium text-sidebar-foreground hover:underline"
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
                    {login.isPending ? "Signing in…" : "Sign in"}
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
