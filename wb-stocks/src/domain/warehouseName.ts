/**
 * Single source of truth for "склад X" identity across the module.
 *
 * WB returns warehouse names with inconsistent capitalisation, stray spaces
 * and occasional non-breaking spaces (`\u00A0`). Three pipelines (orders,
 * stocks, supplies) must agree on what counts as "the same warehouse",
 * otherwise the join in demand/forecast snapshots silently drops or
 * duplicates rows. Always pipe a name through `normalizeWarehouseName`
 * before using it as a join key.
 *
 * The original raw value should still be stored alongside the normalized
 * one in the snapshot tables for debugging / human-friendly display.
 */
export function normalizeWarehouseName(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

/**
 * Marker used in PK columns when there is genuinely no warehouse attached
 * (e.g. WB stub rows). Kept out of `normalizeWarehouseName` so empty input
 * stays distinguishable from a real warehouse named "".
 */
export const UNKNOWN_WAREHOUSE_KEY = "<unknown>";

export function warehouseKey(raw: string | null | undefined): string {
  const n = normalizeWarehouseName(raw);
  return n === "" ? UNKNOWN_WAREHOUSE_KEY : n;
}
