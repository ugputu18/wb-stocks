/**
 * Подписи складов с макрорегионом WB. Справочник: `wb-stocks/src/domain/wbWarehouseMacroRegion.ts`.
 */

import {
  getWarehouseMacroRegion,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
  WB_MACRO_REGION_COVERED_WAREHOUSE_KEYS,
  WB_WAREHOUSE_MACRO_REGION,
} from "../../../src/domain/wbWarehouseMacroRegion.js";

export {
  WB_WAREHOUSE_MACRO_REGION,
  WB_MACRO_REGION_COVERED_WAREHOUSE_KEYS,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
  getWarehouseMacroRegion,
};

export type WarehouseRegionDisplayMode = "suffix" | "regionOnly";

/**
 * Подпись склада: `Название · Макрорегион`. Без mapping — «Не сопоставлен».
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
 * Перераспределение: `Макрорегион (название)`. Без mapping — «Не сопоставлен (название)».
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
