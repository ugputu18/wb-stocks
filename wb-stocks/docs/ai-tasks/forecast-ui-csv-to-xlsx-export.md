# Forecast UI: миграция выгрузок CSV → XLSX

## Зачем

Аналитики жаловались, что открытие CSV-выгрузок прогноза в Excel постоянно
ломалось из-за локалезависимого парсинга:

- `0.5` в локалях с `,` как десятичным разделителем превращалось в строку или
  «5 января» (Excel пытался угадать дату).
- Длинные `nm_id` (8–9 цифр) автоформатировались в экспоненту, после чего
  склейка с другими таблицами по `nm_id` ломалась.
- Кириллица в заголовках/значениях («Риск», «Доступно в регионе», макрорегионы
  типа «Центральный») открывалась с битой кодировкой у пользователей, чьи
  Excel-настройки не совпадали с UTF-8.

В XLSX (Office Open XML) каждая ячейка несёт свой тип (`n` для number, `s` для
shared string, …), а кодировка фиксирована UTF-8 внутри ZIP-архива, поэтому
все три проблемы исчезают «бесплатно».

## Что сделано

Заменены **все три экспорт-роута** прогноза:

| Endpoint                                         | Старое имя файла               | Новое имя файла                  |
| ------------------------------------------------ | ------------------------------ | -------------------------------- |
| `GET /api/forecast/export-wb`                    | `wb-replenishment-…csv`        | `wb-replenishment-…xlsx`         |
| `GET /api/forecast/export-supplier`              | `supplier-replenishment-…csv`  | `supplier-replenishment-…xlsx`   |
| `GET /api/forecast/export-regional-stocks`       | `regional-stocks-…csv`         | `regional-stocks-…xlsx`          |

UI-кнопки переименованы: «Скачать WB CSV» → «Скачать WB Excel»,
«Скачать Supplier CSV» → «Скачать Supplier Excel», «Экспорт в CSV» → «Экспорт
в Excel». Импорт остатков нашего склада (`POST /api/forecast/upload-own-stocks`)
сознательно **остался на CSV** — оператор грузит выгрузку из 1С/склада в её
родном формате, входной парсинг локалезависимым не страдает.

## Ключевые точки кода

- `src/server/xlsx.ts` — `toXlsxBuffer(rows, columns, { sheetName })`. Зеркало
  бывшего `toCsv`: контракт «объекты с произвольными ключами + явный список
  колонок» сохранён, поэтому мапперы строк работают без правок (только
  переименованы из `…RowsToCsvObjects` в `…RowsToExportObjects`). Числовые
  JS-значения уходят как числа, `null`/`undefined` → пустая ячейка.
- `src/server/forecast-ui/http/contentDispositionFilename.ts` — выделенный
  билдер RFC 5987-совместимого `Content-Disposition`. Был внутри
  `sendCsvAttachment.ts`, теперь шарится между потенциальными отправителями
  файлов.
- `src/server/forecast-ui/http/sendXlsxAttachment.ts` — пишет XLSX-буфер с
  правильным MIME (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
  и `Content-Length`. BOM **не нужен** (XLSX — бинарь).
- `src/server/forecast-ui/export/forecastExportMappers.ts` — раньше лежал в
  `forecast-ui/csv/`; директория переименована, имена колонок и порядок
  оставлены 1:1 с прежней CSV-выгрузкой (контракт для аналитических шаблонов).
- `forecast-ui-client/src/api/client.ts` — `downloadForecastCsv` →
  `downloadForecastFile` (универсальное имя, `Accept` обновлён на xlsx-MIME),
  парсинг `Content-Disposition` (включая `filename*=UTF-8''…`) сохранён.

Удалены как мёртвый код:
- `src/server/csv.ts`
- `src/server/forecast-ui/http/sendCsvAttachment.ts`
- `test/csv.test.ts`, `test/sendCsvAttachment.test.ts`

Добавлены: `test/xlsx.test.ts` (round-trip с `exceljs.load` — числа остаются
числами, кириллица сохраняется, имя листа санитизируется),
`test/sendXlsxAttachment.test.ts` (повторяет покрытие старого
sendCsvAttachment-теста: ASCII / Cyrillic / fallback на `download.xlsx` /
правильные заголовки).

## Зависимости

- `exceljs@4.4.0` (production-dep `wb-stocks/package.json`). Это самая
  массовая Node-обёртка над XLSX, MIT-лицензия, есть встроенные TS-типы.
  Подтянулись типовые транзитивные зависимости (`archiver`/`unzipper` и т.п.) —
  ничего нативного, билд не нужен.

## Совместимость

- Имя файла осталось тем же модулем форматирования (только расширение `.csv`
  → `.xlsx`); скрипты у аналитиков, которые ловят файл по префиксу, продолжают
  работать.
- Колонки и их порядок в выгрузках сохранены 1:1 — макрос/Power Query на
  стороне аналитика, который ссылается на «3-й столбец = vendor_code», ничего
  не заметит.
- `will_stockout_before_arrival` в supplier-выгрузке оставлен строкой
  `"true"/"false"` (как было в CSV), чтобы фильтры точного совпадения не
  поломались. Если будут просить boolean — поменять в
  `supplierRowsToExportObjects`.

## Как проверить локально

```bash
cd wb-stocks
pnpm typecheck            # tsc по серверу
pnpm typecheck:forecast-ui-client  # tsc по preact-клиенту
pnpm test                 # vitest: 360 тестов, в т.ч. test/xlsx.test.ts
pnpm serve:forecast-ui    # поднять API+SPA на http://localhost:3000
# В UI нажать «Скачать WB Excel» / «Скачать Supplier Excel» / на странице
# «Запасы WB по региону» — «Экспорт в Excel». Открыть в Excel/Numbers/
# LibreOffice → числа должны быть числами, кириллица — без артефактов.
```
