/**
 * Minimal RFC-style CSV (comma-separated, double-quote escape), UTF-8.
 */

function cellString(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

function escapeField(s: string): string {
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param rows — each object may only contain keys from `columns`; other keys ignored.
 * @param columns — header row and column order.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map((c) => escapeField(c)).join(",");
  const lines: string[] = [header];
  for (const row of rows) {
    const line = columns
      .map((c) => escapeField(cellString(row[c])))
      .join(",");
    lines.push(line);
  }
  return lines.join("\r\n");
}
