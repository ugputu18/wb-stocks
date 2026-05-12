import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { toXlsxBuffer } from "../src/server/xlsx.js";

async function readBack(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  // exceljs объявляет `load(data: Excel.Buffer)` с более узким `Buffer<ArrayBuffer>`,
  // чем общий node-`Buffer<ArrayBufferLike>` — приводим через unknown, чтобы не
  // плодить лишние копии (содержимое не меняется).
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(1);
  if (!ws) throw new Error("expected at least one worksheet");
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    // `row.values` приходит с holey `[empty]` в индексе 0 — нормализуем
    // к обычному массиву начиная с индекса 1.
    const vals = (row.values as unknown[]).slice(1);
    rows.push(vals);
  });
  return { wb, ws, rows };
}

function rowAt(rows: unknown[][], i: number): unknown[] {
  const r = rows[i];
  if (!r) throw new Error(`expected row ${i}`);
  return r;
}

describe("toXlsxBuffer", () => {
  it("writes header + rows in column order; ignores extra keys", async () => {
    const buf = await toXlsxBuffer(
      [
        { a: 1, b: "x,y", c: 'say "hi"', extra: "dropped" },
        { a: 2, b: "ok", c: "" },
      ],
      ["a", "b", "c"],
    );
    const { rows, ws } = await readBack(buf);
    expect(ws.columnCount).toBe(3);
    expect(rowAt(rows, 0)).toEqual(["a", "b", "c"]);
    expect(rowAt(rows, 1)).toEqual([1, "x,y", 'say "hi"']);
    // Empty string "c" — exceljs пропускает пустую trailing-ячейку и
    // длина строки сокращается до 2; именно так должно быть.
    expect(rowAt(rows, 2).slice(0, 2)).toEqual([2, "ok"]);
  });

  it("preserves numbers as numbers (locale-safe vs CSV)", async () => {
    const buf = await toXlsxBuffer(
      [{ qty: 12, price: 0.5 }],
      ["qty", "price"],
    );
    // После `load()` exceljs не сохраняет колоночные `key`-ы — обращаемся
    // по индексу (1-based: A, B, …), который у нас стабильно совпадает с
    // порядком `columns`.
    const { ws } = await readBack(buf);
    expect(typeof ws.getRow(2).getCell(1).value).toBe("number");
    expect(typeof ws.getRow(2).getCell(2).value).toBe("number");
    expect(ws.getRow(2).getCell(2).value).toBe(0.5);
  });

  it("null and undefined become empty cells", async () => {
    const buf = await toXlsxBuffer(
      [{ x: null, y: undefined, z: 0 }],
      ["x", "y", "z"],
    );
    const { ws } = await readBack(buf);
    // Пустые ячейки в exceljs после загрузки читаются как `null` или ""
    // — нас устраивает любой из вариантов (важно, что не возникает
    // строки "null" / "undefined").
    const xCell = ws.getRow(2).getCell(1).value;
    const yCell = ws.getRow(2).getCell(2).value;
    expect(xCell === null || xCell === undefined || xCell === "").toBe(true);
    expect(yCell === null || yCell === undefined || yCell === "").toBe(true);
    expect(ws.getRow(2).getCell(3).value).toBe(0);
  });

  it("supports cyrillic headers and values (the actual reason we left CSV)", async () => {
    const buf = await toXlsxBuffer(
      [{ "Регион": "Центральный", "Заказ": 42 }],
      ["Регион", "Заказ"],
    );
    const { rows } = await readBack(buf);
    expect(rowAt(rows, 0)).toEqual(["Регион", "Заказ"]);
    expect(rowAt(rows, 1)).toEqual(["Центральный", 42]);
  });

  it("sanitizes invalid sheet names and falls back to 'Report'", async () => {
    const buf = await toXlsxBuffer([{ a: 1 }], ["a"], { sheetName: "" });
    const { ws } = await readBack(buf);
    expect(ws.name).toBe("Report");

    const buf2 = await toXlsxBuffer([{ a: 1 }], ["a"], {
      sheetName: "bad:name/with*chars",
    });
    const { ws: ws2 } = await readBack(buf2);
    expect(ws2.name).toBe("bad_name_with_chars");
  });
});
