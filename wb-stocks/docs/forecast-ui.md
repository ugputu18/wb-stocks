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
- **`GET /api/forecast/*`** (health, warehouse-keys, rows, summary) читают только SQLite — **`WB_TOKEN` не нужен**.

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

**Две таблицы в UI**

| Таблица | Уровень | Что показывает |
|---------|---------|----------------|
| Основная (склады WB) | **warehouse × sku** | Риск окончания, уровни запаса, **`recommendedToWB`** на строку склада |
| «Закупка у производителя» | **sku** (`nm_id` + `tech_size`) | **`recommendedFromSupplier`** один раз на артикул; не дублируется по числу складов |

KPI **Σ у производителя** в сводке = сумма по **уникальным SKU** из `/api/forecast/supplier-replenishment`, а не по строкам основной таблицы.

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

KPI по `risk.critical` / `warning` / `attention` / `ok` и `totalRows` считаются **по тем же отфильтрованным строкам**, что и таблица (удобно в узком режиме: например при `lt14` в «warning» попадают только строки с запасом [7, 14), при `lt7` — только critical).

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

**Summary:**

- **`recommendedToWBTotal`** — сумма `recommendedToWB` по **строкам** с тем же фильтром, что и таблица складов (`riskStockout` учитывается), полный срез без `limit`.
- **`recommendedFromSupplierTotal`** — **Σ** `recommendedFromSupplier` только по **уникальным SKU** из supplier-агрегата (`riskStockout` **не** применяется к списку SKU; учитываются `warehouseKey` и `q` для отбора SKU).

Query-параметры: **`targetCoverageDays`**, **`replenishmentMode`**, **`ownWarehouseCode`**.

Ограничения MVP: нет межскладской логистики, MOQ, сроков поставки.

## Endpoints

### `GET /api/forecast/health`

Проверка живости.

**Ответ:** `{ "ok": true, "service": "wb-stocks-forecast-ui" }`

### `GET /api/forecast/warehouse-keys?snapshotDate=YYYY-MM-DD&horizonDays=N`

Список distinct `warehouse_key` для фильтра склада.

**Ответ:** `{ "warehouseKeys": string[] }`

### `GET /api/forecast/rows?...&riskStockout=&targetCoverageDays=&replenishmentMode=&ownWarehouseCode=`

Таблица строк прогноза для **одного** выбранного горизонта (`horizonDays`).

- `warehouseKey` — опционально, точное совпадение с колонкой `warehouse_key`.
- `q` — опциональный поиск: если строка целиком число → фильтр по `nm_id`; иначе подстрока по `vendor_code` / тексту `nm_id`.
- **`riskStockout`** — см. раздел «Риск окончания» (`all` | `lt7` | `lt14` | `lt30`).
- **`targetCoverageDays`** — `30` | `45` | `60` (по умолчанию 30); включает расчёт `replenishment`.
- **`replenishmentMode`** — `wb` | `supplier` (по умолчанию `wb`).
- **`ownWarehouseCode`** — код строки в `own_stock_snapshots` (по умолчанию `main`).
- **`limit`** — максимальное число строк в ответе (целое). По умолчанию **500**, минимум **50**, максимум **2000**. Сортировка: `days_of_stock ASC`, затем `forecast_daily_demand DESC`; полный объём по фильтру смотри `summary.totalRows`.

**Ответ:**

```json
{
  "snapshotDate": "2026-04-17",
  "horizonDays": 30,
  "riskStockout": "all",
  "targetCoverageDays": 30,
  "replenishmentMode": "wb",
  "ownWarehouseCode": "main",
  "limit": 500,
  "rows": []
}
```

Элементы `rows[]`: всегда **`inventoryLevels`**; при покрытии — **`replenishment`** только WB-часть (см. выше).

### `GET /api/forecast/supplier-replenishment?snapshotDate=&horizonDays=&targetCoverageDays=&warehouseKey=&q=&ownWarehouseCode=&replenishmentMode=`

Отдельное read-side представление **по SKU** (не по складу).

- Обязательны `snapshotDate`, `horizonDays`, валидный **`targetCoverageDays`**.
- **`riskStockout`** не передаётся и **не** используется — отбор SKU только по **`warehouseKey`** (наличие артикула на складе) и **`q`**.
- **Ответ:** `{ snapshotDate, horizonDays, targetCoverageDays, ownWarehouseCode, rows: SupplierSkuRow[] }` — строки отсортированы по `recommendedFromSupplier` по убыванию.

### `GET /api/forecast/summary?...` (те же query-параметры, что и у `/rows`, включая `riskStockout` и `targetCoverageDays`)

KPI по тем же фильтрам, что и `/rows`.

Дополнительно:

- **`staleStockRowCount`**: строки, у которых дата в `stock_snapshot_at` (первые 10 символов `YYYY-MM-DD`) **строго меньше** `snapshotDate`.
- **`replenishment`**:  
  `{ targetCoverageDays, replenishmentMode, ownWarehouseCode, recommendedToWBTotal, recommendedFromSupplierTotal }` — см. раздел «Supplier replenishment»; `recommendedFromSupplierTotal` только из SKU-агрегата.

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
