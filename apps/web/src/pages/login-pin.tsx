import { useEffect, useState } from "react";
import { PIN_LENGTH } from "@fnb/core";
import { Button } from "@/components/ui/button";
import { SignInSuccess } from "@/components/sign-in-success";
import { cn } from "@/lib/utils";

/**
 * The offline-desktop sign-in, rendered INSIDE the real login page.
 *
 * It replaces the username/password form on the left; the brand panel, the
 * illustration and the layout are the login page's own. Building a separate
 * HTML sign-in screen was the first attempt and it was wrong — a duplicated
 * screen drifts from the original the moment either is touched, and this one is
 * the first thing anyone sees.
 *
 * Everything here is inert in a browser: it is only rendered when
 * `window.lis?.isDesktop` is true, and the endpoints it calls exist solely on
 * the embedded local server.
 */

const BACKSPACE = "⌫";
const CONFIRM = "✓";

interface Person {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  hasPin: 0 | 1;
}

/**
 * Shuffle the digits every time the keypad is shown.
 *
 * The realistic attacker is a coworker watching WHERE the fingers go — a fixed
 * layout leaks the PIN without them ever seeing the screen. Fisher-Yates so
 * every arrangement is equally likely, seeded from crypto.getRandomValues
 * because this is a control rather than a nicety.
 *
 * The cost is real: it destroys muscle memory, so every sign-in is slower.
 */
function shuffledDigits(): string[] {
  const d = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const r = new Uint32Array(d.length);
  crypto.getRandomValues(r);
  for (let i = d.length - 1; i > 0; i--) {
    const j = r[i]! % (i + 1);
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

export function DesktopPinSignIn() {
  const [people, setPeople] = useState<Person[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [picked, setPicked] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ name: string; to: string } | null>(null);

  const reshuffle = () => {
    const d = shuffledDigits();
    setKeys([...d.slice(0, 9), BACKSPACE, d[9]!, CONFIRM]);
  };

  useEffect(() => {
    void fetch("/_desktop/people")
      .then((r) => r.json())
      .then((r: { people: Person[]; deviceName: string }) => {
        setPeople(r.people);
        setDeviceName(r.deviceName);
      })
      .catch(() => setError("Can't reach the local service on this computer."));
  }, []);

  const submit = async (value: string) => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/_desktop/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: picked.id, pin: value }),
      });
      const body = (await res.json().catch(() => ({}))) as { landing?: string; error?: string };
      if (res.ok) {
        setSuccess({ name: picked.firstName, to: body.landing ?? "/" });
        return;
      }
      setPin("");
      reshuffle(); // re-shuffle on failure too, or a watcher gets repeat looks
      setError(body.error ?? "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (k === BACKSPACE) return setPin((p) => p.slice(0, -1));
    if (k === CONFIRM) return void submit(pin);
    if (pin.length >= PIN_LENGTH) return;
    setPin((p) => p + k);
  };

  // Keyboard works too — the machine has one, even if the keypad is for touch.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press(BACKSPACE);
      else if (e.key === "Enter") press(CONFIRM);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (success) {
    return (
      <SignInSuccess
        name={success.name}
        onDone={() => {
          // A full load, not client-side navigation: the session cookie was
          // just set, and every query must start from the signed-in state.
          window.location.href = success.to;
        }}
      />
    );
  }

  if (!picked) {
    return (
      <>
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight text-balance text-sidebar-foreground">
            Welcome back
          </h1>
          <p className="mt-1 max-w-sm text-sm text-sidebar-foreground/70">
            Choose your name to sign in on this computer.
          </p>
        </div>

        {/* A freshly provisioned bar PC has no PINs at all: five greyed names,
            "no PIN" beside each, and clicking one does nothing. Staff arrive for
            a shift and the computer is a dead end that never says why — or that
            the fix is a two-minute job on the web app, done by each person for
            themselves. */}
        {people.length > 0 && people.every((p) => !p.hasPin) && (
          <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-sidebar-foreground">
            <p className="font-medium">No one has set a PIN on this computer yet.</p>
            <p className="mt-0.5 text-sidebar-foreground/80">
              A PIN is what signs you in here when there's no internet. Each person sets their own:
              sign in to LIS in a web browser, open Settings, and choose a {PIN_LENGTH}-digit PIN.
              It only needs doing once.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          {people.map((p) => {
            const unavailable = !p.hasPin || p.status !== "ACTIVE";
            return (
              <button
                key={p.id}
                type="button"
                disabled={unavailable}
                onClick={() => {
                  setPicked(p);
                  setPin("");
                  setError(null);
                  reshuffle();
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-4 py-3 text-left text-sidebar-foreground transition-colors",
                  unavailable ? "cursor-not-allowed opacity-45" : "hover:border-primary",
                )}
              >
                <span className="text-sm font-medium">
                  {p.firstName} {p.lastName}
                </span>
                <span className="ml-auto text-[0.6875rem] uppercase tracking-wider text-sidebar-foreground/50">
                  {/* Saying WHY someone is unavailable beats a dead row: "no PIN"
                      is a fixable state, and the fix needs the web app. */}
                  {p.status !== "ACTIVE" ? "disabled" : p.hasPin ? p.role : "no PIN"}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="mt-4 text-sm text-red-200">{error}</p>}
        {deviceName && (
          <p className="mt-6 text-xs text-sidebar-foreground/45">This computer: {deviceName}</p>
        )}
      </>
    );
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-balance text-sidebar-foreground">
          {picked.firstName}, enter your PIN
        </h1>
        <p className="mt-1 text-sm text-sidebar-foreground/70">Six digits.</p>
      </div>

      <div className="mb-6 flex items-center justify-center gap-2.5">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-3 rounded-full border-[1.5px] transition-colors",
              i < pin.length ? "border-primary bg-primary" : "border-sidebar-border",
            )}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {keys.map((k, i) => (
          <Button
            key={`${k}-${i}`}
            type="button"
            variant="outline"
            onClick={() => press(k)}
            disabled={busy}
            className={cn(
              // Fixed height and no padding: a non-digit glyph would otherwise
              // size its key differently from the numbers.
              "h-14 border-sidebar-border bg-sidebar-accent/40 p-0 text-xl font-medium text-sidebar-foreground hover:border-primary hover:bg-sidebar-accent",
              // Accent by colour, never a fill — a solid key reads as a bigger one.
              k === CONFIRM && "border-primary text-primary",
            )}
          >
            {k}
          </Button>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-sidebar-foreground/50">
        The number positions change each time.
      </p>
      {error && <p className="mt-3 text-center text-sm text-red-200">{error}</p>}

      <button
        type="button"
        className="mx-auto mt-4 block text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground"
        onClick={() => {
          setPicked(null);
          setPin("");
          setError(null);
        }}
      >
        ← Someone else
      </button>
    </>
  );
}
