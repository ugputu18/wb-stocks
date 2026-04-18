import { describe, expect, it } from "vitest";
import {
  getWarehouseMacroRegion,
  formatWarehouseWithRegion,
  formatWarehouseRegionFirst,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
  WB_WAREHOUSE_MACRO_REGION,
} from "../forecast-ui-client/src/utils/wbWarehouseRegion.js";

describe("getWarehouseMacroRegion", () => {
  it("возвращает макрорегион для известного ключа", () => {
    expect(getWarehouseMacroRegion("коледино")).toBe("Центральный");
    expect(getWarehouseMacroRegion("КОЛЕДИНО")).toBe("Центральный");
  });

  it("null для неизвестного ключа", () => {
    expect(getWarehouseMacroRegion("неизвестный-склад-xyz")).toBeNull();
  });

  it("null для пустого и unknown", () => {
    expect(getWarehouseMacroRegion("")).toBeNull();
    expect(getWarehouseMacroRegion("<unknown>")).toBeNull();
  });
});

describe("formatWarehouseWithRegion", () => {
  it("добавляет регион через ·", () => {
    expect(formatWarehouseWithRegion("Коледино", "коледино")).toBe("Коледино · Центральный");
  });

  it("показывает явный статус для неизвестного региона", () => {
    expect(formatWarehouseWithRegion("Мой склад", "нет-в-справочнике")).toBe(
      `Мой склад · ${UNMAPPED_WAREHOUSE_REGION_LABEL}`,
    );
  });
});

describe("formatWarehouseRegionFirst", () => {
  it("регион и название в скобках", () => {
    expect(formatWarehouseRegionFirst("Краснодар", "краснодар")).toBe(
      "Южный и Северо-Кавказский (Краснодар)",
    );
  });

  it("неизвестный регион — ведущий статус «Не сопоставлен»", () => {
    expect(formatWarehouseRegionFirst("Склад X", "unknown-warehouse-zzz")).toBe(
      `${UNMAPPED_WAREHOUSE_REGION_LABEL} (Склад X)`,
    );
  });
});

describe("справочник", () => {
  it("содержит ожидаемые ключи", () => {
    expect(WB_WAREHOUSE_MACRO_REGION["новосибирск"]).toBe("Сибирский и Дальневосточный");
    expect(WB_WAREHOUSE_MACRO_REGION["казань"]).toBe("Приволжский");
  });
});
