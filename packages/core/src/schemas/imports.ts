import { z } from "zod";
import { dateString, id } from "./common";

/** The structured output schema handed to Claude for PDF/image extraction. */
export const importExtractionRow = z.object({
  itemText: z.string().describe("The item or product name exactly as printed"),
  qty: z.number().nullable().optional().describe("Quantity, if present"),
  unitPrice: z.number().nullable().optional().describe("Selling price per unit, if present"),
  unitCost: z.number().nullable().optional().describe("Cost per unit, if present"),
  date: z.string().nullable().optional().describe("Transaction date if present (any format)"),
  note: z.string().nullable().optional(),
});

export const importExtractionResult = z.object({
  detectedKind: z.enum(["SALES", "PURCHASES", "NON_REVENUE", "UNKNOWN"]),
  rows: z.array(importExtractionRow),
  warnings: z.array(z.string()),
});
export type ImportExtractionResult = z.infer<typeof importExtractionResult>;

export const importRowUpdate = z.object({
  matchedLocationItemId: id.nullable().optional(),
  matchedMenuItemId: id.nullable().optional(),
  qty: z.number().nonnegative().nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  unitCost: z.number().nonnegative().nullable().optional(),
  rowDate: dateString.nullable().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});
export type ImportRowUpdate = z.infer<typeof importRowUpdate>;
