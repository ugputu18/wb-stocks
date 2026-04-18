/**
 * Read-side: перераспределение с одного донорского склада WB.
 * — Донор: warehouse-level (как раньше).
 * — Цель: либо макрорегион (buyer-region demand), либо склад (fulfillment) — режимом UI.
 */

import { parseWbWarehouseRow } from "./wbRedistributionModel.js";
import {
  getWarehouseMacroRegion,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
} from "./wbWarehouseRegion.js";

export function skuKey(nmId: number | string, techSize: string): string {
  return `${nmId}|${techSize}`;
}

export interface DonorSkuSurplus {
  nmId: number;
  techSize: string;
  vendorCode: string;
  donorWarehouseKey: string;
  donorLocalAvailable: number;
  donorForecastDailyDemand: number;
  donorReserveUnits: number;
  donorTransferableUnits: number;
}

export type RankingMode = "fulfillment" | "regional";

/** Региональный режим: одна строка = SKU × донор × макрорегион назначения. */
export interface DonorMacroRegionRecommendation {
  kind: "macro";
  priorityRank: number;
  nmId: number;
  techSize: string;
  vendorCode: string;
  donorWarehouseKey: string;
  donorLocalAvailable: number;
  donorReserveUnits: number;
  donorTransferableUnits: number;
  targetMacroRegion: string;
  /** Σ regional_forecast_daily_demand по buyer-регионам макрорегиона. */
  targetRegionalDemand: number;
  /** Σ localAvailable по складам целевого макрорегиона в сети (донорский склад не входит). */
  regionalAvailableUnits: number;
  /** regionalAvailableUnits / targetRegionalDemand при спросе > 0. */
  regionalDaysOfStock: number;
  /** Целевой запас до покрытия: ceil(targetRegionalDemand × targetCoverageDays). */
  targetCoverageStockUnits: number;
  /** Дефицит до целевого покрытия: max(0, ceil(targetCoverageStockUnits − regionalAvailableUnits)). */
  regionalNeedUnits: number;
  recommendedTransferUnitsToRegion: number;
  transferScore: number;
  /** Склады сети WB в этом макрорегионе (операционная деталь). */
  candidateWarehouseKeys: string[];
  /** Короткие подписи для UI. */
  candidateWarehouseLabels: string[];
  /** Склад с max recommendedToWB среди кандидатов — подсказка для логистики. */
  preferredWarehouseKey: string | null;
  /** Мин. дней запаса среди кандидатов в регионе (подсказка). */
  regionMinDaysOfStockHint: number | null;
  /** Σ recommendedToWB по кандидатам в регионе (справочно). */
  sumRecommendedToWBInRegion: number;
}

export type DonorWarehouseRecommendation = {
  kind: "warehouse";
  priorityRank: number;
  nmId: number;
  techSize: string;
  vendorCode: string;
  donorWarehouseKey: string;
  donorLocalAvailable: number;
  donorReserveUnits: number;
  donorTransferableUnits: number;
  targetWarehouseKey: string;
  targetWarehouseNameRaw: string;
  targetForecastDailyDemand: number;
  targetDaysOfStock: number;
  targetRecommendedToWB: number;
  recommendedTransferUnits: number;
  transferScore: number;
  rankingMode: "fulfillment";
  targetRankingDemand: number;
};

export type RedistributionRow = DonorMacroRegionRecommendation | DonorWarehouseRecommendation;

function num(x: unknown, fallback = 0): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** Одна строка донора из `GET /api/forecast/rows` + `warehouseKey=donor`. */
export function parseDonorWarehouseSkuRow(
  raw: unknown,
  donorWarehouseKey: string,
  donorReserveDays: number,
): DonorSkuSurplus | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row) return null;
  const nmId = num(row.nmId, NaN);
  if (!Number.isFinite(nmId)) return null;
  const techSize = row.techSize != null ? String(row.techSize) : "";
  const vendorCode = row.vendorCode != null ? String(row.vendorCode) : "";
  const inv = row.inventoryLevels;
  const local =
    inv && typeof inv === "object"
      ? num((inv as Record<string, unknown>).localAvailable, NaN)
      : NaN;
  if (!Number.isFinite(local)) return null;
  const fd = num(row.forecastDailyDemand, 0);
  const donorReserveUnits = fd * donorReserveDays;
  const donorTransferableUnits = Math.max(0, local - donorReserveUnits);
  return {
    nmId,
    techSize,
    vendorCode,
    donorWarehouseKey: donorWarehouseKey.trim(),
    donorLocalAvailable: local,
    donorForecastDailyDemand: fd,
    donorReserveUnits,
    donorTransferableUnits,
  };
}

export interface WarehouseInMacroCandidate {
  warehouseKey: string;
  warehouseNameRaw: string;
  recommendedToWB: number;
  daysOfStock: number;
  localAvailable: number;
}

