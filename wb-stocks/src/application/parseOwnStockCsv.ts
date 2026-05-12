import { parse } from "csv-parse/sync";

/**
 * Raw logical row read from an "our warehouse" CSV.
 *
 * The schema below only carries the two fields that the snapshot needs
 * (`vendorCode` and `quantity`): everything else in the source CSV
 * (потребность, резерв, WB article column, etc.) is planning metadata and
 * is dropped intentionally.
 */
export interface OwnStockCsvRow {
  vendorCode: string;
  quantity: number;
}

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
  /** Delimiter we ended up parsing with (`,`, `;` or `\t`). */
  delimiter: string;
}

export interface OwnStockCsvParseResult {
  rows: OwnStockCsvRow[];
  issues: OwnStockCsvParseIssue[];
  detection: OwnStockCsvDetection;
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
 *   - "1 234" / "1,234" → 1234,
 *   - non-numeric → row reported as an issue and skipped.
 *
 * Delimiter is auto-detected from the first non-empty line (`,`, `;`, `\t`).
 */
export function parseOwnStockCsv(content: Buffer | string): OwnStockCsvParseResult {
  const text =
    typeof content === "string" ? content : content.toString("utf8");
  const stripped = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(stripped);

  const records = parse(stripped, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter,
  }) as Record<string, string>[];

  const firstRecord = records[0];
  const headers = firstRecord ? Object.keys(firstRecord) : [];
  const detection = detectColumns(headers, records, delimiter);

  const rows: OwnStockCsvRow[] = [];
  const issues: OwnStockCsvParseIssue[] = [];

  if (!detection.quantityColumn) {
    records.forEach((rec, idx) => {
      issues.push({
        lineNumber: idx + 2,
        reason: 'no column with "Остаток" detected',
        raw: rec,
      });
    });
    return { rows, issues, detection };
  }
  if (!detection.vendorColumn && !detection.wbColumn) {
    records.forEach((rec, idx) => {
      issues.push({
        lineNumber: idx + 2,
        reason: 'no column with "Артикул" detected',
        raw: rec,
      });
    });
    return { rows, issues, detection };
  }

  const primaryColumn = detection.vendorColumn ?? detection.wbColumn ?? "";
  const fallbackColumn =
    detection.vendorColumn && detection.wbColumn ? detection.wbColumn : null;

  records.forEach((rec, idx) => {
    const lineNumber = idx + 2;
    const primary = (rec[primaryColumn] ?? "").trim();
    const fallback = fallbackColumn ? (rec[fallbackColumn] ?? "").trim() : "";
    const vendorCode = primary !== "" ? primary : fallback;
    if (vendorCode === "") {
      issues.push({
        lineNumber,
        reason: `missing "${primaryColumn}"`,
        raw: rec,
      });
      return;
    }

    const rawQty = rec[detection.quantityColumn ?? ""] ?? "";
    const qty = parseIntLoose(rawQty);
    if (qty === null) {
      issues.push({
        lineNumber,
        reason: `"${detection.quantityColumn}"="${rawQty}" is not a valid integer`,
        raw: rec,
      });
      return;
    }

    rows.push({ vendorCode, quantity: qty });
  });

  return { rows, issues, detection };
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
  delimiter: string,
): OwnStockCsvDetection {
  const articleHeaders = headers.filter((h) => ARTICLE_RE.test(h));
  const quantityHeaders = headers.filter((h) => QUANTITY_RE.test(h));
  const quantityColumn = quantityHeaders[0] ?? null;

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

  return { vendorColumn, wbColumn, quantityColumn, delimiter };
}

function classifyAsWb(
  header: string,
  records: Record<string, string>[],
): boolean {
  return wbFraction(header, records) >= 0.5;
}

function wbFraction(
  header: string,
  records: Record<string, string>[],
): number {
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

/**
 * Mirrors `parse_int` used in store/*.py:
 *   - strips spaces
 *   - replaces comma with dot (to survive "1,5")
 *   - empty → 0
 *   - otherwise floor-rounds to integer
 */
function parseIntLoose(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  if (normalized === "") return 0;
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}
