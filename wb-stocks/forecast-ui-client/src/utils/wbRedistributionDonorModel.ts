/**
 * Read-side: перераспределение с одного донорского склада WB.
 * — Донор: warehouse-level (как раньше).
 * — Цель: либо регион (buyer-region demand), либо склад (fulfillment) — режимом UI.
 */

import { normalizeWarehouseName } from "../../../src/domain/warehouseName.js";
import { parseWbWarehouseRow } from "./wbRedistributionModel.js";
import {
  getWarehouseMacroRegion,
  getWarehouseRegistryEntry,
  isWarehouseMacroCompatibleWithTargetMacro,
  isWarehouseRedistributionDonorEligible,
  isWarehouseRedistributionExecutionTarget,
  shouldSkipRedistributionDonorVsTargetMacro,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
  warehouseContributesToRegionalAvailabilityStock,
} from "./wbWarehouseRegion.js";
import {
  bumpUnknownWarehouseUsage,
  getUnknownWarehouseUsageStats,
  resetUnknownWarehouseUsageStats,
} from "./wbRedistributionUnknownWarehouses.js";

export { getUnknownWarehouseUsageStats, resetUnknownWarehouseUsageStats };

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

/**
 * Режим рекомендаций redistribution: исполнение по складам vs агрегат по макрорегиону
 * (в macro-режиме у строки всё равно есть preferred / candidate склады).
 */
export type RedistributionRecommendationMode = "warehouse" | "macro";

/** Региональный режим: одна строка = SKU × донор × регион назначения. */
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
  /** Σ regional_forecast_daily_demand по buyer-регионам целевого региона. */
  targetRegionalDemand: number;
  /** Σ localAvailable по складам целевого региона в сети (донорский склад не входит). */
  regionalAvailableUnits: number;
  /** regionalAvailableUnits / targetRegionalDemand при спросе > 0. */
  regionalDaysOfStock: number;
  /** Целевой запас до покрытия: ceil(targetRegionalDemand × targetCoverageDays). */
  targetCoverageStockUnits: number;
  /** Дефицит до целевого покрытия: max(0, ceil(targetCoverageStockUnits − regionalAvailableUnits)). */
  regionalNeedUnits: number;
  recommendedTransferUnitsToRegion: number;
  transferScore: number;
  /** Ключи execution targets (после hard filters), упорядочены {@link compareRedistributionExecutionTargets}. */
  candidateWarehouseKeys: string[];
  /** Короткие подписи для UI. */
  candidateWarehouseLabels: string[];
  /** Первый склад после {@link compareRedistributionExecutionTargets} (тот же порядок, что candidateWarehouseKeys). */
  preferredWarehouseKey: string | null;
  /**
   * Мин. дней запаса по строкам сети в целевом макрорегионе (те же строки, что {@link regionalAvailableUnits}:
   * вклад в остатки региона после macro matching, без виртуальных).
   */
  regionMinDaysOfStockHint: number | null;
  /**
   * Σ recommendedToWB по тем же строкам, что и {@link regionalAvailableUnits} (macro region / availability contributors).
   */
  sumRecommendedToWBInRegion: number;
  /**
   * true — в сети по SKU есть хотя бы одна строка склада (не донор) с macro-compatible регионом цели.
   */
  hasCandidateWarehouses: boolean;
  /** Число execution targets после hard filters; длина {@link candidateWarehouseKeys}. */
  executionTargetCount: number;
  /** true — есть хотя бы один склад, прошедший execution hard filters. */
  hasExecutionTargets: boolean;
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
  const donorKeyNorm = normalizeWarehouseName(donorWarehouseKey);
  if (!donorKeyNorm) return null;
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
    donorWarehouseKey: donorKeyNorm,
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
  /** Из реестра; для ranking, если нет в справочнике — 0. */
  priorityWithinMacro: number;
}

function isVirtualWarehouseKey(warehouseKey: string): boolean {
  return normalizeWarehouseName(warehouseKey).startsWith("виртуальный ");
}

/** Базовое имя после префикса «виртуальный » — для сопоставления с реальным складом. */
function warehouseKeyBaseForVirtualDedup(warehouseKey: string): string {
  return normalizeWarehouseName(warehouseKey).replace(/^виртуальный\s+/, "");
}

