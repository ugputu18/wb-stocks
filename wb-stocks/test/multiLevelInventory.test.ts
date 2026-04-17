import { describe, expect, it } from "vitest";
import {
  buildInventoryLevels,
  buildSupplierSkuReplenishment,
  buildWbRowReplenishment,
} from "../src/domain/multiLevelInventory.js";

describe("buildInventoryLevels", () => {
  it("system risk when nothing anywhere", () => {
    const l = buildInventoryLevels(0, 0, 0);
    expect(l.systemRisk).toBe(true);
    expect(l.wbRisk).toBe(true);
    expect(l.localRisk).toBe(true);
    expect(l.regionalDeficit).toBe(false);
  });

  it("regional deficit: empty local but WB has stock", () => {
    const l = buildInventoryLevels(0, 50, 0);
    expect(l.regionalDeficit).toBe(true);
    expect(l.systemRisk).toBe(false);
  });
});

describe("buildWbRowReplenishment", () => {
  it("uses network WB total vs this row demand", () => {
    const d = buildWbRowReplenishment(10, 30, 100);
    expect(d.recommendedToWB).toBe(200);
  });
});

describe("buildSupplierSkuReplenishment", () => {
  it("one pooled shortfall for SKU", () => {
    const s = buildSupplierSkuReplenishment(10 + 10, 100, 0, 30);
    expect(s.targetDemandSystem).toBe(600);
    expect(s.recommendedFromSupplier).toBe(500);
  });
});
