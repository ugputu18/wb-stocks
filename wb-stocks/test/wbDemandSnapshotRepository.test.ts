import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbDemandSnapshotRepository } from "../src/infra/wbDemandSnapshotRepository.js";
import type { WbDemandSnapshotRecord } from "../src/domain/wbDemandSnapshot.js";

function rec(overrides: Partial<WbDemandSnapshotRecord> = {}): WbDemandSnapshotRecord {
  return {
    snapshotDate: "2026-04-17",
    warehouseNameRaw: "Коледино",
    warehouseKey: "коледино",
    nmId: 100,
    techSize: "0",
    vendorCode: "SKU-1",
    barcode: "111",
    units7: 14,
    units30: 30,
    units90: 90,
    avgDaily7: 2,
    avgDaily30: 1,
    avgDaily90: 1,
    baseDailyDemand: 1.6,
    trendRatio: 2,
    trendRatioClamped: 1.25,
    forecastDailyDemand: 2,
    computedAt: "2026-04-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("WbDemandSnapshotRepository", () => {
  let repo: WbDemandSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new WbDemandSnapshotRepository(db);
  });

  it("replaceForDate inserts when empty", () => {
    const r = repo.replaceForDate("2026-04-17", [rec(), rec({ nmId: 101 })]);
    expect(r.deleted).toBe(0);
    expect(r.inserted).toBe(2);
    expect(repo.countForDate("2026-04-17")).toBe(2);
  });

  it("replaceForDate fully overwrites the slice on re-run (idempotent)", () => {
    repo.replaceForDate("2026-04-17", [
      rec({ nmId: 100 }),
      rec({ nmId: 101 }),
      rec({ nmId: 102 }),
    ]);
    const r = repo.replaceForDate("2026-04-17", [rec({ nmId: 100, units7: 99 })]);
    expect(r.deleted).toBe(3);
    expect(r.inserted).toBe(1);
    const out = repo.getForDate("2026-04-17");
    expect(out).toHaveLength(1);
    expect(out[0]!.units7).toBe(99);
  });

  it("never touches other snapshot dates", () => {
    repo.replaceForDate("2026-04-16", [rec({ snapshotDate: "2026-04-16" })]);
    repo.replaceForDate("2026-04-17", [rec({ snapshotDate: "2026-04-17" })]);
    repo.replaceForDate("2026-04-17", []);
    expect(repo.countForDate("2026-04-16")).toBe(1);
    expect(repo.countForDate("2026-04-17")).toBe(0);
  });

  it("PK is (date, warehouseKey, nmId, techSize): same nmId on different warehouses coexist", () => {
    repo.replaceForDate("2026-04-17", [
      rec({ warehouseKey: "коледино" }),
      rec({ warehouseKey: "электросталь", warehouseNameRaw: "Электросталь" }),
    ]);
    expect(repo.countForDate("2026-04-17")).toBe(2);
  });
});
