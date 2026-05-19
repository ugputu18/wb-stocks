/**
 * Read-side эвристика «перемещение между складами WB» для одного SKU.
 * Не меняет pipeline и не пишет в БД — только расчёт поверх строк `wbWarehouses`.
 */

import { normalizeWarehouseName } from "../../../src/domain/warehouseName.js";
import {
  parseWbWarehouseRow,
  type WbWarehouseMetrics,
} from "../../../src/application/redistribution/redistributionModel.js";

export { parseWbWarehouseRow };
export type { WbWarehouseMetrics };

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

export function computeWbRedistribution(
  rows: unknown[],
  donorWarehouseKey: string,
  donorReserveDays: number,
): WbRedistributionResult | null {
  const dk = normalizeWarehouseName(donorWarehouseKey);
  if (!dk) return null;
  const reserveDays = Number(donorReserveDays);
  if (!Number.isFinite(reserveDays) || reserveDays < 0) return null;

  const parsed: WbWarehouseMetrics[] = [];
  for (const r of rows) {
    const p = parseWbWarehouseRow(r);
    if (p) parsed.push(p);
  }

  const donor = parsed.find((p) => normalizeWarehouseName(p.warehouseKey) === dk);
  if (!donor) return null;

  const fd = donor.forecastDailyDemand;
  const donorReserveUnits = fd * reserveDays;
  const donorTransferableUnits = Math.max(0, donor.localAvailable - donorReserveUnits);

  const targetsRaw = parsed.filter((p) => normalizeWarehouseName(p.warehouseKey) !== dk);
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
