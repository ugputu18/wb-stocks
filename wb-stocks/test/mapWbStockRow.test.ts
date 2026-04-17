import { describe, it, expect } from "vitest";
import { mapWbStockRow } from "../src/application/mapWbStockRow.js";

const snapshotAt = "2026-04-17T10:00:00.000Z";

describe("mapWbStockRow", () => {
  it("maps a fully-populated WB row into the internal record", () => {
    const raw = {
      lastChangeDate: "2023-07-05T11:13:35",
      warehouseName: "Краснодар",
      supplierArticle: "443284",
      nmId: 1439871458,
      barcode: "2037401340280",
      quantity: 33,
      inWayToClient: 1,
      inWayFromClient: 0,
      quantityFull: 34,
      techSize: "0",
      category: "ignored",
      Price: 185,
    };

    const result = mapWbStockRow(raw, snapshotAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toEqual({
      snapshotAt,
      nmId: 1439871458,
      vendorCode: "443284",
      barcode: "2037401340280",
      techSize: "0",
      warehouseName: "Краснодар",
      quantity: 33,
      inWayToClient: 1,
      inWayFromClient: 0,
      quantityFull: 34,
      lastChangeDate: "2023-07-05T11:13:35",
    });
  });

  it("keeps optional numeric fields as null when WB does not return them", () => {
    const raw = {
      warehouseName: "Электросталь",
      nmId: 42,
      quantity: 5,
    };

    const result = mapWbStockRow(raw, snapshotAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({
      nmId: 42,
      quantity: 5,
      warehouseName: "Электросталь",
      vendorCode: null,
      barcode: null,
      techSize: null,
      inWayToClient: null,
      inWayFromClient: null,
      quantityFull: null,
      lastChangeDate: null,
    });
  });

  it("normalizes empty strings to null for text fields", () => {
    const raw = {
      warehouseName: "Коледино",
      supplierArticle: "   ",
      nmId: 7,
      barcode: "",
      quantity: 0,
      techSize: "",
    };

    const result = mapWbStockRow(raw, snapshotAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.vendorCode).toBeNull();
    expect(result.record.barcode).toBeNull();
    expect(result.record.techSize).toBeNull();
  });

  it("rejects rows missing required fields without throwing", () => {
    const raw = { nmId: "not a number", warehouseName: "X", quantity: 1 };

    const result = mapWbStockRow(raw, snapshotAt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("nmId");
    expect(result.raw).toBe(raw);
  });

  it("rejects rows without a warehouseName", () => {
    const raw = { nmId: 1, quantity: 10 };
    const result = mapWbStockRow(raw, snapshotAt);
    expect(result.ok).toBe(false);
  });
});
