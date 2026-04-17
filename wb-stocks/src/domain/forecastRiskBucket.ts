export type ForecastRiskBucket =
  | "critical"
  | "warning"
  | "attention"
  | "ok";

/**
 * UI risk bands (mutually exclusive), based solely on `daysOfStock` from
 * `wb_forecast_snapshots` for the selected horizon.
 *
 * | risk       | daysOfStock        |
 * |-----------|--------------------|
 * | critical  | < 7                |
 * | warning   | [7, 14)            |
 * | attention | [14, 30)           |
 * | ok        | >= 30              |
 */
export function riskBucketFromDaysOfStock(daysOfStock: number): ForecastRiskBucket {
  if (!Number.isFinite(daysOfStock)) return "critical";
  if (daysOfStock < 7) return "critical";
  if (daysOfStock < 14) return "warning";
  if (daysOfStock < 30) return "attention";
  return "ok";
}
