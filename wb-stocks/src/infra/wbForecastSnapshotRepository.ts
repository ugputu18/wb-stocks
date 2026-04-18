import type { DbHandle } from "./db.js";
import type { WbForecastSnapshotRecord } from "../domain/wbForecastSnapshot.js";
import { riskBucketFromDaysOfStock } from "../domain/forecastRiskBucket.js";
import {
  buildInventoryLevels,
  buildSupplierOrderPlan,
  buildSupplierSkuReplenishment,
  buildWbRowReplenishment,
  daysOfStockSystemFromNetworkTotals,
  daysOfStockWbFromNetworkTotals,
  systemStockoutDateEstimateFromSnapshot,
  type InventoryLevelsReadModel,
  type ReplenishmentMode,
  type SupplierSkuReplenishmentReadModel,
  type WbRowReplenishmentReadModel,
} from "../domain/multiLevelInventory.js";
import { DEFAULT_WAREHOUSE_CODE } from "../domain/ownStockSnapshot.js";
import { OwnStockSnapshotRepository } from "./ownStockSnapshotRepository.js";

export interface ForecastSnapshotScope {
  warehouseKey?: string;
  nmId?: number;
  vendorCode?: string;
}

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
         units7, units30, avg_daily_7, avg_daily_30,
         base_daily_demand, trend_ratio, trend_ratio_clamped,
         forecast_daily_demand,
         stock_snapshot_at, start_stock, incoming_units,
         forecast_units, end_stock, days_of_stock, stockout_date,
         computed_at
       ) VALUES (
         @snapshotDate, @horizonDays, @warehouseNameRaw, @warehouseKey,
         @nmId, @techSize, @vendorCode, @barcode,
         @units7, @units30, @avgDaily7, @avgDaily30,
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
                avg_daily_7           AS avgDaily7,
                avg_daily_30          AS avgDaily30,
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
  distinctWarehouseKeys(
    snapshotDate: string,
    horizonDays: number,
  ): string[] {
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
   * Report rows with optional filters. Default sort: `days_of_stock` ASC,
   * `forecast_daily_demand` DESC.
   *
   * @param limit — optional SQL `LIMIT` (omit only for tests; UI always caps).
   */
  listReportRows(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
    limit?: number,
  ): WbForecastSnapshotReportRow[] {
    const { sql, params } = buildReportWhere(snapshotDate, horizonDays, filter);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit <= 0 || limit > 50_000)
    ) {
      throw new Error("listReportRows: limit must be 1..50000 or omitted");
    }
    const limClause = limit !== undefined ? " LIMIT ?" : "";
    const allParams =
      limit !== undefined ? [...params, limit] : [...params];
    const rows = this.db
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
                avg_daily_7           AS avgDaily7,
                avg_daily_30          AS avgDaily30,
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
          ${sql}
          ORDER BY days_of_stock ASC, forecast_daily_demand DESC${limClause}`,
      )
      .all(...allParams) as WbForecastSnapshotRecord[];

    const wbTotals = this.loadWbAvailabilityTotals(snapshotDate, horizonDays);
    const ownWh =
      filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendor(snapshotDate, ownWh);

    return rows.map((r) => enrichReportRow(r, filter, wbTotals, ownByVendor));
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

  /**
   * Supplier replenishment по **уникальному SKU** (все склады WB): одна строка на `(nm_id, tech_size)`.
   * Спрос и запасы WB — **глобальные суммы** по сети; own — по `vendor_code`.
   * Фильтр `riskStockout` **не** применяется (только warehouse + `q` из `filter`).
   */
  listSupplierReplenishmentBySku(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
    targetCoverageDays: number,
  ): SupplierSkuReplenishmentReadModel[] {
    const grouped = this.db
      .prepare(
        `SELECT nm_id AS nmId, tech_size AS techSize,
                MAX(vendor_code) AS vendorCode,
                SUM(forecast_daily_demand) AS sumFd,
                SUM(start_stock + incoming_units) AS sumWb,
                SUM(start_stock) AS sumStartStock,
                SUM(incoming_units) AS sumIncoming
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?
          GROUP BY nm_id, tech_size`,
      )
      .all(snapshotDate, horizonDays) as {
      nmId: number;
      techSize: string;
      vendorCode: string | null;
      sumFd: number;
      sumWb: number;
      sumStartStock: number;
      sumIncoming: number;
    }[];

    const scopeKeys = skuKeysMatchingScope(
      this.db,
      snapshotDate,
      horizonDays,
      filter,
    );
    const ownWh =
      filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendor(snapshotDate, ownWh);

    const leadDays =
      filter.supplierLeadTimeDays !== undefined &&
      Number.isFinite(filter.supplierLeadTimeDays) &&
      filter.supplierLeadTimeDays > 0
        ? Math.floor(filter.supplierLeadTimeDays)
        : 45;
    const orderCovDays =
      filter.supplierOrderCoverageDays !== undefined &&
      Number.isFinite(filter.supplierOrderCoverageDays) &&
      filter.supplierOrderCoverageDays > 0
        ? Math.floor(filter.supplierOrderCoverageDays)
        : 90;
    const safetyDays =
      filter.supplierSafetyDays !== undefined &&
      Number.isFinite(filter.supplierSafetyDays) &&
      filter.supplierSafetyDays >= 0
        ? Math.floor(filter.supplierSafetyDays)
        : 0;

    const out: SupplierSkuReplenishmentReadModel[] = [];
    for (const g of grouped) {
      const k = skuKey(g.nmId, g.techSize);
      if (scopeKeys && !scopeKeys.has(k)) continue;

      const vend = (g.vendorCode ?? "").trim();
      const ownQty = vend ? (ownByVendor.get(vend) ?? 0) : 0;
      const part = buildSupplierSkuReplenishment(
        g.sumFd,
        g.sumWb,
        ownQty,
        targetCoverageDays,
      );
      const plan = buildSupplierOrderPlan({
        systemDailyDemand: g.sumFd,
        wbAvailableTotal: g.sumWb,
        ownStock: ownQty,
        leadTimeDays: leadDays,
        coverageDays: orderCovDays,
        safetyDays,
      });
      out.push({
        nmId: g.nmId,
        techSize: g.techSize,
        vendorCode: g.vendorCode,
        systemDailyDemand: g.sumFd,
        sumForecastDailyDemand: g.sumFd,
        wbStartStockTotal: g.sumStartStock,
        wbIncomingUnitsTotal: g.sumIncoming,
        leadTimeDays: leadDays,
        orderCoverageDays: orderCovDays,
        safetyDays,
        ...part,
        stockAtArrival: plan.stockAtArrival,
        recommendedOrderQty: plan.recommendedOrderQty,
        willStockoutBeforeArrival: plan.willStockoutBeforeArrival,
        daysUntilStockout: plan.daysUntilStockout,
      });
    }
    out.sort(
      (a, b) => b.recommendedFromSupplier - a.recommendedFromSupplier,
    );
    return out;
  }

  /**
   * SKU × сеть WB (одна строка на номенклатуру): агрегаты по `warehouse_key`, read-side.
   */
  listWbTotalBySkuReportRows(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
    limit?: number,
  ): WbTotalBySkuReportRow[] {
    const full = this.buildWbTotalBySkuReportRowsFull(
      snapshotDate,
      horizonDays,
      filter,
    );
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit <= 0 || limit > 50_000)
    ) {
      throw new Error("listWbTotalBySkuReportRows: limit must be 1..50000 or omitted");
    }
    return limit !== undefined ? full.slice(0, limit) : full;
  }

  /** SKU × системный пул (WB∑ + own): одна строка на `(nm_id, tech_size)`. */
  listSystemTotalBySkuReportRows(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
    limit?: number,
  ): SystemTotalBySkuReportRow[] {
    const full = this.buildSystemTotalBySkuReportRowsFull(
      snapshotDate,
      horizonDays,
      filter,
    );
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit <= 0 || limit > 50_000)
    ) {
      throw new Error(
        "listSystemTotalBySkuReportRows: limit must be 1..50000 or omitted",
      );
    }
    return limit !== undefined ? full.slice(0, limit) : full;
  }

  /**
   * Aggregate KPIs: `wbWarehouses` | `systemTotal` | `wbTotal` (default).
   */
  aggregateReportMetrics(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
  ): ForecastReportAggregate {
    const mode = filter.viewMode ?? "wbTotal";
    if (mode === "wbWarehouses") {
      return this.aggregateWarehouseRowReportMetrics(
        snapshotDate,
        horizonDays,
        filter,
      );
    }
    if (mode === "systemTotal") {
      return this.aggregateSystemTotalBySkuReportMetrics(
        snapshotDate,
        horizonDays,
        filter,
      );
    }
    return this.aggregateWbTotalBySkuReportMetrics(snapshotDate, horizonDays, filter);
  }

  /**
   * Полный список SKU-строк для агрегатов и KPI (без LIMIT).
   */
  private buildWbTotalBySkuReportRowsFull(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
  ): WbTotalBySkuReportRow[] {
    const grouped = this.db
      .prepare(
        `SELECT nm_id AS nmId,
                tech_size AS techSize,
                SUM(forecast_daily_demand) AS sumFd,
                SUM(start_stock + incoming_units) AS sumWb,
                SUM(start_stock) AS sumStartStock,
                SUM(incoming_units) AS sumIncoming,
                MIN(stockout_date) AS stockoutDateWB,
                MAX(vendor_code) AS vendorCode,
                MIN(stock_snapshot_at) AS minStockSnapshotAt
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?
          GROUP BY nm_id, tech_size`,
      )
      .all(snapshotDate, horizonDays) as {
      nmId: number;
      techSize: string;
      sumFd: number;
      sumWb: number;
      sumStartStock: number;
      sumIncoming: number;
      stockoutDateWB: string | null;
      vendorCode: string | null;
      minStockSnapshotAt: string | null;
    }[];

    const scopeKeys = skuKeysMatchingScope(
      this.db,
      snapshotDate,
      horizonDays,
      filter,
    );
    const ownWh =
      filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendor(snapshotDate, ownWh);
    const tc = filter.replenishmentTargetCoverageDays;

    const out: WbTotalBySkuReportRow[] = [];
    for (const g of grouped) {
      const k = skuKey(g.nmId, g.techSize);
      if (scopeKeys && !scopeKeys.has(k)) continue;

      const daysWb = daysOfStockWbFromNetworkTotals(g.sumWb, g.sumFd);
      if (!aggregatedRiskStockoutMatches(daysWb, filter.riskStockout ?? "all")) {
        continue;
      }

      const risk = riskBucketFromDaysOfStock(
        Math.min(999_999, Math.floor(daysWb)),
      );
      const vend = (g.vendorCode ?? "").trim();
      const ownQty = vend ? (ownByVendor.get(vend) ?? 0) : 0;
      const inventoryLevels = buildInventoryLevels(g.sumWb, g.sumWb, ownQty);

      let replenishment: WbRowReplenishmentReadModel | undefined;
      let recommendedFromSupplier = 0;
      if (tc !== undefined && Number.isFinite(tc) && tc > 0) {
        replenishment = buildWbRowReplenishment(g.sumFd, tc, g.sumWb);
        recommendedFromSupplier = buildSupplierSkuReplenishment(
          g.sumFd,
          g.sumWb,
          ownQty,
          tc,
        ).recommendedFromSupplier;
      }

      out.push({
        viewKind: "wbTotal",
        nmId: g.nmId,
        techSize: g.techSize,
        vendorCode: g.vendorCode,
        daysOfStockWB: daysWb,
        stockoutDateWB: g.stockoutDateWB,
        stockSnapshotAtWB: g.minStockSnapshotAt ?? "",
        forecastDailyDemandTotal: g.sumFd,
        wbAvailableTotal: g.sumWb,
        wbStartStockTotal: g.sumStartStock,
        wbIncomingUnitsTotal: g.sumIncoming,
        ownStock: ownQty,
        risk,
        inventoryLevels,
        replenishment,
        recommendedFromSupplier,
      });
    }

    // Default order for «WB в целом»: сначала худшие по дням запаса сети, при равенстве — выше спрос.
    out.sort((a, b) => {
      const c = a.daysOfStockWB - b.daysOfStockWB;
      if (c !== 0) return c;
      return b.forecastDailyDemandTotal - a.forecastDailyDemandTotal;
    });
    return out;
  }

  /**
   * SKU по системному пулу: фильтр риска и бакеты по дням запаса **system** (WB∑ + own).
   */
  private buildSystemTotalBySkuReportRowsFull(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
  ): SystemTotalBySkuReportRow[] {
    const grouped = this.db
      .prepare(
        `SELECT nm_id AS nmId,
                tech_size AS techSize,
                SUM(forecast_daily_demand) AS sumFd,
                SUM(start_stock + incoming_units) AS sumWb,
                SUM(start_stock) AS sumStartStock,
                SUM(incoming_units) AS sumIncoming,
                MAX(vendor_code) AS vendorCode,
                MIN(stock_snapshot_at) AS minStockSnapshotAt
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ?
          GROUP BY nm_id, tech_size`,
      )
      .all(snapshotDate, horizonDays) as {
      nmId: number;
      techSize: string;
      sumFd: number;
      sumWb: number;
      sumStartStock: number;
      sumIncoming: number;
      vendorCode: string | null;
      minStockSnapshotAt: string | null;
    }[];

    const scopeKeys = skuKeysMatchingScope(
      this.db,
      snapshotDate,
      horizonDays,
      filter,
    );
    const ownWh =
      filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendor(snapshotDate, ownWh);
    const tc = filter.replenishmentTargetCoverageDays;

    const supplierBySku = new Map<string, SupplierSkuReplenishmentReadModel>();
    if (tc !== undefined && Number.isFinite(tc) && tc > 0) {
      for (const s of this.listSupplierReplenishmentBySku(
        snapshotDate,
        horizonDays,
        filter,
        tc,
      )) {
        supplierBySku.set(skuKey(s.nmId, s.techSize), s);
      }
    }

    const out: SystemTotalBySkuReportRow[] = [];
    for (const g of grouped) {
      const k = skuKey(g.nmId, g.techSize);
      if (scopeKeys && !scopeKeys.has(k)) continue;

      const vend = (g.vendorCode ?? "").trim();
      const ownQty = vend ? (ownByVendor.get(vend) ?? 0) : 0;
      const inventoryLevels = buildInventoryLevels(g.sumWb, g.sumWb, ownQty);
      const daysSys = daysOfStockSystemFromNetworkTotals(
        inventoryLevels.systemAvailable,
        g.sumFd,
      );
      if (!aggregatedRiskStockoutMatches(daysSys, filter.riskStockout ?? "all")) {
        continue;
      }

      const risk = riskBucketFromDaysOfStock(
        Math.min(999_999, Math.floor(daysSys)),
      );

      let replenishment: WbRowReplenishmentReadModel | undefined;
      let recommendedFromSupplier = 0;
      if (tc !== undefined && Number.isFinite(tc) && tc > 0) {
        replenishment = buildWbRowReplenishment(g.sumFd, tc, g.sumWb);
        recommendedFromSupplier = buildSupplierSkuReplenishment(
          g.sumFd,
          g.sumWb,
          ownQty,
          tc,
        ).recommendedFromSupplier;
      }

      const sup = supplierBySku.get(k);
      const recommendedOrderQty = sup?.recommendedOrderQty ?? 0;
      const willStockoutBeforeArrival = sup?.willStockoutBeforeArrival ?? false;

      if (
        !systemTotalQuickFilterMatches(filter.systemTotalQuickFilter, {
          inventoryLevels,
          recommendedFromSupplier,
          replenishment,
        })
      ) {
        continue;
      }

      const systemStockoutDateEstimate = systemStockoutDateEstimateFromSnapshot(
        snapshotDate,
        daysSys,
        g.sumFd,
      );

      out.push({
        viewKind: "systemTotal",
        nmId: g.nmId,
        techSize: g.techSize,
        vendorCode: g.vendorCode,
        daysOfStockSystem: daysSys,
        systemStockoutDateEstimate,
        stockSnapshotAtSystem: g.minStockSnapshotAt ?? "",
        forecastDailyDemandTotal: g.sumFd,
        wbAvailableTotal: g.sumWb,
        wbStartStockTotal: g.sumStartStock,
        wbIncomingUnitsTotal: g.sumIncoming,
        ownStock: ownQty,
        risk,
        inventoryLevels,
        replenishment,
        recommendedFromSupplier,
        recommendedOrderQty,
        willStockoutBeforeArrival,
      });
    }

    out.sort((a, b) => {
      const c = a.daysOfStockSystem - b.daysOfStockSystem;
      if (c !== 0) return c;
      return b.forecastDailyDemandTotal - a.forecastDailyDemandTotal;
    });
    return out;
  }

  private aggregateWbTotalBySkuReportMetrics(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
  ): ForecastReportAggregate {
    const full = this.buildWbTotalBySkuReportRowsFull(
      snapshotDate,
      horizonDays,
      filter,
    );

    let critical = 0;
    let warning = 0;
    let attention = 0;
    let ok = 0;
    let staleStockRowCount = 0;
    let oldestStockSnapshotAt: string | null = null;
    let newestStockSnapshotAt: string | null = null;

    for (const r of full) {
      if (r.risk === "critical") critical += 1;
      else if (r.risk === "warning") warning += 1;
      else if (r.risk === "attention") attention += 1;
      else ok += 1;

      const sn = r.stockSnapshotAtWB?.trim();
      if (sn && sn.length >= 10 && sn.slice(0, 10) < snapshotDate) {
        staleStockRowCount += 1;
      }
      if (sn) {
        if (
          oldestStockSnapshotAt === null ||
          sn < oldestStockSnapshotAt
        ) {
          oldestStockSnapshotAt = sn;
        }
        if (
          newestStockSnapshotAt === null ||
          sn > newestStockSnapshotAt
        ) {
          newestStockSnapshotAt = sn;
        }
      }
    }

    let recommendedToWBTotal = 0;
    let recommendedFromSupplierTotal = 0;
    let recommendedOrderQtyTotal = 0;
    const tc = filter.replenishmentTargetCoverageDays;
    const ownWh =
      filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;

    if (tc !== undefined && Number.isFinite(tc) && tc > 0) {
      for (const r of full) {
        if (r.replenishment) {
          recommendedToWBTotal += r.replenishment.recommendedToWB;
        }
      }
      const supplierRows = this.listSupplierReplenishmentBySku(
        snapshotDate,
        horizonDays,
        {
          warehouseKey: filter.warehouseKey,
          q: filter.q,
          ownWarehouseCode: filter.ownWarehouseCode,
          replenishmentMode: filter.replenishmentMode,
          replenishmentTargetCoverageDays: tc,
          supplierLeadTimeDays: filter.supplierLeadTimeDays,
          supplierOrderCoverageDays: filter.supplierOrderCoverageDays,
          supplierSafetyDays: filter.supplierSafetyDays,
        },
        tc,
      );
      recommendedFromSupplierTotal = supplierRows.reduce(
        (s, x) => s + x.recommendedFromSupplier,
        0,
      );
      recommendedOrderQtyTotal = supplierRows.reduce(
        (s, x) => s + x.recommendedOrderQty,
        0,
      );
    }

    return {
      totalRows: full.length,
      risk: { critical, warning, attention, ok },
      staleStockRowCount,
      oldestStockSnapshotAt,
      newestStockSnapshotAt,
      replenishment:
        tc !== undefined && Number.isFinite(tc) && tc > 0
          ? {
              targetCoverageDays: tc,
              replenishmentMode: filter.replenishmentMode ?? "wb",
              ownWarehouseCode: ownWh,
              recommendedToWBTotal,
              recommendedFromSupplierTotal,
              recommendedOrderQtyTotal,
              leadTimeDays: filter.supplierLeadTimeDays ?? 45,
              orderCoverageDays: filter.supplierOrderCoverageDays ?? 90,
              safetyDays: filter.supplierSafetyDays ?? 0,
            }
          : undefined,
    };
  }

  private aggregateSystemTotalBySkuReportMetrics(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
  ): ForecastReportAggregate {
    const full = this.buildSystemTotalBySkuReportRowsFull(
      snapshotDate,
      horizonDays,
      filter,
    );

    let critical = 0;
    let warning = 0;
    let attention = 0;
    let ok = 0;
    let staleStockRowCount = 0;
    let oldestStockSnapshotAt: string | null = null;
    let newestStockSnapshotAt: string | null = null;

    for (const r of full) {
      if (r.risk === "critical") critical += 1;
      else if (r.risk === "warning") warning += 1;
      else if (r.risk === "attention") attention += 1;
      else ok += 1;

      const sn = r.stockSnapshotAtSystem?.trim();
      if (sn && sn.length >= 10 && sn.slice(0, 10) < snapshotDate) {
        staleStockRowCount += 1;
      }
      if (sn) {
        if (
          oldestStockSnapshotAt === null ||
          sn < oldestStockSnapshotAt
        ) {
          oldestStockSnapshotAt = sn;
        }
        if (
          newestStockSnapshotAt === null ||
          sn > newestStockSnapshotAt
        ) {
          newestStockSnapshotAt = sn;
        }
      }
    }

    let recommendedToWBTotal = 0;
    let recommendedFromSupplierTotal = 0;
    let recommendedOrderQtyTotal = 0;
    const tc = filter.replenishmentTargetCoverageDays;
    const ownWh =
      filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;

    if (tc !== undefined && Number.isFinite(tc) && tc > 0) {
      for (const r of full) {
        if (r.replenishment) {
          recommendedToWBTotal += r.replenishment.recommendedToWB;
        }
      }
      const supplierRows = this.listSupplierReplenishmentBySku(
        snapshotDate,
        horizonDays,
        {
          warehouseKey: filter.warehouseKey,
          q: filter.q,
          ownWarehouseCode: filter.ownWarehouseCode,
          replenishmentMode: filter.replenishmentMode,
          replenishmentTargetCoverageDays: tc,
          supplierLeadTimeDays: filter.supplierLeadTimeDays,
          supplierOrderCoverageDays: filter.supplierOrderCoverageDays,
          supplierSafetyDays: filter.supplierSafetyDays,
        },
        tc,
      );
      const keysInTable = new Set(
        full.map((r) => skuKey(r.nmId, r.techSize)),
      );
      recommendedFromSupplierTotal = supplierRows
        .filter((x) => keysInTable.has(skuKey(x.nmId, x.techSize)))
        .reduce((s, x) => s + x.recommendedFromSupplier, 0);
      recommendedOrderQtyTotal = supplierRows
        .filter((x) => keysInTable.has(skuKey(x.nmId, x.techSize)))
        .reduce((s, x) => s + x.recommendedOrderQty, 0);
    }

    return {
      totalRows: full.length,
      risk: { critical, warning, attention, ok },
      staleStockRowCount,
      oldestStockSnapshotAt,
      newestStockSnapshotAt,
      replenishment:
        tc !== undefined && Number.isFinite(tc) && tc > 0
          ? {
              targetCoverageDays: tc,
              replenishmentMode: filter.replenishmentMode ?? "wb",
              ownWarehouseCode: ownWh,
              recommendedToWBTotal,
              recommendedFromSupplierTotal,
              recommendedOrderQtyTotal,
              leadTimeDays: filter.supplierLeadTimeDays ?? 45,
              orderCoverageDays: filter.supplierOrderCoverageDays ?? 90,
              safetyDays: filter.supplierSafetyDays ?? 0,
            }
          : undefined,
    };
  }

  private aggregateWarehouseRowReportMetrics(
    snapshotDate: string,
    horizonDays: number,
    filter: ForecastReportFilter,
  ): ForecastReportAggregate {
    const { sql, params } = buildReportWhere(snapshotDate, horizonDays, filter);
    const staleParam = snapshotDate;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN days_of_stock < 7 THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN days_of_stock >= 7 AND days_of_stock < 14 THEN 1 ELSE 0 END) AS warning,
                SUM(CASE WHEN days_of_stock >= 14 AND days_of_stock < 30 THEN 1 ELSE 0 END) AS attention,
                SUM(CASE WHEN days_of_stock >= 30 THEN 1 ELSE 0 END) AS ok,
                MIN(stock_snapshot_at) AS oldestStockSnapshotAt,
                MAX(stock_snapshot_at) AS newestStockSnapshotAt,
                SUM(CASE WHEN substr(stock_snapshot_at, 1, 10) < ? THEN 1 ELSE 0 END) AS staleStockRowCount
           FROM wb_forecast_snapshots
          ${sql}`,
      )
      .get(staleParam, ...params) as {
      total: number;
      critical: number | null;
      warning: number | null;
      attention: number | null;
      ok: number | null;
      oldestStockSnapshotAt: string | null;
      newestStockSnapshotAt: string | null;
      staleStockRowCount: number | null;
    };
    let recommendedToWBTotal = 0;
    let recommendedFromSupplierTotal = 0;
    let recommendedOrderQtyTotal = 0;
    const tc = filter.replenishmentTargetCoverageDays;
    const ownWh =
      filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const wbTotals = this.loadWbAvailabilityTotals(snapshotDate, horizonDays);

    if (tc !== undefined && Number.isFinite(tc) && tc > 0) {
      const iter = this.db
        .prepare(
          `SELECT forecast_daily_demand AS forecastDailyDemand,
                  start_stock AS startStock,
                  incoming_units AS incomingUnits,
                  nm_id AS nmId,
                  tech_size AS techSize,
                  vendor_code AS vendorCode
             FROM wb_forecast_snapshots
            ${sql}`,
        )
        .iterate(...params) as IterableIterator<{
        forecastDailyDemand: number;
        startStock: number;
        incomingUnits: number;
        nmId: number;
        techSize: string;
        vendorCode: string | null;
      }>;
      for (const r of iter) {
        const wbTot = wbTotals.get(skuKey(r.nmId, r.techSize)) ?? 0;
        const wbRow = buildWbRowReplenishment(
          r.forecastDailyDemand,
          tc,
          wbTot,
        );
        recommendedToWBTotal += wbRow.recommendedToWB;
      }
      const supplierRows = this.listSupplierReplenishmentBySku(
        snapshotDate,
        horizonDays,
        {
          warehouseKey: filter.warehouseKey,
          q: filter.q,
          ownWarehouseCode: filter.ownWarehouseCode,
          replenishmentMode: filter.replenishmentMode,
          replenishmentTargetCoverageDays: tc,
          supplierLeadTimeDays: filter.supplierLeadTimeDays,
          supplierOrderCoverageDays: filter.supplierOrderCoverageDays,
          supplierSafetyDays: filter.supplierSafetyDays,
        },
        tc,
      );
      /* Одна строка на SKU в supplierRows — сумма не зависит от числа складов на артикул. */
      recommendedFromSupplierTotal = supplierRows.reduce(
        (s, x) => s + x.recommendedFromSupplier,
        0,
      );
      recommendedOrderQtyTotal = supplierRows.reduce(
        (s, x) => s + x.recommendedOrderQty,
        0,
      );
    }
    return {
      totalRows: row.total ?? 0,
      risk: {
        critical: row.critical ?? 0,
        warning: row.warning ?? 0,
        attention: row.attention ?? 0,
        ok: row.ok ?? 0,
      },
      staleStockRowCount: row.staleStockRowCount ?? 0,
      oldestStockSnapshotAt: row.oldestStockSnapshotAt ?? null,
      newestStockSnapshotAt: row.newestStockSnapshotAt ?? null,
      replenishment:
        tc !== undefined && Number.isFinite(tc) && tc > 0
          ? {
              targetCoverageDays: tc,
              replenishmentMode: filter.replenishmentMode ?? "wb",
              ownWarehouseCode: ownWh,
              recommendedToWBTotal,
              recommendedFromSupplierTotal,
              recommendedOrderQtyTotal,
              leadTimeDays: filter.supplierLeadTimeDays ?? 45,
              orderCoverageDays: filter.supplierOrderCoverageDays ?? 90,
              safetyDays: filter.supplierSafetyDays ?? 0,
            }
          : undefined,
    };
  }
}

