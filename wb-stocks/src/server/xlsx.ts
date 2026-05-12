import ExcelJS from "exceljs";

/**
 * Serialize a flat list of plain objects into an XLSX workbook **buffer**.
 *
 * Контракт — намеренно зеркало бывшего `toCsv` из `csv.ts`:
 *
 * - Шапка строится из `columns`; объекты `rows` могут содержать только эти
 *   ключи (лишние молча игнорируются), как и в CSV-варианте — это позволяет
 *   общим мапперам строк (`*RowsToExportObjects`) работать без изменений.
 * - Ячейки заполняются "как есть": JS-`number` остаётся числом в Excel
 *   (важно — это и есть главная причина миграции с CSV: на разных локалях
 *   `0.5` vs `0,5` ломали парсинг чисел), строки остаются строкой, `null`
 *   и `undefined` превращаются в пустую ячейку.
 * - Возвращается `Buffer` — готов к отдаче в HTTP-ответ
 *   (см. `sendXlsxAttachment`).
 *
 * Имя листа по умолчанию короткое и ASCII-only (`Report`) — Excel
 * ограничивает имя 31 символом и запрещает несколько специальных
 * символов; пусть вызывающие сами решают, нужно ли локализовать.
 */
export async function toXlsxBuffer(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<string>,
  options: { sheetName?: string } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "wb-stocks";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sanitizeSheetName(options.sheetName));

  // `worksheet.columns` принимает массив `{ header, key, width }`. Мы
  // используем сам заголовок и как `header`, и как `key` — тогда
  // `addRow(row)` ставит значения по тем же ключам, что и в исходных
  // объектах из мапперов (`row[col]`).
  sheet.columns = columns.map((c) => ({
    header: c,
    key: c,
    width: defaultColumnWidth(c),
  }));

  // Сделаем шапку жирной — это типовая привычка пользователей Excel.
  // Стиль ставится на ряд №1 после задания `sheet.columns`.
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };

  for (const row of rows) {
    const projected: Record<string, unknown> = {};
    for (const col of columns) {
      const v = row[col];
      projected[col] = v === null || v === undefined ? "" : v;
    }
    sheet.addRow(projected);
  }

  // `writeBuffer` возвращает Node-`Buffer` под Node.js — типизация
  // exceljs шире (Browser ArrayBuffer / Node Buffer), здесь safe-cast.
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

/**
 * Имя листа в Excel:
 * - не длиннее 31 символа,
 * - не должно содержать `: \ / ? * [ ]`,
 * - не должно начинаться или заканчиваться на одинарную кавычку.
 *
 * Заменяем запрещённые символы на `_` и обрезаем длину; пустую строку
 * откатываем на `Report`.
 */
function sanitizeSheetName(raw: string | undefined): string {
  if (!raw) return "Report";
  const cleaned = raw.replace(/[:\\/?*\[\]]/g, "_").replace(/^'+|'+$/g, "");
  const truncated = cleaned.slice(0, 31).trim();
  return truncated.length > 0 ? truncated : "Report";
}

/**
 * Заголовок задаёт минимальную ширину колонки: для коротких имён
 * добавляем небольшой запас, для длинных — отдаём по длине шапки.
 * Это не идеальная авто-подгонка (для неё пришлось бы сканировать
 * все значения), но для аналитических выгрузок выглядит читаемо.
 */
function defaultColumnWidth(header: string): number {
  const base = header.length + 2;
  if (base < 12) return 12;
  if (base > 40) return 40;
  return base;
}
