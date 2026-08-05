import { phpRound } from "./rounding";
import { WEIGH_OUTLIER_LOW_RATIO, WEIGH_OUTLIER_HIGH_RATIO } from "./constants";

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
  /**
   * Content units (ml) per ONE unit of whatever `tareWeight`/`scaleWeight` are
   * expressed in — grams here if the bottle's empty weight is in grams
   * (spirits ≈ 1.06), ounces if it is in ounces (≈ 30.1). Comment only: the
   * arithmetic below is unit-agnostic and unchanged.
   */
  densityFactor: number;
}

export type WeighWarning =
  | { code: "SCALE_BELOW_TARE"; blocking: true; message: string }
  | { code: "CONTENT_EXCEEDS_SIZE"; blocking: false; message: string }
  | { code: "CONTENT_BELOW_SIZE_FLOOR"; blocking: false; message: string }
  | { code: "CONTENT_UNUSUAL_VS_HISTORY"; blocking: false; message: string };

/**
 * History-ratio check (plan §3, §6 step 1) — shared by validateWeigh and
 * validateNetWeigh, and callable on its own for Open Amount (Phase 4), which
 * has no scale/tare, only a final content value.
 *
 * Flags a reading that is a large multiple away from this item's own recent
 * count history at this location, in either direction. `trailingAverage` is
 * fetched by the caller (the server route, Phase 2) — this file stays pure,
 * no I/O, per architecture.md §3. `null`/`undefined`/`<= 0` means no history
 * yet, so the check stays silent rather than guessing (plan §3, §8) — the
 * same "derived, not configured" fallback resolveDensityFactor already uses.
 */
export function checkContentVsHistory(
  content: number,
  trailingAverage: number | null | undefined,
): WeighWarning | null {
  if (trailingAverage == null || trailingAverage <= 0) return null;
  const ratio = content / trailingAverage;
  if (ratio < WEIGH_OUTLIER_LOW_RATIO) {
    return {
      code: "CONTENT_UNUSUAL_VS_HISTORY",
      blocking: false,
      message: "That's much lower than this item's recent counts — check the reading.",
    };
  }
  if (ratio > WEIGH_OUTLIER_HIGH_RATIO) {
    return {
      code: "CONTENT_UNUSUAL_VS_HISTORY",
      blocking: false,
      message: "That's much higher than this item's recent counts — check the reading.",
    };
  }
  return null;
}

/** remaining = round((scale − tare) × densityFactor) — integer, legacy parity. */
export function remainingContent(input: WeighInput): number {
  return phpRound((input.scaleWeight - input.tareWeight) * input.densityFactor);
}

export function validateWeigh(
  input: WeighInput,
  variantSize?: number | null,
  trailingAverage?: number | null,
): WeighWarning[] {
  const warnings: WeighWarning[] = [];
  if (input.scaleWeight < input.tareWeight) {
    warnings.push({
      code: "SCALE_BELOW_TARE",
      blocking: true,
      message: "Scale reading is below the empty weight — check the empty weight or the reading.",
    });
    return warnings;
  }
  const remaining = remainingContent(input);
  // Size-based check, DENSITY items only (plan §3): CONTENT_EXCEEDS_SIZE
  // (too high) kept as is, CONTENT_BELOW_SIZE_FLOOR (too low) is its new
  // low-side sibling — same reference (container size), opposite direction.
  // Ordered first: a size violation is closer to physically implausible
  // than a history mismatch (plan §4).
  if (variantSize && variantSize > 0) {
    if (remaining > variantSize) {
      warnings.push({
        code: "CONTENT_EXCEEDS_SIZE",
        blocking: false,
        message: "That's more than a full container holds — check the Liquid Weight or empty weight.",
      });
    } else if (remaining < variantSize * WEIGH_OUTLIER_LOW_RATIO) {
      warnings.push({
        code: "CONTENT_BELOW_SIZE_FLOOR",
        blocking: false,
        message: "That's far below what this container should hold — check the reading.",
      });
    }
  }
  // History-based check (plan §3, both weigh modes) — independent of the
  // size check above, catches a reading that fits the container fine but
  // is still a typo relative to how this item normally counts.
  const historyWarning = checkContentVsHistory(remaining, trailingAverage);
  if (historyWarning) warnings.push(historyWarning);
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

/**
 * validateWeigh's sibling for the NET path — same blocking rule, no size
 * check (NET items have no container size to compare against, plan §3/§6).
 *
 * `netContent` is the already-computed netQuantity() result and
 * `trailingAverage` this item's history at this location — both fetched by
 * the caller, same reason validateWeigh takes variantSize rather than
 * resolving it itself. Either argument omitted means "can't run the history
 * check yet" (e.g. a live preview before a full netQuantity call), which
 * stays silent rather than guessing, same as no history existing at all.
 */
export function validateNetWeigh(
  input: { scaleWeight: number; tareWeight: number },
  netContent?: number | null,
  trailingAverage?: number | null,
): WeighWarning[] {
  if (input.scaleWeight < input.tareWeight) {
    return [
      {
        code: "SCALE_BELOW_TARE",
        blocking: true,
        message: "Scale reading is below the empty-container weight — check the tare weight or the reading.",
      },
    ];
  }
  const warnings: WeighWarning[] = [];
  if (netContent != null) {
    const historyWarning = checkContentVsHistory(netContent, trailingAverage);
    if (historyWarning) warnings.push(historyWarning);
  }
  return warnings;
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

export type SplitTotalAmountResult =
  | { ok: true; fullCount: number; openRemainder: number }
  | { ok: false; code: "INVALID_SIZE"; message: string };

/**
 * Client req 2026-07-31 (Mayonnaise scenario): a counter types one combined
 * total for full units plus one open container, instead of splitting by
 * hand. 5.5L size, 5.2L on the shelf across 1 full jug and one open jug
 * would otherwise get typed straight into Open Amount as if it were all
 * open content, overstating cost.
 *
 * fullCount = floor(total / size), openRemainder = what is left over.
 * Uses phpRound on the remainder for the same integer/rounding parity as
 * the rest of this file. A remainder that rounds down to 0 is reported as
 * exactly 0, so the caller can skip creating an empty open line.
 */
export function splitTotalAmount(total: number, size: number): SplitTotalAmountResult {
  if (!size || size <= 0) {
    return { ok: false, code: "INVALID_SIZE", message: "Item has no size set, cannot split a total amount." };
  }
  const fullCount = Math.floor(total / size);
  // Two decimal places, not phpRound's default whole-number precision — the
  // remainder is in the item's own counting unit (L, kg), not a base unit
  // like ml/g, so rounding it to an integer collapsed 5.2 L down to 5 L.
  const openRemainder = phpRound(total - fullCount * size, 2);
  return { ok: true, fullCount, openRemainder };
}
