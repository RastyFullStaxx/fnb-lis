import { useMemo } from "react";
import { Scale } from "lucide-react";
import {
  can,
  netQuantity,
  resolveBottleWeights,
  remainingContent,
  resolveDensityFactor,
  validateNetWeigh,
  validateWeigh,
  openEquivalent,
  type Role,
} from "@fnb/core";
import { useMe } from "@/api/auth";
import { useUnits } from "@/api/master";
import type { LocationItem } from "@/api/types";
import { cn } from "@/lib/utils";
import { defaultWeighUnit, useUnitSystem } from "@/lib/preferences";

/**
 * The live weigh strip — the SAME core math the server uses, running in the
 * browser as the user types. Screen math can never disagree with report math.
 *
 * Two modes (client req #16):
 *   DENSITY — bar open-bottle: (scale − tare) × density ⇒ content (ml)
 *   NET     — kitchen: (scale − tare) converted to the counting unit ⇒ qty
 *
 * `trailingAverage` feeds the history-based outlier check
 * (docs/2026-08-01-weight-outlier-warning-plan.md §3, §6 step 1; phases doc
 * Phase 3) — fetched by the caller (useTrailingAverage), not by this hook,
 * so the math here stays a pure function of its own arguments, same shape
 * as before this feature. `undefined`/`null` (no history yet, or not loaded
 * yet) flows straight through to validateWeigh/validateNetWeigh, which stay
 * silent on the history check rather than guessing.
 */
export function useWeighPreview(item: LocationItem | null, scaleText: string, trailingAverage?: number | null) {
  const unitSystem = useUnitSystem();
  const units = useUnits();
  // Fallback only for items that have no tare unit configured yet — a
  // properly set-up item always carries its own real tareWeightUnit, since
  // that reflects how the container was actually weighed, not a display
  // choice. Only the fallback should follow the user's preference.
  const fallbackUnit = defaultWeighUnit(unitSystem);
  return useMemo(() => {
    if (!item) return null;
    const variant = item.itemVariant;
    // Mirrors effectiveWeighMode in routes/counts.ts: contentTracked always
    // means the density path; NET applies only to whole-count MASS variants.
    const mode = variant.contentTracked
      ? ("DENSITY" as const)
      : variant.weighMode === "NET" || variant.weighMode === "DENSITY"
        ? variant.weighMode
        : null;
    if (!mode) return null;
    // The client's own weighing of THEIR bottle wins over the shared master
    // library — same rule the server applies in routes/counts.ts, so the live
    // preview can never disagree with what gets saved.
    const resolved = resolveBottleWeights(item, variant, variant.item.category.defaultDensityFactor);
    const tare = resolved.tareWeight;

    if (mode === "NET") {
      if (tare === null) return { ready: false as const, missing: "empty weight" };
      const unitName = resolved.tareWeightUnit ?? fallbackUnit;
      const scale = Number(scaleText);
      if (scaleText === "" || !Number.isFinite(scale)) {
        return { ready: true as const, entered: false as const, mode, tare, density: null, unit: unitName };
      }
      // Blocking check first — SCALE_BELOW_TARE only needs scale/tare, so it
      // doesn't wait on the quantity below.
      const blockingCheck = validateNetWeigh({ scaleWeight: scale, tareWeight: tare });
      const blocking = blockingCheck.some((w) => w.blocking);
      // Same math as the server (core netQuantity): round in base grams, then
      // express in the counting unit.
      const scaleUnitRow = units.data?.find((u) => u.name === unitName);
      const remaining =
        blocking || !scaleUnitRow || variant.unit.factorToBase <= 0
          ? 0
          : netQuantity({
              scaleWeight: scale,
              tareWeight: tare,
              scaleFactorToBase: scaleUnitRow.factorToBase,
              targetFactorToBase: variant.unit.factorToBase,
            });
      // Re-run with the computed content so the history-based outlier check
      // (plan §3, both weigh modes) can compare it against trailingAverage —
      // blocking already resolved above, so this only adds/keeps warnings.
      const warnings = blocking
        ? blockingCheck
        : validateNetWeigh({ scaleWeight: scale, tareWeight: tare }, remaining, trailingAverage);
      return {
        ready: true as const,
        entered: true as const,
        mode,
        tare,
        density: null,
        unit: unitName,
        scale,
        remaining,
        equivalent: remaining,
        warnings,
        blocking,
      };
    }

    const density = resolveDensityFactor(
      resolved.densityFactor,
      variant.item.category.defaultDensityFactor,
    );
    if (!density || tare === null) {
      return { ready: false as const, missing: !density ? "liquid weight" : "empty weight" };
    }
    const scale = Number(scaleText);
    if (scaleText === "" || !Number.isFinite(scale)) {
      return {
        ready: true as const,
        entered: false as const,
        mode,
        tare,
        density,
        unit: resolved.tareWeightUnit ?? fallbackUnit,
      };
    }
    const input = { scaleWeight: scale, tareWeight: tare, densityFactor: density };
    const warnings = validateWeigh(input, variant.size, trailingAverage);
    const blocking = warnings.some((w) => w.blocking);
    const remaining = blocking ? 0 : remainingContent(input);
    return {
      ready: true as const,
      entered: true as const,
      mode,
      tare,
      density,
      unit: resolved.tareWeightUnit ?? fallbackUnit,
      scale,
      remaining,
      equivalent: blocking ? 0 : openEquivalent(remaining, variant.size, true),
      warnings,
      blocking,
    };
  }, [item, scaleText, fallbackUnit, units.data, trailingAverage]);
}

