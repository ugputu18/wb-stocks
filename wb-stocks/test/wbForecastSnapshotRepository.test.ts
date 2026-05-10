import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbForecastSnapshotRepository } from "../src/infra/wbForecastSnapshotRepository.js";
import type { WbForecastSnapshotRecord } from "../src/domain/wbForecastSnapshot.js";

function rec(over: Partial<WbForecastSnapshotRecord> = {}): WbForecastSnapshotRecord {
  return {
    snapshotDate: "2026-04-17",
    horizonDays: 30,
    warehouseNameRaw: "Коледино",
    warehouseKey: "коледино",
    nmId: 42,
    techSize: "0",
    vendorCode: "SKU-1",
    barcode: "111",
    units7: 14,
    units30: 60,
    units90: 180,
    avgDaily7: 2,
    avgDaily30: 2,
    avgDaily90: 2,
    baseDailyDemand: 2,
    trendRatio: 1,
    trendRatioClamped: 1,
    forecastDailyDemand: 2,
    stockSnapshotAt: "2026-04-17T10:00:00.000Z",
    startStock: 12,
    incomingUnits: 5,
    forecastUnits: 12,
    endStock: 5,
    daysOfStock: 6,
    stockoutDate: "2026-04-23",
    computedAt: "2026-04-17T11:00:00.000Z",
    ...over,
  };
}

describe("WbForecastSnapshotRepository", () => {
  let repo: WbForecastSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new WbForecastSnapshotRepository(db);
  });

  it("inserts then re-replaces by (snapshotDate, horizonDays)", () => {
    const a = repo.replaceForKey("2026-04-17", 30, [rec(), rec({ nmId: 43 })]);
    expect(a.deleted).toBe(0);
    expect(a.inserted).toBe(2);
    expect(repo.countForKey("2026-04-17", 30)).toBe(2);

    // Recompute: full slice replaced.
    const b = repo.replaceForKey("2026-04-17", 30, [rec({ nmId: 99 })]);
    expect(b.deleted).toBe(2);
    expect(b.inserted).toBe(1);
    expect(repo.countForKey("2026-04-17", 30)).toBe(1);
  });

  it("does not interfere across different (snapshotDate, horizonDays)", () => {
    repo.replaceForKey("2026-04-17", 30, [rec()]);
    repo.replaceForKey("2026-04-17", 60, [rec({ horizonDays: 60 })]);
    repo.replaceForKey("2026-04-18", 30, [rec({ snapshotDate: "2026-04-18" })]);

    expect(repo.countForKey("2026-04-17", 30)).toBe(1);
    expect(repo.countForKey("2026-04-17", 60)).toBe(1);
    expect(repo.countForKey("2026-04-18", 30)).toBe(1);

    // Re-running for one combination must not nuke the others.
    repo.replaceForKey("2026-04-17", 30, []);
    expect(repo.countForKey("2026-04-17", 30)).toBe(0);
    expect(repo.countForKey("2026-04-17", 60)).toBe(1);
    expect(repo.countForKey("2026-04-18", 30)).toBe(1);
  });

  it("replaceForScope updates only the requested subset, leaving other rows intact", () => {
    repo.replaceForKey("2026-04-17", 30, [
      rec({ warehouseKey: "коледино", vendorCode: "SKU-1", nmId: 42 }),
      rec({
        warehouseKey: "электросталь",
        warehouseNameRaw: "Электросталь",
        vendorCode: "SKU-1",
        nmId: 42,
      }),
      rec({ warehouseKey: "коледино", vendorCode: "SKU-2", nmId: 99 }),
    ]);

    const result = repo.replaceForScope(
      "2026-04-17",
      30,
      [
        rec({
          warehouseKey: "коледино",
          vendorCode: "SKU-1",
          nmId: 42,
          forecastUnits: 777,
        }),
      ],
      { warehouseKey: "коледино", vendorCode: "SKU-1" },
    );

    expect(result.deleted).toBe(1);
    expect(result.inserted).toBe(1);
    const rows = repo.getForKey("2026-04-17", 30);
    expect(rows).toHaveLength(3);
    expect(
      rows.find((r) => r.warehouseKey === "коледино" && r.vendorCode === "SKU-1")
        ?.forecastUnits,
    ).toBe(777);
    expect(
      rows.find((r) => r.warehouseKey === "электросталь")?.forecastUnits,
    ).toBe(12);
    expect(rows.find((r) => r.vendorCode === "SKU-2")?.forecastUnits).toBe(12);
  });

  it("round-trips all explainability + provenance fields", () => {
    const r = rec({
      stockoutDate: null,
      vendorCode: null,
      barcode: null,
      forecastDailyDemand: 1.234,
      endStock: 7.5,
    });
    repo.replaceForKey("2026-04-17", 30, [r]);
    const read = repo.getForKey("2026-04-17", 30)[0]!;
    expect(read).toMatchObject({
      stockoutDate: null,
      vendorCode: null,
      barcode: null,
      forecastDailyDemand: 1.234,
      endStock: 7.5,
      stockSnapshotAt: r.stockSnapshotAt,
      units7: 14,
      units30: 60,
      units90: 180,
    });
  });

  it("UNIQUE constraint blocks duplicates inserted via the same call", () => {
    expect(() =>
      repo.replaceForKey("2026-04-17", 30, [rec(), rec()]),
    ).toThrow(/UNIQUE|unique/i);
    // Transaction must have rolled back: nothing persisted.
    expect(repo.countForKey("2026-04-17", 30)).toBe(0);
  });
});
