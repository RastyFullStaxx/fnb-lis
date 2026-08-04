import { useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useVerifyMfa } from "@/api/auth";
import { ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MeResponse } from "@fnb/core";

/**
 * Second step of a two-step sign-in.
 *
 * Rendered in place of the password form once the server answers with a
 * challenge. Deliberately not a separate route: a challenge is short-lived
 * in-memory state, and putting it in the URL would leak it into history,
 * bookmarks and the referrer.
 */
export function MfaChallengeForm({
  challenge,
  onVerified,
  onCancel,
}: {
  challenge: string;
  onVerified: (me: MeResponse) => void;
  onCancel: () => void;
}) {
  const verify = useVerifyMfa();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onVerified(await verify.mutateAsync({ challenge, code }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setCode("");
    }
  };

  return (
    <>
      <div className="mb-8">
        <ShieldCheck className="mb-3 size-8 text-sidebar-foreground/50" aria-hidden="true" />
        <h1 className="text-xl font-semibold tracking-tight text-balance text-sidebar-foreground">
          Enter your code
        </h1>
        <p className="mt-1 max-w-sm text-sm text-sidebar-foreground/70">
          Open your authenticator app and enter the 6-digit code for Liquor Inventory Solution.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="mfa-code" className="text-sidebar-foreground">
            Authentication code
          </Label>
          <Input
            id="mfa-code"
            // One-time-code lets iOS and Android offer the code from the
            // clipboard or an SMS-style autofill, which is most of the UX win.
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            aria-describedby={error ? "mfa-error" : "mfa-hint"}
            aria-invalid={Boolean(error)}
            className="min-h-11 border-sidebar-border bg-white text-center font-mono text-lg tracking-[0.3em] text-foreground focus-visible:ring-sidebar-ring"
          />
          <p id="mfa-hint" className="text-xs text-sidebar-foreground/60">
            Lost your phone? Use one of your recovery codes instead.
          </p>
        </div>

        {error && (
          <p id="mfa-error" role="alert" className="rounded-md bg-white px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="min-h-11 w-full" disabled={verify.isPending || code.trim().length < 6}>
          {verify.isPending ? "Verifying…" : "Verify"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-11 w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Sign In
        </Button>
      </form>
    </>
  );
}
