import type { Logger } from "pino";
import type { WbOrdersDailyByRegionRepository } from "../infra/wbOrdersDailyByRegionRepository.js";
import type { WbRegionDemandSnapshotRepository } from "../infra/wbRegionDemandSnapshotRepository.js";
import type { WbOrdersDailyRegionRecord } from "../domain/wbOrder.js";
import type { WbRegionDemandSnapshotRecord } from "../domain/wbRegionDemandSnapshot.js";

export interface ComputeRegionDemandSnapshotDeps {
  ordersByRegionRepository: WbOrdersDailyByRegionRepository;
  regionDemandRepository: WbRegionDemandSnapshotRepository;
  logger: Logger;
  now?: () => Date;
}

export interface ComputeRegionDemandSnapshotOptions {
  snapshotDate?: string;
  dryRun?: boolean;
}

export interface ComputeRegionDemandSnapshotResult {
  snapshotDate: string;
  windowFrom: string;
  windowTo: string;
  ordersRows: number;
  demandRows: number;
  rowsDeleted: number;
  rowsInserted: number;
  durationMs: number;
  dryRun: boolean;
}

const WINDOW_SHORT_DAYS = 7;
const WINDOW_LONG_DAYS = 30;
const SHORT_WEIGHT = 0.6;
const LONG_WEIGHT = 0.4;
const EPSILON = 1e-6;
const TREND_MIN = 0.75;
const TREND_MAX = 1.25;

export async function computeRegionDemandSnapshot(
  deps: ComputeRegionDemandSnapshotDeps,
  options: ComputeRegionDemandSnapshotOptions = {},
): Promise<ComputeRegionDemandSnapshotResult> {
  const { ordersByRegionRepository, regionDemandRepository, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = Date.now();

  const snapshotDate = options.snapshotDate ?? toUtcYmd(now());
  const windowTo = addDays(snapshotDate, -1);
  const windowFrom = addDays(snapshotDate, -WINDOW_LONG_DAYS);
  const computedAt = now().toISOString();
  const dryRun = options.dryRun === true;

  logger.info(
    { snapshotDate, windowFrom, windowTo, dryRun },
    "WB region demand snapshot: start",
  );

  const ordersRows = ordersByRegionRepository.getRange(windowFrom, windowTo);
  const records = buildRegionDemandRecords(
    ordersRows,
    snapshotDate,
    windowTo,
    computedAt,
  );

  let rowsDeleted = 0;
  let rowsInserted = 0;
  if (!dryRun) {
    const r = regionDemandRepository.replaceForDate(snapshotDate, records);
    rowsDeleted = r.deleted;
    rowsInserted = r.inserted;
  }

  const durationMs = Date.now() - t0;
  const result: ComputeRegionDemandSnapshotResult = {
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
  logger.info(result, "WB region demand snapshot: done");
  return result;
}

export function buildRegionDemandRecords(
  rows: readonly WbOrdersDailyRegionRecord[],
  snapshotDate: string,
  windowTo: string,
  computedAt: string,
): WbRegionDemandSnapshotRecord[] {
  const cutoffShort = addDays(windowTo, -(WINDOW_SHORT_DAYS - 1));

  type Bucket = {
    regionNameRaw: string | null;
    regionKey: string;
    nmId: number;
    techSize: string;
    vendorCode: string | null;
    barcode: string | null;
    units7: number;
    units30: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const key = `${r.regionKey}\u0000${r.nmId}\u0000${r.techSize}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        regionNameRaw: r.regionNameRaw,
        regionKey: r.regionKey,
        nmId: r.nmId,
        techSize: r.techSize,
        vendorCode: r.vendorCode,
        barcode: r.barcode,
        units7: 0,
        units30: 0,
      };
      buckets.set(key, b);
    } else {
      if (b.regionNameRaw === null && r.regionNameRaw !== null) {
        b.regionNameRaw = r.regionNameRaw;
      }
      if (b.vendorCode === null && r.vendorCode !== null) b.vendorCode = r.vendorCode;
      if (b.barcode === null && r.barcode !== null) b.barcode = r.barcode;
    }
    b.units30 += r.units;
    if (r.orderDate >= cutoffShort) b.units7 += r.units;
  }

  const out: WbRegionDemandSnapshotRecord[] = [];
  for (const b of buckets.values()) {
    const avgDaily7 = b.units7 / WINDOW_SHORT_DAYS;
    const avgDaily30 = b.units30 / WINDOW_LONG_DAYS;
    const baseDailyDemand =
      SHORT_WEIGHT * avgDaily7 + LONG_WEIGHT * avgDaily30;
    const trendRatio = avgDaily7 / Math.max(avgDaily30, EPSILON);
    const trendRatioClamped = clamp(trendRatio, TREND_MIN, TREND_MAX);
    const regionalForecastDailyDemand = baseDailyDemand * trendRatioClamped;

    out.push({
      snapshotDate,
      regionNameRaw: b.regionNameRaw,
      regionKey: b.regionKey,
      nmId: b.nmId,
      techSize: b.techSize,
      vendorCode: b.vendorCode,
      barcode: b.barcode,
      units7: b.units7,
      units30: b.units30,
      avgDaily7,
      avgDaily30,
      baseDailyDemand,
      trendRatio,
      trendRatioClamped,
      regionalForecastDailyDemand,
      computedAt,
    });
  }
  out.sort((a, b) => {
    if (a.regionKey !== b.regionKey) return a.regionKey < b.regionKey ? -1 : 1;
    if (a.nmId !== b.nmId) return a.nmId - b.nmId;
    return a.techSize < b.techSize ? -1 : a.techSize > b.techSize ? 1 : 0;
  });
  return out;
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

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  return toUtcYmd(new Date(t));
}