function systemTotalQuickFilterMatches(
  qf: ForecastReportFilter["systemTotalQuickFilter"],
  row: {
    inventoryLevels: InventoryLevelsReadModel;
    recommendedFromSupplier: number;
    replenishment?: WbRowReplenishmentReadModel;
  },
): boolean {
  const mode = qf ?? "all";
  if (mode === "all") return true;
  if (mode === "systemRisk") return row.inventoryLevels.systemRisk;
  if (mode === "supplierOrder") return row.recommendedFromSupplier > 0;
  if (mode === "wbReplenish") {
    return (row.replenishment?.recommendedToWB ?? 0) > 0;
  }
  return true;
}

function aggregatedRiskStockoutMatches(
  daysWb: number,
  rs: RiskStockoutFilter,
): boolean {
  if (rs === "all") return true;
  if (rs === "lt7") return daysWb < 7;
  if (rs === "lt14") return daysWb < 14;
  if (rs === "lt30") return daysWb < 30;
  if (rs === "lt45") return daysWb < 45;
  if (rs === "lt60") return daysWb < 60;
  return true;
}

function skuKey(nmId: number, techSize: string): string {
  return `${nmId}\t${techSize ?? ""}`;
}

function enrichReportRow(
  r: WbForecastSnapshotRecord,
  filter: ForecastReportFilter,
  wbTotals: Map<string, number>,
  ownByVendor: Map<string, number>,
): WbForecastSnapshotReportRow {
  const risk = riskBucketFromDaysOfStock(r.daysOfStock);
  const localAvail = r.startStock + r.incomingUnits;
  const wbTot = wbTotals.get(skuKey(r.nmId, r.techSize)) ?? 0;
  const vend = (r.vendorCode ?? "").trim();
  const ownQty = vend ? (ownByVendor.get(vend) ?? 0) : 0;
  const inventoryLevels: InventoryLevelsReadModel = buildInventoryLevels(
    localAvail,
    wbTot,
    ownQty,
  );

  const base: WbForecastSnapshotReportRow = {
    ...r,
    risk,
    inventoryLevels,
  };

  const tc = filter.replenishmentTargetCoverageDays;
  if (tc === undefined || !Number.isFinite(tc) || tc <= 0) {
    return base;
  }

  const replenishment: WbRowReplenishmentReadModel = buildWbRowReplenishment(
    r.forecastDailyDemand,
    tc,
    wbTot,
  );

  return { ...base, replenishment };
}

