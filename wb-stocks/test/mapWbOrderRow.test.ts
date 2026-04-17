import { describe, it, expect } from "vitest";
import { mapWbOrderRow } from "../src/application/mapWbOrderRow.js";

describe("mapWbOrderRow", () => {
  const baseRow = {
    date: "2026-04-15T18:08:31",
    lastChangeDate: "2026-04-15T18:09:00",
    warehouseName: "Коледино",
    supplierArticle: "SKU-1",
    nmId: 123,
    barcode: "111",
    techSize: "0",
    isCancel: false,
    srid: "abc",
  };

  it("maps a valid row, normalizing the warehouse key", () => {
    const r = mapWbOrderRow({ ...baseRow, warehouseName: "  КОЛЕДИНО  " });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value.orderDate).toBe("2026-04-15");
    expect(r.value.warehouseKey).toBe("коледино");
    expect(r.value.warehouseNameRaw).toBe("КОЛЕДИНО");
    expect(r.value.nmId).toBe(123);
    expect(r.value.techSize).toBe("0");
    expect(r.value.vendorCode).toBe("SKU-1");
    expect(r.value.barcode).toBe("111");
    expect(r.value.isCancel).toBe(false);
  });

  it("treats null / missing isCancel as false (not cancelled)", () => {
    const a = mapWbOrderRow({ ...baseRow, isCancel: null });
    const b = mapWbOrderRow({ ...baseRow, isCancel: undefined });
    expect(a.ok && a.value.isCancel).toBe(false);
    expect(b.ok && b.value.isCancel).toBe(false);
  });

  it("collapses null/empty techSize to empty string for stable PK", () => {
    const r = mapWbOrderRow({ ...baseRow, techSize: null });
    expect(r.ok && r.value.techSize).toBe("");
    const r2 = mapWbOrderRow({ ...baseRow, techSize: "  " });
    expect(r2.ok && r2.value.techSize).toBe("");
  });

  it("uses the unknown-warehouse sentinel when WB sent null warehouse", () => {
    const r = mapWbOrderRow({ ...baseRow, warehouseName: null });
    expect(r.ok && r.value.warehouseKey).toBe("<unknown>");
    expect(r.ok && r.value.warehouseNameRaw).toBeNull();
  });

  it("rejects rows without nmId", () => {
    const r = mapWbOrderRow({ ...baseRow, nmId: undefined });
    expect(r.ok).toBe(false);
  });

  it("rejects rows without a parseable date", () => {
    const r = mapWbOrderRow({ ...baseRow, date: "not-a-date" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/date/);
  });

  it("does NOT shift the date across midnight when WB time is late", () => {
    // 23:59 МСК — must stay on 2026-04-15, not become 2026-04-14 (UTC).
    const r = mapWbOrderRow({ ...baseRow, date: "2026-04-15T23:59:00" });
    expect(r.ok && r.value.orderDate).toBe("2026-04-15");
  });
});
