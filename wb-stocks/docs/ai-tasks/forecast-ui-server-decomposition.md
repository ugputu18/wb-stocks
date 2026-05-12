# Декомпозиция `forecastUiServer.ts`

## Цель

Вынести HTTP-хелперы, парсинг query, CSV-мапперы и обработчики маршрутов в `src/server/forecast-ui/` без изменения URL, JSON и CSV.

## Структура

- `forecast-ui/http/` — `json`, `readBody`, `authOk`, `sendXlsxAttachment` (был `sendCsvAttachment`; см. `forecast-ui-csv-to-xlsx-export.md`)
- `forecast-ui/parse/` — константы, `forecastQuery`, `exportQuery`, `diagnosticsQuery`
- `forecast-ui/csv/forecastExportMappers.ts` — колонки и маппинг строк в объекты для CSV
- `forecast-ui/handlers/` — SPA/static, health, forecast read, diagnostics, export, recalculate
- `forecast-ui/routes/` — `ForecastRouteMatch`, `buildForecastUiSpaHealthRoutes`, `buildForecastUiApiRoutes`
- `forecast-ui/deps.ts` — `buildMvpDeps`, `buildForecastUiHandlerDeps`
- `forecastUiServer.ts` — composition root: auth → SPA/health → `forecastRepo` → API routes

## Поведение

- `WbForecastSnapshotRepository` создаётся только после фазы SPA/health (как в монолите).
- Dispatch: первый подошедший `match` в таблице маршрутов.

## Проверка

- `npm run typecheck`
- `npm test` (в т.ч. `test/forecastUiRouteRegistry.test.ts`)
