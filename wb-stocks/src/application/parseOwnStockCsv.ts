import { parse } from "csv-parse/sync";

/**
 * Raw logical row read from the "our warehouse" CSV.
 * We only surface the two fields that the snapshot cares about;
 * additional columns (like "Потребность" or "Потребность WB 56") are
 * metadata / planning overlays and are intentionally dropped here.
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

export interface OwnStockCsvParseResult {
  rows: OwnStockCsvRow[];
  issues: OwnStockCsvParseIssue[];
}

const VENDOR_CODE_KEY = "Артикул";
const QUANTITY_KEY = "Остаток";

/**
 * Parse a CSV buffer in the shape used by `store/our<MMDD>.csv`.
 *
 * Semantics (matching the existing Python scripts in `store/`):
 *   - Empty "Остаток" is treated as 0 (same convention as
 *     `store/update_our0418_wb56.py :: parse_int`).
 *   - Values like "1 234" or "1,234" are normalized to 1234.
 *   - A row with a missing / empty "Артикул" is rejected with an issue.
 *   - A row whose "Остаток" is non-numeric after normalization is rejected.
 *
 * Extra columns in the input are ignored by design — they describe planning,
 * not physical stock.
 */
export function parseOwnStockCsv(content: Buffer | string): OwnStockCsvParseResult {
  const records = parse(content, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: OwnStockCsvRow[] = [];
  const issues: OwnStockCsvParseIssue[] = [];

  records.forEach((rec, idx) => {
    const lineNumber = idx + 2; // header is line 1
    const vendorCode = (rec[VENDOR_CODE_KEY] ?? "").trim();
    if (vendorCode === "") {
      issues.push({
        lineNumber,
        reason: `missing "${VENDOR_CODE_KEY}"`,
        raw: rec,
      });
      return;
    }

    const rawQty = rec[QUANTITY_KEY] ?? "";
    const qty = parseIntLoose(rawQty);
    if (qty === null) {
      issues.push({
        lineNumber,
        reason: `"${QUANTITY_KEY}"="${rawQty}" is not a valid integer`,
        raw: rec,
      });
      return;
    }

    rows.push({ vendorCode, quantity: qty });
  });

  return { rows, issues };
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
