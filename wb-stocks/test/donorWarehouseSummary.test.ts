import { describe, expect, it } from "vitest";
import { computeDonorWarehouseSummary } from "../forecast-ui-client/src/utils/donorWarehouseSummary.js";

describe("computeDonorWarehouseSummary", () => {
  it("агрегирует Σ local, Σ спрос и дни покрытия по складу", () => {
    const donor = "W1";
    const rows = [
      {
        nmId: 1,
        techSize: "",
        warehouseKey: donor,
        warehouseNameRaw: "Склад А",
        forecastDailyDemand: 10,
        inventoryLevels: { localAvailable: 100 },
      },
      {
        nmId: 2,
        techSize: "M",
        warehouseKey: donor,
        warehouseNameRaw: "Склад А",
        forecastDailyDemand: 5,
        inventoryLevels: { localAvailable: 50 },
      },
    ];
    const s = computeDonorWarehouseSummary(rows, donor, 0, 1);
    expect(s).not.toBeNull();
    expect(s!.warehouseNameRaw).toBe("Склад А");
    expect(s!.totalLocalStock).toBe(150);
    expect(s!.totalForecastDailyDemand).toBe(15);
    expect(s!.aggregatedDaysOfCoverage).toBe(150 / 15);
  });

  it("при нулевом Σ спросе дни покрытия — null", () => {
    const donor = "W1";
    const rows = [
      {
        nmId: 1,
        techSize: "",
        warehouseKey: donor,
        warehouseNameRaw: "Склад А",
        forecastDailyDemand: 0,
        inventoryLevels: { localAvailable: 20 },
      },
    ];
    const s = computeDonorWarehouseSummary(rows, donor, 0, 1);
    expect(s).not.toBeNull();
    expect(s!.aggregatedDaysOfCoverage).toBeNull();
  });

  it("считает SKU с передаваемым излишком ≥ min при резерве", () => {
    const donor = "W1";
    const rows = [
      {
        nmId: 1,
        techSize: "",
        warehouseKey: donor,
        warehouseNameRaw: "Склад А",
        forecastDailyDemand: 2,
        inventoryLevels: { localAvailable: 100 },
      },
      {
        nmId: 2,
        techSize: "",
        warehouseKey: donor,
        warehouseNameRaw: "Склад А",
        forecastDailyDemand: 1,
        inventoryLevels: { localAvailable: 5 },
      },
    ];
    const s = computeDonorWarehouseSummary(rows, donor, 10, 1);
    expect(s).not.toBeNull();
    expect(s!.skuWithTransferableSurplusCount).toBe(1);
  });
});
