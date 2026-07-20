import type { ComponentProps } from "react";
import type { Badge } from "@/components/ui/badge";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/**
 * The one status vocabulary (client req, 2026-07-21). Four semantic buckets,
 * applied identically on every screen so a colour means the same thing
 * wherever it appears:
 *
 *   success (green)  — the record is DONE. Committed, received, paid.
 *   destructive (red)— the record is CANCELLED or FAILED. Terminal.
 *   warning (amber)  — needs a human, but recoverable. Not a failure.
 *   default (blue)   — in progress. Work started, not finished.
 *   secondary        — classification, not state (role, type, unit kind).
 *
 * Green is reserved for "this record completed successfully" and never means
 * "this number is favourable" — on an audit tool a surplus is as much a
 * reconciliation defect as a shortage, so variance stays uncoloured on the
 * positive side.
 */
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  // Done.
  COMMITTED: "success",
  RECEIVED: "success",
  PAID: "success",
  PUBLISHED: "success",
  COMPLETE: "success",

  // Terminal — cancelled or failed.
  VOID: "destructive",
  CANCELLED: "destructive",
  REVERSED: "destructive",
  FAILED: "destructive",
  DISABLED: "destructive",
  REJECTED: "destructive",

  // Recoverable, needs attention.
  NEEDS_REVIEW: "warning",
  UNPAID: "warning",
  GRACE: "warning",
  SUSPENDED: "warning",
  UNMATCHED: "warning",
  UNPRICED: "warning",
  VIEW_ONLY: "warning",

  // In progress.
  OPEN: "default",
  DRAFT: "default",
  ACTIVE: "default",
  TRIAL: "default",
  PROCESSING: "default",
  COUNTING: "default",
  PARTIAL: "default",
};

/** Badge variant for a status code. Unknown codes stay inert rather than
 *  guessing a colour — a wrong colour is worse than no colour. */
export function statusVariant(status: string | null | undefined): BadgeVariant {
  if (!status) return "outline";
  return STATUS_VARIANTS[status.toUpperCase()] ?? "outline";
}
