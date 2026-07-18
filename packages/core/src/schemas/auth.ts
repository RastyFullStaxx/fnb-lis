import { z } from "zod";
import { ROLES } from "../constants";

export const loginRequest = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const role = z.enum(ROLES);

export interface SessionUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: z.infer<typeof role>;
}

export interface MeLocation {
  id: string;
  name: string;
  clientId: string;
  /** This location's OWN modules (Fix Plan §2.3) — the enforced reality, not the client's ceiling. */
  modules: string[];
}

export interface MeClientSubscription {
  packageType: string;
  modules: string[];
  status: string;
}

export interface MeClient {
  id: string;
  name: string;
  locations: MeLocation[];
  subscription: MeClientSubscription | null;
}

export interface MeResponse {
  user: SessionUser;
  clients: MeClient[];
  features: { aiEnabled: boolean };
}
