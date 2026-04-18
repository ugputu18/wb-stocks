function rowRec(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Строка склада для панели «сеть по SKU» (read-side, без изменения прогноза). */
export interface WbWarehouseNetworkRow {
  warehouseKey: string;
  warehouseNameRaw: string;
  localAvailable: number;
  startStock: number;
  incomingUnits: number;
  /** local + incoming (как «всего на складе» для оператора) */
  totalOnWarehouse: number;
  forecastDailyDemand: number;
  daysOfStock: number;
  recommendedToWB: number;
  stockoutDate: string | null;
}

export function parseWbWarehouseNetworkRow(raw: unknown): WbWarehouseNetworkRow | null {
  const row = rowRec(raw);
  if (!row) return null;
  const warehouseKey = row.warehouseKey;
  if (typeof warehouseKey !== "string" || !warehouseKey.trim()) return null;

  const warehouseNameRaw =
    typeof row.warehouseNameRaw === "string" && row.warehouseNameRaw.trim()
      ? row.warehouseNameRaw.trim()
      : warehouseKey;

  const inv = row.inventoryLevels;
  const invObj = inv && typeof inv === "object" ? (inv as Record<string, unknown>) : null;
  const localAvailable = num(invObj?.localAvailable);

  const startStock = num(row.startStock);
  const incomingUnits = num(row.incomingUnits);

  const replen = row.replenishment;
  const replenObj = replen && typeof replen === "object" ? (replen as Record<string, unknown>) : null;
  const recommendedToWB = num(replenObj?.recommendedToWB);

  const forecastDailyDemand = num(row.forecastDailyDemand);
  const daysOfStock = num(row.daysOfStock);

  const sd = row.stockoutDate;
  const stockoutDate =
    typeof sd === "string" && sd.trim() ? sd.trim() : sd instanceof Date ? sd.toISOString().slice(0, 10) : null;

  return {
    warehouseKey: warehouseKey.trim(),
    warehouseNameRaw,
    localAvailable,
    startStock,
    incomingUnits,
    totalOnWarehouse: localAvailable + incomingUnits,
    forecastDailyDemand,
    daysOfStock,
    recommendedToWB,
    stockoutDate,
  };
}

export function parseWbWarehouseNetworkRows(rawRows: unknown[]): WbWarehouseNetworkRow[] {
  const out: WbWarehouseNetworkRow[] = [];
  for (const raw of rawRows) {
    const r = parseWbWarehouseNetworkRow(raw);
    if (r) out.push(r);
  }
  return out;
}

/** Сначала строка целевого склада из рекомендации, затем донор, остальные по названию. */
export function sortNetworkRowsForDisplay(
  rows: WbWarehouseNetworkRow[],
  donorWarehouseKey: string,
  targetWarehouseKey: string,
): WbWarehouseNetworkRow[] {
  const dk = donorWarehouseKey.trim();
  const tk = targetWarehouseKey.trim();
  const tier = (k: string) => (k === tk ? 0 : k === dk ? 1 : 2);
  return [...rows].sort((a, b) => {
    const da = tier(a.warehouseKey);
    const db = tier(b.warehouseKey);
    if (da !== db) return da - db;
    return a.warehouseNameRaw.localeCompare(b.warehouseNameRaw, "ru");
  });
}
