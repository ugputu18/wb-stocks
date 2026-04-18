import { describe, expect, it } from "vitest";
import {
  UNKNOWN_WB_REGION_KEY,
  normalizeWbRegionName,
  wbRegionKey,
} from "../src/domain/wbRegionKey.js";

describe("normalizeWbRegionName", () => {
  it("trims, lowercases, collapses whitespace", () => {
    expect(normalizeWbRegionName("  Москва  ")).toBe("москва");
    expect(normalizeWbRegionName("Новосибирская\nобласть")).toBe("новосибирская область");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalizeWbRegionName(null)).toBe("");
    expect(normalizeWbRegionName(undefined)).toBe("");
  });
});

describe("wbRegionKey", () => {
  it("uses UNKNOWN key for empty normalized name", () => {
    expect(wbRegionKey(null)).toBe(UNKNOWN_WB_REGION_KEY);
    expect(wbRegionKey("   ")).toBe(UNKNOWN_WB_REGION_KEY);
  });

  it("returns normalized key for non-empty region", () => {
    expect(wbRegionKey("Сибирский ФО")).toBe("сибирский фо");
  });
});
