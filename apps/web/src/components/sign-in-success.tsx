import { useEffect } from "react";

/**
 * The beat between a correct credential and the dashboard.
 *
 * It exists to make the hand-off feel deliberate rather than abrupt — and,
 * usefully, it covers the work the app is doing anyway: fetching `/me`, resolving
 * the location, mounting the shell. The animation is not pure decoration; it is
 * occupying time that was already going to pass.
 *
 * Deliberately BRIEF. Staff on a bar PC sign in many times a shift, so anything
 * longer than about a second stops being a flourish and becomes a toll they pay
 * over and over. It is also skippable: any key or click hands off immediately.
 *
 * Not a Lottie file. lottie-web is ~250 kB for one decorative mark, on a bundle
 * already past its size warning — an SVG stroke draw is ~2 kB and identical at
 * this scale. If a specific branded Lottie is ever supplied, this component is
 * the single place it would drop into.
 */
export function SignInSuccess({
  name,
  onDone,
  durationMs = 1050,
}: {
  /** First name, so the hand-off is addressed to a person. */
  name?: string;
  onDone: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    // `once` on the listeners and a cleared timer: onDone must fire exactly
    // once, or a double navigation lands somewhere unintended.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };
    const timer = setTimeout(finish, durationMs);
    window.addEventListener("keydown", finish, { once: true });
    window.addEventListener("pointerdown", finish, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", finish);
      window.removeEventListener("pointerdown", finish);
    };
  }, [onDone, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-signin-pop fixed inset-0 z-[60] grid place-items-center bg-sidebar text-sidebar-foreground"
    >
      <div className="flex flex-col items-center gap-5">
        <svg viewBox="0 0 64 64" className="size-20" fill="none" aria-hidden="true">
          {/* Track: the full ring at low opacity, so the drawing ring has
              something to travel along instead of appearing out of nothing. */}
          <circle cx="32" cy="32" r="27" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
          <circle
            cx="32"
            cy="32"
            r="27"
            stroke="var(--primary)"
            strokeWidth="3"
            strokeLinecap="round"
            className="animate-signin-ring origin-center -rotate-90"
          />
          <path
            d="M21 33.5 L28.5 41 L43 25"
            stroke="var(--primary)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-signin-check"
          />
        </svg>

        <p className="animate-signin-rise text-lg font-semibold tracking-tight">
          {name ? `Welcome back, ${name}` : "Signed in"}
        </p>
      </div>
    </div>
  );
}
