/**
 * Pure read-side redistribution model shared by the browser UI and XLSX export.
 * No DOM/localStorage/console side effects live here; callers can pass optional
 * diagnostics callbacks when they need client-only tracing.
 */

import { normalizeWarehouseName } from "../../domain/warehouseName.js";
import {
  getWarehouseMacroRegion,
  getWarehouseRegistryEntry,
  isWarehouseMacroCompatibleWithTargetMacro,
  isWarehouseRedistributionDonorEligible,
  isWarehouseRedistributionExecutionTarget,
  shouldSkipRedistributionDonorVsTargetMacro,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
  warehouseContributesToRegionalAvailabilityStock,
} from "../../domain/wbWarehouseMacroRegion.js";
import { getMacroRegionByRegionKey } from "../../domain/wbRegionMacroRegion.js";

export function skuKey(nmId: number | string, techSize: string): string {
  return `${nmId}|${techSize}`;
}

export interface WbWarehouseMetrics {
  warehouseKey: string;
  warehouseNameRaw: string;
  localAvailable: number;
  forecastDailyDemand: number;
  daysOfStock: number;
  recommendedToWB: number;
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

export type RedistributionRecommendationMode = "warehouse" | "macro";

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
  targetRegionalDemand: number;
  regionalAvailableUnits: number;
  regionalDaysOfStock: number;
  targetCoverageStockUnits: number;
  regionalNeedUnits: number;
  recommendedTransferUnitsToRegion: number;
  transferScore: number;
  candidateWarehouseKeys: string[];
  candidateWarehouseLabels: string[];
  preferredWarehouseKey: string | null;
  regionMinDaysOfStockHint: number | null;
  sumRecommendedToWBInRegion: number;
  hasCandidateWarehouses: boolean;
  executionTargetCount: number;
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

export type RedistributionRow =
  | DonorMacroRegionRecommendation
  | DonorWarehouseRecommendation;

export interface WarehouseInMacroCandidate {
  warehouseKey: string;
  warehouseNameRaw: string;
  recommendedToWB: number;
  daysOfStock: number;
  localAvailable: number;
  priorityWithinMacro: number;
}

export interface RegionalDemandSnapshotRow {
  regionKey: string;
  nmId: number;
  techSize: string;
  regionalForecastDailyDemand: number;
}

export interface RedistributionMacroTraceRow {
  warehouseKey: string;
  warehouseNameRaw: string;
  matchedNetwork: string;
  selectedRegion: string;
  reasonFilteredOut: string | null;
}

export interface RedistributionDiagnostics {
  onUnknownWarehouse?: (rawKey: string, context: string) => void;
  traceMacroRow?: (row: RedistributionMacroTraceRow) => void;
}

function num(x: unknown, fallback = 0): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function parseWbWarehouseRow(raw: unknown): WbWarehouseMetrics | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row) return null;
  const wk = row.warehouseKey;
  if (typeof wk !== "string") return null;
  const warehouseKeyNorm = normalizeWarehouseName(wk);
  if (!warehouseKeyNorm) return null;
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
    warehouseKey: warehouseKeyNorm,
    warehouseNameRaw: typeof nameRaw === "string" ? nameRaw : wk,
    localAvailable: local,
    forecastDailyDemand: num(row.forecastDailyDemand, 0),
    daysOfStock: num(row.daysOfStock, 0),
    recommendedToWB: Number.isFinite(recWb) ? Math.max(0, recWb) : 0,
  };
}

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

function isVirtualWarehouseKey(warehouseKey: string): boolean {
  return normalizeWarehouseName(warehouseKey).startsWith("виртуальный ");
}

function warehouseKeyBaseForVirtualDedup(warehouseKey: string): string {
  return normalizeWarehouseName(warehouseKey).replace(/^виртуальный\s+/, "");
}

