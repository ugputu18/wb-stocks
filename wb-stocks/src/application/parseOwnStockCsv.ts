import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

/**
 * Raw logical row read from an "our warehouse" import file.
 *
 * The schema below only carries the two fields that the snapshot needs
 * (`vendorCode` and `quantity`): everything else in the source file
 * (потребность, резерв, WB article column, etc.) is planning metadata and
 * is dropped intentionally.
 */
export interface OwnStockCsvRow {
  vendorCode: string;
  quantity: number;
}

export type OwnStockInputFormat = "csv" | "spreadsheet";

export type OwnStockCsvParseIssue = {
  lineNumber: number;
  reason: string;
  raw: Record<string, unknown>;
};

/**
 * Diagnostics about how the auto-detector classified the input headers.
 * Surfaced to the operator (forecast UI upload response) so that mismatches
 * — e.g. picking the wrong column as the WB article — are visible.
 */
export interface OwnStockCsvDetection {
  /** Column whose values are used as `vendorCode` in the DB. */
  vendorColumn: string | null;
  /** Column classified as WB article (6–10 digit numeric ID). Informational. */
  wbColumn: string | null;
  /** Column with the integer stock value. */
  quantityColumn: string | null;
  /**
   * Unit-of-measure column when present (`Единица измерения`, `Единица товара`).
   * Used to ignore duplicated box/package rows in Sku Simple exports.
   */
  unitColumn: string | null;
  /** Delimiter for CSV inputs (`,`, `;` or `\t`); empty for spreadsheets. */
  delimiter: string;
  /** Physical input family selected by the parser. */
  format: OwnStockInputFormat;
  /** Worksheet name for spreadsheet inputs. */
  sheetName: string | null;
}

export interface OwnStockCsvParseResult {
  rows: OwnStockCsvRow[];
  issues: OwnStockCsvParseIssue[];
  detection: OwnStockCsvDetection;
  /** Rows intentionally ignored, e.g. duplicated box/package rows. */
  filteredOut: number;
}

interface SourceRecord {
  lineNumber: number;
  raw: Record<string, string>;
}

interface ParseRecordsOptions {
  filterReason?: (
    record: Record<string, string>,
    detection: OwnStockCsvDetection,
  ) => string | null;
}

/**
 * Parse an "own warehouse stock" import buffer, auto-selecting CSV vs Excel.
 *
 * CSV remains the historical format. Binary `.xls` / `.xlsx` files are parsed
 * as spreadsheets and then passed through the same header/value detector.
 */
export function parseOwnStockInput(
  content: Buffer | string,
  sourceFile?: string,
): OwnStockCsvParseResult {
  if (looksLikeSpreadsheet(content, sourceFile)) {
    return parseOwnStockSpreadsheet(content);
  }
  return parseOwnStockCsv(content);
}

/**
 * Parse a CSV buffer with a flexible header.
 *
 * Column detection rules (matches the requirement: classify by header keyword
 * + content of the first data rows):
 *
 *  - Columns whose header contains "артикул" (case-insensitive) are
 *    article columns. At most two are expected — vendor article and WB
 *    article.
 *  - Columns whose header contains "остаток" are stock columns; the first
 *    such column wins.
 *  - An article column is classified as **WB** iff most of its non-empty
 *    sample values (first 10 data rows) match `^\d{6,10}$`. Otherwise it is
 *    treated as the **vendor** article column.
 *  - The vendor column is preferred as the source of `vendorCode`. If the
 *    vendor column is empty for a given row but the WB column is present,
 *    the WB article (as a string) is used as the row's `vendorCode` — the
 *    DB only stores one identifier per row, so we never silently drop a
 *    row that has *some* article.
 *
 * Numeric parsing for `Остаток` matches the existing `store/*.py` scripts:
 *   - empty → 0,
 *   - "1 234" / "1,5" → 1234 / 1,
 *   - "1 234 шт" → 1234,
 *   - non-numeric → row reported as an issue and skipped.
 *
 * Delimiter is auto-detected from the first non-empty line (`,`, `;`, `\t`).
 */