function collectWarehousesInMacroRegion(
  netRows: unknown[],
  donorKeyLower: string,
  targetMacro: string,
): WarehouseInMacroCandidate[] {
  const out: WarehouseInMacroCandidate[] = [];
  for (const rawT of netRows) {
    const p = parseWbWarehouseRow(rawT);
    if (!p || p.warehouseKey.toLowerCase() === donorKeyLower) continue;
    const wm = getWarehouseMacroRegion(p.warehouseKey) ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
    if (wm !== targetMacro) continue;
    out.push({
      warehouseKey: p.warehouseKey,
      warehouseNameRaw: p.warehouseNameRaw,
      recommendedToWB: p.recommendedToWB,
      daysOfStock: p.daysOfStock,
      localAvailable: p.localAvailable,
    });
  }
  return out;
}

/**
 * Региональное перераспределение: цель = **макрорегион** (buyer-region demand).
 * Объём: `min(donorTransferableUnits, regionalNeedUnits)`, где нехватка считается до целевого покрытия
 * с учётом уже лежащего в регионе товара (Σ localAvailable по складам макрорегиона в сети).
 * Межрегиональный сценарий: строки «донор и цель в одном макрорегионе» отбрасываются.
 */
export function computeDonorMacroRegionRecommendations(
  donorRows: unknown[],
  networkBySku: Map<string, unknown[]>,
  donorWarehouseKey: string,
  donorReserveDays: number,
  minTransferableUnits: number,
  regionalByMacroBySku: Map<string, Map<string, number>>,
  targetCoverageDays: number,
): DonorMacroRegionRecommendation[] {
  const dk = donorWarehouseKey.trim().toLowerCase();
  const donorMacroRegion =
    getWarehouseMacroRegion(donorWarehouseKey) ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
  const reserveDays = Number(donorReserveDays);
  if (!Number.isFinite(reserveDays) || reserveDays < 0) return [];
  const cov = Number(targetCoverageDays);
  const coverageOk = Number.isFinite(cov) && cov > 0;
  if (!coverageOk) return [];

  const out: DonorMacroRegionRecommendation[] = [];

  for (const raw of donorRows) {
    const surplus = parseDonorWarehouseSkuRow(raw, donorWarehouseKey, reserveDays);
    if (!surplus || surplus.donorTransferableUnits < minTransferableUnits) continue;

    const key = skuKey(surplus.nmId, surplus.techSize);
    const netRows = networkBySku.get(key);
    if (!netRows?.length) continue;

    const macroMap = regionalByMacroBySku.get(key);
    if (!macroMap) continue;

    for (const [macro, demand] of macroMap) {
      if (demand <= 0) continue;
      /** Не предлагать «из региона в тот же макрорегион». */
      if (macro === donorMacroRegion) continue;

      const candidates = collectWarehousesInMacroRegion(netRows, dk, macro);
      let regionalAvailableUnits = 0;
      for (const c of candidates) {
        regionalAvailableUnits += c.localAvailable;
      }

      const targetCoverageStockUnits = Math.ceil(demand * cov);
      const regionalNeedUnits = Math.max(
        0,
        Math.ceil(targetCoverageStockUnits - regionalAvailableUnits),
      );
      if (regionalNeedUnits <= 0) continue;

      const recommendedTransferUnitsToRegion = Math.min(
        surplus.donorTransferableUnits,
        regionalNeedUnits,
      );
      if (recommendedTransferUnitsToRegion < minTransferableUnits) continue;

      const regionalDaysOfStock = demand > 0 ? regionalAvailableUnits / demand : 0;

      const candidateWarehouseKeys = candidates.map((c) => c.warehouseKey);
      const candidateWarehouseLabels = candidates.map(
        (c) => `${c.warehouseNameRaw || c.warehouseKey}`.trim() || c.warehouseKey,
      );
      let preferredWarehouseKey: string | null = null;
      let sumRecommendedToWBInRegion = 0;
      let bestRec = -1;
      for (const c of candidates) {
        sumRecommendedToWBInRegion += c.recommendedToWB;
        if (c.recommendedToWB > bestRec) {
          bestRec = c.recommendedToWB;
          preferredWarehouseKey = c.warehouseKey;
        }
      }
      if (bestRec <= 0) preferredWarehouseKey = null;

      let regionMinDaysOfStockHint: number | null = null;
      for (const c of candidates) {
        if (regionMinDaysOfStockHint === null || c.daysOfStock < regionMinDaysOfStockHint) {
          regionMinDaysOfStockHint = c.daysOfStock;
        }
      }

      const transferScore = recommendedTransferUnitsToRegion * demand;

      out.push({
        kind: "macro",
        priorityRank: 0,
        nmId: surplus.nmId,
        techSize: surplus.techSize,
        vendorCode: surplus.vendorCode,
        donorWarehouseKey: surplus.donorWarehouseKey,
        donorLocalAvailable: surplus.donorLocalAvailable,
        donorReserveUnits: surplus.donorReserveUnits,
        donorTransferableUnits: surplus.donorTransferableUnits,
        targetMacroRegion: macro,
        targetRegionalDemand: demand,
        regionalAvailableUnits,
        regionalDaysOfStock,
        targetCoverageStockUnits,
        regionalNeedUnits,
        recommendedTransferUnitsToRegion,
        transferScore,
        candidateWarehouseKeys,
        candidateWarehouseLabels,
        preferredWarehouseKey,
        regionMinDaysOfStockHint,
        sumRecommendedToWBInRegion,
      });
    }
  }

  out.sort((a, b) => {
    const aDays = a.regionalDaysOfStock;
    const bDays = b.regionalDaysOfStock;
    if (aDays !== bDays) return aDays - bDays;
    const dd = b.targetRegionalDemand - a.targetRegionalDemand;
    if (dd !== 0) return dd;
    const ds = b.transferScore - a.transferScore;
    if (ds !== 0) return ds;
    return b.recommendedTransferUnitsToRegion - a.recommendedTransferUnitsToRegion;
  });

  out.forEach((r, i) => {
    r.priorityRank = i + 1;
  });
  return out;
}