export type { ReplenishmentMode } from "../domain/multiLevelInventory.js";

export type RiskStockoutFilter =
  | "all"
  | "lt7"
  | "lt14"
  | "lt30"
  | "lt45"
  | "lt60";

export interface ForecastReportFilter {
  warehouseKey?: string | null;
  /** Vendor fragment or nmId digits — see `buildReportWhere`. */
  q?: string | null;
  /**
   * Узкий фильтр по `tech_size`, если **`q` — только цифры (nm_id)**.
   * Используется для drilldown «WB в целом» → строки по складам по одному SKU.
   */
  techSize?: string | null;
  /**
   * Narrow rows by `days_of_stock` (операционный «риск окончания»):
   * - lt7: &lt; 7 — совпадает с bucket critical
   * - lt14: &lt; 14 — critical + warning
   * - lt30: &lt; 30 — critical + warning + attention
   * - lt45 / lt60: &lt; 45 / &lt; 60 — расширенный узкий фильтр (read-side)
   */
  riskStockout?: RiskStockoutFilter | null;
  /** Если задан — в строках и в aggregate добавляется read-side replenishment. */
  replenishmentTargetCoverageDays?: number;
  /** Какой KPI суммарно подсвечивать в UI (оба значения всегда считаются). */
  replenishmentMode?: ReplenishmentMode | null;
  /** Код нашего склада в `own_stock_snapshots` (default `main`). */
  ownWarehouseCode?: string | null;
  /** Lead time для плана заказа у поставщика (дней), query `leadTimeDays`. Default 45. */
  supplierLeadTimeDays?: number;
  /** Покрытие после прихода для плана заказа (дней), query `coverageDays`. Default 90. */
  supplierOrderCoverageDays?: number;
  /** Страховые дни в целевом покрытии после прихода, query `safetyDays`. Default 0. */
  supplierSafetyDays?: number;
  /**
   * Вид основной таблицы: `systemTotal` — default в forecast UI / parse (пустой query);
   * `wbTotal` — одна строка на SKU, риск по WB; `wbWarehouses` — строки `warehouse × sku`.
   */
  viewMode?: ForecastViewMode | null;
  /**
   * Только для `viewMode=systemTotal`: быстрый read-side фильтр строк после полного расчёта SKU.
   * Не в SQL — те же строки, что и KPI при `aggregateReportMetrics`.
   */
  systemTotalQuickFilter?:
    | "all"
    | "systemRisk"
    | "supplierOrder"
    | "wbReplenish"
    | null;
}

