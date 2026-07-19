import { useMemo } from "react";
import { Scale } from "lucide-react";
import {
  netQuantity,
  remainingContent,
  resolveDensityFactor,
  validateNetWeigh,
  validateWeigh,
  openEquivalent,
} from "@fnb/core";
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
 */
export function useWeighPreview(item: LocationItem | null, scaleText: string) {
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
    const tare = variant.tareWeight;

    if (mode === "NET") {
      if (tare === null) return { ready: false as const, missing: "tare weight" };
      const unitName = variant.tareWeightUnit ?? fallbackUnit;
      const scale = Number(scaleText);
      if (scaleText === "" || !Number.isFinite(scale)) {
        return { ready: true as const, entered: false as const, mode, tare, density: null, unit: unitName };
      }
      const warnings = validateNetWeigh({ scaleWeight: scale, tareWeight: tare });
      const blocking = warnings.some((w) => w.blocking);
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
      variant.densityFactor,
      variant.item.category.defaultDensityFactor,
    );
    if (!density || tare === null) {
      return { ready: false as const, missing: !density ? "liquid weight formula" : "tare weight" };
    }
    const scale = Number(scaleText);
    if (scaleText === "" || !Number.isFinite(scale)) {
      return {
        ready: true as const,
        entered: false as const,
        mode,
        tare,
        density,
        unit: variant.tareWeightUnit ?? fallbackUnit,
      };
    }
    const input = { scaleWeight: scale, tareWeight: tare, densityFactor: density };
    const warnings = validateWeigh(input, variant.size);
    const blocking = warnings.some((w) => w.blocking);
    const remaining = blocking ? 0 : remainingContent(input);
    return {
      ready: true as const,
      entered: true as const,
      mode,
      tare,
      density,
      unit: variant.tareWeightUnit ?? fallbackUnit,
      scale,
      remaining,
      equivalent: blocking ? 0 : openEquivalent(remaining, variant.size, true),
      warnings,
      blocking,
    };
  }, [item, scaleText, fallbackUnit, units.data]);
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
  if (!preview) return null;
  if (!preview.ready) {
    return (
      <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-foreground">
        This item has no {preview.missing} configured — set it in Items before weighing.
      </p>
    );
  }
  if (!preview.entered) {
    return (
      <p className="text-sm text-muted-foreground tnum">
        {preview.mode === "NET"
          ? `Tare ${preview.tare} ${preview.unit} · net weight mode — type the scale reading.`
          : `Tare ${preview.tare} ${preview.unit} · Liquid Weight ×${preview.density} — type the scale reading.`}
      </p>
    );
  }
  const warning = preview.warnings[0];
  return (
    <div aria-live="polite" className="space-y-1.5">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 transition-opacity duration-150",
          preview.blocking ? "border-destructive/50 bg-destructive/5" : "bg-muted",
        )}
      >
        <Scale className="size-4 shrink-0 text-primary" />
        {preview.blocking ? (
          <span className="text-sm text-destructive">{warning?.message}</span>
        ) : preview.mode === "NET" ? (
          <span className="tnum text-sm">
            scale {preview.scale} − tare {preview.tare} {preview.unit} →{" "}
            <span className="font-semibold">
              {preview.remaining} {contentUnit}
            </span>
          </span>
        ) : (
          <span className="tnum text-sm">
            (scale {preview.scale} − tare {preview.tare}) × Liquid Weight {preview.density} →{" "}
            <span className="font-semibold">
              {preview.remaining} {contentUnit}
            </span>{" "}
            · {preview.equivalent.toFixed(2)} of {size} {contentUnit}
          </span>
        )}
      </div>
      {!preview.blocking && warning && (
        <p className="text-xs text-warning-foreground text-muted-foreground">{warning.message}</p>
      )}
    </div>
  );
}
