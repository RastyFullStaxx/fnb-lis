import { describe, expect, it } from "vitest";
import { openContainerContent, reconcile } from "../src/domain/calculations";

describe("open-container measurement", () => {
  it("subtracts tare and applies the item factor", () => {
    expect(openContainerContent(720, 420, 1.19, 700)).toEqual({
      value: 357,
      warning: ""
    });
  });

  it("rejects a scale reading below tare", () => {
    expect(openContainerContent(400, 420, 1.19, 700).warning).toMatch(/below tare/i);
  });

  it("flags content above container capacity", () => {
    expect(openContainerContent(1100, 420, 1.19, 700).warning).toMatch(/exceeds/i);
  });
});

describe("audit reconciliation", () => {
  it("separates physical and explained depletion", () => {
    expect(
      reconcile({
        beginning: 82400,
        receipts: 21400,
        ending: 10000,
        sales: 48200,
        recipeUse: 33400,
        nonRevenue: 4200,
        waste: 6160
      })
    ).toEqual({
      physical: 93800,
      explained: 91960,
      variance: 1840
    });
  });
});
