import {
  CENSORED_PEAK_DEMAND_MODEL_VERSION,
  LEGACY_DEMAND_MODEL_VERSION,
  type DemandDiagnosticsFields,
} from "../domain/demandDiagnostics.js";

export {
  CENSORED_PEAK_DEMAND_MODEL_VERSION,
  LEGACY_DEMAND_MODEL_VERSION,
  type DemandDiagnosticsFields,
};

export const WINDOW_SHORT_DAYS = 7;
export const WINDOW_MID_DAYS = 30;
export const WINDOW_LONG_DAYS = 90;

const SHORT_WEIGHT = 0.5;
const MID_WEIGHT = 0.3;
const LONG_WEIGHT = 0.2;
const EPSILON = 1e-6;
const TREND_MIN = 0.75;
const TREND_MAX = 1.25;
const PEAK_QUANTILE = 0.9;
const ROLLING_PEAK_DAYS = 7;
const MIN_POSITIVE_DAILY_FOR_DAILY_PEAK = 7;

export interface CensoredPeakDemandProfile extends Required<DemandDiagnosticsFields> {
  units7: number;
  units30: number;
  units90: number;
  avgDaily7: number;
  avgDaily30: number;
  avgDaily90: number;
  baseDailyDemand: number;
  trendRatio: number;
  trendRatioClamped: number;
  forecastDailyDemand: number;
}

export interface BuildCensoredPeakDemandProfileInput {
  /** Inclusive last day of the 90-day window, YYYY-MM-DD. */
  windowTo: string;
  /** orderDate -> units for the scoped SKU bucket. Missing dates are zero. */
  dailyUnits: ReadonlyMap<string, number>;
  /**
   * orderDate -> stock quantity available for the same scope.
   * Missing dates are treated as unknown availability and are not censored.
   */
  dailyAvailability?: ReadonlyMap<string, number>;
}

export function buildCensoredPeakDemandProfile(
  input: BuildCensoredPeakDemandProfileInput,
): CensoredPeakDemandProfile {
  const dates = buildTrailingDates(input.windowTo, WINDOW_LONG_DAYS);
  const unitsByDate = new Map<string, number>();
  for (const date of dates) {
    unitsByDate.set(date, nonNegativeFinite(input.dailyUnits.get(date)));
  }

  const allUnits = dates.map((date) => unitsByDate.get(date) ?? 0);
  const peakDailyDemand = computePeakDailyDemand(allUnits);
  const peakThreshold = Math.ceil(peakDailyDemand);

  const shortStats = computeWindowStats(
    dates,
    unitsByDate,
    input.dailyAvailability,
    WINDOW_SHORT_DAYS,
    peakThreshold,
  );
  const midStats = computeWindowStats(
    dates,
    unitsByDate,
    input.dailyAvailability,
    WINDOW_MID_DAYS,
    peakThreshold,
  );
  const longStats = computeWindowStats(
    dates,
    unitsByDate,
    input.dailyAvailability,
    WINDOW_LONG_DAYS,
    peakThreshold,
  );

  const effectiveAvg7 = firstNonZero(
    shortStats.adjustedAvgDaily,
    midStats.adjustedAvgDaily,
    longStats.adjustedAvgDaily,
  );
  const effectiveAvg30 = firstNonZero(
    midStats.adjustedAvgDaily,
    longStats.adjustedAvgDaily,
  );
  const baseDailyDemand =
    SHORT_WEIGHT * effectiveAvg7 +
    MID_WEIGHT * effectiveAvg30 +
    LONG_WEIGHT * longStats.adjustedAvgDaily;
  const trendRatio =
    shortStats.adjustedAvgDaily / Math.max(midStats.adjustedAvgDaily, EPSILON);
  const trendRatioClamped = clamp(trendRatio, TREND_MIN, TREND_MAX);
  const smoothedDemand = baseDailyDemand * trendRatioClamped;
  const forecastDailyDemand = Math.max(smoothedDemand, peakDailyDemand);

  return {
    demandModelVersion: CENSORED_PEAK_DEMAND_MODEL_VERSION,
    units7: shortStats.units,
    units30: midStats.units,
    units90: longStats.units,
    rawAvgDaily7: shortStats.rawAvgDaily,
    rawAvgDaily30: midStats.rawAvgDaily,
    rawAvgDaily90: longStats.rawAvgDaily,
    adjustedAvgDaily7: shortStats.adjustedAvgDaily,
    adjustedAvgDaily30: midStats.adjustedAvgDaily,
    adjustedAvgDaily90: longStats.adjustedAvgDaily,
    avgDaily7: shortStats.adjustedAvgDaily,
    avgDaily30: midStats.adjustedAvgDaily,
    avgDaily90: longStats.adjustedAvgDaily,
    sellableDays7: shortStats.sellableDays,
    sellableDays30: midStats.sellableDays,
    sellableDays90: longStats.sellableDays,
    constrainedDays7: shortStats.constrainedDays,
    constrainedDays30: midStats.constrainedDays,
    constrainedDays90: longStats.constrainedDays,
    availabilityObservedDays7: shortStats.availabilityObservedDays,
    availabilityObservedDays30: midStats.availabilityObservedDays,
    availabilityObservedDays90: longStats.availabilityObservedDays,
    peakDailyDemand,
    baseDailyDemand,
    trendRatio,
    trendRatioClamped,
    forecastDailyDemand,
    forecastAllocationScale: 1,
  };
}

