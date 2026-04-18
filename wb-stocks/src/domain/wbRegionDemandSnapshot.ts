/**
 * Снимок спроса по региону заказа (`regionName` из WB), ключ `(snapshot_date, region_key, nm_id, tech_size)`.
 * Формулы avg/forecast — те же, что у `wb_demand_snapshots`.
 */
export interface WbRegionDemandSnapshotRecord {
  snapshotDate: string;
  regionNameRaw: string | null;
  regionKey: string;
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
  /** Аналог `forecast_daily_demand` в `wb_demand_snapshots`, но по региону заказа. */
  regionalForecastDailyDemand: number;
  computedAt: string;
}
