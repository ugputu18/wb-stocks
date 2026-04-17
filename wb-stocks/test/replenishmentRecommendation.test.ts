import { describe, expect, it } from "vitest";
import { replenishmentFromSnapshotRow } from "../src/domain/replenishmentRecommendation.js";

describe("replenishmentFromSnapshotRow", () => {
  it("returns 0 when projected covers target demand", () => {
    const r = replenishmentFromSnapshotRow(2, 100, 50, 30);
    expect(r.targetDemand).toBe(60);
    expect(r.projectedAvailable).toBe(150);
    expect(r.recommendedSupplyUnits).toBe(0);
  });

  it("ceil positive gap", () => {
    const r = replenishmentFromSnapshotRow(10, 5, 0, 30);
    expect(r.targetDemand).toBe(300);
    expect(r.projectedAvailable).toBe(5);
    expect(r.recommendedSupplyUnits).toBe(295);
  });

  it("fractional demand", () => {
    const r = replenishmentFromSnapshotRow(1.2, 0, 0, 30);
    expect(r.recommendedSupplyUnits).toBe(36);
  });
});