export function applyForecastAllocationScale<
  T extends CensoredPeakDemandProfile,
>(profile: T, scale: number): T {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    ...profile,
    forecastDailyDemand: profile.forecastDailyDemand * s,
    forecastAllocationScale: s,
  };
}

export function legacyDemandDiagnosticsDefaults(input: {
  avgDaily7: number;
  avgDaily30: number;
  avgDaily90: number;
  peakDailyDemand?: number;
  forecastAllocationScale?: number;
}): Required<DemandDiagnosticsFields> {
  return {
    demandModelVersion: LEGACY_DEMAND_MODEL_VERSION,
    rawAvgDaily7: input.avgDaily7,
    rawAvgDaily30: input.avgDaily30,
    rawAvgDaily90: input.avgDaily90,
    adjustedAvgDaily7: input.avgDaily7,
    adjustedAvgDaily30: input.avgDaily30,
    adjustedAvgDaily90: input.avgDaily90,
    sellableDays7: WINDOW_SHORT_DAYS,
    sellableDays30: WINDOW_MID_DAYS,
    sellableDays90: WINDOW_LONG_DAYS,
    constrainedDays7: 0,
    constrainedDays30: 0,
    constrainedDays90: 0,
    availabilityObservedDays7: 0,
    availabilityObservedDays30: 0,
    availabilityObservedDays90: 0,
    peakDailyDemand: input.peakDailyDemand ?? 0,
    forecastAllocationScale: input.forecastAllocationScale ?? 1,
  };
}

interface WindowStats {
  units: number;
  rawAvgDaily: number;
  adjustedAvgDaily: number;
  sellableDays: number;
  constrainedDays: number;
  availabilityObservedDays: number;
}

function computeWindowStats(
  allDates: readonly string[],
  dailyUnits: ReadonlyMap<string, number>,
  dailyAvailability: ReadonlyMap<string, number> | undefined,
  windowDays: number,
  peakThreshold: number,
): WindowStats {
  const dates = allDates.slice(allDates.length - windowDays);
  let units = 0;
  let unconstrainedUnits = 0;
  let sellableDays = 0;
  let constrainedDays = 0;
  let availabilityObservedDays = 0;

  for (const date of dates) {
    const dayUnits = dailyUnits.get(date) ?? 0;
    units += dayUnits;

    const hasAvailability = dailyAvailability?.has(date) === true;
    if (hasAvailability) availabilityObservedDays += 1;
    const availability = hasAvailability ? dailyAvailability?.get(date) ?? 0 : null;
    const constrained =
      peakThreshold > 0 &&
      availability !== null &&
      availability < peakThreshold &&
      dayUnits < peakThreshold;

    if (constrained) {
      constrainedDays += 1;
    } else {
      sellableDays += 1;
      unconstrainedUnits += dayUnits;
    }
  }

  const rawAvgDaily = units / windowDays;
  const adjustedAvgDaily =
    sellableDays > 0 ? unconstrainedUnits / sellableDays : rawAvgDaily;

  return {
    units,
    rawAvgDaily,
    adjustedAvgDaily,
    sellableDays,
    constrainedDays,
    availabilityObservedDays,
  };
}

function computePeakDailyDemand(units: readonly number[]): number {
  const positiveDaily = units.filter((u) => u > 0);
  const dailyPeak =
    positiveDaily.length >= MIN_POSITIVE_DAILY_FOR_DAILY_PEAK
      ? nearestRankQuantile(positiveDaily, PEAK_QUANTILE)
      : 0;

  const rollingAverages: number[] = [];
  for (let i = 0; i <= units.length - ROLLING_PEAK_DAYS; i += 1) {
    let sum = 0;
    for (let j = 0; j < ROLLING_PEAK_DAYS; j += 1) {
      sum += units[i + j] ?? 0;
    }
    const avg = sum / ROLLING_PEAK_DAYS;
    if (avg > 0) rollingAverages.push(avg);
  }
  const rollingPeak =
    rollingAverages.length > 0
      ? nearestRankQuantile(rollingAverages, PEAK_QUANTILE)
      : 0;

  return Math.max(dailyPeak, rollingPeak);
}

function nearestRankQuantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))] ?? 0;
}

function buildTrailingDates(windowTo: string, days: number): string[] {
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(addDays(windowTo, -offset));
  }
  return dates;
}

function firstNonZero(...values: number[]): number {
  for (const v of values) {
    if (v > 0) return v;
  }
  return 0;
}

function nonNegativeFinite(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 0;
  return Math.max(0, v);
}

function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
