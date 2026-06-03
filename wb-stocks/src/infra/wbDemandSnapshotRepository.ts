import type { DbHandle } from "./db.js";
import type { WbDemandSnapshotRecord } from "../domain/wbDemandSnapshot.js";
import { legacyDemandDiagnosticsDefaults } from "../application/censoredPeakDemand.js";

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
         vendor_code, barcode, units7, units30, units90, avg_daily_7, avg_daily_30, avg_daily_90,
         base_daily_demand, trend_ratio, trend_ratio_clamped,
         forecast_daily_demand,
         demand_model_version,
         raw_avg_daily_7, raw_avg_daily_30, raw_avg_daily_90,
         adjusted_avg_daily_7, adjusted_avg_daily_30, adjusted_avg_daily_90,
         sellable_days_7, sellable_days_30, sellable_days_90,
         constrained_days_7, constrained_days_30, constrained_days_90,
         availability_observed_days_7, availability_observed_days_30, availability_observed_days_90,
         peak_daily_demand, forecast_allocation_scale,
         computed_at
       ) VALUES (
         @snapshotDate, @warehouseNameRaw, @warehouseKey, @nmId, @techSize,
         @vendorCode, @barcode, @units7, @units30, @units90, @avgDaily7, @avgDaily30, @avgDaily90,
         @baseDailyDemand, @trendRatio, @trendRatioClamped,
         @forecastDailyDemand,
         @demandModelVersion,
         @rawAvgDaily7, @rawAvgDaily30, @rawAvgDaily90,
         @adjustedAvgDaily7, @adjustedAvgDaily30, @adjustedAvgDaily90,
         @sellableDays7, @sellableDays30, @sellableDays90,
         @constrainedDays7, @constrainedDays30, @constrainedDays90,
         @availabilityObservedDays7, @availabilityObservedDays30, @availabilityObservedDays90,
         @peakDailyDemand, @forecastAllocationScale,
         @computedAt
       )`,
    );
    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly WbDemandSnapshotRecord[]) => {
        deleted = del.run(snapshotDate).changes;
        for (const r of batch) {
          ins.run(withDemandDiagnosticsDefaults(r));
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
                units90               AS units90,
                avg_daily_7           AS avgDaily7,
                avg_daily_30          AS avgDaily30,
                avg_daily_90          AS avgDaily90,
                base_daily_demand     AS baseDailyDemand,
                trend_ratio           AS trendRatio,
                trend_ratio_clamped   AS trendRatioClamped,
                forecast_daily_demand AS forecastDailyDemand,
                demand_model_version  AS demandModelVersion,
                raw_avg_daily_7       AS rawAvgDaily7,
                raw_avg_daily_30      AS rawAvgDaily30,
                raw_avg_daily_90      AS rawAvgDaily90,
                adjusted_avg_daily_7  AS adjustedAvgDaily7,
                adjusted_avg_daily_30 AS adjustedAvgDaily30,
                adjusted_avg_daily_90 AS adjustedAvgDaily90,
                sellable_days_7       AS sellableDays7,
                sellable_days_30      AS sellableDays30,
                sellable_days_90      AS sellableDays90,
                constrained_days_7    AS constrainedDays7,
                constrained_days_30   AS constrainedDays30,
                constrained_days_90   AS constrainedDays90,
                availability_observed_days_7  AS availabilityObservedDays7,
                availability_observed_days_30 AS availabilityObservedDays30,
                availability_observed_days_90 AS availabilityObservedDays90,
                peak_daily_demand     AS peakDailyDemand,
                forecast_allocation_scale AS forecastAllocationScale,
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

function withDemandDiagnosticsDefaults(
  r: WbDemandSnapshotRecord,
): WbDemandSnapshotRecord {
  return { ...legacyDemandDiagnosticsDefaults(r), ...r };
}
