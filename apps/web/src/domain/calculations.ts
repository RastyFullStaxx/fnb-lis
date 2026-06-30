export function openContainerContent(
  scaleWeight: number,
  tareWeight: number,
  factor: number,
  capacity?: number
) {
  if (scaleWeight < tareWeight) {
    return { value: 0, warning: "Scale weight cannot be below tare weight." };
  }
  const value = Math.round((scaleWeight - tareWeight) * factor * 100) / 100;
  if (capacity && value > capacity) {
    return { value, warning: "Calculated content exceeds container capacity." };
  }
  return { value, warning: "" };
}

export function reconcile(input: {
  beginning: number;
  receipts: number;
  transfersIn?: number;
  transfersOut?: number;
  positiveAdjustments?: number;
  ending: number;
  sales: number;
  recipeUse: number;
  nonRevenue: number;
  waste: number;
  production?: number;
}) {
  const physical =
    input.beginning +
    input.receipts +
    (input.transfersIn ?? 0) +
    (input.positiveAdjustments ?? 0) -
    (input.transfersOut ?? 0) -
    input.ending;
  const explained =
    input.sales +
    input.recipeUse +
    input.nonRevenue +
    input.waste +
    (input.production ?? 0);
  return { physical, explained, variance: physical - explained };
}