export function WeighPreviewStrip({
  preview,
  size,
  contentUnit,
}: {
  preview: ReturnType<typeof useWeighPreview>;
  size: number;
  contentUnit: string;
}) {
  const me = useMe();
  const canEditWeights = can((me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role, "prices.edit");
  if (!preview) return null;
  if (!preview.ready) {
    return (
      <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-foreground">
        {/* Never a dead end: whoever hits this must be told what THEY can do
            next — and only a manager/owner can record a weighing, so staff get
            the way around it instead of an instruction they can't follow. */}
        {canEditWeights
          ? `This bottle has no ${preview.missing} yet — weigh the empty container and record it on the item in Local Database, then come back.`
          : `This bottle has no ${preview.missing} yet, so it can't be weighed. Ask your manager to weigh the empty container in Local Database — meanwhile you can count it under Full Units, or enter what's left under Open Amount.`}
      </p>
    );
  }
  if (!preview.entered) {
    return (
      <p className="text-sm text-muted-foreground tnum">
        {/* The constants are LIS's own calibration data — a counter needs the
            RESULT, not the inputs (client decision 2026-07-25). */}
        {preview.mode === "NET"
          ? `Empty weight ${preview.tare} ${preview.unit} · weighed by net weight — type the scale weight.`
          : `Empty weight ${preview.tare} ${preview.unit} · Liquid Weight ×${preview.density} — type the scale weight.`}
      </p>
    );
  }
  const warning = preview.warnings[0];
  // Thousands separators — "9,284" reads faster than "9284" at a glance.
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div aria-live="polite" className="space-y-1.5">
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2",
          preview.blocking ? "border-destructive/50 bg-destructive/5" : "bg-muted",
        )}
      >
        <Scale className="mt-0.5 size-4 shrink-0 text-primary" />
        {preview.blocking ? (
          <span className="text-sm text-destructive">{warning?.message}</span>
        ) : (
          // The calculation on one line with its parts named, the result bold,
          // and (for bar bottles) how many containers that is on a second,
          // quieter line — instead of one dense dot-separated run.
          <div className="min-w-0 flex-1 space-y-0.5 tnum text-sm">
            <div>
              <span className="text-muted-foreground">
                {preview.mode === "NET"
                  ? `scale ${fmt(preview.scale)} − empty ${fmt(preview.tare)} ${preview.unit}`
                  : `(scale ${fmt(preview.scale)} − empty ${fmt(preview.tare)} ${preview.unit}) × Liquid Weight ${fmt(preview.density)}`}
              </span>{" "}
              ={" "}
              {/* Keyed on the result so every recomputation visibly ticks (DESIGN.md motion). */}
              <span
                key={preview.remaining}
                className="inline-block font-semibold text-foreground duration-150 animate-in fade-in slide-in-from-bottom-0.5 motion-reduce:animate-none"
              >
                {fmt(preview.remaining)} {contentUnit}
              </span>
            </div>
            {preview.mode !== "NET" && size > 0 && (
              // Fullness gauge, not a bottle count: you're weighing ONE open
              // bottle, so this liquid should fill UNDER 100% of it. Framing it
              // as "% of the bottle" ties the ml result back to the bottle and
              // makes the error obvious (1,238% can't fit; 62% is a normal pour).
              <div className="text-xs text-muted-foreground">
                fills ≈ {(preview.equivalent * 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}% of the{" "}
                {fmt(size)} {contentUnit} bottle
              </div>
            )}
          </div>
        )}
      </div>
      {!preview.blocking && warning && (
        <p className="rounded-md bg-warning/10 px-3 py-1.5 text-xs text-foreground">{warning.message}</p>
      )}
    </div>
  );
}
