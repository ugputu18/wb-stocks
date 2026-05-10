import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { OwnStockSnapshotRepository } from "../src/infra/ownStockSnapshotRepository.js";
import type { OwnStockSnapshotRecord } from "../src/domain/ownStockSnapshot.js";

function mk(overrides: Partial<OwnStockSnapshotRecord> = {}): OwnStockSnapshotRecord {
  return {
    snapshotDate: "2026-04-18",
    warehouseCode: "main",
    vendorCode: "A",
    quantity: 10,
    sourceFile: "our0418.csv",
    importedAt: "2026-04-18T09:00:00.000Z",
    ...overrides,
  };
}

describe("OwnStockSnapshotRepository.replaceForDate", () => {
  let repo: OwnStockSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new OwnStockSnapshotRepository(db);
  });

  it("inserts rows on first import for a date", () => {
    const { deleted, inserted } = repo.replaceForDate("2026-04-18", "main", [
      mk({ vendorCode: "A", quantity: 5 }),
      mk({ vendorCode: "B", quantity: 7 }),
    ]);
    expect(deleted).toBe(0);
    expect(inserted).toBe(2);
    expect(repo.countForDate("2026-04-18", "main")).toBe(2);
  });

  it("replaces existing rows when re-imported for the same date (idempotent)", () => {
    repo.replaceForDate("2026-04-18", "main", [
      mk({ vendorCode: "A", quantity: 5 }),
      mk({ vendorCode: "B", quantity: 7 }),
    ]);
    const second = repo.replaceForDate("2026-04-18", "main", [
      mk({ vendorCode: "A", quantity: 99 }),
      mk({ vendorCode: "C", quantity: 1 }),
    ]);
    expect(second.deleted).toBe(2);
    expect(second.inserted).toBe(2);
    expect(repo.countForDate("2026-04-18", "main")).toBe(2);
  });

  it("keeps history across different dates", () => {
    repo.replaceForDate("2026-04-18", "main", [mk({ vendorCode: "A" })]);
    repo.replaceForDate("2026-04-19", "main", [mk({ vendorCode: "A", quantity: 20 })]);
    expect(repo.countForDate("2026-04-18", "main")).toBe(1);
    expect(repo.countForDate("2026-04-19", "main")).toBe(1);
  });

  it("isolates data between warehouses", () => {
    repo.replaceForDate("2026-04-18", "main", [mk({ vendorCode: "A" })]);
    repo.replaceForDate("2026-04-18", "reserve", [
      mk({ vendorCode: "A", warehouseCode: "reserve" }),
      mk({ vendorCode: "B", warehouseCode: "reserve" }),
    ]);
    expect(repo.countForDate("2026-04-18", "main")).toBe(1);
    expect(repo.countForDate("2026-04-18", "reserve")).toBe(2);

    // Replacing 'main' must not touch 'reserve'
    repo.replaceForDate("2026-04-18", "main", []);
    expect(repo.countForDate("2026-04-18", "main")).toBe(0);
    expect(repo.countForDate("2026-04-18", "reserve")).toBe(2);
  });

  it("handles empty batch as 'clear snapshot for date'", () => {
    repo.replaceForDate("2026-04-18", "main", [mk()]);
    const { deleted, inserted } = repo.replaceForDate("2026-04-18", "main", []);
    expect(deleted).toBe(1);
    expect(inserted).toBe(0);
    expect(repo.countForDate("2026-04-18", "main")).toBe(0);
  });
});

describe("OwnStockSnapshotRepository.quantitiesByVendorLatest", () => {
  let repo: OwnStockSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new OwnStockSnapshotRepository(db);
  });

  it("returns quantities from MAX(snapshot_date) for warehouse", () => {
    repo.replaceForDate("2026-04-18", "main", [
      mk({ vendorCode: "A", quantity: 5, snapshotDate: "2026-04-18" }),
    ]);
    repo.replaceForDate("2026-04-20", "main", [
      mk({ vendorCode: "A", quantity: 99, snapshotDate: "2026-04-20" }),
    ]);
    const m = repo.quantitiesByVendorLatest("main");
    expect(m.get("A")).toBe(99);
  });

  it("ignores older dates when a newer snapshot exists", () => {
    repo.replaceForDate("2026-04-20", "main", [mk({ vendorCode: "A", quantity: 1 })]);
    repo.replaceForDate("2026-04-18", "main", [mk({ vendorCode: "A", quantity: 500 })]);
    expect(repo.quantitiesByVendorLatest("main").get("A")).toBe(1);
  });

  it("empty map when warehouse has no rows", () => {
    expect([...repo.quantitiesByVendorLatest("main")]).toEqual([]);
  });

  it("is isolated per warehouse_code", () => {
    repo.replaceForDate("2026-04-19", "main", [mk({ vendorCode: "A", quantity: 7 })]);
    repo.replaceForDate("2026-04-20", "reserve", [
      mk({ vendorCode: "A", quantity: 42, warehouseCode: "reserve" }),
    ]);
    expect(repo.quantitiesByVendorLatest("main").get("A")).toBe(7);
    expect(repo.quantitiesByVendorLatest("reserve").get("A")).toBe(42);
  });
});
