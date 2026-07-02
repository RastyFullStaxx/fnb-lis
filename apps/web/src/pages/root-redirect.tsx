import { Navigate } from "react-router";
import { useMe } from "@/api/auth";
import { ApiError } from "@/api/http";
import { FullPageSpinner } from "@/components/full-page-spinner";

/** Lands the user on their first accessible location (or the login page). */
export function RootRedirect() {
  const me = useMe();

  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace />;
    }
    return <FullPageSpinner error="Could not reach the server. Is the API running?" />;
  }

  const firstLocation = me.data.clients.flatMap((c) => c.locations)[0];
  if (!firstLocation) {
    return (
      <FullPageSpinner error="Your account has no assigned client locations yet. Ask an administrator to assign you." />
    );
  }
  return <Navigate to={`/l/${firstLocation.id}/dashboard`} replace />;
}
