import type { Logger } from "pino";
import type { WbOrdersDailyRepository } from "../infra/wbOrdersDailyRepository.js";
import type { WbDemandSnapshotRepository } from "../infra/wbDemandSnapshotRepository.js";
import type { WbOrdersDailyRecord } from "../domain/wbOrder.js";
import type { WbDemandSnapshotRecord } from "../domain/wbDemandSnapshot.js";

export interface ComputeDemandSnapshotDeps {
  ordersRepository: WbOrdersDailyRepository;
  demandRepository: WbDemandSnapshotRepository;
  logger: Logger;
  /** Override for tests; defaults to () => new Date(). */
  now?: () => Date;
}

export interface ComputeDemandSnapshotOptions {
  /**
   * "As-of" date for the snapshot, YYYY-MM-DD. Demand is computed from
   * orders strictly BEFORE this date — `snapshotDate` itself is treated
   * as incomplete and excluded. Default: today (UTC).
   */
  snapshotDate?: string;
  /** Compute and return only — never write to DB. Default: false. */
  dryRun?: boolean;
}

export interface ComputeDemandSnapshotResult {
  snapshotDate: string;
  windowFrom: string; // YYYY-MM-DD, inclusive (= snapshotDate − 90)
  windowTo: string;   // YYYY-MM-DD, inclusive (= snapshotDate − 1)
  ordersRows: number;
  demandRows: number;
  rowsDeleted: number;
  rowsInserted: number;
  durationMs: number;
  dryRun: boolean;
}

/** Window sizes are part of the model (Stage 2 spec). */
const WINDOW_SHORT_DAYS = 7;
const WINDOW_MID_DAYS = 30;
const WINDOW_LONG_DAYS = 90;

/**
 * Smoothing parameters from the task spec. `EPSILON` keeps the
 * `trendRatio` finite when long-window demand is zero. The clamp is
 * intentionally tight to avoid runaway forecasts on tiny absolute values.
 */
const SHORT_WEIGHT = 0.5;
const MID_WEIGHT = 0.3;
const LONG_WEIGHT = 0.2;
const EPSILON = 1e-6;
const TREND_MIN = 0.75;
const TREND_MAX = 1.25;

/**
 * Use case: build the demand snapshot for `snapshotDate` from
 * `wb_orders_daily` over the trailing 90 days.
 *
 * Idempotency: full replace-by-date in `wb_demand_snapshots`.
 * If you re-run for the same `snapshotDate` after re-importing orders,
 * the result fully replaces the previous slice — no leftovers.
 */