export function parseOwnStockCsv(
  content: Buffer | string,
): OwnStockCsvParseResult {
  const text = typeof content === "string" ? content : content.toString("utf8");
  const stripped = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(stripped);

  const csvRecords = parse(stripped, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter,
  }) as Record<string, string>[];

  const firstRecord = csvRecords[0];
  const headers = firstRecord ? Object.keys(firstRecord) : [];
  const records = csvRecords.map((raw, idx) => ({
    lineNumber: idx + 2,
    raw,
  }));
  const detection = detectColumns(headers, csvRecords, {
    delimiter,
    format: "csv",
    sheetName: null,
  });

  return parseDetectedRecords(records, detection, {
    filterReason: skuSimpleDuplicateRowReason,
  });
}

/**
 * Parse Excel-compatible stock exports (`.xls`, `.xlsx`) used by Sku Simple.
 *
 * The export contains duplicate rows for product units and boxes. For the own
 * warehouse snapshot we keep only piece rows:
 *   - `Остаток, шт` must not mention `кор`;
 *   - if a unit column is present, it must be a piece unit (`шт`/`штука`...).
 */
export function parseOwnStockSpreadsheet(
  content: Buffer | string,
): OwnStockCsvParseResult {
  const buf = typeof content === "string" ? Buffer.from(content) : content;
  const workbook = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0] ?? null;
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheetName || !sheet) {
    return {
      rows: [],
      issues: [
        {
          lineNumber: 1,
          reason: "spreadsheet contains no worksheets",
          raw: {},
        },
      ],
      detection: emptyDetection("spreadsheet", "", null),
      filteredOut: 0,
    };
  }

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown[][];
  const headerRowIndex = findSpreadsheetHeaderRow(matrix);
  if (headerRowIndex === -1) {
    return {
      rows: [],
      issues: [
        {
          lineNumber: 1,
          reason: 'no header row with "Артикул" and "Остаток" detected',
          raw: { sheetName },
        },
      ],
      detection: emptyDetection("spreadsheet", "", sheetName),
      filteredOut: 0,
    };
  }

  const headers = (matrix[headerRowIndex] ?? []).map(cellToText);
  const records = spreadsheetRecords(matrix, headers, headerRowIndex + 1);
  const detection = detectColumns(
    headers.filter((h) => h !== ""),
    records.map((r) => r.raw),
    {
      delimiter: "",
      format: "spreadsheet",
      sheetName,
    },
  );

  return parseDetectedRecords(records, detection, {
    filterReason: skuSimpleDuplicateRowReason,
  });
}

function parseDetectedRecords(
  records: SourceRecord[],
  detection: OwnStockCsvDetection,
  options: ParseRecordsOptions = {},
): OwnStockCsvParseResult {
  const rows: OwnStockCsvRow[] = [];
  const issues: OwnStockCsvParseIssue[] = [];
  let filteredOut = 0;

  if (!detection.quantityColumn) {
    records.forEach((rec) => {
      issues.push({
        lineNumber: rec.lineNumber,
        reason: 'no column with "Остаток" detected',
        raw: rec.raw,
      });
    });
    return { rows, issues, detection, filteredOut };
  }
  if (!detection.vendorColumn && !detection.wbColumn) {
    records.forEach((rec) => {
      issues.push({
        lineNumber: rec.lineNumber,
        reason: 'no column with "Артикул" detected',
        raw: rec.raw,
      });
    });
    return { rows, issues, detection, filteredOut };
  }

  const primaryColumn = detection.vendorColumn ?? detection.wbColumn ?? "";
  const fallbackColumn =
    detection.vendorColumn && detection.wbColumn ? detection.wbColumn : null;

  records.forEach((rec) => {
    const filterReason = options.filterReason?.(rec.raw, detection) ?? null;
    if (filterReason) {
      filteredOut += 1;
      return;
    }

    const primary = (rec.raw[primaryColumn] ?? "").trim();
    const fallback = fallbackColumn
      ? (rec.raw[fallbackColumn] ?? "").trim()
      : "";
    const vendorCode = primary !== "" ? primary : fallback;
    if (vendorCode === "") {
      issues.push({
        lineNumber: rec.lineNumber,
        reason: `missing "${primaryColumn}"`,
        raw: rec.raw,
      });
      return;
    }

    const rawQty = rec.raw[detection.quantityColumn ?? ""] ?? "";
    const qty = parseStockQuantity(rawQty);
    if (qty === null) {
      issues.push({
        lineNumber: rec.lineNumber,
        reason: `"${detection.quantityColumn}"="${rawQty}" is not a valid integer`,
        raw: rec.raw,
      });
      return;
    }

    rows.push({ vendorCode, quantity: qty });
  });

  return { rows, issues, detection, filteredOut };
}

