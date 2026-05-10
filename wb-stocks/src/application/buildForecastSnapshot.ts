import type { Logger } from "pino";
import type { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import type { WbDemandSnapshotRepository } from "../infra/wbDemandSnapshotRepository.js";
import type { WbSupplyRepository } from "../infra/wbSupplyRepository.js";
import type {
  ForecastSnapshotScope,
  WbForecastSnapshotRepository,
} from "../infra/wbForecastSnapshotRepository.js";
import type { StockSnapshotRecord } from "../domain/stockSnapshot.js";
import type { WbSupplyItemRecord } from "../domain/wbSupply.js";
import type { WbForecastSnapshotRecord } from "../domain/wbForecastSnapshot.js";
import {
  normalizeWarehouseName,
  warehouseKey,
} from "../domain/warehouseName.js";
import { SUPPLY_STATUS_INCOMING_FOR_FORECAST } from "../domain/wbSupplyStatus.js";
import { selectIncomingSupplies } from "./selectIncomingSupplies.js";
import { runForecastSimulation } from "./runForecastSimulation.js";

export interface BuildForecastSnapshotDeps {
  stockRepository: StockSnapshotRepository;
  demandRepository: WbDemandSnapshotRepository;
  supplyRepository: WbSupplyRepository;
  forecastRepository: WbForecastSnapshotRepository;
  logger: Logger;
  now?: () => Date;
}

export interface BuildForecastSnapshotOptions {
  /** YYYY-MM-DD; default = today (UTC). */
  snapshotDate?: string;
  /** Horizon in days; must be > 0. */
  horizonDays: number;
  /**
   * Optional forecast-scope filter. Numeric values are treated as `nmId`,
   * everything else is matched against `vendorCode` verbatim.
   *
   * Important: this scopes the FORECAST slice only. Demand snapshot
   * calculation still remains a full replace-by-date so the demand table
   * stays globally consistent.
   */
  sku?: string;
  /** Optional exact warehouse filter after normalization. */
  warehouse?: string;
  /** Compute and return only — never write to DB. */
  dryRun?: boolean;
}

export interface BuildForecastSnapshotResult {
  snapshotDate: string;
  horizonDays: number;
  /** Pinned WB-stocks snapshot used for `startStock`. */
  stockSnapshotAt: string | null;
  demandRows: number;
  /** Demand rows that produced a forecast row. */
  forecastRows: number;
  /** Demand rows skipped, with reasons grouped. */
  skipped: { reason: string; count: number }[];
  incomingSupplies: number;
  incomingArrivals: number;
  incomingUnitsTotal: number;
  rowsDeleted: number;
  rowsInserted: number;
  durationMs: number;
  dryRun: boolean;
}

/**
 * Build the forecast snapshot for a given `(snapshotDate, horizonDays)`.
 *
 * Iteration is **driven by the demand snapshot**: every output row
 * corresponds to one demand row. SKUs without a demand row are not
 * forecast (we never silently substitute zero demand — see the per-row
 * skip reasons below).
 *
 * Stock pinning: the most recent `wb_stock_snapshots.snapshot_at` not
 * later than `snapshotDate + 23:59:59 UTC` is used; its full timestamp
 * is recorded as `stockSnapshotAt` so the forecast is reproducible.
 * This is an explicit MVP convention: `snapshotDate` is a UTC day across
 * demand/forecast, and stock imports are timestamped in UTC. If later we
 * want "Moscow business date" semantics, the conversion should happen
 * BEFORE calling this use case.
 *
 * Incoming supplies: `selectIncomingSupplies` already encapsulates the
 * "which status / which warehouse / which qty / when" decisions; this
 * function only consumes its output.
 *
 * Persistence:
 * - With **no** `sku`/`warehouse` filter, `replaceForScope` deletes the
 *   full `(snapshotDate, horizonDays)` slice and re-inserts — full recompute.
 * - With filters, only rows matching the scope (`warehouse_key`, and/or
 *   `nm_id`, and/or `vendor_code`) are deleted and re-inserted; other
 *   forecast rows for the same date+horizon are left untouched (CLI
 *   `--sku` / `--warehouse` semantics).
 */
export async function buildForecastSnapshot(
  deps: BuildForecastSnapshotDeps,
  options: BuildForecastSnapshotOptions,
): Promise<BuildForecastSnapshotResult> {
  const {
    stockRepository,
    demandRepository,
    supplyRepository,
    forecastRepository,
    logger,
  } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = Date.now();

  if (!Number.isInteger(options.horizonDays) || options.horizonDays <= 0) {
    throw new Error(
      `buildForecastSnapshot: horizonDays must be a positive integer, got ${options.horizonDays}`,
    );
  }
  const snapshotDate = options.snapshotDate ?? toUtcYmd(now());
  const horizonDays = options.horizonDays;
  const horizonEnd = addDays(snapshotDate, horizonDays - 1);
  const computedAt = now().toISOString();
  const dryRun = options.dryRun === true;
  const forecastScope = parseForecastScope(options);

  logger.info(
    { snapshotDate, horizonDays, horizonEnd, dryRun, forecastScope },
    "WB forecast: start",
  );

  const stockSnapshotAt = stockRepository.getLatestSnapshotAtAsOf(snapshotDate);
  if (stockSnapshotAt === null) {
    logger.error(
      { snapshotDate },
      "WB forecast: no stock snapshot available up to snapshotDate; aborting",
    );
    return {
      snapshotDate,
      horizonDays,
      stockSnapshotAt: null,
      demandRows: 0,
      forecastRows: 0,
      skipped: [{ reason: "no-stock-snapshot-available", count: 0 }],
      incomingSupplies: 0,
      incomingArrivals: 0,
      incomingUnitsTotal: 0,
      rowsDeleted: 0,
      rowsInserted: 0,
      durationMs: Date.now() - t0,
      dryRun,
    };
  }

  const demandRows = demandRepository
    .getForDate(snapshotDate)
    .filter((row) => matchesForecastScope(row, forecastScope));
  const stockRows = stockRepository.getBySnapshotAt(stockSnapshotAt);
  const stockMap = buildStockMap(stockRows);

  const supplies = supplyRepository.getSuppliesByStatuses(
    SUPPLY_STATUS_INCOMING_FOR_FORECAST,
  );
  const items = supplyRepository.getItemsForSupplyIds(
    supplies.map((s) => s.supplyId),
  );
  const itemsBySupplyId = groupItems(items);

  const incomingResult = selectIncomingSupplies({
    supplies,
    itemsBySupplyId,
    fromDate: snapshotDate,
    toDate: horizonEnd,
    logger,
  });
  logger.info(
    {
      considered: incomingResult.consideredSupplies,
      accepted: incomingResult.acceptedSupplies,
      arrivals: incomingResult.totalArrivals,
      units: incomingResult.totalUnits,
      skipped: incomingResult.skipped.length,
    },
    "WB forecast: incoming supplies selected",
  );

  const records: WbForecastSnapshotRecord[] = [];
  const skipReasons = new Map<string, number>();
  for (const d of demandRows) {
    const key = `${d.warehouseKey}\u0000${d.nmId}\u0000${d.techSize}`;
    const startStock = stockMap.get(key) ?? 0;
    const arrivals = incomingResult.incoming.get(key) ?? [];

    const sim = runForecastSimulation({
      snapshotDate,
      horizonDays,
      startStock,
      forecastDailyDemand: d.forecastDailyDemand,
      incoming: arrivals,
    });

    records.push({
      snapshotDate,
      horizonDays,
      warehouseNameRaw: d.warehouseNameRaw,
      warehouseKey: d.warehouseKey,
      nmId: d.nmId,
      techSize: d.techSize,
      vendorCode: d.vendorCode,
      barcode: d.barcode,
      units7: d.units7,
      units30: d.units30,
      units90: d.units90,
      avgDaily7: d.avgDaily7,
      avgDaily30: d.avgDaily30,
      avgDaily90: d.avgDaily90,
      baseDailyDemand: d.baseDailyDemand,
      trendRatio: d.trendRatio,
      trendRatioClamped: d.trendRatioClamped,
      forecastDailyDemand: d.forecastDailyDemand,
      stockSnapshotAt,
      startStock,
      incomingUnits: sim.incomingTotal,
      forecastUnits: sim.forecastUnits,
      endStock: sim.endStock,
      daysOfStock: sim.daysOfStock,
      stockoutDate: sim.stockoutDate,
      computedAt,
    });
  }

  // Surface stock rows that have NO demand snapshot — these are SKUs we
  // hold inventory for but cannot forecast (per req 6: skip + log,
  // never substitute zero demand).
  const demandKeys = new Set(
    demandRows.map((d) => `${d.warehouseKey}\u0000${d.nmId}\u0000${d.techSize}`),
  );
  let skippedNoDemand = 0;
  for (const k of stockMap.keys()) {
    if (!demandKeys.has(k) && keyMatchesScope(k, forecastScope)) skippedNoDemand += 1;
  }
  if (skippedNoDemand > 0) {
    skipReasons.set("no-demand-snapshot-for-stock-key", skippedNoDemand);
    logger.warn(
      { count: skippedNoDemand },
      "WB forecast: stock keys without demand snapshot were not forecast",
    );
  }

  let rowsDeleted = 0;
  let rowsInserted = 0;
  if (!dryRun) {
    const r = forecastRepository.replaceForScope(
      snapshotDate,
      horizonDays,
      records,
      toRepositoryScope(forecastScope),
    );
    rowsDeleted = r.deleted;
    rowsInserted = r.inserted;
  }

  const result: BuildForecastSnapshotResult = {
    snapshotDate,
    horizonDays,
    stockSnapshotAt,
    demandRows: demandRows.length,
    forecastRows: records.length,
    skipped: Array.from(skipReasons, ([reason, count]) => ({
      reason,
      count,
    })),
    incomingSupplies: incomingResult.acceptedSupplies,
    incomingArrivals: incomingResult.totalArrivals,
    incomingUnitsTotal: incomingResult.totalUnits,
    rowsDeleted,
    rowsInserted,
    durationMs: Date.now() - t0,
    dryRun,
  };

  logger.info(result, "WB forecast: done");
  return result;
}

/**
 * Collapse stock rows into `(warehouseKey, nmId, techSize) → quantity`.
 * WB stocks may carry multiple barcodes per `(nm_id, techSize, warehouse)`,
 * which we sum: the simulation needs total quantity at the warehouse.
 *
 * `null` `techSize` collapses to `""`, mirroring how the demand snapshot
 * stores it — both sides must use the exact same key shape, otherwise
 * the join silently misses pairs.
 */
function buildStockMap(
  rows: readonly StockSnapshotRecord[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const key = `${warehouseKey(r.warehouseName)}\u0000${r.nmId}\u0000${r.techSize ?? ""}`;
    m.set(key, (m.get(key) ?? 0) + r.quantity);
  }
  return m;
}

function groupItems(
  items: readonly WbSupplyItemRecord[],
): Map<number, WbSupplyItemRecord[]> {
  const m = new Map<number, WbSupplyItemRecord[]>();
  for (const it of items) {
    const arr = m.get(it.supplyId) ?? [];
    arr.push(it);
    m.set(it.supplyId, arr);
  }
  return m;
}

function toUtcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  return toUtcYmd(new Date(t));
}