function dropVirtualWhenRealSharesBase(candidates: WarehouseInMacroCandidate[]): WarehouseInMacroCandidate[] {
  const realBases = new Set<string>();
  for (const c of candidates) {
    if (!isVirtualWarehouseKey(c.warehouseKey)) {
      realBases.add(normalizeWarehouseName(c.warehouseKey));
      realBases.add(warehouseKeyBaseForVirtualDedup(c.warehouseKey));
    }
  }
  return candidates.filter((c) => {
    if (!isVirtualWarehouseKey(c.warehouseKey)) return true;
    const base = warehouseKeyBaseForVirtualDedup(c.warehouseKey);
    return !realBases.has(base);
  });
}

const redistributionUnknownWarehouseLogged = new Set<string>();

/** Один раз на нормализованный ключ за жизнь страницы (снимает шум в консоли). */
function logRedistributionUnknownWarehouse(rawKey: string, context: string): void {
  const n = normalizeWarehouseName(rawKey);
  if (!n || n === "<unknown>") return;
  if (getWarehouseRegistryEntry(rawKey) != null) return;
  bumpUnknownWarehouseUsage(n);
  if (redistributionUnknownWarehouseLogged.has(n)) return;
  redistributionUnknownWarehouseLogged.add(n);
  console.warn("[wbRedistribution] warehouse not in registry", { rawKey, normalized: n, context });
}

/**
 * Сравнение execution targets для macro redistribution (только среди уже прошедших hard filters).
 * Отрицательный результат ⇒ `a` выше в ranking, чем `b`.
 *
 * Порядок: выше `recommendedToWB` → ниже `daysOfStock` → ниже `localAvailable` → выше `priorityWithinMacro` (нет в реестре = 0) → стабильно по `warehouseKey` (locale `ru`).
 */
export function compareRedistributionExecutionTargets(
  a: WarehouseInMacroCandidate,
  b: WarehouseInMacroCandidate,
): number {
  if (b.recommendedToWB !== a.recommendedToWB) return b.recommendedToWB - a.recommendedToWB;
  if (a.daysOfStock !== b.daysOfStock) return a.daysOfStock - b.daysOfStock;
  if (a.localAvailable !== b.localAvailable) return a.localAvailable - b.localAvailable;
  const prA = a.priorityWithinMacro;
  const prB = b.priorityWithinMacro;
  if (prB !== prA) return prB - prA;
  return a.warehouseKey.localeCompare(b.warehouseKey, "ru");
}

/** Упорядочить execution targets для UI и preferred (копия массива). */
export function sortRedistributionExecutionTargets(
  executionTargets: WarehouseInMacroCandidate[],
): WarehouseInMacroCandidate[] {
  return [...executionTargets].sort(compareRedistributionExecutionTargets);
}

/**
 * Только отладка: ключ сортировки для console / сравнения снимков. Не использовать в бизнес-логике.
 */
export function redistributionExecutionTargetDebugSortKey(c: WarehouseInMacroCandidate): string {
  return [
    c.recommendedToWB,
    c.daysOfStock,
    c.localAvailable,
    c.priorityWithinMacro,
    c.warehouseKey,
  ].join("\t");
}

/**
 * Фильтр debug-трейса macro-collect (`localStorage.wbRedistTraceSubstring`).
 * - `getItem` === `null` (ключ отсутствует) → off
 * - `""` → все строки
 * - непустое → подстрока в `warehouseKey|warehouseNameRaw` (без регистра, `ru`)
 */
export type RedistributionMacroTraceFilter =
  | { kind: "off" }
  | { kind: "all" }
  | { kind: "substring"; needle: string };

/** Для тестов: то же, что `localStorage.getItem("wbRedistTraceSubstring")` возвращает до trim. */
export function redistributionMacroTraceFilterFromGetItemResult(raw: string | null): RedistributionMacroTraceFilter {
  if (raw === null) return { kind: "off" };
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "all" };
  return { kind: "substring", needle: trimmed.toLocaleLowerCase("ru") };
}

export function readRedistributionMacroTraceFilterFromLocalStorage(): RedistributionMacroTraceFilter {
  if (typeof globalThis === "undefined") return { kind: "off" };
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    if (!ls) return { kind: "off" };
    return redistributionMacroTraceFilterFromGetItemResult(ls.getItem("wbRedistTraceSubstring"));
  } catch {
    return { kind: "off" };
  }
}

export function shouldTraceRedistributionMacroRow(
  warehouseKey: string,
  warehouseNameRaw: string,
  filter: RedistributionMacroTraceFilter,
): boolean {
  if (filter.kind === "off") return false;
  if (filter.kind === "all") return true;
  const hay = `${warehouseKey}|${warehouseNameRaw}`.toLocaleLowerCase("ru");
  return hay.includes(filter.needle);
}

