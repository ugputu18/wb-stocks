import { describe, it, expect } from "vitest";
import { buildWarehouseRegionAudit } from "../src/application/warehouseRegionAudit.js";
import { getWarehouseMacroRegion } from "../src/domain/wbWarehouseMacroRegion.js";

describe("buildWarehouseRegionAudit", () => {
  it("splits mapped vs unmapped and sorts unmapped by forecast", () => {
    const audit = buildWarehouseRegionAudit("2026-04-01", 30, [
      {
        warehouseKey: "коледино",
        warehouseNameRaw: "Коледино",
        rowCount: 10,
        sumForecastDailyDemand: 5,
        sumStartStock: 100,
        sumIncomingUnits: 0,
      },
      {
        warehouseKey: "неизвестный склад xyz",
        warehouseNameRaw: "X",
        rowCount: 2,
        sumForecastDailyDemand: 20,
        sumStartStock: 1,
        sumIncomingUnits: 0,
      },
      {
        warehouseKey: "мало спроса",
        warehouseNameRaw: "Y",
        rowCount: 1,
        sumForecastDailyDemand: 0.1,
        sumStartStock: 0,
        sumIncomingUnits: 0,
      },
    ]);
    expect(audit.totals.unmappedWarehouseCount).toBe(2);
    expect(audit.unmappedSortedByForecast[0]!.warehouseKey).toBe("неизвестный склад xyz");
    expect(audit.unmappedSortedByForecast[1]!.warehouseKey).toBe("мало спроса");
  });
});

describe("wbWarehouseMacroRegion new keys", () => {
  it("maps virtual and SC warehouses", () => {
    expect(getWarehouseMacroRegion("сц барнаул")).toBe("Сибирский");
    expect(getWarehouseMacroRegion("виртуальный новосибирск")).toBe(
      "Сибирский и Дальневосточный",
    );
    expect(getWarehouseMacroRegion("спб шушары")).toBe("Северо-Западный");
    expect(getWarehouseMacroRegion("самара (новосемейкино)")).toBe("Приволжский");
    expect(getWarehouseMacroRegion("екатеринбург - перспективная 14")).toBe("Уральский");
  });
});
