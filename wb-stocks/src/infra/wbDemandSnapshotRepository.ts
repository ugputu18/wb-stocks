import type { DbHandle } from "./db.js";
import type { WbDemandSnapshotRecord } from "../domain/wbDemandSnapshot.js";

/**
 * Repository for `wb_demand_snapshots`.
 *
 * Idempotency model:
 * - PK is `(snapshot_date, warehouse_key, nm_id, tech_size)`.
 * - `replaceForDate(snapshotDate, rows)` deletes the entire slice for
 *   the given snapshotDate then re-inserts. Recomputing demand for the
 *   same date thus converges to the latest aggregate; nothing leaks
 *   from a previous (possibly broader) run.
 * - `vendor_code` / `barcode` are persisted alongside the key strictly
 *   for debugging / cross-referencing with own warehouse data.
 */
export class WbDemandSnapshotRepository {
  constructor(private readonly db: DbHandle) {}

  replaceForDate(
    snapshotDate: string,
    rows: readonly WbDemandSnapshotRecord[],
  ): { deleted: number; inserted: number } {
    const del = this.db.prepare(
      `DELETE FROM wb_demand_snapshots WHERE snapshot_date = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO wb_demand_snapshots (
         snapshot_date, warehouse_name_raw, warehouse_key, nm_id, tech_size,
         vendor_code, barcode, units7, units30, avg_daily_7, avg_daily_30,
         base_daily_demand, trend_ratio, trend_ratio_clamped,
         forecast_daily_demand, computed_at
       ) VALUES (
         @snapshotDate, @warehouseNameRaw, @warehouseKey, @nmId, @techSize,
         @vendorCode, @barcode, @units7, @units30, @avgDaily7, @avgDaily30,
         @baseDailyDemand, @trendRatio, @trendRatioClamped,
         @forecastDailyDemand, @computedAt
       )`,
    );
    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly WbDemandSnapshotRecord[]) => {
        deleted = del.run(snapshotDate).changes;
        for (const r of batch) {
          ins.run(r);
          inserted += 1;
        }
      },
    );
    tx(rows);
    return { deleted, inserted };
  }

  getForDate(snapshotDate: string): WbDemandSnapshotRecord[] {
    return this.db
      .prepare(
        `SELECT snapshot_date         AS snapshotDate,
                warehouse_name_raw    AS warehouseNameRaw,
                warehouse_key         AS warehouseKey,
                nm_id                 AS nmId,
                tech_size             AS techSize,
                vendor_code           AS vendorCode,
                barcode               AS barcode,
                units7                AS units7,
                units30               AS units30,
                avg_daily_7           AS avgDaily7,
                avg_daily_30          AS avgDaily30,
                base_daily_demand     AS baseDailyDemand,
                trend_ratio           AS trendRatio,
                trend_ratio_clamped   AS trendRatioClamped,
                forecast_daily_demand AS forecastDailyDemand,
                computed_at           AS computedAt
           FROM wb_demand_snapshots
          WHERE snapshot_date = ?
          ORDER BY warehouse_key, nm_id, tech_size`,
      )
      .all(snapshotDate) as WbDemandSnapshotRecord[];
  }

  countForDate(snapshotDate: string): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM wb_demand_snapshots WHERE snapshot_date = ?`,
      )
      .get(snapshotDate) as { c: number };
    return r.c;
  }
}
