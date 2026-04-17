import { describe, expect, it } from "vitest";
import {
  buildInventoryLevels,
  buildSupplierOrderPlan,
  buildSupplierSkuReplenishment,
  buildWbRowReplenishment,
  daysOfStockWbFromNetworkTotals,
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

describe("daysOfStockWbFromNetworkTotals", () => {
  it("divides network stock by summed demand", () => {
    expect(daysOfStockWbFromNetworkTotals(100, 10)).toBe(10);
  });

  it("when demand is zero and stock positive, returns large cover proxy", () => {
    expect(daysOfStockWbFromNetworkTotals(50, 0)).toBe(1e6);
  });

  it("when demand is zero and stock zero, returns zero", () => {
    expect(daysOfStockWbFromNetworkTotals(0, 0)).toBe(0);
  });
});

describe("buildSupplierSkuReplenishment", () => {
  it("one pooled shortfall for SKU", () => {
    const s = buildSupplierSkuReplenishment(10 + 10, 100, 0, 30);
    expect(s.targetDemandSystem).toBe(600);
    expect(s.recommendedFromSupplier).toBe(500);
  });
});

describe("buildSupplierOrderPlan", () => {
  it("recommended order covers gap after arrival vs coverage target", () => {
    const p = buildSupplierOrderPlan({
      systemDailyDemand: 10,
      wbAvailableTotal: 100,
      ownStock: 0,
      leadTimeDays: 5,
      coverageDays: 30,
      safetyDays: 0,
    });
    expect(p.stockAtArrival).toBe(50);
    expect(p.recommendedOrderQty).toBe(250);
    expect(p.willStockoutBeforeArrival).toBe(false);
    expect(p.daysUntilStockout).toBe(10);
  });

  it("flags stockout before arrival when projected stock negative", () => {
    const p = buildSupplierOrderPlan({
      systemDailyDemand: 10,
      wbAvailableTotal: 10,
      ownStock: 0,
      leadTimeDays: 5,
      coverageDays: 30,
      safetyDays: 0,
    });
    expect(p.stockAtArrival).toBe(-40);
    expect(p.willStockoutBeforeArrival).toBe(true);
    expect(p.recommendedOrderQty).toBeGreaterThan(0);
    expect(p.daysUntilStockout).toBe(1);
  });

  it("safetyDays extends required coverage days in target demand after arrival", () => {
    const withSafety = buildSupplierOrderPlan({
      systemDailyDemand: 10,
      wbAvailableTotal: 100,
      ownStock: 0,
      leadTimeDays: 5,
      coverageDays: 30,
      safetyDays: 5,
    });
    const noSafety = buildSupplierOrderPlan({
      systemDailyDemand: 10,
      wbAvailableTotal: 100,
      ownStock: 0,
      leadTimeDays: 5,
      coverageDays: 30,
      safetyDays: 0,
    });
    expect(withSafety.recommendedOrderQty).toBe(noSafety.recommendedOrderQty + 50);
  });

  it("daysUntilStockout null when no system demand", () => {
    const p = buildSupplierOrderPlan({
      systemDailyDemand: 0,
      wbAvailableTotal: 100,
      ownStock: 0,
      leadTimeDays: 5,
      coverageDays: 30,
    });
    expect(p.daysUntilStockout).toBe(null);
  });
});
