/**
 * One row in `wb_demand_snapshots`.
 *
 * The snapshot is the per-`(warehouse, sku)` demand profile as of
 * `snapshotDate`, computed from `wb_orders_daily` over the trailing
 * 30 days. It is the input to the forecast simulation (Stage 3).
 *
 * Numeric fields:
 * - `units7` / `units30`        — raw sums in pieces
 * - `avgDaily7` / `avgDaily30`  — smoothed daily rates (pieces/day)
 * - `baseDailyDemand`           — `0.6*avgDaily7 + 0.4*avgDaily30`
 * - `trendRatio`                — `avgDaily7 / max(avgDaily30, ε)`
 * - `trendRatioClamped`         — `clamp(trendRatio, 0.75, 1.25)`
 * - `forecastDailyDemand`       — `baseDailyDemand * trendRatioClamped`
 *
 * `vendorCode` / `barcode` are payload-only debug aids; the join key is
 * `(snapshotDate, warehouseKey, nmId, techSize)`.
 */
export interface WbDemandSnapshotRecord {
  snapshotDate: string; // YYYY-MM-DD
  warehouseNameRaw: string | null;
  warehouseKey: string;
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  barcode: string | null;
  units7: number;
  units30: number;
  avgDaily7: number;
  avgDaily30: number;
  baseDailyDemand: number;
  trendRatio: number;
  trendRatioClamped: number;
  forecastDailyDemand: number;
  computedAt: string;
}
