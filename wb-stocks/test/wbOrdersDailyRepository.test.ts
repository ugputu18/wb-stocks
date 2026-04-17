import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbOrdersDailyRepository } from "../src/infra/wbOrdersDailyRepository.js";
import type { WbOrdersDailyRecord } from "../src/domain/wbOrder.js";

function rec(overrides: Partial<WbOrdersDailyRecord> = {}): WbOrdersDailyRecord {
  return {
    orderDate: "2026-04-15",
    warehouseNameRaw: "Коледино",
    warehouseKey: "коледино",
    nmId: 100,
    techSize: "0",
    vendorCode: "SKU-1",
    barcode: "111",
    units: 3,
    cancelledUnits: 1,
    grossUnits: 4,
    firstSeenAt: "2026-04-17T10:00:00.000Z",
    lastSeenAt: "2026-04-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("WbOrdersDailyRepository", () => {
  let repo: WbOrdersDailyRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new WbOrdersDailyRepository(db);
  });

  it("replaceDay: inserts when day is empty", () => {
    const r = repo.replaceDay("2026-04-15", [rec(), rec({ nmId: 101 })]);
    expect(r.deleted).toBe(0);
    expect(r.inserted).toBe(2);
    expect(repo.countDay("2026-04-15")).toBe(2);
  });

  it("replaceDay: a re-run with the same day overwrites old slice fully", () => {
    repo.replaceDay("2026-04-15", [
      rec({ nmId: 100 }),
      rec({ nmId: 101 }),
      rec({ nmId: 102 }),
    ]);
    expect(repo.countDay("2026-04-15")).toBe(3);

    // Now WB reports only one row for that day (e.g. cancellations dropped it).
    const r = repo.replaceDay("2026-04-15", [rec({ nmId: 100, units: 5 })]);
    expect(r.deleted).toBe(3);
    expect(r.inserted).toBe(1);
    expect(repo.countDay("2026-04-15")).toBe(1);

    const fetched = repo.getRange("2026-04-15", "2026-04-15");
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.nmId).toBe(100);
    expect(fetched[0]!.units).toBe(5);
  });

  it("replaceDay touches only that day, never neighbouring days", () => {
    repo.replaceDay("2026-04-14", [rec({ orderDate: "2026-04-14" })]);
    repo.replaceDay("2026-04-15", [rec({ orderDate: "2026-04-15" })]);
    repo.replaceDay("2026-04-15", [
      rec({ orderDate: "2026-04-15", nmId: 999, units: 10 }),
    ]);
    expect(repo.countDay("2026-04-14")).toBe(1);
    expect(repo.countDay("2026-04-15")).toBe(1);
    expect(repo.countAll()).toBe(2);
  });

  it("PK is (date, warehouseKey, nmId, techSize): same nmId on different warehouses coexist", () => {
    repo.replaceDay("2026-04-15", [
      rec({ warehouseKey: "коледино", warehouseNameRaw: "Коледино" }),
      rec({ warehouseKey: "электросталь", warehouseNameRaw: "Электросталь" }),
    ]);
    expect(repo.countDay("2026-04-15")).toBe(2);
  });

  it("getRange returns rows ordered deterministically", () => {
    repo.replaceDay("2026-04-15", [
      rec({ nmId: 200, techSize: "M" }),
      rec({ nmId: 100, techSize: "S" }),
      rec({ nmId: 100, techSize: "L" }),
    ]);
    const rows = repo.getRange("2026-04-15", "2026-04-15");
    expect(rows.map((r) => `${r.nmId}/${r.techSize}`)).toEqual([
      "100/L",
      "100/S",
      "200/M",
    ]);
  });

  it("getRange filters by date window inclusively", () => {
    repo.replaceDay("2026-04-13", [rec({ orderDate: "2026-04-13" })]);
    repo.replaceDay("2026-04-14", [rec({ orderDate: "2026-04-14" })]);
    repo.replaceDay("2026-04-15", [rec({ orderDate: "2026-04-15" })]);
    expect(repo.getRange("2026-04-14", "2026-04-15")).toHaveLength(2);
    expect(repo.getRange("2026-04-13", "2026-04-13")).toHaveLength(1);
  });
});
