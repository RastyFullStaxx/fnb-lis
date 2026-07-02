import { useState } from "react";
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginRequest, type LoginRequest } from "@fnb/core";
import { useLogin } from "@/api/auth";
import { ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequest),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const me = await login.mutateAsync(values);
      const first = me.clients.flatMap((c) => c.locations)[0];
      navigate(first ? `/l/${first.id}/dashboard` : "/", { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">
            L
          </div>
          <h1 className="text-xl font-semibold tracking-tight">LIS</h1>
          <p className="text-sm text-muted-foreground">Inventory Solution</p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                aria-invalid={!!form.formState.errors.username}
                {...form.register("username")}
              />
              {form.formState.errors.username && (
                <p className="text-sm text-destructive">{form.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!form.formState.errors.password}
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
              )}
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
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Liquor Inventory Solution · audit-grade inventory
        </p>
      </div>
    </div>
  );
}
