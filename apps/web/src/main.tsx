import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { router } from "./router";
import { captureError, initAnalytics } from "./lib/analytics";
import { ApiError } from "./api/http";
import { PreferencesProvider } from "./lib/preferences";

void initAnalytics();

/**
 * Any 401 means the session is gone — get the user to the sign-in page.
 *
 * Only `AppShell`'s `me` query knew how to react to a 401 (→ /login?expired=1).
 * Every other request surfaced its error where it stood, so an expired session
 * read as a failed load: an audit viewer, whose session is 20 minutes
 * (READONLY_SESSION_TTL_MS) against `me`'s 5-minute staleTime and
 * `refetchOnWindowFocus: false`, sat on a report being told to "check your
 * connection" beside a Try again that could never succeed.
 *
 * Invalidating `me` and letting AppShell redirect was the first attempt and it
 * does not work: React Query keeps `status: "success"` when a BACKGROUND
 * refetch fails on a query that already holds data, so `me.isError` never
 * becomes true and the redirect never fires.
 *
 * A hard navigation, not the router: every cached query belongs to a session
 * that no longer exists, and a full load is the only thing that reliably drops
 * all of it. `?expired=1` is the same URL AppShell uses, so the login page
 * still shows the calm "session ended" notice rather than looking like a
 * silent kick-out.
 */
const onApiError = (error: unknown) => {
  if (!(error instanceof ApiError)) return;

  /**
   * The server refuses everything but the enrolment routes until a role that
   * requires a second factor has one (`requireMfaEnrolment`). Without this the
   * user would meet that refusal as a wall of identical toasts on whatever
   * screen they happened to open, with no route to the fix.
   *
   * Same hard-navigation reasoning as the 401 below.
   */
  if (error.status === 403 && error.code === "MFA_SETUP_REQUIRED") {
    if (window.location.pathname.startsWith("/account/security")) return;
    window.location.assign("/account/security");
    return;
  }

  if (error.status !== 401) return;
  /**
   * Routes where a 401 is the NORMAL state, not a lost session.
   *
   * `/login` was already here — a failed sign-in is a 401 too, and must not
   * bounce. `/` was not, and it is the public marketing landing: its session
   * probe 401s for every signed-out visitor, so the front door redirected
   * first-time arrivals straight past itself and greeted them with "Your
   * session ended — sign in again to continue." They had never had one, and
   * they never saw the landing page at all.
   *
   * Exact match on "/" on purpose: every real app route lives under `/l/:id`,
   * and a prefix test would exempt the whole application.
   */
  const path = window.location.pathname;
  if (path === "/" || path.startsWith("/login")) return;
  window.location.assign("/login?expired=1");
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => onApiError(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      captureError(error);
      onApiError(error);
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      /**
       * Right policy, but NOT the fix for the pause this once chased.
       *
       * The symptom was: with the API stopped, `["me"]` sat at
       * `fetchStatus: "paused"`, `status: "pending"`, `failureCount: 0` — never
       * attempted, no error — so the shell showed a skeleton forever. Setting
       * "always" did not stop it, and the cause was recorded as unknown.
       *
       * It is not unknown. query-core's retryer:
       *
       *   const canContinue = () =>
       *     focusManager.isFocused() &&
       *     (config.networkMode === "always" || onlineManager.isOnline()) &&
       *     config.canRun()
       *
       * `focusManager.isFocused()` is required REGARDLESS of networkMode, and
       * it gates the first attempt — hence `failureCount: 0`. The window was
       * simply in the background (watching a terminal for the stopped API does
       * that), so the query paused by design and would have resumed on focus.
       *
       * "always" stays because it is correct on its own terms: this API is
       * same-origin, and the online heuristic answers "is a network interface
       * up", not "is my server reachable". Code that treats `paused` as a
       * failure must pair it with `document.hasFocus()` — see `queryFailed()`
       * in table-surface.tsx.
       */
      networkMode: "always",
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <RouterProvider router={router} />
      </PreferencesProvider>
    </QueryClientProvider>
  </StrictMode>,
);
