/**
 * Явный mapping buyer `region_key` (нормализованный `regionName` из заказов WB) → макрорегион.
 * Не смешивать с `wbWarehouseMacroRegion.ts` (склад исполнения).
 *
 * Источники:
 * - константа {@link WB_REGION_KEY_MACRO_REGION} — захардкоженные пары (редко);
 * - строки из `wb_region_macro_region` (через {@link buildRegionMacroLookup}) перекрывают константу для того же ключа.
 */

import { UNMAPPED_WAREHOUSE_REGION_LABEL } from "./wbWarehouseMacroRegion.js";
import { WB_REGION_KEY_MACRO_REGION_BOOTSTRAP } from "./wbRegionKeyMacroRegionBootstrap.js";

/** Тот же fallback, что и для складов без маппинга — сопоставимо в сводках «регион vs fulfillment». */
export const UNMAPPED_REGION_MACRO_REGION = UNMAPPED_WAREHOUSE_REGION_LABEL;

/**
 * Baseline: субъекты РФ и страны (явные ключи). Переопределение: строки `wb_region_macro_region` в БД
 * поверх этих пар (см. {@link buildRegionMacroLookup}).
 */
export const WB_REGION_KEY_MACRO_REGION: Readonly<Record<string, string>> = {
  ...WB_REGION_KEY_MACRO_REGION_BOOTSTRAP,
};

/**
 * Порядок приоритета: 1) {@link WB_REGION_KEY_MACRO_REGION} (bootstrap), 2) строки из БД перекрывают ключ.
 */
export function buildRegionMacroLookup(
  dbRows: readonly { regionKey: string; macroRegion: string }[],
): Map<string, string> {
  const m = new Map<string, string>(Object.entries(WB_REGION_KEY_MACRO_REGION));
  for (const r of dbRows) {
    const key = r.regionKey.trim();
    if (!key) continue;
    m.set(key, r.macroRegion.trim());
  }
  return m;
}

export function getMacroRegionByRegionKey(
  regionKey: string,
  lookup: ReadonlyMap<string, string>,
): string {
  const k = regionKey.trim();
  if (!k) return UNMAPPED_REGION_MACRO_REGION;
  return lookup.get(k) ?? UNMAPPED_REGION_MACRO_REGION;
}
