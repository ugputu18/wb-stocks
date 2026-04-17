# Forecast UI (internal) — HTTP API contract (MVP)

Локальный thin UI: статическая страница + JSON API. **Пересчёт** выполняется только через **`runSalesForecastMvp`** — тот же orchestration, что CLI `pnpm forecast:sales-mvp` (импорт заказов → demand snapshot → forecast snapshots), без дублирования бизнес-логики.

## Env

| Переменная | Зачем | По умолчанию |
|------------|--------|----------------|
| `FORECAST_UI_HOST` | bind HTTP | `127.0.0.1` |
| `FORECAST_UI_PORT` | порт | `3847` |
| `FORECAST_UI_TOKEN` | Защита JSON API **опционально**: если задан, все запросы к `GET/POST /api/*` должны иметь `Authorization: Bearer <значение>` | — (не защищено) |
| `WB_TOKEN` | Нужен **только** для `POST /api/forecast/recalculate` (Wildberries Statistics API, импорт заказов). Просмотр таблицы и KPI из локальной БД **не вызывает** WB | — |

**Что доступно без каких-либо токенов**

- Страница `/` и статика `/static/*`.
- Если **`FORECAST_UI_TOKEN` не задан**: все **`/api/*`** доступны без заголовка (имеет смысл только на localhost).
- **`GET /api/forecast/*`** (health, warehouse-keys, rows, summary, supplier-replenishment, export CSV) читают только SQLite — **`WB_TOKEN` не нужен**.

**Что требует токенов**

| Действие | `FORECAST_UI_TOKEN` | `WB_TOKEN` |
|----------|----------------------|------------|
| Открыть UI в браузере | Нет | Нет |
| Читать KPI / строки прогноза из БД | Да, если переменная задана | Нет |
| Пересчитать срез (`POST .../recalculate`) | Да, если `FORECAST_UI_TOKEN` задан | **Да**, иначе `503` с кодом `WB_TOKEN_MISSING` |

Токен UI: вводится в поле на странице и уходит только в заголовке **`Authorization`**; в query string **не** передаётся, в `localStorage` **не** сохраняется (только память вкладки).

## Запуск

Из каталога `wb-stocks`:

```bash
pnpm serve:forecast-ui
```

Открыть в браузере: **`http://127.0.0.1:3847/`** (хост/порт см. `FORECAST_UI_*` в `.env`).

**Две блока в UI**

| Блок | Уровень | Что показывает |
|------|---------|----------------|
| **Основная таблица WB** | Зависит от **`viewMode`** (query) | См. ниже — два read-side режима без изменения пайплайна и схемы БД |
| «Закупка у производителя» | **sku** (`nm_id` + `tech_size`) | **`recommendedFromSupplier`**, план заказа с **lead time** (**`recommendedOrderQty`**, запас к приходу, дней до OOS); не дублируется по числу складов |

### Режим основной таблицы WB (`viewMode`)

Параметр query **`viewMode`** задаёт read-side представление для **`GET /api/forecast/rows`**, **`GET /api/forecast/summary`** и **`GET /api/forecast/export-wb`**. По умолчанию (параметр отсутствует или не узнан) — **`wbTotal`**.

| Значение | UI (переключатель) | Строка таблицы | KPI сводки |
|----------|----------------------|----------------|------------|
| **`wbTotal`** (default) | «WB в целом» | Одна строка на **`(nm_id, tech_size)`** по сети WB: агрегаты `SUM` по `wb_forecast_snapshots` | `totalRows`, риски, устаревший сток — по **числу SKU-строк**; **`recommendedToWBTotal`** — сумма рекомендаций «На WB» по этим SKU |
| **`wbWarehouses`** | «По складам WB» | Как раньше: **warehouse × sku** | KPI — по **строкам склад×SKU** (прежняя семантика) |

Алиасы для `wbWarehouses`: `wbwarehouses`, `warehouses`, `by-warehouse`.

В UI для **`wbTotal`** первая колонка сделана заметнее (крупный бакет **CRITICAL** / **WARNING** / **ATTENTION** / **OK**), вторая — **vendor**. Порядок строк на сервере по умолчанию: **`daysOfStockWB` ASC**, затем **`forecastDailyDemandTotal` DESC**.

