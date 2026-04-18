/**
 * Read-side эвристика «перемещение между складами WB» для одного SKU.
 * Не меняет pipeline и не пишет в БД — только расчёт поверх строк `wbWarehouses`.
 */

export interface WbWarehouseMetrics {
  warehouseKey: string;
  warehouseNameRaw: string;
  localAvailable: number;
  forecastDailyDemand: number;
  daysOfStock: number;
  recommendedToWB: number;
}

export interface WbRedistributionDonor {
  donorWarehouseKey: string;
  donorLocalAvailable: number;
  donorForecastDailyDemand: number;
  donorDaysOfStock: number;
  donorReserveDays: number;
  donorReserveUnits: number;
  donorTransferableUnits: number;
}

export interface WbRedistributionTarget {
  targetWarehouseKey: string;
  targetWarehouseNameRaw: string;
  targetForecastDailyDemand: number;
  targetDaysOfStock: number;
  targetRecommendedToWB: number;
  recommendedTransferUnits: number;
  priority: number;
}

export interface WbRedistributionResult {
  donor: WbRedistributionDonor;
  targets: WbRedistributionTarget[];
  /** Склады-получатели с recommendedToWB <= 0 — не попадают в targets; см. MVP. */
  skippedNonNeedyCount: number;
}

function num(x: unknown, fallback = 0): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** Разбор одной строки ответа `GET /api/forecast/rows` при `viewMode=wbWarehouses`. */
export function parseWbWarehouseRow(raw: unknown): WbWarehouseMetrics | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row) return null;
  const wk = row.warehouseKey;
  if (typeof wk !== "string" || !wk.trim()) return null;
  const inv = row.inventoryLevels;
  const local =
    inv && typeof inv === "object"
      ? num((inv as Record<string, unknown>).localAvailable, NaN)
      : NaN;
  if (!Number.isFinite(local)) return null;
  const rep = row.replenishment;
  const recWb =
    rep && typeof rep === "object"
      ? num((rep as Record<string, unknown>).recommendedToWB, 0)
      : 0;
  const nameRaw = row.warehouseNameRaw;
  return {
    warehouseKey: wk.trim(),
    warehouseNameRaw: typeof nameRaw === "string" ? nameRaw : wk,
    localAvailable: local,
    forecastDailyDemand: num(row.forecastDailyDemand, 0),
    daysOfStock: num(row.daysOfStock, 0),
    recommendedToWB: Number.isFinite(recWb) ? Math.max(0, recWb) : 0,
  };
}

export function computeWbRedistribution(
  rows: unknown[],
  donorWarehouseKey: string,
  donorReserveDays: number,
): WbRedistributionResult | null {
  const dk = donorWarehouseKey.trim().toLowerCase();
  if (!dk) return null;
  const reserveDays = Number(donorReserveDays);
  if (!Number.isFinite(reserveDays) || reserveDays < 0) return null;

  const parsed: WbWarehouseMetrics[] = [];
  for (const r of rows) {
    const p = parseWbWarehouseRow(r);
    if (p) parsed.push(p);
  }

  const donor = parsed.find((p) => p.warehouseKey.toLowerCase() === dk);
  if (!donor) return null;

  const fd = donor.forecastDailyDemand;
  const donorReserveUnits = fd * reserveDays;
  const donorTransferableUnits = Math.max(0, donor.localAvailable - donorReserveUnits);

  const targetsRaw = parsed.filter((p) => p.warehouseKey.toLowerCase() !== dk);
  const skippedNonNeedyCount = targetsRaw.filter((p) => p.recommendedToWB <= 0).length;
  const needy = targetsRaw.filter((p) => p.recommendedToWB > 0);

  const sorted = [...needy].sort((a, b) => {
    const dFd = b.forecastDailyDemand - a.forecastDailyDemand;
    if (dFd !== 0) return dFd;
    const dDays = a.daysOfStock - b.daysOfStock;
    if (dDays !== 0) return dDays;
    return b.recommendedToWB - a.recommendedToWB;
  });

  const targets: WbRedistributionTarget[] = sorted.map((t, i) => {
    const recommendedTransferUnits = Math.min(
      donorTransferableUnits,
      t.recommendedToWB,
    );
    return {
      targetWarehouseKey: t.warehouseKey,
      targetWarehouseNameRaw: t.warehouseNameRaw,
      targetForecastDailyDemand: t.forecastDailyDemand,
      targetDaysOfStock: t.daysOfStock,
      targetRecommendedToWB: t.recommendedToWB,
      recommendedTransferUnits,
      priority: i + 1,
    };
  });

  return {
    donor: {
      donorWarehouseKey: donor.warehouseKey,
      donorLocalAvailable: donor.localAvailable,
      donorForecastDailyDemand: donor.forecastDailyDemand,
      donorDaysOfStock: donor.daysOfStock,
      donorReserveDays: reserveDays,
      donorReserveUnits,
      donorTransferableUnits,
    },
    targets,
    skippedNonNeedyCount,
  };
}
