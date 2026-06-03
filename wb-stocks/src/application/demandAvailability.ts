import type { DailyStockAvailabilityRecord } from "../infra/stockSnapshotRepository.js";

export type DailyAvailabilityLookup = Map<string, Map<string, number>>;

export function skuDemandKey(nmId: number, techSize: string): string {
  return `${nmId}\u0000${techSize}`;
}

export function buildDailyAvailabilityLookups(
  rows: readonly DailyStockAvailabilityRecord[],
): {
  bySku: DailyAvailabilityLookup;
} {
  const bySku: DailyAvailabilityLookup = new Map();

  for (const row of rows) {
    addDailyQuantity(
      bySku,
      skuDemandKey(row.nmId, row.techSize),
      row.stockDate,
      row.quantity,
    );
  }

  return { bySku };
}

function addDailyQuantity(
  lookup: DailyAvailabilityLookup,
  key: string,
  date: string,
  quantity: number,
): void {
  let byDate = lookup.get(key);
  if (!byDate) {
    byDate = new Map();
    lookup.set(key, byDate);
  }
  byDate.set(date, (byDate.get(date) ?? 0) + quantity);
}
