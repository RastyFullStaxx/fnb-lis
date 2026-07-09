import { useState } from "react";
import { useNavigate } from "react-router";
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

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const [rememberMe, setRememberMe] = useState(true);

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
            Powered by LIS
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
                  Contact your system administrator to have it reset.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-6 border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground bg-transparent"
                  onClick={() => setShowForgotPassword(false)}
                >
                  <ArrowLeft className="size-4" />
                  Back to sign in
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-8">
                  <h1 className="text-xl font-semibold tracking-tight text-balance text-sidebar-foreground">
                    Bar and Kitchen Inventory Management System
                  </h1>
                </div>

                <form onSubmit={onSubmit} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-sidebar-foreground">Username</Label>
                    <Input
                      id="username"
                      autoComplete="username"
                      autoFocus
                      aria-invalid={!!form.formState.errors.username}
                      className="bg-white border-sidebar-border text-foreground placeholder:text-muted-foreground focus-visible:ring-sidebar-ring"
                      {...form.register("username")}
                    />
                    {form.formState.errors.username && (
                      <p className="text-sm text-destructive">{form.formState.errors.username.message}</p>
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
                        className="pr-9 bg-white border-sidebar-border text-foreground placeholder:text-muted-foreground focus-visible:ring-sidebar-ring"
                        {...form.register("password")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        className="absolute inset-y-0 right-0 flex w-9 translate-y-px items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 rounded-md"
                      >
                        {showPassword ? (
                          <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />
                        ) : (
                          <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {form.formState.errors.password && (
                      <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="remember-me"
                        checked={rememberMe}
                        onCheckedChange={(v) => setRememberMe(v === true)}
                        className="border-sidebar-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                      <Label htmlFor="remember-me" className="font-normal text-sidebar-foreground/70">
                        Remember me
                      </Label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                      className="text-sm font-medium text-sidebar-foreground hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>

                  {serverError && (
                    <p role="alert" className="text-sm text-destructive">
                      {serverError}
                    </p>
                  )}

                  <Button type="submit" className="w-full" disabled={login.isPending}>
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

      {/* Brand panel — now white */}
      <div className="relative hidden flex-col items-center justify-center gap-10 overflow-hidden bg-background px-12 py-16 lg:flex">
        {/* Geometric accent, top-right */}
        <svg
          className="pointer-events-none absolute top-0 right-0 h-44 w-44"
          viewBox="0 0 176 176"
          fill="none"
          aria-hidden="true"
        >
          <rect x="132" y="8" width="30" height="30" rx="6" fill="currentColor" className="text-primary" fillOpacity="0.14" />
          <rect x="96" y="8" width="20" height="20" rx="5" fill="currentColor" className="text-primary" fillOpacity="0.08" />
          <rect x="132" y="52" width="20" height="20" rx="5" fill="currentColor" className="text-primary" fillOpacity="0.08" />
          <rect x="160" y="52" width="12" height="12" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.16" />
          <rect x="108" y="44" width="12" height="12" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.06" />
          <rect x="150" y="90" width="14" height="14" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.1" />
          <rect x="70" y="16" width="12" height="12" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.06" />
        </svg>

        {/* Geometric accent, bottom-left */}
        <svg
          className="pointer-events-none absolute bottom-0 left-0 h-44 w-44"
          viewBox="0 0 176 176"
          fill="none"
          aria-hidden="true"
        >
          <rect x="14" y="138" width="30" height="30" rx="6" fill="currentColor" className="text-primary" fillOpacity="0.14" />
          <rect x="56" y="148" width="20" height="20" rx="5" fill="currentColor" className="text-primary" fillOpacity="0.08" />
          <rect x="14" y="104" width="20" height="20" rx="5" fill="currentColor" className="text-primary" fillOpacity="0.08" />
          <rect x="4" y="72" width="12" height="12" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.16" />
          <rect x="56" y="112" width="12" height="12" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.06" />
          <rect x="12" y="60" width="14" height="14" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.1" />
          <rect x="94" y="150" width="12" height="12" rx="3" fill="currentColor" className="text-primary" fillOpacity="0.06" />
        </svg>

        <InventoryIllustration className="w-full max-w-md shrink-0 -mt-5" />

        <div className="-mt-9 max-w-sm text-center">
          <h2 className="text-xl font-semibold tracking-tight text-foreground text-balance">
            Every ingredient and item, accounted for
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            From opening count to closing variance.
          </p>
        </div>
      </div>
    </div>
  );
}
