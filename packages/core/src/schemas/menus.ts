import { z } from "zod";
import { id, nonNegative, positive } from "./common";

export const menuCreate = z.object({
  name: z.string().trim().min(1).max(120),
});
export type MenuCreate = z.infer<typeof menuCreate>;

export const recipeLineInput = z.object({
  locationItemId: id,
  /** Content units for content-tracked ingredients (e.g. 45 ml), whole units otherwise. */
  servingQty: positive,
  sortOrder: z.number().int().optional(),
});
export type RecipeLineInput = z.infer<typeof recipeLineInput>;

export const recipePublish = z.object({
  srp: nonNegative,
  note: z.string().trim().max(500).optional(),
  lines: z.array(recipeLineInput).min(1, "A recipe needs at least one ingredient"),
});
export type RecipePublish = z.infer<typeof recipePublish>;
