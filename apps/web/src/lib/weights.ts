import { canSeeBottleWeights, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCurrentLocation } from "@/api/location";

/**
 * Whether the signed-in user may see raw tare / liquid weights here.
 *
 * The calibration library is LIS's own data (client decision 2026-07-25): the
 * LIS admin always sees it, an establishment only when the admin has switched
 * it on for them. Everyone else still sees the "Needs weight" STATUS and the
 * computed remaining content — they just never read the constants.
 *
 * One hook so every surface asks the same question the same way.
 */
export function useCanSeeBottleWeights(): boolean {
  const me = useMe();
  const location = useCurrentLocation();
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const client = me.data?.clients.find((c) => c.id === location?.clientId);
  return canSeeBottleWeights(role, client?.showBottleWeights);
}
