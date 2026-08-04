import { useState } from "react";
import { Link } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Check, Copy, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import {
  useConfirmMfa,
  useDisableMfa,
  useEnrollMfa,
  useMe,
  useMfaStatus,
} from "@/api/auth";
import { ApiError } from "@/api/http";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import lisLogo from "@/assets/lis-logo.png";

/**
 * Two-factor setup, on its own route outside AppShell.
 *
 * It has to live outside: an ADMIN or OWNER who has not enrolled is refused by
 * every location-scoped route (requireMfaEnrolment), so a screen nested under
 * `/l/:locationId` would be unreachable by exactly the people required to use
 * it. Same reason it carries its own minimal chrome.
 */

type Stage =
  | { step: "idle" }
  | { step: "password" }
  | { step: "scan"; secret: string; otpauthUri: string }
  | { step: "codes"; codes: string[] };

export function AccountSecurityPage() {
  const me = useMe();
  const status = useMfaStatus();
  const enroll = useEnrollMfa();
  const confirm = useConfirmMfa();
  const disable = useDisableMfa();

  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const forced = Boolean(me.data?.mfaSetupRequired);
  const enrolled = status.data?.enrolled ?? false;
  const required = status.data?.required ?? false;
  const firstLocation = me.data?.clients.flatMap((c) => c.locations)[0];

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");

  const startEnrol = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await enroll.mutateAsync({ currentPassword: password });
      setStage({ step: "scan", secret: res.secret, otpauthUri: res.otpauthUri });
      setPassword("");
    } catch (err) {
      fail(err);
    }
  };

  const confirmEnrol = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await confirm.mutateAsync({ code });
      setStage({ step: "codes", codes: res.backupCodes });
      setCode("");
    } catch (err) {
      fail(err);
    }
  };

  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await disable.mutateAsync({ currentPassword: password, code });
      setStage({ step: "idle" });
      setPassword("");
      setCode("");
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="min-h-dvh bg-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center gap-2.5">
          <img src={lisLogo} alt="" className="size-14 object-contain" />
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Liquor Inventory Solution</span>
          {/* Only offered once there is somewhere to go back TO. While
              enrolment is outstanding every other route refuses the request,
              so a back link would be a door onto a wall. */}
          {!forced && firstLocation && (
            <Link
              to={`/l/${firstLocation.id}/dashboard`}
              className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to app
            </Link>
          )}
        </div>

        {forced && (
          <Alert className="mb-6">
            <ShieldAlert className="size-4" />
            <AlertTitle>Two-factor authentication is required for your role</AlertTitle>
            <AlertDescription>
              Your account can create users and change settings for a whole establishment, so it needs a
              second factor. Set it up below to continue — the rest of the app is unavailable until you do.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              {enrolled ? (
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <ShieldOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div>
                <CardTitle>Two-factor authentication</CardTitle>
                <CardDescription>
                  {enrolled
                    ? "On. You'll be asked for a code from your authenticator app each time you sign in."
                    : "Off. Add a code from an authenticator app on top of your password."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {status.data && !status.data.available && (
              <Alert>
                <ShieldAlert className="size-4" />
                <AlertTitle>Not configured on this server</AlertTitle>
                <AlertDescription>
                  Two-factor authentication needs <code className="font-mono text-xs">FNB_MFA_KEY</code> set on
                  the server. Ask your LIS administrator.
                </AlertDescription>
              </Alert>
            )}

            {/* ── Already on ── */}
            {enrolled && stage.step !== "codes" && (
              <>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Turned on</dt>
                    <dd className="font-medium">
                      {status.data?.confirmedAt
                        ? new Date(status.data.confirmedAt).toLocaleDateString()
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Recovery codes left</dt>
                    <dd className="font-medium">{status.data?.backupCodesRemaining ?? 0}</dd>
                  </div>
                </dl>

                {(status.data?.backupCodesRemaining ?? 0) <= 2 && (
                  <Alert>
                    <ShieldAlert className="size-4" />
                    <AlertTitle>You're low on recovery codes</AlertTitle>
                    <AlertDescription>
                      Ask an administrator to reset your two-factor setup so you can enrol again and get a
                      fresh set.
                    </AlertDescription>
                  </Alert>
                )}

                <Separator />

                {required ? (
                  <p className="text-sm text-muted-foreground">
                    Your role requires two-factor authentication, so it can't be switched off here. If you've
                    lost your phone, an administrator can reset it for you.
                  </p>
                ) : stage.step === "password" ? (
                  <form onSubmit={turnOff} className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Confirm with your password and a current code to turn this off.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="off-password">Password</Label>
                      <Input
                        id="off-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="min-h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="off-code">Authentication code</Label>
                      <Input
                        id="off-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="min-h-11 font-mono"
                      />
                    </div>
                    {error && (
                      <p role="alert" className="text-sm font-medium text-destructive">
                        {error}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" variant="destructive" className="min-h-11" disabled={disable.isPending}>
                        {disable.isPending ? "Turning off…" : "Turn off"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        onClick={() => {
                          setStage({ step: "idle" });
                          setError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setStage({ step: "password" })}
                  >
                    Turn off two-factor authentication
                  </Button>
                )}
              </>
            )}

            {/* ── Step 1: re-prove the password ── */}
            {!enrolled && stage.step === "idle" && status.data?.available && (
              <Button type="button" className="min-h-11" onClick={() => setStage({ step: "password" })}>
                Set up two-factor authentication
              </Button>
            )}

            {!enrolled && stage.step === "password" && (
              <form onSubmit={startEnrol} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="enrol-password">Confirm your password</Label>
                  <Input
                    id="enrol-password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="min-h-11"
                    aria-describedby="enrol-password-hint"
                  />
                  <p id="enrol-password-hint" className="text-xs text-muted-foreground">
                    This stops someone using an unattended screen to attach their own phone to your account.
                  </p>
                </div>
                {error && (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" className="min-h-11" disabled={enroll.isPending || !password}>
                    {enroll.isPending ? "Checking…" : "Continue"}
                  </Button>
                  {!forced && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => {
                        setStage({ step: "idle" });
                        setError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            )}

            {/* ── Step 2: scan, then prove one code ── */}
            {stage.step === "scan" && (
              <form onSubmit={confirmEnrol} className="space-y-5">
                <ol className="space-y-5">
                  <li className="space-y-3">
                    <p className="text-sm font-medium">
                      1. Scan this with Google Authenticator, Authy, or 1Password
                    </p>
                    {/* Rendered as inline SVG rather than an image: no data: URI,
                        nothing to fetch, and it stays crisp at any zoom. */}
                    <div className="flex justify-center rounded-lg border bg-white p-4">
                      <QRCodeSVG value={stage.otpauthUri} size={180} marginSize={0} />
                    </div>
                  </li>
                  <li className="space-y-2">
                    <p className="text-sm font-medium">Can't scan? Type this key instead</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                        {stage.secret}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Copy setup key"
                        className="size-11 shrink-0"
                        onClick={() => {
                          void navigator.clipboard.writeText(stage.secret);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      </Button>
                    </div>
                  </li>
                  <li className="space-y-2">
                    <Label htmlFor="enrol-code" className="text-sm font-medium">
                      2. Enter the 6-digit code it shows
                    </Label>
                    <Input
                      id="enrol-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="123456"
                      className="min-h-11 text-center font-mono text-lg tracking-[0.3em]"
                    />
                  </li>
                </ol>
                {error && (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="min-h-11 w-full"
                  disabled={confirm.isPending || code.trim().length < 6}
                >
                  {confirm.isPending ? "Verifying…" : "Turn on two-factor authentication"}
                </Button>
              </form>
            )}

            {/* ── Step 3: the codes, shown exactly once ── */}
            {stage.step === "codes" && (
              <div className="space-y-4">
                <Alert>
                  <ShieldCheck className="size-4" />
                  <AlertTitle>Two-factor authentication is on</AlertTitle>
                  <AlertDescription>
                    Save these recovery codes somewhere safe. Each works once, and this is the only time
                    they're shown — if you lose your phone without them, an administrator has to reset your
                    setup.
                  </AlertDescription>
                </Alert>
                <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/50 p-4 font-mono text-sm">
                  {stage.codes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      void navigator.clipboard.writeText(stage.codes.join("\n"));
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Copied" : "Copy codes"}
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    onClick={() => {
                      setStage({ step: "idle" });
                      // /me was invalidated on confirm, so by now the gate has
                      // lifted and a location is reachable again.
                      if (firstLocation) window.location.assign(`/l/${firstLocation.id}/dashboard`);
                    }}
                  >
                    I've saved them — continue
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