export interface WbForecastSnapshotReportRow extends WbForecastSnapshotRecord {
  risk: import("../domain/forecastRiskBucket.js").ForecastRiskBucket;
  inventoryLevels: InventoryLevelsReadModel;
  replenishment?: WbRowReplenishmentReadModel;
}

/** Режим основной таблицы forecast UI. */
export type ForecastViewMode = "wbTotal" | "wbWarehouses" | "systemTotal";

/**
 * Одна строка = SKU по всей сети WB (read-side GROUP BY `nm_id`, `tech_size`).
 * `daysOfStockWB` = `wbAvailableTotal / forecastDailyDemandTotal` (при нулевом спросе — см. домен).
 */
export interface WbTotalBySkuReportRow {
  viewKind: "wbTotal";
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  daysOfStockWB: number;
  stockoutDateWB: string | null;
  /** Минимум `stock_snapshot_at` по складам для SKU. */
  stockSnapshotAtWB: string;
  forecastDailyDemandTotal: number;
  wbAvailableTotal: number;
  /** Σ start_stock по складам WB для SKU. */
  wbStartStockTotal: number;
  /** Σ incoming_units (горизонт) по складам WB для SKU. */
  wbIncomingUnitsTotal: number;
  ownStock: number;
  risk: import("../domain/forecastRiskBucket.js").ForecastRiskBucket;
  inventoryLevels: InventoryLevelsReadModel;
  replenishment?: WbRowReplenishmentReadModel;
  /** Согласовано с supplier-level `recommendedFromSupplier` для того же SKU и `targetCoverageDays`. */
  recommendedFromSupplier: number;
}

