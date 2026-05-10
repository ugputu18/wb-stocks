import type { DbHandle } from "./db.js";
import type { WbForecastSnapshotRecord } from "../domain/wbForecastSnapshot.js";
import type { ForecastSnapshotScope } from "../application/forecast-report/forecastReportTypes.js";
import {
  buildScopeWhere,
  skuKey,
} from "../application/forecast-report/forecastReportQueryHelpers.js";

/**
 * Repository for `wb_forecast_snapshots`.
 *
 * Idempotency model:
 * - PK is `(snapshot_date, horizon_days, warehouse_key, nm_id, tech_size)`.
 * - `replaceForKey` / `replaceForScope(..., scope={})` deletes matching rows
 *   for that `(snapshotDate, horizonDays)` — by default the full slice; if
 *   `scope` sets `warehouseKey` / `nmId` / `vendorCode`, only rows matching
 *   those columns are removed before insert. Used by the forecast CLI when
 *   `--sku` / `--warehouse` narrow the recompute without wiping other SKUs.
 * - `vendor_code` and `barcode` are persisted for debugging / cross-checking
 *   with our own warehouse data; never part of the key.
 */
export class WbForecastSnapshotRepository {
  constructor(private readonly db: DbHandle) {}

  replaceForKey(
    snapshotDate: string,
    horizonDays: number,
    rows: readonly WbForecastSnapshotRecord[],
  ): { deleted: number; inserted: number } {
    return this.replaceForScope(snapshotDate, horizonDays, rows);
  }

  replaceForScope(
    snapshotDate: string,
    horizonDays: number,
    rows: readonly WbForecastSnapshotRecord[],
    scope: ForecastSnapshotScope = {},
  ): { deleted: number; inserted: number } {
    const { sql, params } = buildScopeWhere(snapshotDate, horizonDays, scope);
    const del = this.db.prepare(`DELETE FROM wb_forecast_snapshots ${sql}`);
    const ins = this.db.prepare(
      `INSERT INTO wb_forecast_snapshots (
         snapshot_date, horizon_days, warehouse_name_raw, warehouse_key,
         nm_id, tech_size, vendor_code, barcode,
         units7, units30, units90, avg_daily_7, avg_daily_30, avg_daily_90,
         base_daily_demand, trend_ratio, trend_ratio_clamped,
         forecast_daily_demand,
         stock_snapshot_at, start_stock, incoming_units,
         forecast_units, end_stock, days_of_stock, stockout_date,
         computed_at
       ) VALUES (
         @snapshotDate, @horizonDays, @warehouseNameRaw, @warehouseKey,
         @nmId, @techSize, @vendorCode, @barcode,
         @units7, @units30, @units90, @avgDaily7, @avgDaily30, @avgDaily90,
         @baseDailyDemand, @trendRatio, @trendRatioClamped,
         @forecastDailyDemand,
         @stockSnapshotAt, @startStock, @incomingUnits,
         @forecastUnits, @endStock, @daysOfStock, @stockoutDate,
         @computedAt
       )`,
    );

    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly WbForecastSnapshotRecord[]) => {
        deleted = del.run(...params).changes;
        for (const r of batch) {
          ins.run(r);
          inserted += 1;
        }
      },
    );
    tx(rows);
    return { deleted, inserted };
  }

  getForKey(
    snapshotDate: string,
    horizonDays: number,
  ): WbForecastSnapshotRecord[] {
    return this.db
      .prepare(
        `SELECT snapshot_date         AS snapshotDate,
                horizon_days          AS horizonDays,
                warehouse_name_raw    AS warehouseNameRaw,
                warehouse_key         AS warehouseKey,
                nm_id                 AS nmId,
                tech_size             AS techSize,
                vendor_code           AS vendorCode,
                barcode               AS barcode,
                units7                AS units7,
                units30               AS units30,
                units90               AS units90,
                avg_daily_7           AS avgDaily7,
                avg_daily_30          AS avgDaily30,
                avg_daily_90          AS avgDaily90,
                base_daily_demand     AS baseDailyDemand,
                trend_ratio           AS trendRatio,
                trend_ratio_clamped   AS trendRatioClamped,
                forecast_daily_demand AS forecastDailyDemand,
                stock_snapshot_at     AS stockSnapshotAt,
                start_stock           AS startStock,
                incoming_units        AS incomingUnits,
                forecast_units        AS forecastUnits,
                end_stock             AS endStock,
                days_of_stock         AS daysOfStock,
                stockout_date         AS stockoutDate,
                computed_at           AS computedAt
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?
          ORDER BY warehouse_key, nm_id, tech_size`,
      )
      .all(snapshotDate, horizonDays) as WbForecastSnapshotRecord[];
  }

  countForKey(snapshotDate: string, horizonDays: number): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS c
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?`,
      )
      .get(snapshotDate, horizonDays) as { c: number };
    return r.c;
  }

  /** Distinct warehouse keys for filters (dropdown). */
  distinctWarehouseKeys(snapshotDate: string, horizonDays: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT warehouse_key AS k
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?
          ORDER BY warehouse_key`,
      )
      .all(snapshotDate, horizonDays) as { k: string }[];
    return rows.map((r) => r.k);
  }

  /**
   * Агрегаты по складу для аудита маппинга макрорегионов (строки прогноза = SKU×склад).
   */
  aggregateWarehouseMetricsPerWarehouse(
    snapshotDate: string,
    horizonDays: number,
  ): Array<{
    warehouseKey: string;
    warehouseNameRaw: string | null;
    rowCount: number;
    sumForecastDailyDemand: number;
    sumStartStock: number;
    sumIncomingUnits: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT warehouse_key AS warehouseKey,
                MAX(warehouse_name_raw) AS warehouseNameRaw,
                COUNT(*) AS rowCount,
                SUM(forecast_daily_demand) AS sumForecastDailyDemand,
                SUM(start_stock) AS sumStartStock,
                SUM(incoming_units) AS sumIncomingUnits
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?
          GROUP BY warehouse_key
          ORDER BY warehouse_key`,
      )
      .all(snapshotDate, horizonDays) as Array<{
      warehouseKey: string;
      warehouseNameRaw: string | null;
      rowCount: number;
      sumForecastDailyDemand: number;
      sumStartStock: number;
      sumIncomingUnits: number;
    }>;
    return rows.map((r) => ({
      warehouseKey: r.warehouseKey,
      warehouseNameRaw: r.warehouseNameRaw,
      rowCount: r.rowCount,
      sumForecastDailyDemand: Number(r.sumForecastDailyDemand ?? 0),
      sumStartStock: Number(r.sumStartStock ?? 0),
      sumIncomingUnits: Number(r.sumIncomingUnits ?? 0),
    }));
  }

  /** Sum(start_stock + incoming_units) по всем складам WB для (nm_id, tech_size). */
  loadWbAvailabilityTotals(
    snapshotDate: string,
    horizonDays: number,
  ): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT nm_id AS nmId, tech_size AS techSize,
                COALESCE(SUM(start_stock + incoming_units), 0) AS s
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?
          GROUP BY nm_id, tech_size`,
      )
      .all(snapshotDate, horizonDays) as { nmId: number; techSize: string; s: number }[];
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(skuKey(r.nmId, r.techSize), Number(r.s) || 0);
    }
    return m;
  }
}

export * from "../application/forecast-report/forecastReportTypes.js";
export { WbForecastReportQueryService } from "../application/forecast-report/WbForecastReportQueryService.js";
