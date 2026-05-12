import { describe, it, expect } from "vitest";
import { parseOwnStockCsv } from "../src/application/parseOwnStockCsv.js";

describe("parseOwnStockCsv", () => {
  it("parses a minimal valid file with header and rows", () => {
    const csv = [
      "Артикул,Остаток,Потребность,Потребность WB 56",
      "0120exp,144,0,0",
      "0295,0,161,33",
      "1/610,47,167,0",
    ].join("\n");

    const { rows, issues, detection } = parseOwnStockCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { vendorCode: "0120exp", quantity: 144 },
      { vendorCode: "0295", quantity: 0 },
      { vendorCode: "1/610", quantity: 47 },
    ]);
    expect(detection.vendorColumn).toBe("Артикул");
    expect(detection.wbColumn).toBeNull();
    expect(detection.quantityColumn).toBe("Остаток");
    expect(detection.delimiter).toBe(",");
  });

  it("treats empty Остаток as 0 (matches store/*.py convention)", () => {
    const csv = "Артикул,Остаток\n0294,\n0295,0\n";
    const { rows, issues } = parseOwnStockCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { vendorCode: "0294", quantity: 0 },
      { vendorCode: "0295", quantity: 0 },
    ]);
  });

  it("normalizes '1 234' and '1,5' numeric formats", () => {
    const csv = "Артикул,Остаток\nA,1 234\nB,\"1,5\"\n";
    const { rows, issues } = parseOwnStockCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { vendorCode: "A", quantity: 1234 },
      { vendorCode: "B", quantity: 1 },
    ]);
  });

  it("skips rows without a vendor code and reports the issue", () => {
    const csv = "Артикул,Остаток\n,10\nA,5\n";
    const { rows, issues } = parseOwnStockCsv(csv);
    expect(rows).toEqual([{ vendorCode: "A", quantity: 5 }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      lineNumber: 2,
      reason: expect.stringContaining("Артикул"),
    });
  });

  it("skips rows with non-numeric Остаток and reports the issue", () => {
    const csv = "Артикул,Остаток\nA,abc\nB,3\n";
    const { rows, issues } = parseOwnStockCsv(csv);
    expect(rows).toEqual([{ vendorCode: "B", quantity: 3 }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/abc/);
  });

  it("tolerates UTF-8 BOM and trailing whitespace", () => {
    const csv = "\uFEFFАртикул,Остаток\n  A  , 7 \n";
    const { rows, issues } = parseOwnStockCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([{ vendorCode: "A", quantity: 7 }]);
  });

  it("ignores extra columns silently (e.g. Потребность WB 56)", () => {
    const csv = [
      "Артикул,Остаток,Потребность,Потребность WB 56",
      "X,10,999,888",
    ].join("\n");
    const { rows } = parseOwnStockCsv(csv);
    expect(rows).toEqual([{ vendorCode: "X", quantity: 10 }]);
  });

  it("auto-detects vendor + WB columns by content (vendor preferred for key)", () => {
    const csv = [
      "Артикул продавца,Артикул WB,Остаток склад Канпол рус",
      "35/368_gre,507833572,75",
      "23/222_blu_NEW,488894119,0",
      "35/368_blu,,0",
      "35/368_bei,507833580,459",
      "35/272,485435821,2004",
      "23/278_pin_new,877139590,0",
    ].join("\n");

    const { rows, issues, detection } = parseOwnStockCsv(csv);
    expect(issues).toEqual([]);
    expect(detection.vendorColumn).toBe("Артикул продавца");
    expect(detection.wbColumn).toBe("Артикул WB");
    expect(detection.quantityColumn).toBe("Остаток склад Канпол рус");
    expect(rows).toEqual([
      { vendorCode: "35/368_gre", quantity: 75 },
      { vendorCode: "23/222_blu_NEW", quantity: 0 },
      { vendorCode: "35/368_blu", quantity: 0 },
      { vendorCode: "35/368_bei", quantity: 459 },
      { vendorCode: "35/272", quantity: 2004 },
      { vendorCode: "23/278_pin_new", quantity: 0 },
    ]);
  });

  it("falls back to WB article when vendor column is empty for that row", () => {
    const csv = [
      "Артикул продавца,Артикул WB,Остаток",
      ",507833572,10",
      "ABC,488894119,3",
    ].join("\n");
    const { rows, issues } = parseOwnStockCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { vendorCode: "507833572", quantity: 10 },
      { vendorCode: "ABC", quantity: 3 },
    ]);
  });

  it("uses WB column as vendor key when no vendor column is present", () => {
    const csv = ["Артикул WB,Остаток", "507833572,10", "488894119,0"].join(
      "\n",
    );
    const { rows, detection } = parseOwnStockCsv(csv);
    expect(detection.vendorColumn).toBeNull();
    expect(detection.wbColumn).toBe("Артикул WB");
    expect(rows).toEqual([
      { vendorCode: "507833572", quantity: 10 },
      { vendorCode: "488894119", quantity: 0 },
    ]);
  });

  it("detects semicolon delimiter and matches case-insensitively", () => {
    const csv = "артикул продавца;ОСТАТОК\nA;5\nB;7\n";
    const { rows, detection } = parseOwnStockCsv(csv);
    expect(detection.delimiter).toBe(";");
    expect(detection.vendorColumn).toBe("артикул продавца");
    expect(detection.quantityColumn).toBe("ОСТАТОК");
    expect(rows).toEqual([
      { vendorCode: "A", quantity: 5 },
      { vendorCode: "B", quantity: 7 },
    ]);
  });

  it("reports a clear issue when no Остаток column is present", () => {
    const csv = "Артикул,Цена\nA,100\n";
    const { rows, issues, detection } = parseOwnStockCsv(csv);
    expect(detection.quantityColumn).toBeNull();
    expect(rows).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/Остаток/);
  });

  it("reports a clear issue when no Артикул column is present", () => {
    const csv = "Имя,Остаток\nfoo,1\n";
    const { rows, issues, detection } = parseOwnStockCsv(csv);
    expect(detection.vendorColumn).toBeNull();
    expect(detection.wbColumn).toBeNull();
    expect(rows).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/Артикул/);
  });
});