/**
 * Одна строка = SKU: риск и дни запаса по **системному** пулу (WB∑ + own), read-side.
 * `recommendedToWB` / `recommendedFromSupplier` / `recommendedOrderQty` — те же величины, что в режимах WB total и supplier-витрине (без двойного суммирования).
 */
export interface SystemTotalBySkuReportRow {
  viewKind: "systemTotal";
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  /** `systemAvailable / Σ спрос` (см. `daysOfStockSystemFromNetworkTotals`). */
  daysOfStockSystem: number;
  /**
   * Оценка даты OOS по пулу system: `snapshot_date` + `floor(daysOfStockSystem)` календарных дней
   * при `forecastDailyDemandTotal > 0`; согласована с **Дн. system**. Не `MIN(stockout_date)` по WB.
   */
  systemStockoutDateEstimate: string | null;
  stockSnapshotAtSystem: string;
  forecastDailyDemandTotal: number;
  wbAvailableTotal: number;
  /** Σ start_stock по складам WB для SKU. */
  wbStartStockTotal: number;
  /** Σ incoming_units (горизонт) по складам WB для SKU. */
  wbIncomingUnitsTotal: number;
  ownStock: number;
  risk: import("../domain/forecastRiskBucket.js").ForecastRiskBucket;
  inventoryLevels: InventoryLevelsReadModel;
  replenishment?: WbRowReplenishmentReadModel;
  recommendedFromSupplier: number;
  /** Из той же строки supplier-plan, что `/supplier-replenishment` для SKU. */
  recommendedOrderQty: number;
  willStockoutBeforeArrival: boolean;
}

