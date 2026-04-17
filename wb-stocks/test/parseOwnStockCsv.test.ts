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

    const { rows, issues } = parseOwnStockCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { vendorCode: "0120exp", quantity: 144 },
      { vendorCode: "0295", quantity: 0 },
      { vendorCode: "1/610", quantity: 47 },
    ]);
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
});
