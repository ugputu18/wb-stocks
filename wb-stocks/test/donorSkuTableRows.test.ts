import { describe, expect, it } from "vitest";
import { buildDonorSkuTableRows } from "../forecast-ui-client/src/utils/donorSkuTableRows.js";

function donorRow(
  nmId: number,
  techSize: string,
  local: number,
  incoming: number,
  fd: number,
  days: number,
  warehouseKey: string,
): Record<string, unknown> {
  return {
    nmId,
    techSize,
    vendorCode: `V${nmId}`,
    warehouseKey,
    warehouseNameRaw: "Донор",
    forecastDailyDemand: fd,
    daysOfStock: days,
    startStock: local,
    incomingUnits: incoming,
    inventoryLevels: { localAvailable: local },
    replenishment: { recommendedToWB: 0 },
  };
}

describe("buildDonorSkuTableRows", () => {
  it("сортирует по donorTransferableUnits DESC, затем forecastDailyDemand DESC", () => {
    const dk = "W1";
    const raw = [
      donorRow(1, "", 10, 0, 2, 5, dk),
      donorRow(2, "M", 100, 0, 1, 10, dk),
      donorRow(3, "", 50, 10, 2, 3, dk),
    ];
    const rows = buildDonorSkuTableRows(raw, dk, 0);
    expect(rows.map((r) => r.nmId)).toEqual([2, 3, 1]);
  });

  it("считает totalOnWarehouse и резерв", () => {
    const dk = "W1";
    const raw = [donorRow(1, "", 30, 5, 2, 4, dk)];
    const rows = buildDonorSkuTableRows(raw, dk, 10);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.totalOnWarehouse).toBe(35);
    expect(row.donorReserveUnits).toBe(20);
    expect(row.donorTransferableUnits).toBe(10);
  });
});
