# Regional WB stocks: «Склад», «Заказ» и CSV-экспорт

Расширение страницы **«Запасы WB по региону»** (`/forecast-ui/regional-stocks`)
двумя расчётными столбцами и CSV-выгрузкой позиций к заказу.

## Что появилось

Для каждой строки SKU отчёта `RegionalStocksReport` теперь считаются:

- **Нужно** (`recommendedToRegion`) — сколько единиц нужно довезти в регион,
  чтобы закрыть целевое покрытие (`targetCoverageDays`). Это та же величина,
  которая раньше называлась «К довозу»; переименована, чтобы рядом со столбцом
  «Заказ» термины звучали единообразно («Нужно» vs «Заказ»).
- **Склад** (`ownWarehouseStock`) — кол-во единиц этого SKU на нашем
  основном складе (`own_stock_snapshots`, по умолчанию `warehouseCode = "main"`),
  взято из **последнего** снимка через
  `OwnStockSnapshotRepository.quantitiesByVendorLatest(...)`. Лукап ведётся
  по `vendor_code`; если для SKU нет vendor_code или vendor отсутствует в
  снимке — значение `0`.
- **Заказ** (`recommendedOrderQty`) — `min(recommendedToRegion, ownWarehouseStock)`.
  Бизнес-смысл: «сколько реально можно отгрузить в регион прямо сейчас» —
  ограничено сверху и потребностью региона (зачем везти больше, чем нужно),
  и фактическим наличием на нашем складе (больше всё равно не отгрузишь).
  Если `Склад = 0`, то и `Заказ = 0` — даже при ненулевом `Нужно`.

Сводка региона (`summary`) дополнена тоталами `ownWarehouseStockTotal` и
`recommendedOrderQtyTotal`. В ответ JSON также добавлено поле
`ownWarehouseCode` (эхо параметра запроса), чтобы UI/CSV корректно подписывали
столбец «Склад».

### CSV-экспорт

Новый эндпоинт **`GET /api/forecast/export-regional-stocks`** возвращает
позиции, у которых `recommendedOrderQty > 0`. Колонки и их порядок 1:1
повторяют шапку таблицы на странице — оператор открывает файл в Excel и
видит ровно те же столбцы:

```
Риск, vendor, nm_id, Размер,
Доступно в регионе, Спрос/день, Дней запаса, OOS,
Нужно, Склад, Заказ
```

Имя файла — `regional-stocks-{Регион}-{YYYY-MM-DD}-h{horizonDays}.csv`. Не-ASCII
имя региона корректно уезжает через RFC 5987-параметр `filename*=UTF-8''…`
в `Content-Disposition` (см. `sendCsvAttachment`); легаси-параметр
`filename="..."` содержит ASCII-fallback. Файл шлётся с UTF-8 BOM, чтобы
кириллические заголовки правильно открывались в Excel.

## Ключевые решения

- **Никакой новой агрегации по `nm_id+techSize`** для own-stock не вводилось:
  `own_stock_snapshots` хранит остаток по `vendor_code`, и `vendor_code` в
  существующем отчёте уже выбирается на уровне SKU. Это совпадает с тем,
  как `WbForecastReportQueryService` подмешивает `ownStock` в SKU-отчёт.
- **Источник данных для own-stock — `quantitiesByVendorLatest`**, а не привязка
  к дате среза WB. Так же делает основной forecast-отчёт: оператор всегда
  видит «реально лежит сейчас», даже если сегодня снимок WB ещё не подгружен.
- **Параметр `ownWarehouseCode`** добавлен в `parseRegionalStocksQuery` и в
  `BuildRegionalStocksReportInput`. По умолчанию — `"main"` (через общий
  `parseOwnWarehouseCode` / `DEFAULT_OWN_WAREHOUSE_CODE`).
- **Общий загрузчик отчёта**: чтобы read-route и export-route не разъезжались,
  выделен модуль
  `src/server/forecast-ui/queries/loadRegionalStocksReport.ts`. Он отвечает
  за: поиск базового horizon, чтение `wb_forecast_snapshots` и
  `wb_region_demand_snapshots`, расчёт incoming-поставок и подмешивание
  own-stock. Оба роута теперь — тонкие обёртки.
- **Фильтрация «Заказ > 0» — на стороне сервера** в обработчике CSV.
  Так UI-клиент не зависит от наличия токена/доступа: он просто скачивает
  файл и не дублирует бизнес-правило.
- **UI-кнопка экспорта** деактивируется, когда нет позиций к заказу
  (`orderableRowCount === 0`), и параметр `limit` снимается с запроса —
  выгружаем всё, что подходит под фильтры (риск/поиск/регион).

## Как запустить локально

1. Запустить Forecast UI как обычно (`pnpm tsx scripts/serve-forecast-ui.ts`),
   убедиться, что в БД есть свежие `wb_forecast_snapshots`,
   `wb_region_demand_snapshots` и `own_stock_snapshots` (импортируется через
   `scripts/import-own-warehouse-state.ts`).
2. Открыть `/forecast-ui/regional-stocks`, выбрать регион и нажать
   **«Загрузить»** → проверить новые колонки **«Склад»** и **«Заказ»** + новые
   тоталы в сводке.
3. Кнопка **«Экспорт в CSV»** скачает CSV только с позициями, где
   `Заказ > 0`. Файл откроется в Excel (UTF-8 BOM сохранён).

## Тесты

- `test/buildRegionalStocksReport.test.ts` — добавлены кейсы:
  - `looks up own warehouse stock by vendor code and uses min(need, on_hand) for order qty`
  - `treats missing/blank vendor code in own-stock map as zero (and zero order)`
  - проверки `ownWarehouseStockTotal`, `recommendedOrderQtyTotal`,
    `ownWarehouseCode` в существующих тестах.
- Полный backend-suite не запускается локально из-за environmental issue
  `better-sqlite3` (NODE_MODULE_VERSION mismatch на Node 18 при requirement
  Node 20+) — это не связано с этой задачей.
