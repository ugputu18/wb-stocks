import type { Logger } from "pino";
import type { WbOrdersDailyRepository } from "../infra/wbOrdersDailyRepository.js";
import type { WbDemandSnapshotRepository } from "../infra/wbDemandSnapshotRepository.js";
import type { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import type { WbOrdersDailyRecord } from "../domain/wbOrder.js";
import type { WbDemandSnapshotRecord } from "../domain/wbDemandSnapshot.js";
import {
  applyForecastAllocationScale,
  buildCensoredPeakDemandProfile,
  WINDOW_LONG_DAYS,
} from "./censoredPeakDemand.js";
import {
  buildDailyAvailabilityLookups,
  skuDemandKey,
  type DailyAvailabilityLookup,
} from "./demandAvailability.js";

export interface ComputeDemandSnapshotDeps {
  ordersRepository: WbOrdersDailyRepository;
  demandRepository: WbDemandSnapshotRepository;
  stockRepository?: StockSnapshotRepository;
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

/**
 * Smoothing parameters from the task spec. `EPSILON` keeps the
 * `trendRatio` finite when long-window demand is zero. The clamp is
 * intentionally tight to avoid runaway forecasts on tiny absolute values.
 */

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
  const { ordersRepository, demandRepository, stockRepository, logger } = deps;
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
  const stockAvailabilityRows =
    stockRepository?.getDailyAvailabilityRange(windowFrom, windowTo) ?? [];
  const availabilityLookups = buildDailyAvailabilityLookups(stockAvailabilityRows);
  const records = buildDemandRecords(
    ordersRows,
    snapshotDate,
    windowTo,
    computedAt,
    {
      availabilityBySku: availabilityLookups.bySku,
    },
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
  options: {
    availabilityBySku?: DailyAvailabilityLookup;
  } = {},
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
    dailyUnits: Map<string, number>;
  };
  const buckets = new Map<string, Bucket>();
  const skuBuckets = new Map<
    string,
    {
      nmId: number;
      techSize: string;
      dailyUnits: Map<string, number>;
    }
  >();

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
        dailyUnits: new Map(),
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
    b.dailyUnits.set(r.orderDate, (b.dailyUnits.get(r.orderDate) ?? 0) + r.units);

    const skuKey = skuDemandKey(r.nmId, r.techSize);
    let sku = skuBuckets.get(skuKey);
    if (!sku) {
      sku = { nmId: r.nmId, techSize: r.techSize, dailyUnits: new Map() };
      skuBuckets.set(skuKey, sku);
    }
    sku.dailyUnits.set(
      r.orderDate,
      (sku.dailyUnits.get(r.orderDate) ?? 0) + r.units,
    );
  }

  const networkForecastBySku = new Map<string, number>();
  for (const [key, sku] of skuBuckets) {
    const networkProfile = buildCensoredPeakDemandProfile({
      windowTo,
      dailyUnits: sku.dailyUnits,
      dailyAvailability: options.availabilityBySku?.get(key),
    });
    networkForecastBySku.set(key, networkProfile.forecastDailyDemand);
  }

  const localProfiles = new Map<string, ReturnType<typeof buildCensoredPeakDemandProfile>>();
  const localForecastSumBySku = new Map<string, number>();
  for (const [key, b] of buckets) {
    const profile = buildCensoredPeakDemandProfile({
      windowTo,
      dailyUnits: b.dailyUnits,
      dailyAvailability: options.availabilityBySku?.get(
        skuDemandKey(b.nmId, b.techSize),
      ),
    });
    localProfiles.set(key, profile);
    const skuKey = skuDemandKey(b.nmId, b.techSize);
    localForecastSumBySku.set(
      skuKey,
      (localForecastSumBySku.get(skuKey) ?? 0) + profile.forecastDailyDemand,
    );
  }

  const out: WbDemandSnapshotRecord[] = [];
  for (const b of buckets.values()) {
    const key = `${b.warehouseKey}\u0000${b.nmId}\u0000${b.techSize}`;
    const skuKey = skuDemandKey(b.nmId, b.techSize);
    const profile = localProfiles.get(key);
    if (!profile) continue;
    const localSum = localForecastSumBySku.get(skuKey) ?? 0;
    const networkForecast = networkForecastBySku.get(skuKey) ?? localSum;
    const allocationScale =
      localSum > 0 && networkForecast > 0 ? networkForecast / localSum : 1;
    const scaledProfile = applyForecastAllocationScale(profile, allocationScale);

    out.push({
      snapshotDate,
      warehouseNameRaw: b.warehouseNameRaw,
      warehouseKey: b.warehouseKey,
      nmId: b.nmId,
      techSize: b.techSize,
      vendorCode: b.vendorCode,
      barcode: b.barcode,
      units7: scaledProfile.units7,
      units30: scaledProfile.units30,
      units90: scaledProfile.units90,
      avgDaily7: scaledProfile.avgDaily7,
      avgDaily30: scaledProfile.avgDaily30,
      avgDaily90: scaledProfile.avgDaily90,
      baseDailyDemand: scaledProfile.baseDailyDemand,
      trendRatio: scaledProfile.trendRatio,
      trendRatioClamped: scaledProfile.trendRatioClamped,
      forecastDailyDemand: scaledProfile.forecastDailyDemand,
      demandModelVersion: scaledProfile.demandModelVersion,
      rawAvgDaily7: scaledProfile.rawAvgDaily7,
      rawAvgDaily30: scaledProfile.rawAvgDaily30,
      rawAvgDaily90: scaledProfile.rawAvgDaily90,
      adjustedAvgDaily7: scaledProfile.adjustedAvgDaily7,
      adjustedAvgDaily30: scaledProfile.adjustedAvgDaily30,
      adjustedAvgDaily90: scaledProfile.adjustedAvgDaily90,
      sellableDays7: scaledProfile.sellableDays7,
      sellableDays30: scaledProfile.sellableDays30,
      sellableDays90: scaledProfile.sellableDays90,
      constrainedDays7: scaledProfile.constrainedDays7,
      constrainedDays30: scaledProfile.constrainedDays30,
      constrainedDays90: scaledProfile.constrainedDays90,
      availabilityObservedDays7: scaledProfile.availabilityObservedDays7,
      availabilityObservedDays30: scaledProfile.availabilityObservedDays30,
      availabilityObservedDays90: scaledProfile.availabilityObservedDays90,
      peakDailyDemand: scaledProfile.peakDailyDemand,
      forecastAllocationScale: scaledProfile.forecastAllocationScale,
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
