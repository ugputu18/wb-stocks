import { parseDonorWarehouseSkuRow } from "./wbRedistributionDonorModel.js";
import { parseWbWarehouseNetworkRow } from "./wbWarehouseNetworkRow.js";

/** Строка таблицы «Товары донора» (верификация read-side). */
export interface DonorSkuTableRow {
  vendorCode: string;
  nmId: number;
  techSize: string;
  localAvailable: number;
  incomingUnits: number;
  totalOnWarehouse: number;
  forecastDailyDemand: number;
  daysOfStock: number;
  donorReserveUnits: number;
  donorTransferableUnits: number;
}

/**
 * Строит отсортированный список строк для таблицы донора.
 * `donorReserveUnits` = `forecastDailyDemand × donorReserveDays`;
 * `donorTransferableUnits` = `max(0, localAvailable − donorReserveUnits)` — как в расчёте перераспределения.
 * Сортировка: `donorTransferableUnits` DESC, затем `forecastDailyDemand` DESC.
 */
export function buildDonorSkuTableRows(
  rawRows: unknown[],
  donorWarehouseKey: string,
  donorReserveDays: number,
): DonorSkuTableRow[] {
  const out: DonorSkuTableRow[] = [];
  for (const raw of rawRows) {
    const s = parseDonorWarehouseSkuRow(raw, donorWarehouseKey, donorReserveDays);
    if (!s) continue;
    const net = parseWbWarehouseNetworkRow(raw);
    const incomingUnits = net?.incomingUnits ?? 0;
    const daysOfStock = net?.daysOfStock ?? 0;
    const localAvailable = s.donorLocalAvailable;
    out.push({
      vendorCode: s.vendorCode,
      nmId: s.nmId,
      techSize: s.techSize,
      localAvailable,
      incomingUnits,
      totalOnWarehouse: localAvailable + incomingUnits,
      forecastDailyDemand: s.donorForecastDailyDemand,
      daysOfStock,
      donorReserveUnits: s.donorReserveUnits,
      donorTransferableUnits: s.donorTransferableUnits,
    });
  }
  out.sort((a, b) => {
    const dt = b.donorTransferableUnits - a.donorTransferableUnits;
    if (dt !== 0) return dt;
    return b.forecastDailyDemand - a.forecastDailyDemand;
  });
  return out;
}

export function donorSkuKey(nmId: number, techSize: string): string {
  return `${nmId}|${techSize}`;
}
