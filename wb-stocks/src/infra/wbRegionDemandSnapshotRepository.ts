import type { DbHandle } from "./db.js";
import type { WbRegionDemandSnapshotRecord } from "../domain/wbRegionDemandSnapshot.js";
import { legacyDemandDiagnosticsDefaults } from "../application/censoredPeakDemand.js";

/**
 * Снимок регионального спроса (`wb_region_demand_snapshots`).
 * Ключ: `(snapshot_date, region_key, nm_id, tech_size)`.
 */
export class WbRegionDemandSnapshotRepository {
  constructor(private readonly db: DbHandle) {}

  replaceForDate(
    snapshotDate: string,
    rows: readonly WbRegionDemandSnapshotRecord[],
  ): { deleted: number; inserted: number } {
    const del = this.db.prepare(
      `DELETE FROM wb_region_demand_snapshots WHERE snapshot_date = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO wb_region_demand_snapshots (
         snapshot_date, region_name_raw, region_key, nm_id, tech_size,
         vendor_code, barcode, units7, units30, units90, avg_daily_7, avg_daily_30, avg_daily_90,
         base_daily_demand, trend_ratio, trend_ratio_clamped,
         regional_forecast_daily_demand,
         demand_model_version,
         raw_avg_daily_7, raw_avg_daily_30, raw_avg_daily_90,
         adjusted_avg_daily_7, adjusted_avg_daily_30, adjusted_avg_daily_90,
         sellable_days_7, sellable_days_30, sellable_days_90,
         constrained_days_7, constrained_days_30, constrained_days_90,
         availability_observed_days_7, availability_observed_days_30, availability_observed_days_90,
         peak_daily_demand, forecast_allocation_scale,
         computed_at
       ) VALUES (
         @snapshotDate, @regionNameRaw, @regionKey, @nmId, @techSize,
         @vendorCode, @barcode, @units7, @units30, @units90, @avgDaily7, @avgDaily30, @avgDaily90,
         @baseDailyDemand, @trendRatio, @trendRatioClamped,
         @regionalForecastDailyDemand,
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
      (batch: readonly WbRegionDemandSnapshotRecord[]) => {
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

  getForDate(snapshotDate: string): WbRegionDemandSnapshotRecord[] {
    return this.db
      .prepare(
        `SELECT snapshot_date         AS snapshotDate,
                region_name_raw       AS regionNameRaw,
                region_key            AS regionKey,
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
                regional_forecast_daily_demand AS regionalForecastDailyDemand,
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
           FROM wb_region_demand_snapshots
          WHERE snapshot_date = ?
          ORDER BY region_key, nm_id, tech_size`,
      )
      .all(snapshotDate) as WbRegionDemandSnapshotRecord[];
  }

  /**
   * Строки снимка только для перечисленных SKU (для API перераспределения).
   */
  countForDate(snapshotDate: string): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM wb_region_demand_snapshots WHERE snapshot_date = ?`,
      )
      .get(snapshotDate) as { c: number };
    return r.c;
  }

  /** Все региональные строки снимка для одного SKU — ручная сверка. */
  getForDateNmTech(
    snapshotDate: string,
    nmId: number,
    techSize: string,
  ): WbRegionDemandSnapshotRecord[] {
    return this.db
      .prepare(
        `SELECT snapshot_date         AS snapshotDate,
                region_name_raw       AS regionNameRaw,
                region_key            AS regionKey,
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
                regional_forecast_daily_demand AS regionalForecastDailyDemand,
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
           FROM wb_region_demand_snapshots
          WHERE snapshot_date = ? AND nm_id = ? AND tech_size = ?
          ORDER BY region_key`,
      )
      .all(snapshotDate, nmId, techSize) as WbRegionDemandSnapshotRecord[];
  }

  /**
   * Сумма `regional_forecast_daily_demand` по `region_key` за снимок (все SKU×размер).
   */
  aggregateDemandByRegion(snapshotDate: string): Array<{
    regionKey: string;
    regionNameRaw: string | null;
    regionalForecastDailyDemand: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT region_key AS regionKey,
                MAX(region_name_raw) AS regionNameRaw,
                SUM(regional_forecast_daily_demand) AS sumDemand
           FROM wb_region_demand_snapshots
          WHERE snapshot_date = ?
          GROUP BY region_key`,
      )
      .all(snapshotDate) as Array<{
      regionKey: string;
      regionNameRaw: string | null;
      sumDemand: number;
    }>;
    return rows.map((r) => ({
      regionKey: r.regionKey,
      regionNameRaw: r.regionNameRaw,
      regionalForecastDailyDemand: Number(r.sumDemand ?? 0),
    }));
  }

  getForDateAndSkus(
    snapshotDate: string,
    skus: readonly { nmId: number; techSize: string }[],
  ): WbRegionDemandSnapshotRecord[] {
    if (skus.length === 0) return [];
    const clauses: string[] = [];
    const params: (string | number)[] = [snapshotDate];
    for (const s of skus) {
      clauses.push("(nm_id = ? AND tech_size = ?)");
      params.push(s.nmId, s.techSize);
    }
    const sql = `SELECT snapshot_date         AS snapshotDate,
                        region_name_raw       AS regionNameRaw,
                        region_key            AS regionKey,
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
                        regional_forecast_daily_demand AS regionalForecastDailyDemand,
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
                   FROM wb_region_demand_snapshots
                  WHERE snapshot_date = ?
                    AND (${clauses.join(" OR ")})
                  ORDER BY nm_id, tech_size, region_key`;
    return this.db.prepare(sql).all(...params) as WbRegionDemandSnapshotRecord[];
  }
}

function withDemandDiagnosticsDefaults(
  r: WbRegionDemandSnapshotRecord,
): WbRegionDemandSnapshotRecord {
  return { ...legacyDemandDiagnosticsDefaults(r), ...r };
}
