import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { StockSnapshotRepository } from "../src/infra/stockSnapshotRepository.js";
import type { StockSnapshotRecord } from "../src/domain/stockSnapshot.js";

function makeRecord(
  overrides: Partial<StockSnapshotRecord> = {},
): StockSnapshotRecord {
  return {
    snapshotAt: "2026-04-17T10:00:00.000Z",
    nmId: 1,
    vendorCode: "SKU-1",
    barcode: "1111111111111",
    techSize: "0",
    warehouseName: "Коледино",
    quantity: 10,
    inWayToClient: 1,
    inWayFromClient: 0,
    quantityFull: 11,
    lastChangeDate: "2026-04-17T09:00:00",
    ...overrides,
  };
}

describe("StockSnapshotRepository", () => {
  let repo: StockSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new StockSnapshotRepository(db);
  });

  it("persists a batch of records", () => {
    const rows = [
      makeRecord({ nmId: 1, warehouseName: "Коледино" }),
      makeRecord({ nmId: 1, warehouseName: "Электросталь" }),
      makeRecord({ nmId: 2, warehouseName: "Коледино", barcode: "2222222222222" }),
    ];

    const { inserted } = repo.saveBatch(rows);
    expect(inserted).toBe(3);
    expect(repo.countForSnapshot("2026-04-17T10:00:00.000Z")).toBe(3);
  });

  it("is idempotent: duplicate rows in the same snapshot are ignored", () => {
    const row = makeRecord();
    const first = repo.saveBatch([row]);
    const second = repo.saveBatch([row, row]);

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(repo.countForSnapshot(row.snapshotAt)).toBe(1);
  });

  it("keeps history across different snapshot timestamps", () => {
    const base = makeRecord();
    repo.saveBatch([base]);
    repo.saveBatch([{ ...base, snapshotAt: "2026-04-18T10:00:00.000Z", quantity: 99 }]);

    expect(repo.countForSnapshot("2026-04-17T10:00:00.000Z")).toBe(1);
    expect(repo.countForSnapshot("2026-04-18T10:00:00.000Z")).toBe(1);
  });

  it("distinguishes rows with null vs non-null barcode/techSize", () => {
    const rows = [
      makeRecord({ barcode: null, techSize: null, nmId: 5 }),
      makeRecord({ barcode: "123", techSize: "0", nmId: 5 }),
    ];
    const { inserted } = repo.saveBatch(rows);
    expect(inserted).toBe(2);
  });

  it("handles empty batch", () => {
    expect(repo.saveBatch([])).toEqual({ inserted: 0 });
  });
});
