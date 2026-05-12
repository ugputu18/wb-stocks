import type { ServerResponse } from "node:http";
import { buildContentDisposition } from "./contentDispositionFilename.js";

/**
 * Стандартный Content-Type для `.xlsx` (Office Open XML — SpreadsheetML).
 * Excel, LibreOffice и Google Sheets опознают этот MIME при скачивании.
 */
export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Отдаёт XLSX-буфер браузеру как файл-аттач. Парный аналог бывшего
 * `sendCsvAttachment`, но без BOM (XLSX — бинарь, UTF-8 закодирован
 * внутри XML-частей zip-архива; никаких локалезависимых проблем при
 * открытии, ради чего мы и ушли с CSV).
 *
 * Имя файла безопасно для не-ASCII: Cyrillic-имена кодируются в
 * RFC 5987 `filename*=UTF-8''…`, а в легаси-`filename=` подставляется
 * ASCII-fallback (см. `contentDispositionFilename`).
 */
export function sendXlsxAttachment(
  res: ServerResponse,
  filename: string,
  body: Buffer,
): void {
  res.writeHead(200, {
    "Content-Type": XLSX_CONTENT_TYPE,
    "Content-Disposition": buildContentDisposition(filename, "download.xlsx"),
    "Content-Length": String(body.length),
  });
  res.end(body);
}