**Drilldown «по складам»:** клик по **vendor**, **nm_id**, **размеру** или кнопка **«По складам»** переключает UI на **`viewMode=wbWarehouses`**, подставляет **`q=<nm_id>`** и **`techSize=<точный tech_size>`**, перезагружает таблицу и KPI. Параметр **`techSize`** на сервере учитывается только если **`q` целиком числовой** (иначе поиск по подстроке, как раньше). Правка поля поиска **`q`** в форме сбрасывает сохранённый **`techSize`**.

KPI **Σ у производителя** в сводке = сумма по **уникальным SKU** из `/api/forecast/supplier-replenishment` в обоих режимах (supplier-витрина не умножается на склады). Отдельно: **Σ заказ (план lead time + покрытие)** = сумма **`recommendedOrderQty`** по тем же SKU и параметрам плана.

Кнопки **Скачать WB CSV** / **Скачать Supplier CSV** вызывают `GET /api/forecast/export-wb` и `GET /api/forecast/export-supplier` (те же фильтры, что и у таблиц; supplier CSV требует явный `targetCoverageDays` в query).

Без `WB_TOKEN` в окружении сервера кнопка пересчёта получит ответ `503` с понятным текстом; чтение таблицы при этом работает, если в БД уже есть строки прогноза.

## Risk bucket (по `days_of_stock`, взаимоисключающие)

| `risk` | Условие |
|--------|---------|
| `critical` | `days_of_stock < 7` |
| `warning` | `7 <= days_of_stock < 14` |
| `attention` | `14 <= days_of_stock < 30` |
| `ok` | `days_of_stock >= 30` |

Горизонт симуляции может быть меньше 30 — тогда у строк может не быть `ok`; это нормально для MVP.

### Режим «Риск окончания» (фильтр `riskStockout`)

Параметр query **`riskStockout`** сужает выборку по `days_of_stock` (те же сортировка и лимит, что и без фильтра):

| Значение | SQL (дополнительно к базовому WHERE) |
|----------|--------------------------------------|
| `all` (по умолчанию) | — |
| `lt7` | `days_of_stock < 7` |
| `lt14` | `days_of_stock < 14` |
| `lt30` | `days_of_stock < 30` |

В режиме **`wbTotal`** фильтр применяется к **агрегированным** дням запаса по сети (`daysOfStockWB` = `wbAvailableTotal / forecastDailyDemandTotal`, см. домен), а не к построчному `days_of_stock` склада.

KPI по `risk.critical` / `warning` / `attention` / `ok` и `totalRows` считаются **по тем же отфильтрованным строкам**, что и таблица: в **`wbWarehouses`** это строки склад×SKU, в **`wbTotal`** — строки SKU по сети.

### Многоуровневые запасы и два плана (read-side, не в БД)

**Кратко:** **WB replenishment = warehouse-level** (каждая строка — свой `warehouse_key`). **Supplier replenishment = sku-level** (ключ `(nm_id, tech_size)`; одна рекомендация на артикул на срез).

Вводятся уровни **System / WB total / WB local** и два типа рекомендаций; схема БД **не меняется**.

**Данные**

- **WB local** (строка прогноза): `localAvailable = start_stock + incoming_units` на выбранном `warehouse_key`.
- **WB total** по номенклатуре `(nm_id, tech_size)` и срезу `(snapshot_date, horizon_days)`:
  `wbAvailable = SUM(start_stock + incoming_units)` по **всем** строкам `wb_forecast_snapshots` с тем же ключом.
- **Наш склад**: `own_stock_snapshots` по `vendor_code` и `warehouse_code` (по умолчанию `main`, см. query **`ownWarehouseCode`**). Связка с прогнозом — **только по `vendor_code`** (как в CSV «Артикул»).
- **System:** `systemAvailable = wbAvailable + ownStock`.

**Три флага риска (булевы):**

- `systemRisk` ⇔ `systemAvailable <= 0`
- `wbRisk` ⇔ `wbAvailable <= 0`
- `localRisk` ⇔ `localAvailable <= 0`

