import type { ServerResponse } from "node:http";

export const CSV_UTF8_BOM = "\uFEFF";

export function sendCsvAttachment(
  res: ServerResponse,
  filename: string,
  csvBody: string,
): void {
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(CSV_UTF8_BOM + csvBody, "utf8");
}
