import { describe, it, expect } from "vitest";
import {
  normalizeWarehouseName,
  warehouseKey,
  UNKNOWN_WAREHOUSE_KEY,
} from "../src/domain/warehouseName.js";

describe("normalizeWarehouseName", () => {
  it("lowercases and trims", () => {
    expect(normalizeWarehouseName("Коледино")).toBe("коледино");
    expect(normalizeWarehouseName("  Коледино  ")).toBe("коледино");
  });

  it("collapses any internal whitespace including non-breaking space", () => {
    expect(normalizeWarehouseName("Электросталь  WB")).toBe("электросталь wb");
    expect(normalizeWarehouseName("Электросталь\u00A0WB")).toBe(
      "электросталь wb",
    );
    expect(normalizeWarehouseName("Электросталь\t\nWB")).toBe(
      "электросталь wb",
    );
  });

  it("returns empty string for null / undefined / blank", () => {
    expect(normalizeWarehouseName(null)).toBe("");
    expect(normalizeWarehouseName(undefined)).toBe("");
    expect(normalizeWarehouseName("   ")).toBe("");
  });

  it("is stable across the join — same input always same output", () => {
    const samples = ["Коледино", "коледино", "  Коледино  ", "КОЛЕДИНО"];
    const set = new Set(samples.map((s) => normalizeWarehouseName(s)));
    expect(set.size).toBe(1);
  });
});

describe("warehouseKey", () => {
  it("is the same as normalize for non-empty input", () => {
    expect(warehouseKey("Коледино")).toBe("коледино");
  });

  it("falls back to a sentinel when there is no warehouse name", () => {
    expect(warehouseKey(null)).toBe(UNKNOWN_WAREHOUSE_KEY);
    expect(warehouseKey("")).toBe(UNKNOWN_WAREHOUSE_KEY);
    expect(warehouseKey("   ")).toBe(UNKNOWN_WAREHOUSE_KEY);
  });
});