**Региональный дефицит:** `regionalDeficit` — локальный WB пустой (`localAvailable <= 0`), но по сети WB и/или на нашем складе есть запас (`wbAvailable > 0` или `ownStock > 0`) — подсказка к перераспределению/довозу на WB.

**WB replenishment (уровень warehouse × SKU)**

- Для **каждой строки** склада: `targetDemandWB = forecast_daily_demand × targetCoverageDays` (спрос **этого** WB-склада).
- `wbAvailableTotal` = сумма `(start_stock + incoming_units)` по **всем** складам WB для того же `(nm_id, tech_size)`.
- **`recommendedToWB`** = `max(0, ceil(targetDemandWB − wbAvailableTotal))`.
- В объекте **`replenishment`** в `rows[]` только это: `targetCoverageDays`, `targetDemandWB`, `wbAvailableTotal`, `recommendedToWB`.

**Supplier replenishment (уровень SKU, без дублирования по складам)**

- Ключ: `(nm_id, tech_size)`; `vendorCode` — из `MAX(vendor_code)` в группе (payload).
- `sumForecastDailyDemand` = **Σ** `forecast_daily_demand` по **всем** складам WB для SKU.
- `targetDemandSystem` = `sumForecastDailyDemand × targetCoverageDays`.
- `wbAvailableTotal` = **Σ** `(start_stock + incoming_units)` по всем WB для SKU (то же, что на уровне сети).
- `ownStock` = остаток в `own_stock_snapshots` по `vendor_code` и выбранному **`ownWarehouseCode`**.
- `systemAvailable` = `wbAvailableTotal + ownStock`.
- **`recommendedFromSupplier`** = `max(0, ceil(targetDemandSystem − systemAvailable))` — **одно число на SKU**; не суммируется из строк складской таблицы.

**План заказа у поставщика (read-side, поверх того же SKU-агрегата)**

Параметры query (общие для `/summary`, `/supplier-replenishment`, экспорта, если параметры переданы):

| Параметр | Default | Смысл |
|----------|---------|--------|
| `leadTimeDays` | `45` | Дни до прихода партии; за это время списывается `systemDailyDemand × leadTimeDays`. |
| `coverageDays` | `90` | Целевое покрытие **после** прихода (не путать с `targetCoverageDays` для «простой» колонки Заказать). |
| `safetyDays` | `0` | Добавляется к покрытию в целевом спросе после прихода. |

- `systemDailyDemand` = Σ `forecast_daily_demand` по WB для SKU (тот же агрегат, что `sumForecastDailyDemand`).
- `systemAvailableNow` = `wbAvailableTotal + ownStock`.
- `stockAtArrival` = `systemAvailableNow − systemDailyDemand × leadTimeDays`.
- `requiredAfterArrival` = `systemDailyDemand × (coverageDays + safetyDays)`.
- **`recommendedOrderQty`** = `max(0, ceil(requiredAfterArrival − stockAtArrival))`.
- `willStockoutBeforeArrival` ⇔ `stockAtArrival < 0`.
- **`daysUntilStockout`** = при `systemDailyDemand > 0`: `systemAvailableNow / systemDailyDemand`, иначе `null`.

**Summary:**

- **`recommendedToWBTotal`** — сумма `recommendedToWB` по **тем же строкам, что и основная таблица** при выбранном **`viewMode`** (полный срез без `limit`): в **`wbTotal`** — по SKU-сети, в **`wbWarehouses`** — по строкам склад×SKU. Фильтр **`riskStockout`** согласован с таблицей.
- **`recommendedFromSupplierTotal`** — **Σ** `recommendedFromSupplier` только по **уникальным SKU** из supplier-агрегата (`riskStockout` **не** применяется к списку SKU; учитываются `warehouseKey` и `q` для отбора SKU).
- **`recommendedOrderQtyTotal`** — **Σ** `recommendedOrderQty` по тем же SKU и тем же `leadTimeDays` / `coverageDays` / `safetyDays`.
- В объекте **`replenishment`** также: `leadTimeDays`, `orderCoverageDays`, `safetyDays` (значения из query с дефолтами).

