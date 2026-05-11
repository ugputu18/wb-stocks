import { describe, expect, it } from "vitest";
import {
  buildRegionMacroLookup,
  getMacroRegionByRegionKey,
  WB_REGION_KEY_MACRO_REGION,
} from "../src/domain/wbRegionMacroRegion.js";

describe("wbRegionMacroRegion bootstrap", () => {
  it("maps major buyer region_key without DB (user-reported unmapped list)", () => {
    const lookup = buildRegionMacroLookup([]);
    const cases: [string, string][] = [
      ["московская область", "Центральный"],
      ["москва", "Центральный"],
      ["краснодарский край", "Южный и Северо-Кавказский"],
      ["ростовская область", "Южный и Северо-Кавказский"],
      ["республика крым", "Южный и Северо-Кавказский"],
      ["санкт-петербург", "Северо-Западный"],
      ["свердловская область", "Уральский"],
      ["ставропольский край", "Южный и Северо-Кавказский"],
      ["нижегородская область", "Приволжский"],
      ["республика дагестан", "Южный и Северо-Кавказский"],
      ["челябинская область", "Уральский"],
      ["республика татарстан", "Приволжский"],
      ["самарская область", "Приволжский"],
      ["иркутская область", "Сибирский и Дальневосточный"],
      ["тульская область", "Центральный"],
      ["новосибирская область", "Сибирский и Дальневосточный"],
      ["приморский край", "Сибирский и Дальневосточный"],
      ["ленинградская область", "Северо-Западный"],
    ];
    for (const [key, macro] of cases) {
      expect(getMacroRegionByRegionKey(key, lookup)).toBe(macro);
    }
  });

  it("maps CIS buyer regions to country labels aligned with warehouse macro regions", () => {
    const lookup = buildRegionMacroLookup([]);
    expect(getMacroRegionByRegionKey("минск", lookup)).toBe("Беларусь");
    expect(getMacroRegionByRegionKey("алматы", lookup)).toBe("Казахстан");
    expect(getMacroRegionByRegionKey("ханты-мансийский автономный округ", lookup)).toBe("Уральский");
    expect(getMacroRegionByRegionKey("федеральная территория сириус", lookup)).toBe(
      "Южный и Северо-Кавказский",
    );
  });

  it("DB row overrides bootstrap for same region_key", () => {
    const lookup = buildRegionMacroLookup([
      { regionKey: "москва", macroRegion: "Приволжский" },
    ]);
    expect(getMacroRegionByRegionKey("москва", lookup)).toBe("Приволжский");
    expect(WB_REGION_KEY_MACRO_REGION["москва"]).toBe("Центральный");
  });
});
