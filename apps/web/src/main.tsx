import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { router } from "./router";
import { captureError, initAnalytics } from "./lib/analytics";
import { PreferencesProvider } from "./lib/preferences";

void initAnalytics();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      /**
       * Defensive, not a proven cure — see the note below.
       *
       * With the API stopped, the boot query `["me"]` sits at
       * `fetchStatus: "paused"`, `status: "pending"`, `failureCount: 0` — never
       * attempted, no error — so `AppShell` renders its skeleton forever and
       * never reaches `BootError`. `["settings","preferences"]` errors normally
       * in the same load, so it is specific to the paused query.
       *
       * "online" (the default) pauses when offline, which fit the symptom, so
       * this is set to "always". It did NOT stop the pause: measured on
       * @tanstack/react-query 5.101.2 with `networkMode: "always"` applied
       * (confirmed on the query's own options), `onlineManager.isOnline()` true
       * and `navigator.onLine` true, the query still paused — and stayed paused
       * through an explicit `refetchQueries`. By React Query's own `canFetch`
       * rule that combination should never pause.
       *
       * Kept because "always" is the right policy regardless: this API is
       * same-origin, and the online heuristic answers "is a network interface
       * up", not "is my server reachable". `AppShell` handles the paused state
       * explicitly so the user is never stranded either way.
       */
      networkMode: "always",
    },
    mutations: { onError: (err) => captureError(err) },
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