export async function computeDemandSnapshot(
  deps: ComputeDemandSnapshotDeps,
  options: ComputeDemandSnapshotOptions = {},
): Promise<ComputeDemandSnapshotResult> {
  const { ordersRepository, demandRepository, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = Date.now();

  const snapshotDate = options.snapshotDate ?? toUtcYmd(now());
  const windowTo = addDays(snapshotDate, -1);
  const windowFrom = addDays(snapshotDate, -WINDOW_LONG_DAYS);
  const computedAt = now().toISOString();
  const dryRun = options.dryRun === true;

  logger.info(
    { snapshotDate, windowFrom, windowTo, dryRun },
    "WB demand snapshot: start",
  );

  const ordersRows = ordersRepository.getRange(windowFrom, windowTo);
  const records = buildDemandRecords(
    ordersRows,
    snapshotDate,
    windowTo,
    computedAt,
  );

  let rowsDeleted = 0;
  let rowsInserted = 0;
  if (!dryRun) {
    const r = demandRepository.replaceForDate(snapshotDate, records);
    rowsDeleted = r.deleted;
    rowsInserted = r.inserted;
  }

  const durationMs = Date.now() - t0;
  const result: ComputeDemandSnapshotResult = {
    snapshotDate,
    windowFrom,
    windowTo,
    ordersRows: ordersRows.length,
    demandRows: records.length,
    rowsDeleted,
    rowsInserted,
    durationMs,
    dryRun,
  };
  logger.info(result, "WB demand snapshot: done");
  return result;
}

/**
 * Pure transformation: aggregate `wb_orders_daily` rows into demand
 * snapshot records. Exposed for unit tests.
 *
 * `windowTo` MUST equal `snapshotDate − 1` (the inclusive last day of
 * the input window). The 7/30-day cutoffs are derived from it.
 */
export function buildDemandRecords(
  rows: readonly WbOrdersDailyRecord[],
  snapshotDate: string,
  windowTo: string,
  computedAt: string,
): WbDemandSnapshotRecord[] {
  const cutoffShort = addDays(windowTo, -(WINDOW_SHORT_DAYS - 1));
  const cutoffMid = addDays(windowTo, -(WINDOW_MID_DAYS - 1));

  type Bucket = {
    warehouseNameRaw: string | null;
    warehouseKey: string;
    nmId: number;
    techSize: string;
    vendorCode: string | null;
    barcode: string | null;
    units7: number;
    units30: number;
    units90: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const key = `${r.warehouseKey}\u0000${r.nmId}\u0000${r.techSize}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        warehouseNameRaw: r.warehouseNameRaw,
        warehouseKey: r.warehouseKey,
        nmId: r.nmId,
        techSize: r.techSize,
        vendorCode: r.vendorCode,
        barcode: r.barcode,
        units7: 0,
        units30: 0,
        units90: 0,
      };
      buckets.set(key, b);
    } else {
      if (b.warehouseNameRaw === null && r.warehouseNameRaw !== null) {
        b.warehouseNameRaw = r.warehouseNameRaw;
      }
      if (b.vendorCode === null && r.vendorCode !== null) {
        b.vendorCode = r.vendorCode;
      }
      if (b.barcode === null && r.barcode !== null) {
        b.barcode = r.barcode;
      }
    }
    b.units90 += r.units;
    if (r.orderDate >= cutoffMid) b.units30 += r.units;
    if (r.orderDate >= cutoffShort) b.units7 += r.units;
  }

  const out: WbDemandSnapshotRecord[] = [];
  for (const b of buckets.values()) {
    const avgDaily7 = b.units7 / WINDOW_SHORT_DAYS;
    const avgDaily30 = b.units30 / WINDOW_MID_DAYS;
    const avgDaily90 = b.units90 / WINDOW_LONG_DAYS;
    const effectiveAvg7 = firstNonZero(avgDaily7, avgDaily30, avgDaily90);
    const effectiveAvg30 = firstNonZero(avgDaily30, avgDaily90);
    const baseDailyDemand =
      SHORT_WEIGHT * effectiveAvg7 +
      MID_WEIGHT * effectiveAvg30 +
      LONG_WEIGHT * avgDaily90;
    const trendRatio = avgDaily7 / Math.max(avgDaily30, EPSILON);
    const trendRatioClamped = clamp(trendRatio, TREND_MIN, TREND_MAX);
    const forecastDailyDemand = baseDailyDemand * trendRatioClamped;

    out.push({
      snapshotDate,
      warehouseNameRaw: b.warehouseNameRaw,
      warehouseKey: b.warehouseKey,
      nmId: b.nmId,
      techSize: b.techSize,
      vendorCode: b.vendorCode,
      barcode: b.barcode,
      units7: b.units7,
      units30: b.units30,
      units90: b.units90,
      avgDaily7,
      avgDaily30,
      avgDaily90,
      baseDailyDemand,
      trendRatio,
      trendRatioClamped,
      forecastDailyDemand,
      computedAt,
    });
  }
  out.sort((a, b) => {
    if (a.warehouseKey !== b.warehouseKey)
      return a.warehouseKey < b.warehouseKey ? -1 : 1;
    if (a.nmId !== b.nmId) return a.nmId - b.nmId;
    return a.techSize < b.techSize ? -1 : a.techSize > b.techSize ? 1 : 0;
  });
  return out;
}

function firstNonZero(...values: number[]): number {
  for (const v of values) {
    if (v > 0) return v;
  }
  return 0;
}

function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function toUtcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Add `days` (negative ok) to a YYYY-MM-DD string. We deliberately use
 * UTC arithmetic so the result depends only on the input string, never
 * on the host timezone — important for reproducible snapshots.
 */
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  return toUtcYmd(dt);
}