function dropVirtualWhenRealSharesBase(
  candidates: WarehouseInMacroCandidate[],
): WarehouseInMacroCandidate[] {
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

export function sortRedistributionExecutionTargets(
  executionTargets: WarehouseInMacroCandidate[],
): WarehouseInMacroCandidate[] {
  return [...executionTargets].sort(compareRedistributionExecutionTargets);
}

export function redistributionExecutionTargetDebugSortKey(
  c: WarehouseInMacroCandidate,
): string {
  return [
    c.recommendedToWB,
    c.daysOfStock,
    c.localAvailable,
    c.priorityWithinMacro,
    c.warehouseKey,
  ].join("\t");
}

function collectWarehousesInMacroRegion(
  netRows: readonly unknown[],
  donorKeyNormalized: string,
  targetMacro: string,
  diagnostics?: RedistributionDiagnostics,
): {
  availabilityContributors: WarehouseInMacroCandidate[];
  executionTargets: WarehouseInMacroCandidate[];
  macroRegionNetworkRowCount: number;
} {
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
      diagnostics?.onUnknownWarehouse?.(rawWkForLog, "macro_network_sku_row");
    }
    const wkNorm = normalizeWarehouseName(wk);
    if (wkNorm === donorKeyNormalized) {
      diagnostics?.traceMacroRow?.({
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
      diagnostics?.traceMacroRow?.({
        warehouseKey: wk,
        warehouseNameRaw: p.warehouseNameRaw,
        matchedNetwork: wm,
        selectedRegion: targetMacro,
        reasonFilteredOut: "macro_not_compatible",
      });
      continue;
    }
    macroRegionNetworkRowCount += 1;
    diagnostics?.traceMacroRow?.({
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

export function computeDonorMacroRegionRecommendations(
  donorRows: readonly unknown[],
  networkBySku: ReadonlyMap<string, readonly unknown[]>,
  donorWarehouseKey: string,
  donorReserveDays: number,
  minTransferableUnits: number,
  regionalByMacroBySku: ReadonlyMap<string, ReadonlyMap<string, number>>,
  targetCoverageDays: number,
  diagnostics?: RedistributionDiagnostics,
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
  if (!Number.isFinite(cov) || cov <= 0) return [];

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
        collectWarehousesInMacroRegion(
          netRows,
          donorKeyNormalized,
          macro,
          diagnostics,
        );
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
    if (a.regionalDaysOfStock !== b.regionalDaysOfStock) {
      return a.regionalDaysOfStock - b.regionalDaysOfStock;
    }
    if (b.targetRegionalDemand !== a.targetRegionalDemand) {
      return b.targetRegionalDemand - a.targetRegionalDemand;
    }
    if (b.transferScore !== a.transferScore) return b.transferScore - a.transferScore;
    return b.recommendedTransferUnitsToRegion - a.recommendedTransferUnitsToRegion;
  });

  out.forEach((r, i) => {
    r.priorityRank = i + 1;
  });
  return out;
}

export function computeDonorWarehouseRecommendations(
  donorRows: readonly unknown[],
  networkBySku: ReadonlyMap<string, readonly unknown[]>,
  donorWarehouseKey: string,
  donorReserveDays: number,
  minTransferableUnits: number,
  diagnostics?: RedistributionDiagnostics,
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
        diagnostics?.onUnknownWarehouse?.(rawWkForLog, "fulfillment_network_sku_row");
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
    if (b.transferScore !== a.transferScore) return b.transferScore - a.transferScore;
    if (b.targetRankingDemand !== a.targetRankingDemand) {
      return b.targetRankingDemand - a.targetRankingDemand;
    }
    if (b.targetForecastDailyDemand !== a.targetForecastDailyDemand) {
      return b.targetForecastDailyDemand - a.targetForecastDailyDemand;
    }
    if (a.targetDaysOfStock !== b.targetDaysOfStock) {
      return a.targetDaysOfStock - b.targetDaysOfStock;
    }
    if (b.targetRecommendedToWB !== a.targetRecommendedToWB) {
      return b.targetRecommendedToWB - a.targetRecommendedToWB;
    }
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
  donorRows: readonly unknown[],
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

export function buildRegionalDemandByMacroBySku(
  rows: readonly RegionalDemandSnapshotRow[],
  regionMacroMap: Record<string, string>,
): Map<string, Map<string, number>> {
  const lookup = new Map<string, string>(Object.entries(regionMacroMap));
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const k = skuKey(row.nmId, row.techSize);
    const macro = getMacroRegionByRegionKey(row.regionKey, lookup);
    let m = out.get(k);
    if (!m) {
      m = new Map();
      out.set(k, m);
    }
    const prev = m.get(macro) ?? 0;
    m.set(macro, prev + row.regionalForecastDailyDemand);
  }
  return out;
}
