import type { DbHandle } from "../../infra/db.js";
import type { WbForecastSnapshotRecord } from "../../domain/wbForecastSnapshot.js";
import { riskBucketFromDaysOfStock } from "../../domain/forecastRiskBucket.js";
import {
  buildInventoryLevels,
  buildSupplierOrderPlan,
  buildSupplierSkuReplenishment,
  buildWbRowReplenishment,
  daysOfStockSystemFromNetworkTotals,
  daysOfStockWbFromNetworkTotals,
  systemStockoutDateEstimateFromSnapshot,
  type SupplierSkuReplenishmentReadModel,
  type WbRowReplenishmentReadModel,
} from "../../domain/multiLevelInventory.js";
import { DEFAULT_WAREHOUSE_CODE } from "../../domain/ownStockSnapshot.js";
import { OwnStockSnapshotRepository } from "../../infra/ownStockSnapshotRepository.js";
import { WbForecastSnapshotRepository } from "../../infra/wbForecastSnapshotRepository.js";
import { enrichReportRow } from "./enrichForecastReportRow.js";
import type {
  ForecastReportAggregate,
  ForecastReportFilter,
  SystemTotalBySkuReportRow,
  WbForecastSnapshotReportRow,
  WbTotalBySkuReportRow,
} from "./forecastReportTypes.js";
import {
  aggregatedRiskStockoutMatches,
  buildReportWhere,
  skuKey,
  skuKeysMatchingScope,
  systemTotalQuickFilterMatches,
} from "./forecastReportQueryHelpers.js";

/**
 * Read-side отчёты и KPI для forecast UI: фильтры, агрегаты по SKU, supplier-витрина.
 * Использует `WbForecastSnapshotRepository` для низкоуровневых срезов БД (totals по сети и т.д.).
 */
export class WbForecastReportQueryService {
  constructor(
    private readonly db: DbHandle,
    private readonly snapshots: WbForecastSnapshotRepository,
  ) {}

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
    const allParams = limit !== undefined ? [...params, limit] : [...params];
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
          ${sql}
          ORDER BY days_of_stock ASC, forecast_daily_demand DESC${limClause}`,
      )
      .all(...allParams) as WbForecastSnapshotRecord[];

    const wbTotals = this.snapshots.loadWbAvailabilityTotals(
      snapshotDate,
      horizonDays,
    );
    const ownWh = filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendorLatest(ownWh);

    return rows.map((r) => enrichReportRow(r, filter, wbTotals, ownByVendor));
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
    const ownWh = filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendorLatest(ownWh);

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
    out.sort((a, b) => b.recommendedFromSupplier - a.recommendedFromSupplier);
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
      throw new Error(
        "listWbTotalBySkuReportRows: limit must be 1..50000 or omitted",
      );
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
    return this.aggregateWbTotalBySkuReportMetrics(
      snapshotDate,
      horizonDays,
      filter,
    );
  }

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
    const ownWh = filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendorLatest(ownWh);
    const tc = filter.replenishmentTargetCoverageDays;

    const out: WbTotalBySkuReportRow[] = [];
    for (const g of grouped) {
      const k = skuKey(g.nmId, g.techSize);
      if (scopeKeys && !scopeKeys.has(k)) continue;

      const daysWb = daysOfStockWbFromNetworkTotals(g.sumWb, g.sumFd);
      if (!aggregatedRiskStockoutMatches(daysWb, filter.riskStockout ?? "all")) {
        continue;
      }

      const risk = riskBucketFromDaysOfStock(Math.min(999_999, Math.floor(daysWb)));
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

    out.sort((a, b) => {
      const c = a.daysOfStockWB - b.daysOfStockWB;
      if (c !== 0) return c;
      return b.forecastDailyDemandTotal - a.forecastDailyDemandTotal;
    });
    return out;
  }

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
    const ownWh = filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const ownByVendor = new OwnStockSnapshotRepository(
      this.db,
    ).quantitiesByVendorLatest(ownWh);
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

      const risk = riskBucketFromDaysOfStock(Math.min(999_999, Math.floor(daysSys)));

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
        if (oldestStockSnapshotAt === null || sn < oldestStockSnapshotAt) {
          oldestStockSnapshotAt = sn;
        }
        if (newestStockSnapshotAt === null || sn > newestStockSnapshotAt) {
          newestStockSnapshotAt = sn;
        }
      }
    }

    let recommendedToWBTotal = 0;
    let recommendedFromSupplierTotal = 0;
    let recommendedOrderQtyTotal = 0;
    const tc = filter.replenishmentTargetCoverageDays;
    const ownWh = filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;

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
        if (oldestStockSnapshotAt === null || sn < oldestStockSnapshotAt) {
          oldestStockSnapshotAt = sn;
        }
        if (newestStockSnapshotAt === null || sn > newestStockSnapshotAt) {
          newestStockSnapshotAt = sn;
        }
      }
    }

    let recommendedToWBTotal = 0;
    let recommendedFromSupplierTotal = 0;
    let recommendedOrderQtyTotal = 0;
    const tc = filter.replenishmentTargetCoverageDays;
    const ownWh = filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;

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
      const keysInTable = new Set(full.map((r) => skuKey(r.nmId, r.techSize)));
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
    const ownWh = filter.ownWarehouseCode?.trim() || DEFAULT_WAREHOUSE_CODE;
    const wbTotals = this.snapshots.loadWbAvailabilityTotals(
      snapshotDate,
      horizonDays,
    );

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
