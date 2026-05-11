/**
 * Подписи складов с регионом WB (логистический кластер). Справочник: `wb-stocks/src/domain/wbWarehouseMacroRegion.ts`.
 */

import {
  getWarehouseMacroRegion,
  getWarehouseRegistryEntry,
  isWarehouseMacroCompatibleWithTargetMacro,
  isWarehouseRedistributionDonorEligible,
  isWarehouseRedistributionExecutionTarget,
  passesRegisteredWarehouseExecutionHardFilters,
  shouldSkipRedistributionDonorVsTargetMacro,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
  warehouseContributesToRegionalAvailabilityStock,
  WB_MACRO_REGION_COVERED_WAREHOUSE_KEYS,
  WB_MACRO_REGION_REDISTRIBUTION_COMPATIBILITY_GROUPS,
  WB_WAREHOUSE_MACRO_REGION,
  WB_WAREHOUSE_REGISTRY,
} from "../../../src/domain/wbWarehouseMacroRegion.js";

export {
  WB_WAREHOUSE_MACRO_REGION,
  WB_WAREHOUSE_REGISTRY,
  WB_MACRO_REGION_COVERED_WAREHOUSE_KEYS,
  WB_MACRO_REGION_REDISTRIBUTION_COMPATIBILITY_GROUPS,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
  getWarehouseMacroRegion,
  getWarehouseRegistryEntry,
  isWarehouseMacroCompatibleWithTargetMacro,
  isWarehouseRedistributionDonorEligible,
  isWarehouseRedistributionExecutionTarget,
  passesRegisteredWarehouseExecutionHardFilters,
  shouldSkipRedistributionDonorVsTargetMacro,
  warehouseContributesToRegionalAvailabilityStock,
};
export type {
  RedistributionTargetPickMode,
  WbWarehouseCountryCode,
  WbWarehouseRegistryEntry,
} from "../../../src/domain/wbWarehouseMacroRegion.js";

export type WarehouseRegionDisplayMode = "suffix" | "regionOnly";

/**
 * Подпись склада: `Название · Регион`. Без mapping — «Не сопоставлен».
 */
export function formatWarehouseWithRegion(
  warehouseNameRaw: string | null | undefined,
  warehouseKey: string | null | undefined,
  mode: WarehouseRegionDisplayMode = "suffix",
): string {
  const name = (warehouseNameRaw?.trim() || warehouseKey?.trim() || "").trim();
  const displayName = name || "—";
  const region = getWarehouseMacroRegion(warehouseKey);
  const regionShown = region ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
  if (mode === "regionOnly") return regionShown;
  return `${displayName} · ${regionShown}`;
}

/**
 * Перераспределение: `Регион (название)`. Без mapping — «Не сопоставлен (название)».
 */
export function formatWarehouseRegionFirst(
  warehouseNameRaw: string | null | undefined,
  warehouseKey: string | null | undefined,
): string {
  const name = (warehouseNameRaw?.trim() || warehouseKey?.trim() || "").trim() || "—";
  const region = getWarehouseMacroRegion(warehouseKey);
  const regionShown = region ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
  return `${regionShown} (${name})`;
}

export interface MacroRegionWarehouseInfo {
  warehouseKey: string;
  displayName: string;
  isSortingCenter: boolean;
}

/**
 * Склады, которые относятся к данному макрорегиону и реально участвуют
 * в агрегации «Доступно в регионе» на странице «Запасы WB по региону».
 *
 * Фильтр совпадает с `warehouseContributesToRegionalAvailabilityStock`
 * в `wb-stocks/src/domain/wbWarehouseRegistry.ts`: исключаются виртуальные
 * склады, СЦ остаются (их остаток учитывается отчётом наравне с обычными
 * FBO-складами). Сортировка по `displayName` в русской локали.
 *
 * Возвращаемое значение умышленно компактно — это справочный список под
 * селектором региона, а не полный snapshot из реестра.
 */
export function listLiveWarehousesForMacroRegion(
  macroRegion: string,
): MacroRegionWarehouseInfo[] {
  const target = macroRegion.trim();
  if (!target) return [];
  const out: MacroRegionWarehouseInfo[] = [];
  for (const entry of Object.values(WB_WAREHOUSE_REGISTRY)) {
    if (entry.macroRegion !== target) continue;
    if (entry.isVirtual) continue;
    out.push({
      warehouseKey: entry.warehouseKey,
      displayName: entry.displayName,
      isSortingCenter: entry.isSortingCenter,
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
  return out;
}
