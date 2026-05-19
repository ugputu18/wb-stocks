/**
 * Browser facade for the shared redistribution model.
 *
 * The business calculation lives in `src/application/redistribution`; this
 * module keeps client-only diagnostics (unknown warehouse warning counters and
 * localStorage-driven macro tracing) without duplicating the calculation.
 */

import { normalizeWarehouseName } from "../../../src/domain/warehouseName.js";
import { getWarehouseRegistryEntry } from "./wbWarehouseRegion.js";
import {
  bumpUnknownWarehouseUsage,
  getUnknownWarehouseUsageStats,
  resetUnknownWarehouseUsageStats,
} from "./wbRedistributionUnknownWarehouses.js";
import {
  computeDonorMacroRegionRecommendations as computeDonorMacroRegionRecommendationsPure,
  computeDonorWarehouseRecommendations as computeDonorWarehouseRecommendationsPure,
  type RedistributionDiagnostics,
  type RedistributionMacroTraceRow,
} from "../../../src/application/redistribution/redistributionModel.js";

export {
  buildRegionalDemandByMacroBySku,
  compareRedistributionExecutionTargets,
  parseDonorWarehouseSkuRow,
  parseWbWarehouseRow,
  pickTopSurplusSkus,
  redistributionExecutionTargetDebugSortKey,
  skuKey,
  sortRedistributionExecutionTargets,
} from "../../../src/application/redistribution/redistributionModel.js";
export type {
  DonorMacroRegionRecommendation,
  DonorSkuSurplus,
  DonorWarehouseRecommendation,
  RankingMode,
  RedistributionRecommendationMode,
  RedistributionRow,
  WarehouseInMacroCandidate,
} from "../../../src/application/redistribution/redistributionModel.js";
export { getUnknownWarehouseUsageStats, resetUnknownWarehouseUsageStats };

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
export function redistributionMacroTraceFilterFromGetItemResult(
  raw: string | null,
): RedistributionMacroTraceFilter {
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
  row: RedistributionMacroTraceRow,
): void {
  if (!shouldTraceRedistributionMacroRow(row.warehouseKey, row.warehouseNameRaw, filter)) {
    return;
  }
  console.debug("[wbRedistMacroTrace]", {
    wbTarget: row.warehouseNameRaw,
    normalizedTarget: normalizeWarehouseName(row.warehouseKey),
    matchedWarehouse: row.warehouseKey,
    matchedNetwork: row.matchedNetwork,
    selectedRegion: row.selectedRegion,
    reasonFilteredOut: row.reasonFilteredOut,
  });
}

function browserDiagnostics(): RedistributionDiagnostics {
  const traceFilter = readRedistributionMacroTraceFilterFromLocalStorage();
  return {
    onUnknownWarehouse: logRedistributionUnknownWarehouse,
    traceMacroRow: (row) => traceRedistributionMacroRow(traceFilter, row),
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
) {
  return computeDonorMacroRegionRecommendationsPure(
    donorRows,
    networkBySku,
    donorWarehouseKey,
    donorReserveDays,
    minTransferableUnits,
    regionalByMacroBySku,
    targetCoverageDays,
    browserDiagnostics(),
  );
}

export function computeDonorWarehouseRecommendations(
  donorRows: readonly unknown[],
  networkBySku: ReadonlyMap<string, readonly unknown[]>,
  donorWarehouseKey: string,
  donorReserveDays: number,
  minTransferableUnits: number,
) {
  return computeDonorWarehouseRecommendationsPure(
    donorRows,
    networkBySku,
    donorWarehouseKey,
    donorReserveDays,
    minTransferableUnits,
    browserDiagnostics(),
  );
}
