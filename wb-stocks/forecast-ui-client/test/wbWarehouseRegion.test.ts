import { describe, expect, it } from "vitest";
import { listLiveWarehousesForMacroRegion } from "../src/utils/wbWarehouseRegion.js";

describe("listLiveWarehousesForMacroRegion", () => {
  it("returns a non-empty list sorted by displayName (RU locale) for «Центральный»", () => {
    const list = listLiveWarehousesForMacroRegion("Центральный");
    expect(list.length).toBeGreaterThan(0);

    const names = list.map((w) => w.displayName);
    const sortedExpected = [...names].sort((a, b) => a.localeCompare(b, "ru"));
    expect(names).toEqual(sortedExpected);
  });

  it("excludes virtual warehouses (mirrors the report's warehouseContributesToRegionalAvailabilityStock filter)", () => {
    // Виртуальные склады нормализуются как «виртуальный …»; они не должны
    // попадать в справочный список ни для одного макрорегиона.
    const macros = [
      "Центральный",
      "Приволжский",
      "Уральский",
      "Сибирский и Дальневосточный",
      "Северо-Западный",
      "Южный и Северо-Кавказский",
    ];
    for (const m of macros) {
      for (const w of listLiveWarehousesForMacroRegion(m)) {
        expect(
          w.warehouseKey.startsWith("виртуальный "),
          `expected ${w.warehouseKey} (${m}) to be filtered out as virtual`,
        ).toBe(false);
      }
    }
  });

  it("keeps sorting centers (СЦ) — they DO contribute to «Доступно в регионе»", () => {
    // Продуктовое правило: СЦ остаются. Проверяем явно, чтобы кто-нибудь
    // случайно не отрезал их вместе с виртуальными.
    const acrossAllMacros = [
      "Центральный",
      "Приволжский",
      "Уральский",
      "Сибирский и Дальневосточный",
      "Северо-Западный",
      "Южный и Северо-Кавказский",
    ].flatMap((m) => listLiveWarehousesForMacroRegion(m));

    const anySc = acrossAllMacros.find((w) => w.isSortingCenter);
    expect(
      anySc,
      "expected at least one sorting center (СЦ) to be present in some macro region",
    ).toBeTruthy();
    expect(anySc?.warehouseKey.startsWith("сц ")).toBe(true);
  });

  it("returns an empty array for unknown macro region", () => {
    expect(listLiveWarehousesForMacroRegion("Неизвестный регион")).toEqual([]);
    expect(listLiveWarehousesForMacroRegion("")).toEqual([]);
    expect(listLiveWarehousesForMacroRegion("   ")).toEqual([]);
  });
});
