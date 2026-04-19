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

  it("maps WB target / UI warehouse keys added for coverage", () => {
    expect(getWarehouseMacroRegion("санкт-петербург уткина заводь")).toBe("Северо-Западный");
    expect(getWarehouseMacroRegion("сц шушары")).toBe("Северо-Западный");
    expect(getWarehouseMacroRegion("екатеринбург - испытателей 14г")).toBe("Уральский");
    expect(getWarehouseMacroRegion("виртуальный челябинск")).toBe("Уральский");
    expect(getWarehouseMacroRegion("новосемейкино")).toBe("Приволжский");
    expect(getWarehouseMacroRegion("сарапул")).toBe("Приволжский");
    expect(getWarehouseMacroRegion("виртуальный уфа")).toBe("Приволжский");
    expect(getWarehouseMacroRegion("воронеж")).toBe("Центральный");
    expect(getWarehouseMacroRegion("истра")).toBe("Центральный");
    expect(getWarehouseMacroRegion("виртуальный владикавказ")).toBe("Южный и Северо-Кавказский");
    expect(getWarehouseMacroRegion("виртуальный краснодар")).toBe("Южный и Северо-Кавказский");
    expect(getWarehouseMacroRegion("виртуальный крым")).toBe("Южный и Северо-Кавказский");
    expect(getWarehouseMacroRegion("виртуальный махачкала")).toBe("Южный и Северо-Кавказский");
    expect(getWarehouseMacroRegion("актобе")).toBe("Казахстан");
    expect(getWarehouseMacroRegion("астана карагандинское шоссе")).toBe("Казахстан");
    expect(getWarehouseMacroRegion("атакент")).toBe("Казахстан");
    expect(getWarehouseMacroRegion("ск ереван")).toBe("Армения");
    expect(getWarehouseMacroRegion("ташкент 2")).toBe("Узбекистан");
  });

  it("normalizes case like other keys", () => {
    expect(getWarehouseMacroRegion("СК Ереван")).toBe("Армения");
    expect(getWarehouseMacroRegion("Атакент")).toBe("Казахстан");
  });
});