function looksLikeSpreadsheet(
  content: Buffer | string,
  sourceFile?: string,
): boolean {
  if (sourceFile && /\.(?:xls|xlsx|xlsm)$/iu.test(sourceFile)) return true;
  if (!Buffer.isBuffer(content)) return false;
  return isOleCompoundDocument(content) || isZipWorkbook(content);
}

function isOleCompoundDocument(buf: Buffer): boolean {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return signature.every((byte, idx) => buf[idx] === byte);
}

function isZipWorkbook(buf: Buffer): boolean {
  return buf[0] === 0x50 && buf[1] === 0x4b;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const score = (ch: string): number =>
    (firstLine.match(new RegExp(`\\${ch}`, "g")) ?? []).length;
  const comma = score(",");
  const semi = score(";");
  const tab = (firstLine.match(/\t/g) ?? []).length;
  if (tab > comma && tab > semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

const ARTICLE_RE = /артикул/iu;
const QUANTITY_RE = /остаток/iu;
const WB_ID_RE = /^\d{6,10}$/;

function detectColumns(
  headers: string[],
  records: Record<string, string>[],
  meta: Pick<OwnStockCsvDetection, "delimiter" | "format" | "sheetName">,
): OwnStockCsvDetection {
  const articleHeaders = headers.filter((h) => ARTICLE_RE.test(h));
  const quantityHeaders = headers.filter((h) => QUANTITY_RE.test(h));
  const quantityColumn = quantityHeaders[0] ?? null;
  const unitColumn = detectUnitColumn(headers);

  let vendorColumn: string | null = null;
  let wbColumn: string | null = null;

  if (articleHeaders.length === 1) {
    const only = articleHeaders[0]!;
    if (classifyAsWb(only, records)) wbColumn = only;
    else vendorColumn = only;
  } else if (articleHeaders.length >= 2) {
    const scored = articleHeaders
      .map((h) => ({ h, score: wbFraction(h, records) }))
      .sort((a, b) => b.score - a.score);
    wbColumn = scored[0]!.h;
    vendorColumn = scored.find((s) => s.h !== wbColumn)?.h ?? null;
    // Если ни одно из значений не похоже на WB ID — лучше считать оба
    // продавцовскими и не выдумывать. Берём первый как vendor, второй игнорим.
    if (scored[0]!.score === 0) {
      wbColumn = null;
      vendorColumn = articleHeaders[0]!;
    }
  }

  return {
    vendorColumn,
    wbColumn,
    quantityColumn,
    unitColumn,
    delimiter: meta.delimiter,
    format: meta.format,
    sheetName: meta.sheetName,
  };
}

function emptyDetection(
  format: OwnStockInputFormat,
  delimiter: string,
  sheetName: string | null,
): OwnStockCsvDetection {
  return {
    vendorColumn: null,
    wbColumn: null,
    quantityColumn: null,
    unitColumn: null,
    delimiter,
    format,
    sheetName,
  };
}

function detectUnitColumn(headers: string[]): string | null {
  const exactMeasure = headers.find((h) => /^единица\s+измерения$/iu.test(h));
  if (exactMeasure) return exactMeasure;
  const exactItemUnit = headers.find((h) => /^единица\s+товара$/iu.test(h));
  if (exactItemUnit) return exactItemUnit;
  return headers.find((h) => /единиц/iu.test(h)) ?? null;
}

function classifyAsWb(
  header: string,
  records: Record<string, string>[],
): boolean {
  return wbFraction(header, records) >= 0.5;
}

function wbFraction(header: string, records: Record<string, string>[]): number {
  const sample = records.slice(0, 10);
  let nonEmpty = 0;
  let hits = 0;
  for (const r of sample) {
    const raw = (r[header] ?? "").trim();
    if (raw === "") continue;
    nonEmpty += 1;
    const normalized = raw.replace(/\s+/g, "");
    if (WB_ID_RE.test(normalized)) hits += 1;
  }
  if (nonEmpty === 0) return 0;
  return hits / nonEmpty;
}

function findSpreadsheetHeaderRow(rows: unknown[][]): number {
  const maxScan = Math.min(rows.length, 30);
  for (let idx = 0; idx < maxScan; idx += 1) {
    const cells = rows[idx] ?? [];
    const headers = cells.map(cellToText);
    if (
      headers.some((h) => ARTICLE_RE.test(h)) &&
      headers.some((h) => QUANTITY_RE.test(h))
    ) {
      return idx;
    }
  }
  return -1;
}

function spreadsheetRecords(
  rows: unknown[][],
  headers: string[],
  firstDataRowIndex: number,
): SourceRecord[] {
  const out: SourceRecord[] = [];
  for (let rowIdx = firstDataRowIndex; rowIdx < rows.length; rowIdx += 1) {
    const cells = rows[rowIdx] ?? [];
    const raw: Record<string, string> = {};
    let hasValue = false;
    for (let colIdx = 0; colIdx < headers.length; colIdx += 1) {
      const header = headers[colIdx] ?? "";
      if (!header) continue;
      const value = cellToText(cells[colIdx]);
      raw[header] = value;
      if (value.trim() !== "") hasValue = true;
    }
    if (hasValue) {
      out.push({ lineNumber: rowIdx + 1, raw });
    }
  }
  return out;
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/^\uFEFF/, "")
    .trim();
}

function skuSimpleDuplicateRowReason(
  record: Record<string, string>,
  detection: OwnStockCsvDetection,
): string | null {
  const quantityColumn = detection.quantityColumn;
  if (quantityColumn) {
    const rawQty = record[quantityColumn] ?? "";
    if (mentionsBoxes(rawQty)) return "stock cell contains box quantity";
  }

  const unitColumn = detection.unitColumn;
  if (unitColumn) {
    const unit = classifyUnit(record[unitColumn] ?? "");
    if (unit !== null && unit !== "pieces") return "unit is not pieces";
  }

  return null;
}

function mentionsBoxes(value: string): boolean {
  return normalizeText(value).toLocaleLowerCase("ru").includes("кор");
}

type UnitKind = "pieces" | "boxes" | "other";

function classifyUnit(value: string): UnitKind | null {
  const normalized = normalizeText(value)
    .toLocaleLowerCase("ru")
    .replace(/\./g, "");
  if (!normalized) return null;
  if (/^(?:шт|штук|штука|штуки)$/iu.test(normalized)) return "pieces";
  if (/^(?:кор|короб|коробка|коробки|коробов)$/iu.test(normalized)) {
    return "boxes";
  }
  return "other";
}

/**
 * Mirrors `parse_int` used in store/*.py:
 *   - strips spaces
 *   - removes piece unit suffixes when present
 *   - replaces comma with dot (to survive "1,5")
 *   - empty → 0
 *   - otherwise floor-rounds to integer
 */
function parseStockQuantity(value: string): number | null {
  const withoutPieces = normalizeText(value).replace(
    /(?:штук[аи]?|шт\.?)/giu,
    "",
  );
  const normalized = withoutPieces.replace(/\s+/g, "").replace(",", ".");
  if (normalized === "") return 0;
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