export interface ForecastReportAggregate {
  totalRows: number;
  risk: {
    critical: number;
    warning: number;
    attention: number;
    ok: number;
  };
  staleStockRowCount: number;
  oldestStockSnapshotAt: string | null;
  newestStockSnapshotAt: string | null;
  replenishment?: {
    targetCoverageDays: number;
    replenishmentMode: ReplenishmentMode;
    ownWarehouseCode: string;
    recommendedToWBTotal: number;
    recommendedFromSupplierTotal: number;
    recommendedOrderQtyTotal: number;
    leadTimeDays: number;
    orderCoverageDays: number;
    safetyDays: number;
  };
}

function buildReportWhere(
  snapshotDate: string,
  horizonDays: number,
  filter: ForecastReportFilter,
): { sql: string; params: unknown[] } {
  const clauses = ["snapshot_date = ?", "horizon_days = ?"];
  const params: unknown[] = [snapshotDate, horizonDays];

  const wh = filter.warehouseKey?.trim();
  if (wh) {
    clauses.push("warehouse_key = ?");
    params.push(wh);
  }

  const q = filter.q?.trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      clauses.push("nm_id = ?");
      params.push(Number(q));
      const ts = filter.techSize?.trim();
      if (ts) {
        clauses.push("tech_size = ?");
        params.push(ts);
      }
    } else {
      const like = `%${escapeLike(q)}%`;
      clauses.push("(vendor_code LIKE ? OR CAST(nm_id AS TEXT) LIKE ?)");
      params.push(like, like);
    }
  }

  const rs = filter.riskStockout ?? "all";
  if (rs === "lt7") {
    clauses.push("days_of_stock < 7");
  } else if (rs === "lt14") {
    clauses.push("days_of_stock < 14");
  } else if (rs === "lt30") {
    clauses.push("days_of_stock < 30");
  } else if (rs === "lt45") {
    clauses.push("days_of_stock < 45");
  } else if (rs === "lt60") {
    clauses.push("days_of_stock < 60");
  }

  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Какие `(nm_id, tech_size)` попадают в supplier-витрину при фильтрах warehouse / q.
 * Без фильтров — `null` (все SKU среза). `riskStockout` сюда не входит.
 */