function traceRedistributionMacroRow(
  filter: RedistributionMacroTraceFilter,
  p: {
    warehouseKey: string;
    warehouseNameRaw: string;
    matchedNetwork: string;
    selectedRegion: string;
    reasonFilteredOut: string | null;
  },
): void {
  if (!shouldTraceRedistributionMacroRow(p.warehouseKey, p.warehouseNameRaw, filter)) return;
  console.debug("[wbRedistMacroTrace]", {
    wbTarget: p.warehouseNameRaw,
    normalizedTarget: normalizeWarehouseName(p.warehouseKey),
    matchedWarehouse: p.warehouseKey,
    matchedNetwork: p.matchedNetwork,
    selectedRegion: p.selectedRegion,
    reasonFilteredOut: p.reasonFilteredOut,
  });
}

function collectWarehousesInMacroRegion(
  netRows: unknown[],
  donorKeyNormalized: string,
  targetMacro: string,
): {
  /** Склады для Σ localAvailable / sumRecommendedToWB / min days в регионе (виртуальные не включаются — см. {@link warehouseContributesToRegionalAvailabilityStock}). */
  availabilityContributors: WarehouseInMacroCandidate[];
  /** Склады-исполнители для UI (цели перераспределения по реестру). */
  executionTargets: WarehouseInMacroCandidate[];
  /** Строки сети с macro-compatible регионом (не донор), для {@link DonorMacroRegionRecommendation.hasCandidateWarehouses}. */
  macroRegionNetworkRowCount: number;
} {
  const traceFilter = readRedistributionMacroTraceFilterFromLocalStorage();
  const availabilityPool: WarehouseInMacroCandidate[] = [];
  const executionPool: WarehouseInMacroCandidate[] = [];
  let macroRegionNetworkRowCount = 0;
  for (const rawT of netRows) {
    const p = parseWbWarehouseRow(rawT);
    if (!p) continue;
    const wk = p.warehouseKey;
    const rawRow = rawT && typeof rawT === "object" ? (rawT as Record<string, unknown>) : null;
    const rawWkForLog =
      rawRow?.warehouseKey != null && typeof rawRow.warehouseKey === "string"
        ? rawRow.warehouseKey
        : wk;
    if (getWarehouseRegistryEntry(wk) == null) {
      logRedistributionUnknownWarehouse(rawWkForLog, "macro_network_sku_row");
    }
    const wkNorm = normalizeWarehouseName(wk);
    if (wkNorm === donorKeyNormalized) {
      traceRedistributionMacroRow(traceFilter, {
        warehouseKey: wk,
        warehouseNameRaw: p.warehouseNameRaw,
        matchedNetwork: "",
        selectedRegion: targetMacro,
        reasonFilteredOut: "donor_row",
      });
      continue;
    }
    const wm = getWarehouseMacroRegion(wk) ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
    if (!isWarehouseMacroCompatibleWithTargetMacro(wm, targetMacro)) {
      traceRedistributionMacroRow(traceFilter, {
        warehouseKey: wk,
        warehouseNameRaw: p.warehouseNameRaw,
        matchedNetwork: wm,
        selectedRegion: targetMacro,
        reasonFilteredOut: "macro_not_compatible",
      });
      continue;
    }
    macroRegionNetworkRowCount += 1;
    traceRedistributionMacroRow(traceFilter, {
      warehouseKey: wk,
      warehouseNameRaw: p.warehouseNameRaw,
      matchedNetwork: wm,
      selectedRegion: targetMacro,
      reasonFilteredOut: null,
    });
    const regEntry = getWarehouseRegistryEntry(wk);
    const cand: WarehouseInMacroCandidate = {
      warehouseKey: wk,
      warehouseNameRaw: p.warehouseNameRaw,
      recommendedToWB: p.recommendedToWB,
      daysOfStock: p.daysOfStock,
      localAvailable: p.localAvailable,
      priorityWithinMacro: regEntry?.priorityWithinMacro ?? 0,
    };
    if (warehouseContributesToRegionalAvailabilityStock(regEntry, wkNorm)) {
      availabilityPool.push(cand);
    }
    if (isWarehouseRedistributionExecutionTarget(regEntry, "macro")) {
      executionPool.push(cand);
    }
  }
  return {
    availabilityContributors: availabilityPool,
    executionTargets: dropVirtualWhenRealSharesBase(executionPool),
    macroRegionNetworkRowCount,
  };
}

