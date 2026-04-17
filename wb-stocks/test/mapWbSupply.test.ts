import { describe, it, expect } from "vitest";
import {
  buildItemRecord,
  buildSupplyRecord,
  parseDetails,
  parseGoodsRow,
  parseListRow,
} from "../src/application/mapWbSupply.js";

describe("parseListRow", () => {
  it("accepts a real WB Supplies List row", () => {
    const r = parseListRow({
      phone: "+7 926 *** 90 05",
      supplyID: 38452139,
      preorderID: 50238337,
      createDate: "2026-04-09T14:55:52+03:00",
      supplyDate: "2026-04-17T00:00:00+03:00",
      factDate: "2026-04-17T10:21:21+03:00",
      updatedDate: "2026-04-17T10:21:23+03:00",
      statusID: 6,
      boxTypeID: 2,
      isBoxOnPallet: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.supplyID).toBe(38452139);
    expect(r.value.statusID).toBe(6);
  });

  it("accepts rows with null supplyID (preorder-only drafts)", () => {
    const r = parseListRow({
      phone: "",
      supplyID: null,
      preorderID: 49350942,
      createDate: "2026-04-01T00:00:00+03:00",
      statusID: 1,
      boxTypeID: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.supplyID).toBeNull();
  });

  it("rejects rows missing required fields", () => {
    expect(parseListRow({}).ok).toBe(false);
    expect(parseListRow({ supplyID: 1 }).ok).toBe(false);
    expect(parseListRow(null).ok).toBe(false);
  });
});

describe("parseDetails / parseGoodsRow", () => {
  it("parses a real WB Supply Details payload", () => {
    const r = parseDetails({
      phone: "",
      statusID: 5,
      virtualTypeID: 5,
      boxTypeID: 0,
      createDate: "2026-04-10T00:54:05+03:00",
      supplyDate: "2026-04-10T00:00:00+03:00",
      factDate: "2026-04-10T00:54:05+03:00",
      updatedDate: "2026-04-10T02:23:42+03:00",
      warehouseID: 120762,
      warehouseName: "Электросталь",
      actualWarehouseID: null,
      actualWarehouseName: "",
      transitWarehouseID: null,
      transitWarehouseName: "",
      acceptanceCost: null,
      paidAcceptanceCoefficient: 0,
      rejectReason: null,
      supplierAssignName: 'ООО "КАНПОЛ РУС"',
      storageCoef: null,
      deliveryCoef: null,
      quantity: 1,
      readyForSaleQuantity: 1,
      acceptedQuantity: 1,
      unloadingQuantity: 0,
      depersonalizedQuantity: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.warehouseName).toBe("Электросталь");
    expect(r.value.acceptedQuantity).toBe(1);
  });

  it("parses a real WB Supply Products row", () => {
    const r = parseGoodsRow({
      barcode: "5903407171104",
      vendorCode: "74/060_yel",
      nmID: 497467926,
      needKiz: false,
      tnved: null,
      techSize: "0",
      color: "желтый",
      supplierBoxAmount: null,
      quantity: 1,
      readyForSaleQuantity: 1,
      unloadingQuantity: 0,
      acceptedQuantity: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nmID).toBe(497467926);
  });
});

describe("buildSupplyRecord", () => {
  it("merges list + details and trims empty strings to null", () => {
    const list = parseListRow({
      phone: "",
      supplyID: 38463952,
      preorderID: 0,
      createDate: "2026-04-10T00:54:05+03:00",
      supplyDate: "2026-04-10T00:00:00+03:00",
      factDate: "2026-04-10T00:54:05+03:00",
      updatedDate: "2026-04-10T02:23:42+03:00",
      statusID: 5,
      boxTypeID: 0,
    });
    const details = parseDetails({
      statusID: 5,
      warehouseID: 120762,
      warehouseName: "Электросталь",
      actualWarehouseName: "",
      quantity: 1,
      acceptedQuantity: 1,
      readyForSaleQuantity: 1,
      unloadingQuantity: 0,
      depersonalizedQuantity: 0,
    });
    if (!list.ok || !details.ok) throw new Error("setup");
    const rec = buildSupplyRecord(list.value, details.value);
    expect(rec.supplyId).toBe(38463952);
    expect(rec.preorderId).toBe(0);
    expect(rec.phone).toBeNull();
    expect(rec.warehouseId).toBe(120762);
    expect(rec.warehouseName).toBe("Электросталь");
    expect(rec.actualWarehouseName).toBeNull();
    expect(rec.acceptedQuantity).toBe(1);
  });

  it("works without details (warehouse / qty stay null)", () => {
    const list = parseListRow({
      supplyID: 1,
      preorderID: null,
      statusID: 2,
    });
    if (!list.ok) throw new Error("setup");
    const rec = buildSupplyRecord(list.value, null);
    expect(rec.warehouseName).toBeNull();
    expect(rec.acceptedQuantity).toBeNull();
  });

  it("throws if supplyID is null/0", () => {
    const list = parseListRow({ supplyID: null, statusID: 1 });
    if (!list.ok) throw new Error("setup");
    expect(() => buildSupplyRecord(list.value, null)).toThrow(/supplyID/);
  });
});

describe("buildItemRecord", () => {
  it("maps a goods row to an item record", () => {
    const g = parseGoodsRow({
      barcode: "111",
      vendorCode: "SKU",
      nmID: 42,
      techSize: "M",
      color: "red",
      quantity: 3,
      acceptedQuantity: 3,
      readyForSaleQuantity: 2,
      unloadingQuantity: 1,
    });
    if (!g.ok) throw new Error("setup");
    const rec = buildItemRecord(99, g.value);
    expect(rec).toEqual({
      supplyId: 99,
      barcode: "111",
      vendorCode: "SKU",
      nmId: 42,
      techSize: "M",
      color: "red",
      quantity: 3,
      acceptedQuantity: 3,
      readyForSaleQuantity: 2,
      unloadingQuantity: 1,
    });
  });
});
