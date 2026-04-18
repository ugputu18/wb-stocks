import { describe, expect, it } from "vitest";
import { computeWbRedistribution, parseWbWarehouseRow } from "../src/utils/wbRedistributionModel.js";

function wh(
  key: string,
  local: number,
  fd: number,
  days: number,
  rec: number,
): Record<string, unknown> {
  return {
    warehouseKey: key,
    warehouseNameRaw: key,
    forecastDailyDemand: fd,
    daysOfStock: days,
    inventoryLevels: { localAvailable: local },
    replenishment: { recommendedToWB: rec },
  };
}

describe("parseWbWarehouseRow", () => {
  it("parses wbWarehouses row", () => {
    const p = parseWbWarehouseRow(wh("казань", 100, 5, 20, 0));
    expect(p?.warehouseKey).toBe("казань");
    expect(p?.localAvailable).toBe(100);
    expect(p?.recommendedToWB).toBe(0);
  });

  it("returns null without warehouseKey", () => {
    expect(parseWbWarehouseRow({})).toBeNull();
  });
});

describe("computeWbRedistribution", () => {
  const rows = [
    wh("казань", 100, 5, 20, 0),
    wh("новосибирск", 10, 8, 1, 50),
    wh("краснодар", 200, 4, 30, 10),
  ];

  it("computes donor reserve and transferable", () => {
    const r = computeWbRedistribution(rows, "казань", 14);
    expect(r).not.toBeNull();
    expect(r!.donor.donorReserveUnits).toBe(5 * 14);
    expect(r!.donor.donorTransferableUnits).toBe(100 - 70);
  });

  it("sorts targets by demand desc, days asc, rec wb desc", () => {
    const r = computeWbRedistribution(rows, "казань", 14);
    expect(r!.targets.map((t) => t.targetWarehouseKey)).toEqual([
      "новосибирск",
      "краснодар",
    ]);
    expect(r!.targets[0].recommendedTransferUnits).toBe(Math.min(30, 50));
  });

  it("returns null if donor missing", () => {
    expect(computeWbRedistribution(rows, "нет_такого", 14)).toBeNull();
  });

  it("excludes targets with recommendedToWB 0", () => {
    const r = computeWbRedistribution(rows, "новосибирск", 7);
    const kzn = r!.targets.find((t) => t.targetWarehouseKey === "казань");
    expect(kzn).toBeUndefined();
  });
});