Query-параметры (в дополнение к базовым): **`viewMode`**, **`q`**, **`techSize`** (см. выше), **`targetCoverageDays`**, **`replenishmentMode`**, **`ownWarehouseCode`**, **`leadTimeDays`**, **`coverageDays`**, **`safetyDays`**.

Ограничения MVP: нет межскладской логистики, MOQ, отдельного контура закупок как в ERP. План заказа в UI — read-side формула (`leadTimeDays` / `coverageDays` / `safetyDays`), не симуляция по дням.

## Endpoints

### `GET /api/forecast/health`

Проверка живости.

**Ответ:** `{ "ok": true, "service": "wb-stocks-forecast-ui" }`

### `GET /api/forecast/warehouse-keys?snapshotDate=YYYY-MM-DD&horizonDays=N`

Список distinct `warehouse_key` для фильтра склада.

**Ответ:** `{ "warehouseKeys": string[] }`

### `GET /api/forecast/rows?...&viewMode=&q=&techSize=&riskStockout=&...`

Строки прогноза для **одного** выбранного горизонта (`horizonDays`). Форма **`rows[]`** зависит от **`viewMode`**.

- **`viewMode`** — `wbTotal` (default) | `wbWarehouses` (см. раздел «Режим основной таблицы WB»).
- `warehouseKey` — опционально: в **`wbWarehouses`** — точное совпадение с `warehouse_key`; в **`wbTotal`** — отбор SKU, у которых есть строка на этом складе (scope по ключу SKU).
- `q` — опциональный поиск: если строка целиком число → фильтр по `nm_id`; иначе подстрока по `vendor_code` / тексту `nm_id`.
- **`techSize`** — опционально: учитывается **только вместе с числовым `q` (nm_id)`**; добавляет условие `tech_size = ?` в SQL и сужает supplier / wb-total scope до одного `(nm_id, tech_size)` (удобно после drilldown из UI).
- **`riskStockout`** — см. раздел «Риск окончания» (`all` | `lt7` | `lt14` | `lt30`).
- **`targetCoverageDays`** — `30` | `45` | `60` (по умолчанию 30); включает расчёт `replenishment` и **`recommendedFromSupplier`** в режиме `wbTotal`.
- **`replenishmentMode`** — `wb` | `supplier` (по умолчанию `wb`).
- **`ownWarehouseCode`** — код строки в `own_stock_snapshots` (по умолчанию `main`).
- **`leadTimeDays`**, **`coverageDays`**, **`safetyDays`** — для согласованности KPI в `summary` с таблицей закупки (см. «План заказа»); на сами строки WB не влияют.
- **`limit`** — максимальное число строк в ответе (целое). По умолчанию **500**, минимум **50**, максимум **2000**. Сортировка в **`wbWarehouses`**: `days_of_stock ASC`, затем `forecast_daily_demand DESC`. В **`wbTotal`**: `daysOfStockWB ASC`, затем `forecastDailyDemandTotal DESC`. Полный объём по фильтру смотри `summary.totalRows`.

**Ответ:**

```json
{
  "snapshotDate": "2026-04-17",
  "horizonDays": 30,
  "viewMode": "wbTotal",
  "riskStockout": "all",
  "targetCoverageDays": 30,
  "replenishmentMode": "wb",
  "ownWarehouseCode": "main",
  "limit": 500,
  "rows": []
}
```

Элементы `rows[]`:

- при **`viewMode: "wbWarehouses"`** — как раньше: поля строки склада, **`inventoryLevels`**, при покрытии — **`replenishment`**;
- при **`viewMode: "wbTotal"`** — объект **`WbTotalBySkuReportRow`**: `viewKind: "wbTotal"`, `nmId`, `techSize`, `wbAvailableTotal`, `forecastDailyDemandTotal`, `daysOfStockWB`, `stockoutDateWB`, `stockSnapshotAtWB`, `ownStock`, **`recommendedFromSupplier`**, `risk`, **`inventoryLevels`**, **`replenishment`** (рекомендация «На WB» для сети при заданном `targetCoverageDays`).

### `GET /api/forecast/supplier-replenishment?snapshotDate=&horizonDays=&targetCoverageDays=&warehouseKey=&q=&ownWarehouseCode=&replenishmentMode=&leadTimeDays=&coverageDays=&safetyDays=`

Отдельное read-side представление **по SKU** (не по складу).

- Обязательны `snapshotDate`, `horizonDays`, валидный **`targetCoverageDays`** (`30` | `45` | `60`).
- **`riskStockout`** не передаётся и **не** используется — отбор SKU только по **`warehouseKey`** (наличие артикула на складе) и **`q`**.
- **`leadTimeDays`** (default `45`), **`coverageDays`** (default `90`), **`safetyDays`** (default `0`) — план заказа см. раздел «План заказа у поставщика».
- **Ответ:** `{ snapshotDate, horizonDays, targetCoverageDays, leadTimeDays, coverageDays, safetyDays, ownWarehouseCode, rows[] }` — строки отсортированы по `recommendedFromSupplier` по убыванию; в каждой строке также поля плана (`recommendedOrderQty`, `stockAtArrival`, `daysUntilStockout`, …).

### `GET /api/forecast/summary?...` (те же query-параметры, что и у `/rows`, включая `viewMode`, `riskStockout`, `targetCoverageDays`, `leadTimeDays`, `coverageDays`, `safetyDays`)

KPI по тем же фильтрам и **`viewMode`**, что и `/rows`. В ответе echo поля **`viewMode`** (как у `/rows`).

Дополнительно:

- **`staleStockRowCount`**: строки, у которых дата в `stock_snapshot_at` (первые 10 символов `YYYY-MM-DD`) **строго меньше** `snapshotDate`.
- **`leadTimeDays`**, **`coverageDays`**, **`safetyDays`** — echo параметров плана (для клиента).
- **`replenishment`**:  
  `{ targetCoverageDays, replenishmentMode, ownWarehouseCode, recommendedToWBTotal, recommendedFromSupplierTotal, recommendedOrderQtyTotal, leadTimeDays, orderCoverageDays, safetyDays }` — `recommendedFromSupplierTotal` и `recommendedOrderQtyTotal` только из SKU-агрегата.

### `GET /api/forecast/export-wb` и `GET /api/forecast/export-supplier`

CSV **на сервере**, `Content-Type: text/csv; charset=utf-8`, имя файла `wb-replenishment-<date>-h<horizon>.csv` / `supplier-replenishment-<date>-h<horizon>.csv`.

- **export-wb** — те же query, что у `/rows`, без `limit`: все строки по фильтру. Колонки зависят от **`viewMode`**: при **`wbWarehouses`** — построчный экспорт складов (колонки `warehouse_key`, …); при **`wbTotal`** — агрегат по SKU (`risk_bucket`, `wb_available_total`, `days_of_stock_wb`, `recommended_from_supplier`, …).
- **export-supplier** — обязателен **`targetCoverageDays`** в query; остальное как у `/supplier-replenishment` (включая `leadTimeDays`, `coverageDays`, `safetyDays`, опционально `viewMode` для единообразия URL — на состав SKU не влияет).

### `POST /api/forecast/recalculate`

Полный пайплайн — **только вызов `runSalesForecastMvp`** (как CLI). Без **`WB_TOKEN`** в окружении сервера:

**Ответ `503`:**

```json
{
  "ok": false,
  "code": "WB_TOKEN_MISSING",
  "error": "Не задан WB_TOKEN в окружении: ..."
}
```

**Тело JSON (пример):**

```json
{
  "snapshotDate": "2026-04-17",
  "horizons": [30],
  "dryRun": false,
  "sku": "SKU-1",
  "warehouse": "Коледино"
}
```

- `horizons`: в UI MVP — один элемент `[30]` | `[60]` | `[90]`.

**Успех:** `{ "ok": true, "result": { …RunSalesForecastMvpResult }, "skippedAggregate": [ … ] }`

## Selector горизонта в UI

Один выбранный **`horizonDays`** (30 / 60 / 90). Запросы `rows` и `summary` всегда с одним `horizonDays`. Пересчёт отправляет только этот горизонт в `horizons: [horizonDays]`.
