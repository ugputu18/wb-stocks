/**
 * One row in `wb_forecast_snapshots`.
 *
 * The forecast snapshot is the "what will happen" projection for a given
 * `(snapshotDate, horizonDays, warehouse, sku)`. It carries:
 *
 * 1. **Inline explainability** — the same demand-side numbers we wrote to
 *    `wb_demand_snapshots` (units7..forecastDailyDemand). Duplicated
 *    here on purpose: a forecast row is supposed to be self-explanatory
 *    without a JOIN. If you ever wonder "why is this forecast 4.2?",
 *    you read the row and immediately see `units7=28`,
 *    `trendRatioClamped=1.25` etc.
 *
 * 2. **Stock provenance** — `stockSnapshotAt` records WHICH warehouse-
 *    stock snapshot fed `startStock`. Two forecast snapshots for the
 *    same `snapshotDate` can be reproduced and diffed unambiguously.
 *
 * 3. **Simulation outputs** — `forecastUnits` (≈ projected sales over
 *    horizon), `endStock`, `daysOfStock` (consecutive whole days at the
 *    start of the horizon where projected sales fully cover demand),
 *    `stockoutDate` (first day demand cannot be met, or null).
 *
 * Note on fractional demand:
 * - `forecastDailyDemand` can be fractional because it comes from the
 *   smoothing formula in the demand snapshot.
 * - therefore `forecastUnits` and `endStock` are also allowed to be
 *   fractional
 * - `daysOfStock` remains an integer count of fully-covered *days*;
 *   it does not try to encode a partial final day
 *
 * Idempotency PK: `(snapshotDate, horizonDays, warehouseKey, nmId, techSize)`.
 * `vendorCode` / `barcode` are payload-only and copied through from the
 * demand snapshot for debugging convenience.
 */
export interface WbForecastSnapshotRecord {
  snapshotDate: string; // YYYY-MM-DD
  horizonDays: number;
  warehouseNameRaw: string | null;
  warehouseKey: string;
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  barcode: string | null;
  // Demand explainability (mirror of wb_demand_snapshots fields):
  units7: number;
  units30: number;
  units90: number;
  avgDaily7: number;
  avgDaily30: number;
  avgDaily90: number;
  baseDailyDemand: number;
  trendRatio: number;
  trendRatioClamped: number;
  forecastDailyDemand: number;
  // Stock provenance:
  stockSnapshotAt: string;
  startStock: number;
  // Supplies aggregate over the horizon:
  incomingUnits: number;
  // Simulation outputs:
  forecastUnits: number;
  endStock: number;
  daysOfStock: number;
  stockoutDate: string | null;
  computedAt: string;
}
