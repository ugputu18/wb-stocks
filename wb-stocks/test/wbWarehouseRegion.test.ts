import { describe, expect, it } from "vitest";
import {
  getWarehouseMacroRegion,
  formatWarehouseWithRegion,
  formatWarehouseRegionFirst,
  isWarehouseMacroCompatibleWithTargetMacro,
  shouldSkipRedistributionDonorVsTargetMacro,
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

describe("isWarehouseMacroCompatibleWithTargetMacro", () => {
  it("совпадение строки", () => {
    expect(isWarehouseMacroCompatibleWithTargetMacro("Сибирский", "Сибирский")).toBe(true);
  });

  it("Сибирский ↔ Сибирский и Дальневосточный (кластер)", () => {
    expect(
      isWarehouseMacroCompatibleWithTargetMacro(
        "Сибирский и Дальневосточный",
        "Сибирский",
      ),
    ).toBe(true);
    expect(
      isWarehouseMacroCompatibleWithTargetMacro("Сибирский", "Сибирский и Дальневосточный"),
    ).toBe(true);
  });

  it("Дальневосточный в том же кластере", () => {
    expect(
      isWarehouseMacroCompatibleWithTargetMacro("Сибирский и Дальневосточный", "Дальневосточный"),
    ).toBe(true);
  });

  it("разные кластеры — false", () => {
    expect(isWarehouseMacroCompatibleWithTargetMacro("Приволжский", "Сибирский")).toBe(false);
  });

  it("не сопоставлен — false", () => {
    expect(
      isWarehouseMacroCompatibleWithTargetMacro(UNMAPPED_WAREHOUSE_REGION_LABEL, "Сибирский"),
    ).toBe(false);
  });

  it("страны СНГ не совместимы между собой (только сам с собой)", () => {
    expect(isWarehouseMacroCompatibleWithTargetMacro("Казахстан", "Беларусь")).toBe(false);
    expect(isWarehouseMacroCompatibleWithTargetMacro("Беларусь", "Казахстан")).toBe(false);
    expect(isWarehouseMacroCompatibleWithTargetMacro("Армения", "Узбекистан")).toBe(false);
    expect(isWarehouseMacroCompatibleWithTargetMacro("Киргизия", "Казахстан")).toBe(false);
    expect(isWarehouseMacroCompatibleWithTargetMacro("Узбекистан", "Таджикистан")).toBe(false);
    expect(isWarehouseMacroCompatibleWithTargetMacro("Таджикистан", "Армения")).toBe(false);
  });

  it("страна СНГ совместима сама с собой", () => {
    expect(isWarehouseMacroCompatibleWithTargetMacro("Казахстан", "Казахстан")).toBe(true);
    expect(isWarehouseMacroCompatibleWithTargetMacro("Таджикистан", "Таджикистан")).toBe(true);
  });
});

describe("shouldSkipRedistributionDonorVsTargetMacro", () => {
  it("пропуск только при строгом совпадении макрорегионов", () => {
    expect(shouldSkipRedistributionDonorVsTargetMacro("Приволжский", "Приволжский")).toBe(true);
    expect(shouldSkipRedistributionDonorVsTargetMacro("Сибирский и Дальневосточный", "Сибирский")).toBe(
      false,
    );
  });
});