type ParsedForecastScope = {
  warehouseKey?: string;
  nmId?: number;
  vendorCode?: string;
};

function parseForecastScope(
  options: Pick<BuildForecastSnapshotOptions, "sku" | "warehouse">,
): ParsedForecastScope {
  const scope: ParsedForecastScope = {};
  if (options.warehouse) {
    const normalized = normalizeWarehouseName(options.warehouse);
    if (normalized !== "") scope.warehouseKey = warehouseKey(options.warehouse);
  }
  if (options.sku) {
    const sku = options.sku.trim();
    if (/^\d+$/.test(sku)) scope.nmId = Number(sku);
    else if (sku !== "") scope.vendorCode = sku;
  }
  return scope;
}

function matchesForecastScope(
  row: {
    warehouseKey: string;
    nmId: number;
    vendorCode: string | null;
  },
  scope: ParsedForecastScope,
): boolean {
  if (scope.warehouseKey !== undefined && row.warehouseKey !== scope.warehouseKey) {
    return false;
  }
  if (scope.nmId !== undefined && row.nmId !== scope.nmId) {
    return false;
  }
  if (scope.vendorCode !== undefined && row.vendorCode !== scope.vendorCode) {
    return false;
  }
  return true;
}

function keyMatchesScope(key: string, scope: ParsedForecastScope): boolean {
  if (
    scope.warehouseKey === undefined &&
    scope.nmId === undefined &&
    scope.vendorCode === undefined
  ) {
    return true;
  }
  if (scope.vendorCode !== undefined && scope.nmId === undefined) {
    // Stock rows do not carry `vendorCode` in the aggregation map key, so we
    // cannot safely attribute "no demand" for a vendorCode-only scope here.
    return false;
  }
  const [warehouse, nmIdRaw] = key.split("\u0000");
  if (scope.warehouseKey !== undefined && warehouse !== scope.warehouseKey) {
    return false;
  }
  if (scope.nmId !== undefined && Number(nmIdRaw) !== scope.nmId) {
    return false;
  }
  return true;
}

function toRepositoryScope(scope: ParsedForecastScope): ForecastSnapshotScope {
  return {
    warehouseKey: scope.warehouseKey,
    nmId: scope.nmId,
    vendorCode: scope.vendorCode,
  };
}
