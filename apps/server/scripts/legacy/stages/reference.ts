/**
 * Stage 1 — categories.
 *
 * Runs first because every Item resolves its category through LegacyMap, and
 * nothing else can be imported until they exist.
 */
import type { Stage } from "../../import-legacy";
import { query } from "../source";
import { record } from "../map";
import { densityFor, productTypeFor } from "../units";

type LegacyCategory = {
  category_id: number;
  category_name: string;
  category_type: number;
  liquid_weight: string | number | null;
};

export const referenceStage: Stage = {
  name: "reference",
  async run(tx, report) {
    const rows = query<LegacyCategory>(`
      SELECT JSON_OBJECT(
        'category_id',   category_id,
        'category_name', category_name,
        'category_type', category_type,
        'liquid_weight', liquid_weight
      ) FROM categories ORDER BY category_id
    `);

    for (const row of rows) {
      const name = (row.category_name ?? "").trim();
      if (!name) {
        report.skip("blank-category-name", `category_id ${row.category_id}`);
        continue;
      }

      const productType = productTypeFor(Number(row.category_type));
      const density = densityFor(Number(row.liquid_weight ?? 0));

      const existing = await tx.category.findUnique({
        where: { name },
        select: { id: true, defaultDensityFactor: true, productType: true },
      });

      if (existing) {
        // Do NOT overwrite a bootstrap-seeded density with a legacy one. The
        // seeded values are the verified numbers in architecture.md §6, and a
        // client-specific edit made since then is a deliberate act. Legacy and
        // seed agree on all ten spirits once converted, so a real disagreement
        // here means something changed and a human should look.
        const a = existing.defaultDensityFactor;
        if (density != null && a != null && Math.abs(a - density) > 0.0001) {
          report.flag(
            `Category "${name}": existing density ${a}/g differs from legacy ${density}/g ` +
              `(${row.liquid_weight}/oz). Kept the existing value.`,
          );
        }
        if (existing.productType !== productType) {
          report.flag(
            `Category "${name}": existing productType "${existing.productType}" differs from ` +
              `legacy type ${row.category_type} ("${productType}"). Kept the existing value.`,
          );
        }
        await record(tx, "categories", row.category_id, existing.id);
        report.count("Category (matched existing)");
        continue;
      }

      const created = await tx.category.create({
        data: {
          name,
          productType,
          defaultDensityFactor: density,
          // Legacy has no perishability concept. Food spoils; the legacy
          // "Beverage" bucket is mostly bottled drinks that do not, but it also
          // holds Red/White/Rose' Wine and Liquer, which do. Defaulting Beverage
          // to false here would silently switch expiry tracking OFF for wine, so
          // Beverage takes the schema default (true) and a manager turns it off
          // per category. Over-tracking is visible; under-tracking is not.
          defaultPerishable: true,
          sortOrder: 1000 + Number(row.category_id),
        },
        select: { id: true },
      });
      await record(tx, "categories", row.category_id, created.id);
      report.count("Category (created)");
    }
  },
};
