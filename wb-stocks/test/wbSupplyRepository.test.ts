import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbSupplyRepository } from "../src/infra/wbSupplyRepository.js";
import type {
  WbSupplyItemRecord,
  WbSupplyRecord,
} from "../src/domain/wbSupply.js";

function supply(overrides: Partial<WbSupplyRecord> = {}): WbSupplyRecord {
  return {
    supplyId: 1001,
    preorderId: 5001,
    phone: "+7 *** ** **",
    createDate: "2026-04-09T14:55:52+03:00",
    supplyDate: "2026-04-17T00:00:00+03:00",
    factDate: null,
    updatedDate: "2026-04-09T15:00:00+03:00",
    statusId: 2,
    boxTypeId: 2,
    virtualTypeId: null,
    isBoxOnPallet: false,
    warehouseId: 507,
    warehouseName: "Коледино",
    actualWarehouseId: null,
    actualWarehouseName: null,
    quantity: 10,
    acceptedQuantity: null,
    unloadingQuantity: null,
    readyForSaleQuantity: null,
    depersonalizedQuantity: null,
    ...overrides,
  };
}

function item(overrides: Partial<WbSupplyItemRecord> = {}): WbSupplyItemRecord {
  return {
    supplyId: 1001,
    barcode: "111",
    vendorCode: "SKU-1",
    nmId: 42,
    techSize: "0",
    color: "red",
    quantity: 5,
    acceptedQuantity: null,
    readyForSaleQuantity: null,
    unloadingQuantity: null,
    ...overrides,
  };
}

describe("WbSupplyRepository", () => {
  let repo: WbSupplyRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new WbSupplyRepository(db);
  });

  it("upserts by supply_id: 'created' then 'unchanged' on same data", () => {
    const s = supply();
    const a = repo.upsertSupply(s, "2026-04-17T10:00:00.000Z");
    expect(a.result).toBe("created");
    expect(repo.countSupplies()).toBe(1);

    const b = repo.upsertSupply(s, "2026-04-17T10:00:01.000Z");
    expect(b.result).toBe("unchanged");
    expect(repo.countSupplies()).toBe(1);
  });

  it("'updated' when status / fact_date / quantities change", () => {
    repo.upsertSupply(supply(), "2026-04-17T10:00:00.000Z");

    const r = repo.upsertSupply(
      supply({
        statusId: 5,
        factDate: "2026-04-17T10:21:21+03:00",
        acceptedQuantity: 10,
      }),
      "2026-04-17T10:00:01.000Z",
    );
    expect(r.result).toBe("updated");
    expect(r.previous?.statusId).toBe(2);
    expect(repo.countSupplies()).toBe(1);

    const after = repo.getBySupplyId(1001);
    expect(after?.statusId).toBe(5);
    expect(after?.acceptedQuantity).toBe(10);
  });

  it("round-trips isBoxOnPallet boolean correctly", () => {
    repo.upsertSupply(supply({ isBoxOnPallet: true }), "2026-04-17T10:00:00.000Z");
    expect(repo.getBySupplyId(1001)?.isBoxOnPallet).toBe(true);

    repo.upsertSupply(supply({ isBoxOnPallet: null }), "2026-04-17T10:00:01.000Z");
    expect(repo.getBySupplyId(1001)?.isBoxOnPallet).toBeNull();
  });

  it("replaceItemsForSupply: replaces lines, never duplicates", () => {
    repo.upsertSupply(supply(), "2026-04-17T10:00:00.000Z");
    repo.replaceItemsForSupply(1001, [item(), item({ nmId: 43, barcode: "222" })]);
    expect(repo.countItemsForSupply(1001)).toBe(2);

    repo.replaceItemsForSupply(1001, [item({ nmId: 44, barcode: "333", quantity: 7 })]);
    expect(repo.countItemsForSupply(1001)).toBe(1);
  });

  it("appendStatusHistoryIfChanged: writes once, then only on real change", () => {
    repo.upsertSupply(supply(), "2026-04-17T10:00:00.000Z");

    expect(
      repo.appendStatusHistoryIfChanged(1001, 2, null, "2026-04-17T10:00:00.000Z"),
    ).toBe(true);
    expect(
      repo.appendStatusHistoryIfChanged(1001, 2, null, "2026-04-17T10:05:00.000Z"),
    ).toBe(false);
    expect(
      repo.appendStatusHistoryIfChanged(
        1001,
        5,
        "2026-04-17T10:21:21+03:00",
        "2026-04-17T10:25:00.000Z",
      ),
    ).toBe(true);
    expect(repo.countStatusHistory(1001)).toBe(2);
  });

  it("status history: writes new row when fact_date appears, status unchanged", () => {
    repo.upsertSupply(supply({ statusId: 5 }), "2026-04-17T10:00:00.000Z");
    repo.appendStatusHistoryIfChanged(1001, 5, null, "2026-04-17T10:00:00.000Z");
    expect(
      repo.appendStatusHistoryIfChanged(
        1001,
        5,
        "2026-04-17T10:21:21+03:00",
        "2026-04-17T10:25:00.000Z",
      ),
    ).toBe(true);
    expect(repo.countStatusHistory(1001)).toBe(2);
  });

  it("getSuppliesByStatuses: returns only matching statuses, decodes isBoxOnPallet", () => {
    repo.upsertSupply(
      supply({ supplyId: 1, statusId: 2, isBoxOnPallet: true }),
      "2026-04-17T10:00:00.000Z",
    );
    repo.upsertSupply(
      supply({ supplyId: 2, statusId: 5, isBoxOnPallet: false }),
      "2026-04-17T10:00:00.000Z",
    );
    repo.upsertSupply(
      supply({ supplyId: 3, statusId: 3, isBoxOnPallet: null }),
      "2026-04-17T10:00:00.000Z",
    );

    const incoming = repo.getSuppliesByStatuses([2, 3, 4, 6]);
    expect(incoming.map((s) => s.supplyId).sort()).toEqual([1, 3]);
    expect(incoming.find((s) => s.supplyId === 1)!.isBoxOnPallet).toBe(true);
    expect(incoming.find((s) => s.supplyId === 3)!.isBoxOnPallet).toBeNull();

    const empty = repo.getSuppliesByStatuses([]);
    expect(empty).toEqual([]);
  });

  it("getItemsForSupplyIds: returns flattened items for the supplied IDs", () => {
    repo.upsertSupply(supply({ supplyId: 1 }), "2026-04-17T10:00:00.000Z");
    repo.upsertSupply(supply({ supplyId: 2 }), "2026-04-17T10:00:00.000Z");
    repo.replaceItemsForSupply(1, [
      item({ supplyId: 1, nmId: 100 }),
      item({ supplyId: 1, nmId: 101, barcode: "999" }),
    ]);
    repo.replaceItemsForSupply(2, [item({ supplyId: 2, nmId: 200 })]);

    const items = repo.getItemsForSupplyIds([1, 2]);
    expect(items.map((i) => `${i.supplyId}:${i.nmId}`).sort()).toEqual([
      "1:100",
      "1:101",
      "2:200",
    ]);
    expect(repo.getItemsForSupplyIds([])).toEqual([]);
  });
});
