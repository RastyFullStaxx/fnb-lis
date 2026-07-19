import { phpRound } from "./rounding";

/**
 * Open-container weighing — the legacy system's signature calculation.
 * An open bottle goes on the scale; remaining content is derived from the
 * reading minus the empty-container (tare) weight, times a density factor
 * that converts weight units into content (ml). Verified against
 * fnb-main auditbottles/views/openbottle.php.
 */
export interface WeighInput {
  scaleWeight: number;
  tareWeight: number;
  /** Content units (ml) per weight unit — e.g. Vodka 30.12 ml per oz. */
  densityFactor: number;
}

export type WeighWarning =
  | { code: "SCALE_BELOW_TARE"; blocking: true; message: string }
  | { code: "CONTENT_EXCEEDS_SIZE"; blocking: false; message: string };

/** remaining = round((scale − tare) × densityFactor) — integer, legacy parity. */
export function remainingContent(input: WeighInput): number {
  return phpRound((input.scaleWeight - input.tareWeight) * input.densityFactor);
}

export function validateWeigh(
  input: WeighInput,
  variantSize?: number | null,
): WeighWarning[] {
  const warnings: WeighWarning[] = [];
  if (input.scaleWeight < input.tareWeight) {
    warnings.push({
      code: "SCALE_BELOW_TARE",
      blocking: true,
      message: "Scale reading is below the empty-container weight — check the tare weight or the reading.",
    });
    return warnings;
  }
  if (variantSize && variantSize > 0) {
    const remaining = remainingContent(input);
    if (remaining > variantSize) {
      warnings.push({
        code: "CONTENT_EXCEEDS_SIZE",
        blocking: false,
        message: `Computed content (${remaining}) exceeds the container size (${variantSize}) — the density factor or tare weight may be off.`,
      });
    }
  }
  return warnings;
}

/**
 * Kitchen net-weight mode (client req #16): quantity = (scale − tare)
 * converted to base grams, phpRounded to the INTEGER GRAM (the same
 * "round in the base unit" parity as the density path's integer ml — an
 * oz-scale reading is not quantized to whole ounces), then expressed in the
 * variant's own counting unit (3500 g → 3.5 kg).
 */
export function netQuantity(input: {
  scaleWeight: number;
  tareWeight: number;
  /** The scale unit's factorToBase (g = 1, oz ≈ 28.35). */
  scaleFactorToBase: number;
  /** The variant counting unit's factorToBase (kg = 1000). */
  targetFactorToBase: number;
}): number {
  const netGrams = phpRound((input.scaleWeight - input.tareWeight) * input.scaleFactorToBase);
  return netGrams / input.targetFactorToBase;
}

/** validateWeigh's sibling for the NET path — same blocking rule, no density/size checks. */
export function validateNetWeigh(input: { scaleWeight: number; tareWeight: number }): WeighWarning[] {
  if (input.scaleWeight < input.tareWeight) {
    return [
      {
        code: "SCALE_BELOW_TARE",
        blocking: true,
        message: "Scale reading is below the empty-container weight — check the tare weight or the reading.",
      },
    ];
  }
  return [];
}

/** Per-item density factor beats the category default (legacy behavior). */
export function resolveDensityFactor(
  variantFactor: number | null | undefined,
  categoryDefault: number | null | undefined,
): number | null {
  if (variantFactor && variantFactor > 0) return variantFactor;
  if (categoryDefault && categoryDefault > 0) return categoryDefault;
  return null;
}

/**
 * Open amounts in reports: content-tracked items divide by container size
 * (350 ml of a 700 ml bottle = 0.5 bottles); count items use the raw value.
 * This is the legacy `uom == 'ml'` branch made explicit and universal.
 */
export function openEquivalent(
  content: number,
  size: number,
  contentTracked: boolean,
): number {
  if (!contentTracked) return content;
  if (size <= 0) return 0;
  return content / size;
}