/**
 * Fulfillment: цель = склад исполнения (как раньше). `recommendedTransferUnits = min(surplus, recommendedToWB)`.
 */
export function computeDonorWarehouseRecommendations(
  donorRows: unknown[],
  networkBySku: Map<string, unknown[]>,
  donorWarehouseKey: string,
  donorReserveDays: number,
  minTransferableUnits: number,
): DonorWarehouseRecommendation[] {
  const dk = donorWarehouseKey.trim().toLowerCase();
  const reserveDays = Number(donorReserveDays);
  if (!Number.isFinite(reserveDays) || reserveDays < 0) return [];

  const out: DonorWarehouseRecommendation[] = [];

  for (const raw of donorRows) {
    const surplus = parseDonorWarehouseSkuRow(raw, donorWarehouseKey, reserveDays);
    if (!surplus || surplus.donorTransferableUnits < minTransferableUnits) continue;

    const key = skuKey(surplus.nmId, surplus.techSize);
    const netRows = networkBySku.get(key);
    if (!netRows?.length) continue;

    for (const rawT of netRows) {
      const p = parseWbWarehouseRow(rawT);
      if (!p || p.warehouseKey.toLowerCase() === dk) continue;
      if (p.recommendedToWB <= 0) continue;
      const recommendedTransferUnits = Math.min(
        surplus.donorTransferableUnits,
        p.recommendedToWB,
      );
      if (recommendedTransferUnits <= 0) continue;

      const targetRankingDemand = p.forecastDailyDemand;
      const transferScore = recommendedTransferUnits * targetRankingDemand;
      out.push({
        kind: "warehouse",
        priorityRank: 0,
        nmId: surplus.nmId,
        techSize: surplus.techSize,
        vendorCode: surplus.vendorCode,
        donorWarehouseKey: surplus.donorWarehouseKey,
        donorLocalAvailable: surplus.donorLocalAvailable,
        donorReserveUnits: surplus.donorReserveUnits,
        donorTransferableUnits: surplus.donorTransferableUnits,
        targetWarehouseKey: p.warehouseKey,
        targetWarehouseNameRaw: p.warehouseNameRaw,
        targetForecastDailyDemand: p.forecastDailyDemand,
        targetDaysOfStock: p.daysOfStock,
        targetRecommendedToWB: p.recommendedToWB,
        recommendedTransferUnits,
        transferScore,
        rankingMode: "fulfillment",
        targetRankingDemand,
      });
    }
  }

  out.sort((a, b) => {
    const ds = b.transferScore - a.transferScore;
    if (ds !== 0) return ds;
    const dfd = b.targetRankingDemand - a.targetRankingDemand;
    if (dfd !== 0) return dfd;
    const dff = b.targetForecastDailyDemand - a.targetForecastDailyDemand;
    if (dff !== 0) return dff;
    const dy = a.targetDaysOfStock - b.targetDaysOfStock;
    if (dy !== 0) return dy;
    return b.targetRecommendedToWB - a.targetRecommendedToWB;
  });

  out.forEach((r, i) => {
    r.priorityRank = i + 1;
  });
  return out;
}

export function pickTopSurplusSkus(
  donorRows: unknown[],
  donorWarehouseKey: string,
  donorReserveDays: number,
  minTransferableUnits: number,
  maxSkus: number,
): DonorSkuSurplus[] {
  const reserveDays = Number(donorReserveDays);
  if (!Number.isFinite(reserveDays) || reserveDays < 0) return [];
  const list: DonorSkuSurplus[] = [];
  for (const raw of donorRows) {
    const s = parseDonorWarehouseSkuRow(raw, donorWarehouseKey, reserveDays);
    if (s && s.donorTransferableUnits >= minTransferableUnits) list.push(s);
  }
  list.sort((a, b) => b.donorTransferableUnits - a.donorTransferableUnits);
  return list.slice(0, Math.max(0, maxSkus));
}
