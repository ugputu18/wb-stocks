/**
 * Read-side replenishment hint from a single `wb_forecast_snapshots` row.
 * MVP: no MOQ, packs, or pallet rounding — not persisted to DB.
 */
export interface ReplenishmentReadModel {
  targetCoverageDays: number;
  targetDemand: number;
  projectedAvailable: number;
  /** Integer ≥ 0 */
  recommendedSupplyUnits: number;
}

export function replenishmentFromSnapshotRow(
  forecastDailyDemand: number,
  startStock: number,
  incomingUnits: number,
  targetCoverageDays: number,
): ReplenishmentReadModel {
  const fd = Number(forecastDailyDemand);
  const ss = Number(startStock);
  const iu = Number(incomingUnits);
  const tc = Number(targetCoverageDays);
  if (!Number.isFinite(fd) || !Number.isFinite(ss) || !Number.isFinite(iu) || !Number.isFinite(tc)) {
    return {
      targetCoverageDays: tc,
      targetDemand: NaN,
      projectedAvailable: NaN,
      recommendedSupplyUnits: 0,
    };
  }
  const targetDemand = fd * tc;
  const projectedAvailable = ss + iu;
  const raw = targetDemand - projectedAvailable;
  const recommendedSupplyUnits = raw <= 0 ? 0 : Math.ceil(raw - 1e-12);
  return {
    targetCoverageDays: tc,
    targetDemand,
    projectedAvailable,
    recommendedSupplyUnits,
  };
}
