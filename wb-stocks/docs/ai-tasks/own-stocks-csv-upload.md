# Own-warehouse stocks CSV upload from the forecast UI

Operators can now load "our warehouse" stock snapshots directly from the
forecast UI main page, without dropping files into `store/our<MMDD>.csv` and
running the CLI on the server. The new button sits next to **«Скачать WB CSV»**
and **«Скачать Supplier CSV»** in `ActionsBar` and is labelled
**«Загрузить остатки CSV»**.

## What changed

### Parser: header-aware auto-detection

`src/application/parseOwnStockCsv.ts` used to require the literal column
names `"Артикул"` and `"Остаток"`. It now:

- Auto-detects the delimiter (`,`, `;`, or `\t`) from the first line.
- Picks the stock column by header keyword: the first column whose name
  contains `остаток` (case- and Unicode-insensitive).
- Finds **article** columns by header keyword `артикул` (max 2 expected) and
  classifies each by inspecting up to the first 10 non-empty values:
  - If the majority match `^\d{6,10}$` → that column is the **WB article**
    (`nmId`) column.
  - Otherwise it is treated as the **seller / vendor article** column.
- The vendor article column is the preferred source of `vendorCode` for the
  DB. If a row's vendor cell is empty but its WB cell is non-empty, the WB
  ID (as a string) is used as `vendorCode` for that row, so we never silently
  drop a row that has *some* identifier.
- Returns a new `detection: { vendorColumn, wbColumn, quantityColumn, delimiter }`
  block so the UI can show exactly how the input was interpreted.

All existing tests still pass because `"Артикул"` / `"Остаток"` both contain
the keywords and the existing values (`"0120exp"`, `"0294"`, etc.) are not
6–10 digit numbers, so they classify as vendor articles.

Tests live in `test/parseOwnStockCsv.test.ts` and now cover:

- The demo format from the task: `Артикул продавца,Артикул WB,Остаток склад Канпол рус`.
- Empty vendor cell → fallback to WB article as `vendorCode`.
- WB-only header → WB column used as the key.
- Semicolon delimiter + case-insensitive header match.
- Missing `Остаток` / `Артикул` columns are reported as parse issues.

### Server route: `POST /api/forecast/upload-own-stocks`

New handler `src/server/forecast-ui/handlers/uploadOwnStocksRoute.ts`,
wired through `buildForecastUiApiRoutes`. Contract:

```http
POST /api/forecast/upload-own-stocks?date=YYYY-MM-DD&warehouse=<code>&filename=<basename>
Content-Type: text/csv; charset=utf-8
Authorization: Bearer <FORECAST_UI_TOKEN>   # if configured

<raw CSV bytes>
```

All query params are optional:

- `date` — snapshot date; defaults to server-local today.
- `warehouse` — warehouse code; defaults to `main`.
- `filename` — informational, persisted into `source_file`.

Response (200) is the unchanged `ImportOwnWarehouseStateResult` shape plus
`ok: true`, `detection` and `issues`. Validation errors (bad date, empty
body, no recognizable columns) return 400 with a Russian `error` message.

Idempotency is unchanged: `OwnStockSnapshotRepository.replaceForDate` wipes
and rewrites the `(snapshotDate, warehouseCode)` set in one transaction.

Test: `test/uploadOwnStocksRoute.test.ts` covers the happy path with the
demo CSV, an empty body, and a malformed `date` query param.

### Client UI

- `forecast-ui-client/src/api/client.ts` gained `uploadOwnStocksCsv(file, params, token)`.
- `forecast-ui-client/src/hooks/useForecastActions.ts` gained
  `runUploadOwnStocks(file)` and a new `"upload-own-stocks"` value in the
  `ActionBusy` union.
- `forecast-ui-client/src/components/ActionsBar.tsx` now renders a third
  button **«Загрузить остатки CSV»** that opens a hidden
  `<input type="file" accept=".csv,text/csv">`. After a successful upload
  the page reloads via the existing `reload(form, apiToken)` pipeline, so
  the new stocks show up in the forecast tables immediately.
- The status line reports the inserted / skipped counts and the column
  names the server actually picked, e.g.:

  > Остатки загружены: 4 строк (пропущено 0, создано за 2026-05-12;
  > колонки: vendor=«Артикул продавца», WB=«Артикул WB»,
  > остаток=«Остаток склад Канпол рус»).

The selected snapshot **date** comes from `form.snapshotDate` and the
warehouse code from `form.ownWarehouseCode` (empty → server default `main`).

## How to use

1. Build the SPA: `pnpm build:forecast-ui-client`.
2. Run the server: `pnpm serve:forecast-ui`.
3. Open the main page, choose the desired «Дата среза» (and optionally
   «Свой склад») in the filters form, click **«Загрузить остатки CSV»**, and
   pick a CSV like:

   ```csv
   Артикул продавца,Артикул WB,Остаток склад Канпол рус
   35/368_gre,507833572,75
   23/222_blu_NEW,488894119,0
   35/368_blu,,0
   35/368_bei,507833580,459
   ```

4. The status line shows the result; the page reloads automatically.

The existing CLI flow (`pnpm import:own-stocks --file=…`) still works and
shares the same parser, so files uploaded via the UI and files imported via
the CLI are equivalent.