/**
 * Региональное перераспределение: цель = **регион** (buyer-region demand).
 * Объём: `min(donorTransferableUnits, regionalNeedUnits)`, где нехватка считается до целевого покрытия
 * с учётом уже лежащего в регионе товара (Σ localAvailable по складам целевого региона в сети).
 * Межрегиональный сценарий: строки «донор и цель в одном регионе» отбрасываются.
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
  const donorKeyNormalized = normalizeWarehouseName(donorWarehouseKey);
  const donorMacroRegion =
    getWarehouseMacroRegion(donorWarehouseKey) ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
  if (!isWarehouseRedistributionDonorEligible(getWarehouseRegistryEntry(donorWarehouseKey))) {
    return [];
  }
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
      if (shouldSkipRedistributionDonorVsTargetMacro(donorMacroRegion, macro)) continue;

      const { availabilityContributors, executionTargets, macroRegionNetworkRowCount } =
        collectWarehousesInMacroRegion(netRows, donorKeyNormalized, macro);
      let regionalAvailableUnits = 0;
      for (const c of availabilityContributors) {
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

      const rankedExecutionTargets = sortRedistributionExecutionTargets(executionTargets);
      const candidateWarehouseKeys = rankedExecutionTargets.map((c) => c.warehouseKey);
      const executionTargetCount = candidateWarehouseKeys.length;
      const hasExecutionTargets = executionTargetCount > 0;
      const hasCandidateWarehouses = macroRegionNetworkRowCount > 0;
      const candidateWarehouseLabels = rankedExecutionTargets.map(
        (c) => `${c.warehouseNameRaw || c.warehouseKey}`.trim() || c.warehouseKey,
      );
      const preferredWarehouseKey = rankedExecutionTargets[0]?.warehouseKey ?? null;

      let sumRecommendedToWBInRegion = 0;
      for (const c of availabilityContributors) {
        sumRecommendedToWBInRegion += c.recommendedToWB;
      }

      let regionMinDaysOfStockHint: number | null = null;
      for (const c of availabilityContributors) {
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
        hasCandidateWarehouses,
        executionTargetCount,
        hasExecutionTargets,
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
  const donorKeyNormalized = normalizeWarehouseName(donorWarehouseKey);
  const reserveDays = Number(donorReserveDays);
  if (!Number.isFinite(reserveDays) || reserveDays < 0) return [];
  if (!isWarehouseRedistributionDonorEligible(getWarehouseRegistryEntry(donorWarehouseKey))) {
    return [];
  }

  const out: DonorWarehouseRecommendation[] = [];

  for (const raw of donorRows) {
    const surplus = parseDonorWarehouseSkuRow(raw, donorWarehouseKey, reserveDays);
    if (!surplus || surplus.donorTransferableUnits < minTransferableUnits) continue;

    const key = skuKey(surplus.nmId, surplus.techSize);
    const netRows = networkBySku.get(key);
    if (!netRows?.length) continue;

    for (const rawT of netRows) {
      const p = parseWbWarehouseRow(rawT);
      if (!p || normalizeWarehouseName(p.warehouseKey) === donorKeyNormalized) continue;
      const rawRow = rawT && typeof rawT === "object" ? (rawT as Record<string, unknown>) : null;
      const rawWkForLog =
        rawRow?.warehouseKey != null && typeof rawRow.warehouseKey === "string"
          ? rawRow.warehouseKey
          : p.warehouseKey;
      const regEntry = getWarehouseRegistryEntry(p.warehouseKey);
      if (regEntry == null) {
        logRedistributionUnknownWarehouse(rawWkForLog, "fulfillment_network_sku_row");
      }
      if (!isWarehouseRedistributionExecutionTarget(regEntry, "warehouse")) {
        continue;
      }
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

  const regByKey = new Map<
    string,
    ReturnType<typeof getWarehouseRegistryEntry>
  >();
  for (const r of out) {
    if (!regByKey.has(r.targetWarehouseKey)) {
      regByKey.set(r.targetWarehouseKey, getWarehouseRegistryEntry(r.targetWarehouseKey));
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
    const dr = b.targetRecommendedToWB - a.targetRecommendedToWB;
    if (dr !== 0) return dr;
    const prA = regByKey.get(a.targetWarehouseKey)?.priorityWithinMacro ?? Number.NEGATIVE_INFINITY;
    const prB = regByKey.get(b.targetWarehouseKey)?.priorityWithinMacro ?? Number.NEGATIVE_INFINITY;
    if (prB !== prA) return prB - prA;
    const vA = regByKey.get(a.targetWarehouseKey)?.isVirtual ?? false;
    const vB = regByKey.get(b.targetWarehouseKey)?.isVirtual ?? false;
    if (vA !== vB) return vA ? 1 : -1;
    return a.targetWarehouseKey.localeCompare(b.targetWarehouseKey, "ru");
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
