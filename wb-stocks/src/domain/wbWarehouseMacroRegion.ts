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
 * Сами по себе группы фиксируют **продуктовое правило**: «склад макрорегиона X
 * может покрывать спрос макрорегиона Y». Совпадение по строке уже отдаётся
 * первой веткой {@link isWarehouseMacroCompatibleWithTargetMacro}; группы из
 * одного элемента нужны, чтобы явно зафиксировать «только сам с собой» — иначе
 * соблазнительно «случайно» расширить совместимость.
 *
 * Раньше первая группа была расширенным сибирским кластером
 * `[Сибирский, Сибирский и Дальневосточный, Дальневосточный]`. После
 * объединения всех трёх лейблов в один макрорегион
 * `"Сибирский и Дальневосточный"` кластер сжался до одной строки и стал
 * структурно идентичен странам СНГ.
 *
 * Не смешивать с {@link WB_MACRO_REGION_CLUSTERS}: там `cis` — единая витрина только для аудита.
 */
export const WB_MACRO_REGION_REDISTRIBUTION_COMPATIBILITY_GROUPS: ReadonlyArray<
  readonly string[]
> = [
  ["Сибирский и Дальневосточный"],
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
    label: "Сибирский и Дальневосточный",
    macroRegions: ["Сибирский и Дальневосточный"],
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
 * совпадает с макрорегионом цели из агрегата buyer-region demand. Это и есть
 * правило «redistribution — только межрегиональный».
 *
 * Сейчас все группы совместимости — из одного элемента, поэтому «строгое
 * равенство» эквивалентно «один кластер». Раньше «строгое равенство» намеренно
 * отличалось от кластерной проверки, чтобы пропускать пары вроде донор-Новосибирск
 * (тогда «Сибирский и Дальневосточный») → цель «Сибирский»; после объединения
 * Сибирского/Дальневосточного в один лейбл такие пары стали внутрирегиональными
 * и закономерно режутся.
 */
export function shouldSkipRedistributionDonorVsTargetMacro(
  donorWarehouseMappedMacro: string,
  targetRegionalDemandMacro: string,
): boolean {
  return donorWarehouseMappedMacro === targetRegionalDemandMacro;
}
