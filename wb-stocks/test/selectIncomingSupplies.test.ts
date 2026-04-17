import { describe, expect, it, vi } from "vitest";
import { selectIncomingSupplies } from "../src/application/selectIncomingSupplies.js";
import type {
  WbSupplyItemRecord,
  WbSupplyRecord,
} from "../src/domain/wbSupply.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof selectIncomingSupplies>[0]["logger"];
}

function supply(over: Partial<WbSupplyRecord> = {}): WbSupplyRecord {
  return {
    supplyId: 1001,
    preorderId: null,
    phone: null,
    createDate: null,
    supplyDate: "2026-04-20T00:00:00+03:00",
    factDate: null,
    updatedDate: null,
    statusId: 2,
    boxTypeId: null,
    virtualTypeId: null,
    isBoxOnPallet: null,
    warehouseId: 507,
    warehouseName: "Коледино",
    actualWarehouseId: null,
    actualWarehouseName: null,
    quantity: 10,
    acceptedQuantity: null,
    unloadingQuantity: null,
    readyForSaleQuantity: null,
    depersonalizedQuantity: null,
    ...over,
  };
}

function item(over: Partial<WbSupplyItemRecord> = {}): WbSupplyItemRecord {
  return {
    supplyId: 1001,
    barcode: "111",
    vendorCode: "SKU-1",
    nmId: 42,
    techSize: "0",
    color: null,
    quantity: 5,
    acceptedQuantity: null,
    readyForSaleQuantity: null,
    unloadingQuantity: null,
    ...over,
  };
}

const FROM = "2026-04-17";
const TO = "2026-05-16";

describe("selectIncomingSupplies", () => {
  it("filters out non-incoming statuses (draft/accepted)", () => {
    const supplies = [
      supply({ supplyId: 1, statusId: 1 }), // draft
      supply({ supplyId: 2, statusId: 5 }), // already in stock
      supply({ supplyId: 3, statusId: 2 }),
    ];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [1, [item({ supplyId: 1 })]],
      [2, [item({ supplyId: 2 })]],
      [3, [item({ supplyId: 3 })]],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    expect(r.acceptedSupplies).toBe(1);
    expect(r.skipped.map((s) => s.supplyId).sort()).toEqual([1, 2]);
    const reasons = r.skipped.map((s) => s.reason);
    expect(reasons.some((x) => x.startsWith("status-not-incoming"))).toBe(true);
  });

  it("uses actual_warehouse_name when present, falls back to planned warehouse_name", () => {
    const supplies = [
      supply({ supplyId: 1, warehouseName: "A", actualWarehouseName: "B" }),
      supply({ supplyId: 2, warehouseName: "A", actualWarehouseName: null }),
    ];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [1, [item({ supplyId: 1 })]],
      [2, [item({ supplyId: 2 })]],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    const keys = [...r.incoming.keys()].map((k) => k.split("\u0000")[0]);
    expect(keys.sort()).toEqual(["a", "b"]);
  });

  it("skips supplies without a parseable supply_date and logs reason", () => {
    const log = silentLogger();
    const supplies = [
      supply({ supplyId: 1, supplyDate: null }),
      supply({ supplyId: 2, supplyDate: "0001-01-01T00:00:00Z" }),
      supply({ supplyId: 3, supplyDate: "broken" }),
    ];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [1, [item({ supplyId: 1 })]],
      [2, [item({ supplyId: 2 })]],
      [3, [item({ supplyId: 3 })]],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
      logger: log,
    });
    expect(r.acceptedSupplies).toBe(0);
    expect(r.skipped.every((s) => s.reason === "no-supply-date")).toBe(true);
    expect(r.skipped).toHaveLength(3);
  });

  it("drops arrivals outside the [fromDate, toDate] horizon", () => {
    const supplies = [
      supply({ supplyId: 1, supplyDate: "2026-04-20T00:00:00+03:00" }), // in
      supply({ supplyId: 2, supplyDate: "2026-04-16T00:00:00+03:00" }), // before
      supply({ supplyId: 3, supplyDate: "2026-05-17T00:00:00+03:00" }), // after
    ];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [1, [item({ supplyId: 1 })]],
      [2, [item({ supplyId: 2 })]],
      [3, [item({ supplyId: 3 })]],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    expect(r.acceptedSupplies).toBe(1);
    expect(r.skipped.filter((s) => s.reason.startsWith("out-of-window"))).toHaveLength(2);
  });

  it("subtracts acceptedQuantity from item.quantity (status 4 partial accept)", () => {
    const supplies = [supply({ supplyId: 1, statusId: 4 })];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [
        1,
        [
          item({ supplyId: 1, nmId: 42, quantity: 10, acceptedQuantity: 4 }),
          item({ supplyId: 1, nmId: 43, quantity: 3, acceptedQuantity: 3 }), // fully accepted → 0
        ],
      ],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    expect(r.totalArrivals).toBe(1); // only nmId 42 contributes
    expect(r.totalUnits).toBe(6);
  });

  it("clamps remaining qty to >= 0 (defensive against bad WB data)", () => {
    const supplies = [supply({ supplyId: 1, statusId: 4 })];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [1, [item({ supplyId: 1, quantity: 2, acceptedQuantity: 5 })]],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    expect(r.totalUnits).toBe(0);
    expect(r.acceptedSupplies).toBe(0);
  });

  it("normalizes warehouse name (case + non-breaking spaces) so it joins with stocks", () => {
    const supplies = [
      supply({ supplyId: 1, warehouseName: "КОЛЕДИНО " }),
      supply({ supplyId: 2, warehouseName: "Коледино" }),
      supply({
        supplyId: 3,
        warehouseName: "коледино\u00A0",
        supplyDate: "2026-04-21T00:00:00+03:00",
      }),
    ];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [1, [item({ supplyId: 1 })]],
      [2, [item({ supplyId: 2 })]],
      [3, [item({ supplyId: 3 })]],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    // All three collapse to the same key.
    expect(r.incoming.size).toBe(1);
    const arrivals = [...r.incoming.values()][0]!;
    expect(arrivals).toHaveLength(3);
  });

  it("treats start-of-day arrival rule: a supply for snapshotDate is in the window", () => {
    const supplies = [
      supply({ supplyId: 1, supplyDate: `${FROM}T00:00:00+03:00` }),
    ];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [1, [item({ supplyId: 1 })]],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    expect(r.acceptedSupplies).toBe(1);
    const arrivals = [...r.incoming.values()][0]!;
    expect(arrivals[0]!.date).toBe(FROM);
  });

  it("groups items by (warehouseKey, nmId, techSize); techSize null → ''", () => {
    const supplies = [supply({ supplyId: 1 })];
    const items = new Map<number, WbSupplyItemRecord[]>([
      [
        1,
        [
          item({ supplyId: 1, nmId: 42, techSize: null, quantity: 2 }),
          item({ supplyId: 1, nmId: 42, techSize: "", quantity: 3 }), // separate row but same key
          item({ supplyId: 1, nmId: 42, techSize: "0", quantity: 4 }),
        ],
      ],
    ]);
    const r = selectIncomingSupplies({
      supplies,
      itemsBySupplyId: items,
      fromDate: FROM,
      toDate: TO,
    });
    // Two distinct keys: ('коледино',42,'') and ('коледино',42,'0')
    expect(r.incoming.size).toBe(2);
    const sizesAtNm42 = [...r.incoming.entries()]
      .filter(([k]) => k.includes("\u000042\u0000"))
      .map(([k]) => k.split("\u0000")[2]);
    expect(sizesAtNm42.sort()).toEqual(["", "0"]);
  });
});