function skuKeysMatchingScope(
  db: DbHandle,
  snapshotDate: string,
  horizonDays: number,
  filter: ForecastReportFilter,
): Set<string> | null {
  const wh = filter.warehouseKey?.trim();
  const q = filter.q?.trim();

  if (!wh && !q) return null;

  let set: Set<string> | null = null;

  const intersect = (a: Set<string>, b: Set<string>) =>
    new Set([...a].filter((x) => b.has(x)));

  if (wh) {
    const rows = db
      .prepare(
        `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ? AND warehouse_key = ?`,
      )
      .all(snapshotDate, horizonDays, wh) as {
      nmId: number;
      techSize: string;
    }[];
    set = new Set(rows.map((r) => skuKey(r.nmId, r.techSize)));
  }

  if (q) {
    let qSet: Set<string>;
    if (/^\d+$/.test(q)) {
      const nm = Number(q);
      const ts = filter.techSize?.trim();
      const rows = ts
        ? (db
            .prepare(
              `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
                 FROM wb_forecast_snapshots
                WHERE snapshot_date = ? AND horizon_days = ? AND nm_id = ? AND tech_size = ?`,
            )
            .all(snapshotDate, horizonDays, nm, ts) as {
            nmId: number;
            techSize: string;
          }[])
        : (db
            .prepare(
              `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
                 FROM wb_forecast_snapshots
                WHERE snapshot_date = ? AND horizon_days = ? AND nm_id = ?`,
            )
            .all(snapshotDate, horizonDays, nm) as {
            nmId: number;
            techSize: string;
          }[]);
      qSet = new Set(rows.map((r) => skuKey(r.nmId, r.techSize)));
    } else {
      const like = `%${escapeLike(q)}%`;
      const rows = db
        .prepare(
          `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
             FROM wb_forecast_snapshots
            WHERE snapshot_date = ? AND horizon_days = ?
              AND (vendor_code LIKE ? OR CAST(nm_id AS TEXT) LIKE ?)`,
        )
        .all(snapshotDate, horizonDays, like, like) as {
        nmId: number;
        techSize: string;
      }[];
      qSet = new Set(rows.map((r) => skuKey(r.nmId, r.techSize)));
    }
    set = set ? intersect(set, qSet) : qSet;
  }

  return set;
}

function buildScopeWhere(
  snapshotDate: string,
  horizonDays: number,
  scope: ForecastSnapshotScope,
): { sql: string; params: Array<string | number> } {
  const clauses = ["snapshot_date = ?", "horizon_days = ?"];
  const params: Array<string | number> = [snapshotDate, horizonDays];
  if (scope.warehouseKey !== undefined) {
    clauses.push("warehouse_key = ?");
    params.push(scope.warehouseKey);
  }
  if (scope.nmId !== undefined) {
    clauses.push("nm_id = ?");
    params.push(scope.nmId);
  }
  if (scope.vendorCode !== undefined) {
    clauses.push("vendor_code = ?");
    params.push(scope.vendorCode);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}
