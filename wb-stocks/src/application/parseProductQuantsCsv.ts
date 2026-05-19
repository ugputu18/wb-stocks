import { parse } from "csv-parse/sync";
import { normalizeUnitsPerBox } from "../domain/productQuant.js";

export interface ProductQuantCsvRow {
  vendorCode: string;
  unitsPerBox: number;
}

export interface ProductQuantCsvParseIssue {
  lineNumber: number;
  reason: string;
  raw: Record<string, unknown>;
}

export interface ProductQuantCsvDetection {
  vendorColumn: string | null;
  quantColumn: string | null;
  delimiter: string;
}

export interface ProductQuantCsvParseResult {
  rows: ProductQuantCsvRow[];
  issues: ProductQuantCsvParseIssue[];
  detection: ProductQuantCsvDetection;
  defaulted: number;
  skippedBlankVendor: number;
}

export function parseProductQuantsCsv(
  content: Buffer | string,
): ProductQuantCsvParseResult {
  const text = typeof content === "string" ? content : content.toString("utf8");
  const stripped = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(stripped);
  const records = parse(stripped, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: false,
    relax_column_count: true,
    delimiter,
  }) as Record<string, string>[];

  const headers = records[0] ? Object.keys(records[0]) : [];
  const vendorColumn = detectVendorColumn(headers);
  const quantColumn = detectQuantColumn(headers);
  const detection: ProductQuantCsvDetection = {
    vendorColumn,
    quantColumn,
    delimiter,
  };

  const rows: ProductQuantCsvRow[] = [];
  const issues: ProductQuantCsvParseIssue[] = [];
  let defaulted = 0;
  let skippedBlankVendor = 0;

  for (const [index, raw] of records.entries()) {
    const lineNumber = index + 2;
    if (!vendorColumn) {
      issues.push({
        lineNumber,
        reason: 'no column with "Артикул" detected',
        raw,
      });
      continue;
    }
    if (!quantColumn) {
      issues.push({
        lineNumber,
        reason: 'no column with "квант" detected',
        raw,
      });
      continue;
    }

    const vendorCode = (raw[vendorColumn] ?? "").trim();
    if (!vendorCode) {
      skippedBlankVendor += 1;
      continue;
    }

    const rawQuant = (raw[quantColumn] ?? "").trim();
    const parsed = parseInteger(rawQuant);
    const unitsPerBox = normalizeUnitsPerBox(parsed);
    if (parsed === null || unitsPerBox !== parsed) {
      defaulted += 1;
      issues.push({
        lineNumber,
        reason: `"${quantColumn}"="${rawQuant}" defaulted to 1`,
        raw,
      });
    }
    rows.push({ vendorCode, unitsPerBox });
  }

  return { rows, issues, detection, defaulted, skippedBlankVendor };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const comma = (firstLine.match(/,/g) ?? []).length;
  const semi = (firstLine.match(/;/g) ?? []).length;
  const tab = (firstLine.match(/\t/g) ?? []).length;
  if (tab > comma && tab > semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

function detectVendorColumn(headers: readonly string[]): string | null {
  return headers.find((h) => /артикул|vendor/i.test(h.trim())) ?? null;
}

function detectQuantColumn(headers: readonly string[]): string | null {
  return headers.find((h) => /квант|quant|box/i.test(h.trim())) ?? null;
}

function parseInteger(value: string): number | null {
  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
