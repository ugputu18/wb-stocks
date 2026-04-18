/**
 * Ключ региона заказа из WB (`regionName` в supplier orders).
 * Не смешивать с макрорегионом склада / кластером логистики.
 */

/** Заказы без `regionName` — отдельный ключ агрегата. */
export const UNKNOWN_WB_REGION_KEY = "<no-region>";

/**
 * Нормализация сырого `regionName` для отображения и сравнения (не ключ БД).
 */
export function normalizeWbRegionName(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

/**
 * Ключ региона для `wb_orders_daily_by_region` / `wb_region_demand_snapshots`.
 * Пустой нормализованный регион → {@link UNKNOWN_WB_REGION_KEY}.
 */
export function wbRegionKey(raw: string | null | undefined): string {
  const n = normalizeWbRegionName(raw);
  return n === "" ? UNKNOWN_WB_REGION_KEY : n;
}
