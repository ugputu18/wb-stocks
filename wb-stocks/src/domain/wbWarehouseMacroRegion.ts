/**
 * Макрорегионы WB и правила совместимости для regional redistribution.
 *
 * Канонический справочник складов (исполнение + агрегация): {@link ./wbWarehouseRegistry.js}.
 * Сырой маппинг ключ → макро: {@link ./wbWarehouseMacroRegionData.js}.
 *
 * Кластеры:
 * - {@link WB_MACRO_REGION_CLUSTERS} — группировка для аудита/сводок (в т.ч. `cis`: страны СНГ в одной витрине).
 * - {@link WB_MACRO_REGION_REDISTRIBUTION_COMPATIBILITY_GROUPS} — только для regional redistribution:
 *   один расширенный сибирский кластер; страны СНГ — по одному макрорегиону в группе (только сам с собой;
 *   перекрёстная совместимость Казахстан ↔ Беларусь и т.п. отсутствует).
 */

import { normalizeWarehouseName } from "./warehouseName.js";
import { getWarehouseRegistryEntry } from "./wbWarehouseRegistry.js";

export const UNMAPPED_WAREHOUSE_REGION_LABEL = "Не сопоставлен";

export {
  WB_WAREHOUSE_REGISTRY,
  WB_WAREHOUSE_MACRO_REGION,
  WB_MACRO_REGION_COVERED_WAREHOUSE_KEYS,
  getWarehouseRegistryEntry,
  isWarehouseRedistributionDonorEligible,
  isWarehouseRedistributionExecutionTarget,
  passesRegisteredWarehouseExecutionHardFilters,
  warehouseContributesToRegionalAvailabilityStock,
  type RedistributionTargetPickMode,
  type WbWarehouseRegistryEntry,
  type WbWarehouseCountryCode,
} from "./wbWarehouseRegistry.js";

export function getWarehouseMacroRegion(warehouseKey: string | null | undefined): string | null {
  const k = normalizeWarehouseName(warehouseKey ?? "");
  if (k === "" || k === "<unknown>") return null;
  return getWarehouseRegistryEntry(warehouseKey)?.macroRegion ?? null;
}

/**
 * Группы макрорегионов для подбора candidate warehouses в regional redistribution.
 *
 * - Сибирский кластер: три макрорегиона считаются взаимно совместимыми (склад «новосибирск» и цель «Сибирский»).
 * - Страны СНГ: по одному элементу в группе — совместимость только с той же строкой макрорегиона
 *   (перекрёстно Казахстан ↔ Беларусь и т.д. не проходит; совпадение обрабатывается и так первой веткой
 *   в {@link isWarehouseMacroCompatibleWithTargetMacro}, одиночные группы фиксируют продуктовое правило).
 *
 * Не смешивать с {@link WB_MACRO_REGION_CLUSTERS}: там `cis` — единая витрина только для аудита.
 */
export const WB_MACRO_REGION_REDISTRIBUTION_COMPATIBILITY_GROUPS: ReadonlyArray<
  readonly string[]
> = [
  ["Сибирский", "Сибирский и Дальневосточный", "Дальневосточный"],
  ["Беларусь"],
  ["Казахстан"],
  ["Армения"],
  ["Киргизия"],
  ["Узбекистан"],
  ["Таджикистан"],
];

/** Группировка макрорегионов для сводок «кластер WB» в аудите. */
export const WB_MACRO_REGION_CLUSTERS: ReadonlyArray<{
  id: string;
  label: string;
  macroRegions: readonly string[];
}> = [
  {
    id: "siberia_far_east",
    label: "Сибирь, ДВ и хаб Новосибирск",
    macroRegions: ["Сибирский", "Сибирский и Дальневосточный", "Дальневосточный"],
  },
  { id: "northwest", label: "Северо-Западный", macroRegions: ["Северо-Западный"] },
  { id: "volga", label: "Приволжский", macroRegions: ["Приволжский"] },
  { id: "ural", label: "Уральский", macroRegions: ["Уральский"] },
  { id: "central", label: "Центральный", macroRegions: ["Центральный"] },
  {
    id: "south",
    label: "Южный и Северо-Кавказский",
    macroRegions: ["Южный и Северо-Кавказский"],
  },
  {
    id: "cis",
    label: "Соседние страны",
    macroRegions: ["Беларусь", "Казахстан", "Армения", "Киргизия", "Узбекистан", "Таджикистан"],
  },
];

/**
 * Региональное перераспределение: склад относится к целевому макрорегиону строки,
 * если маппинг совпадает с целью или оба входят в одну группу
 * {@link WB_MACRO_REGION_REDISTRIBUTION_COMPATIBILITY_GROUPS}.
 */
export function isWarehouseMacroCompatibleWithTargetMacro(
  warehouseMappedMacro: string,
  targetMacroRegion: string,
): boolean {
  if (warehouseMappedMacro === targetMacroRegion) return true;
  if (
    warehouseMappedMacro === UNMAPPED_WAREHOUSE_REGION_LABEL ||
    targetMacroRegion === UNMAPPED_WAREHOUSE_REGION_LABEL
  ) {
    return false;
  }
  for (const group of WB_MACRO_REGION_REDISTRIBUTION_COMPATIBILITY_GROUPS) {
    if (group.includes(warehouseMappedMacro) && group.includes(targetMacroRegion)) {
      return true;
    }
  }
  return false;
}

/**
 * Не предлагать пару донор → цель в regional ranking, если макрорегион склада-донора
 * совпадает с макрорегионом цели из агрегата buyer-region demand.
 *
 * Только строгое равенство: skip по «кластеру Сибири» отключён намеренно, чтобы не резать
 * сценарии вроде донор Новосибирск («Сибирский и Дальневосточный») → цель «Сибирский».
 */
export function shouldSkipRedistributionDonorVsTargetMacro(
  donorWarehouseMappedMacro: string,
  targetRegionalDemandMacro: string,
): boolean {
  return donorWarehouseMappedMacro === targetRegionalDemandMacro;
}
