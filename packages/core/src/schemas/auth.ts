import { z } from "zod";
import { ROLES } from "../constants";

export const loginRequest = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
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
}

export interface MeClient {
  id: string;
  name: string;
  locations: MeLocation[];
}

export interface MeResponse {
  user: SessionUser;
  clients: MeClient[];
  features: { aiEnabled: boolean };
}
