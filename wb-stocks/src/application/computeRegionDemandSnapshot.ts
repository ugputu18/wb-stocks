import type { Logger } from "pino";
import type { WbOrdersDailyByRegionRepository } from "../infra/wbOrdersDailyByRegionRepository.js";
import type { WbRegionDemandSnapshotRepository } from "../infra/wbRegionDemandSnapshotRepository.js";
import type { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import type { WbOrdersDailyRegionRecord } from "../domain/wbOrder.js";
import type { WbRegionDemandSnapshotRecord } from "../domain/wbRegionDemandSnapshot.js";
import {
  applyForecastAllocationScale,
  buildCensoredPeakDemandProfile,
  WINDOW_LONG_DAYS,
  WINDOW_MID_DAYS,
  WINDOW_SHORT_DAYS,
} from "./censoredPeakDemand.js";
import {
  buildDailyAvailabilityLookups,
  skuDemandKey,
  type DailyAvailabilityLookup,
} from "./demandAvailability.js";

export interface ComputeRegionDemandSnapshotDeps {
  ordersByRegionRepository: WbOrdersDailyByRegionRepository;
  regionDemandRepository: WbRegionDemandSnapshotRepository;
  stockRepository?: StockSnapshotRepository;
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

export async function computeRegionDemandSnapshot(
  deps: ComputeRegionDemandSnapshotDeps,
  options: ComputeRegionDemandSnapshotOptions = {},
): Promise<ComputeRegionDemandSnapshotResult> {
  const {
    ordersByRegionRepository,
    regionDemandRepository,
    stockRepository,
    logger,
  } = deps;
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
  const stockAvailabilityRows =
    stockRepository?.getDailyAvailabilityRange(windowFrom, windowTo) ?? [];
  const availabilityLookups = buildDailyAvailabilityLookups(stockAvailabilityRows);
  const records = buildRegionDemandRecords(
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
  options: {
    availabilityBySku?: DailyAvailabilityLookup;
  } = {},
): WbRegionDemandSnapshotRecord[] {
  const cutoffShort = addDays(windowTo, -(WINDOW_SHORT_DAYS - 1));
  const cutoffMid = addDays(windowTo, -(WINDOW_MID_DAYS - 1));

  type Bucket = {
    regionNameRaw: string | null;
    regionKey: string;
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
    { nmId: number; techSize: string; dailyUnits: Map<string, number> }
  >();

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
        units90: 0,
        dailyUnits: new Map(),
      };
      buckets.set(key, b);
    } else {
      if (b.regionNameRaw === null && r.regionNameRaw !== null) {
        b.regionNameRaw = r.regionNameRaw;
      }
      if (b.vendorCode === null && r.vendorCode !== null) b.vendorCode = r.vendorCode;
      if (b.barcode === null && r.barcode !== null) b.barcode = r.barcode;
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

  const out: WbRegionDemandSnapshotRecord[] = [];
  for (const b of buckets.values()) {
    const key = `${b.regionKey}\u0000${b.nmId}\u0000${b.techSize}`;
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
      regionNameRaw: b.regionNameRaw,
      regionKey: b.regionKey,
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
      regionalForecastDailyDemand: scaledProfile.forecastDailyDemand,
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
    if (a.regionKey !== b.regionKey) return a.regionKey < b.regionKey ? -1 : 1;
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

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  return toUtcYmd(new Date(t));
}
