# Forecast UI: режимы основной таблицы WB (`viewMode`)

## Что сделано

- Read-side представление **WB в целом по SKU** (`wbTotal`, default): агрегация в `WbForecastSnapshotRepository.buildWbTotalBySkuReportRowsFull` — `SUM(forecast_daily_demand)`, `SUM(start_stock + incoming_units)`, `MIN(stockout_date)`, `MIN(stock_snapshot_at)`, риск по `daysOfStockWB` из `daysOfStockWbFromNetworkTotals` в `multiLevelInventory.ts`.
- Режим **по складам** (`wbWarehouses`): прежние строки `listReportRows`.
- **`GET /api/forecast/rows`**, **`summary`**, **`export-wb`**: параметр `viewMode`, ответы с echo `viewMode`.
- UI: селектор «WB в целом» / «По складам WB», таблица и KPI синхронизированы с режимом; supplier-блок без изменения смысла.

## Как запустить

```bash
cd wb-stocks
pnpm serve:forecast-ui
# http://127.0.0.1:3847/ — по умолчанию основная таблица в режиме wbTotal
```

## Ограничения MVP

- Обратного «одной кнопкой из складов в wb total с тем же фильтром» нет (переключатель вида вручную).
- `pnpm typecheck` может падать на несвязанных с фичей ошибках в `mapWbSupply.ts` (Zod typings).

## Дополнение: drilldown wb total → склады

В таблице `wbTotal` клик по vendor / nm_id / размеру или кнопка «По складам» вызывает `drillDownToWarehousesFromWbTotal`: `viewMode=wbWarehouses`, `q=nm_id`, `techSize` в скрытом поле, запросы как к обычному API.
