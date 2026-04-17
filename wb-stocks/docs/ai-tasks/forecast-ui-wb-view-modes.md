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

- Нет drill-down «все склады по выбранному SKU» в одном клике (режим по складам + фильтр `q` / склад).
- `pnpm typecheck` может падать на несвязанных с фичей ошибках в `mapWbSupply.ts` (Zod typings).
