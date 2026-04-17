import type { DbHandle } from "./db.js";
import type { WbForecastSnapshotRecord } from "../domain/wbForecastSnapshot.js";
import { riskBucketFromDaysOfStock } from "../domain/forecastRiskBucket.js";
import {
  buildInventoryLevels,
  buildSupplierSkuReplenishment,
  buildWbRowReplenishment,
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
                SUM(start_stock + incoming_units) AS sumWb
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
      out.push({
        nmId: g.nmId,
        techSize: g.techSize,
        vendorCode: g.vendorCode,
        sumForecastDailyDemand: g.sumFd,
        ...part,
      });
    }
    out.sort(
      (a, b) => b.recommendedFromSupplier - a.recommendedFromSupplier,
    );
    return out;
  }

  /**
   * Aggregate KPIs for the same filter as `listReportRows` (SQL, no client scan).
   */
  aggregateReportMetrics(
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
        },
        tc,
      );
      /* Одна строка на SKU в supplierRows — сумма не зависит от числа складов на артикул. */
      recommendedFromSupplierTotal = supplierRows.reduce(
        (s, x) => s + x.recommendedFromSupplier,
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
            }
          : undefined,
    };
  }
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

export type RiskStockoutFilter = "all" | "lt7" | "lt14" | "lt30";

export interface ForecastReportFilter {
  warehouseKey?: string | null;
  /** Vendor fragment or nmId digits — see `buildReportWhere`. */
  q?: string | null;
  /**
   * Narrow rows by `days_of_stock` (операционный «риск окончания»):
   * - lt7: &lt; 7 — совпадает с bucket critical
   * - lt14: &lt; 14 — critical + warning
   * - lt30: &lt; 30 — critical + warning + attention
   */
  riskStockout?: RiskStockoutFilter | null;
  /** Если задан — в строках и в aggregate добавляется read-side replenishment. */
  replenishmentTargetCoverageDays?: number;
  /** Какой KPI суммарно подсвечивать в UI (оба значения всегда считаются). */
  replenishmentMode?: ReplenishmentMode | null;
  /** Код нашего склада в `own_stock_snapshots` (default `main`). */
  ownWarehouseCode?: string | null;
}

export interface WbForecastSnapshotReportRow extends WbForecastSnapshotRecord {
  risk: import("../domain/forecastRiskBucket.js").ForecastRiskBucket;
  inventoryLevels: InventoryLevelsReadModel;
  replenishment?: WbRowReplenishmentReadModel;
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
      const rows = db
        .prepare(
          `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
             FROM wb_forecast_snapshots
            WHERE snapshot_date = ? AND horizon_days = ? AND nm_id = ?`,
        )
        .all(snapshotDate, horizonDays, nm) as {
        nmId: number;
        techSize: string;
      }[];
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
