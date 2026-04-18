import { parseDonorWarehouseSkuRow } from "./wbRedistributionDonorModel.js";

export interface DonorWarehouseSummary {
  warehouseKey: string;
  warehouseNameRaw: string;
  /** Σ localAvailable по строкам склада */
  totalLocalStock: number;
  /** Σ forecastDailyDemand по строкам склада */
  totalForecastDailyDemand: number;
  /**
   * Оценка «дней покрытия» по складу в целом: Σ local / Σ спрос.
   * Не совпадает с min/max daysOfStock по SKU — только для быстрой верификации.
   */
  aggregatedDaysOfCoverage: number | null;
  /** Число SKU (строк), где transferable ≥ min при текущем резерве */
  skuWithTransferableSurplusCount: number;
  /** Число строк (SKU×размер) в ответе */
  lineCount: number;
}

function rowName(raw: unknown): string {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const n = row?.warehouseNameRaw;
  return typeof n === "string" && n.trim() ? n.trim() : "";
}

/**
 * Сводка по донору из `rows` ответа `GET /api/forecast/rows` с `warehouseKey=donor`.
 */
export function computeDonorWarehouseSummary(
  rows: unknown[],
  donorWarehouseKey: string,
  donorReserveDays: number,
  minTransferable: number,
): DonorWarehouseSummary | null {
  const key = donorWarehouseKey.trim();
  if (!key) return null;

  let warehouseNameRaw = key;
  let totalLocalStock = 0;
  let totalForecastDailyDemand = 0;
  let skuWithTransferableSurplusCount = 0;

  for (const raw of rows) {
    const s = parseDonorWarehouseSkuRow(raw, key, donorReserveDays);
    if (!s) continue;
    totalLocalStock += s.donorLocalAvailable;
    totalForecastDailyDemand += s.donorForecastDailyDemand;
    if (s.donorTransferableUnits >= minTransferable) {
      skuWithTransferableSurplusCount += 1;
    }
  }

  if (rows.length > 0) {
    const n0 = rowName(rows[0]);
    if (n0) warehouseNameRaw = n0;
  }

  const aggregatedDaysOfCoverage =
    totalForecastDailyDemand > 0 ? totalLocalStock / totalForecastDailyDemand : null;

  return {
    warehouseKey: key,
    warehouseNameRaw,
    totalLocalStock,
    totalForecastDailyDemand,
    aggregatedDaysOfCoverage,
    skuWithTransferableSurplusCount,
    lineCount: rows.length,
  };
}
