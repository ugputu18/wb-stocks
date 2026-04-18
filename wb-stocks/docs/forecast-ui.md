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

- **Основной UI (Preact):** `GET /` → `public/forecast-ui-next/index.html`; JS/CSS сборки — **`/next/assets/*`** (Vite `base: /next/`).
- **Legacy UI (vanilla, fallback / сравнение):** `GET /legacy` или **`/legacy/`** → `public/forecast-ui/index.html`; его статика — **`/static/*`** (`styles.css`, `app.js`).
- Редирект **`/next` → `/`** (query string сохраняется) — для старых закладок; статика по-прежнему **`/next/...`**.
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

Открыть в браузере: **`http://127.0.0.1:3847/`** — основной интерфейс; **`http://127.0.0.1:3847/legacy`** — старый экран (хост/порт см. `FORECAST_UI_*` в `.env`).

**Сборка Preact:** из `wb-stocks` выполнить `pnpm build:forecast-ui-client` (иначе `GET /` вернёт `503` с текстом про отсутствующую сборку).

### Состояние фильтров в адресной строке (без SPA-роутера)

И **основной**, и **legacy** UI используют одни и те же имена query-параметров, что и API. При **первой загрузке** и при **Назад/Вперёд** (`popstate`) состояние формы восстанавливается из **`location.search`**. После **успешной** загрузки таблицы и сводки URL обновляется через **`history.replaceState`** (без перезагрузки, без засорения истории на каждый чих). Исключение: **drilldown** из режима «WB в целом» в «По складам» — **`history.pushState`**, чтобы **Назад** возвращала к предыдущему виду/фильтру. Путь страницы (`/` или `/legacy`) на query не влияет — можно вручную сравнить два UI с одним и тем же `?viewMode=...`.

**В URL сериализуются:** `viewMode`, `snapshotDate`, `horizonDays`, `warehouseKey`, `q`, `techSize`, `riskStockout`, `replenishmentMode`, `targetCoverageDays`, `ownWarehouseCode`, `limit`, `leadTimeDays`, `coverageDays`, `safetyDays`, опционально **`systemQuickFilter`** (только для `viewMode=systemTotal`, если не `all`). Пустой/некорректный параметр → мягкий fallback на дефолт UI. **`apiToken` (FORECAST_UI_TOKEN)** в query **не** записывается и в URL **не** попадает (как и раньше — только заголовок при запросах к API).

**Две блока в UI**

| Блок | Уровень | Что показывает |
|------|---------|----------------|
| **Основная таблица WB** | Зависит от **`viewMode`** (query) | См. ниже — три read-side режима без изменения пайплайна и схемы БД |
| «Закупка у производителя» | **sku** (`nm_id` + `tech_size`) | **`recommendedFromSupplier`**, план заказа с **lead time** (**`recommendedOrderQty`**, запас к приходу, дней до OOS); не дублируется по числу складов |

### Расшифровка рекомендаций (explain mode)

В панели **«Детали строки»** под списком полей (без отдельного режима или тяжёлой вёрстки в таблице) показывается **расшифровка расчётов** и **короткая интерпретация для решений** — только на read-side: те же числа, что уже приходят в `rows[]` и `supplier-replenishment`, плюс явные промежуточные шаги.

- **«На WB» (WB replenishment):**  
  `recommendedToWB = max(0, ceil(forecastDailyDemand × targetCoverageDays − wbAvailableTotal))`  
  **`wbAvailableTotal`** на read-side — это **сток WB + incoming в горизонте** (по строке склада: `startStock + incomingUnits`; по агрегатам SKU: `wbStartStockTotal + wbIncomingUnitsTotal` = то же, что `wbAvailableTotal` в JSON). В explain основного UI при наличии полей показывается разложение: сток → в пути → сумма (= `wbAvailableTotal`).  
  Пошагово: спрос/день → целевые дни → целевой объём на WB → уже доступно по сети → разрыв → **ИТОГ: На WB** (как в колонке «На WB» и в `replenishment.recommendedToWB`).  
  **Интерпретация:** при **recommendedToWB &gt; 0** — предупреждение, что не хватает товара на WB и сколько шт. довезти под выбранное покрытие; при **0** — сообщение, что по целевым дням запаса на WB достаточно.  
  Если **ownStock &gt; 0**, отдельно напоминается: в этой формуле учитывается только запас на WB, **наш склад не влияет** на «На WB».

### Основной UI (`forecast-ui-client`) — слой подсказок и «в пути»

Интерфейс по умолчанию на Preact (корень **`/`**; исходники `forecast-ui-client/`, сборка в `public/forecast-ui-next/`) использует **единый набор примитивов** в `forecast-ui-client/src/components/hints/`: **`LabelWithInlineHelp`** + существующий **`HelpToggle`** для подписей полей, **`ActionHint`** под кнопками загрузки/экспорта, **`TableHeadHintCell`** / **`ColHintText`** для второй строки заголовка таблиц (те же классы `.label-with-help`, `.action-hint`, `.thead-hint-row` / `.col-hint`, стили в `hints.css`).

**Запланированные поставки:** в основной таблице и в supplier-таблице добавлены колонки **«Сток» / «Сток WB»** и **«В пути»** (incoming в горизонте симуляции); значения **в пути** выделены цветом (`.metric-incoming`), чтобы не путать с текущим остатком. В панели деталей и в explain — явная расшифровка **сток + в пути = доступно** для рекомендации «На WB» и контекста закупки.

- **Заказ у поставщика:** строка берётся из последнего ответа **`GET /api/forecast/supplier-replenishment`**, сопоставляется по `(nm_id, tech_size)` с выбранной строкой основной таблицы.  
  Формулы те же, что в домене `buildSupplierOrderPlan`:  
  `consumptionDuringLeadTime = systemDailyDemand × leadTimeDays`,  
  `stockAtArrival = systemAvailableNow − consumptionDuringLeadTime`,  
  `requiredAfterArrival = systemDailyDemand × (coverageDays + safetyDays)`,  
  `recommendedOrderQty = max(0, ceil(requiredAfterArrival − stockAtArrival))`.  
  **ИТОГ: Заказать** — связка с колонкой **«Заказать»** (`recommendedFromSupplier`, простая схема по targetCoverage); **ИТОГ: Заказ (LT)** — с колонкой **«Заказ (LT)»** (`recommendedOrderQty`).  
  **Интерпретация:** если **`willStockoutBeforeArrival === true`** («дефицит до прихода») — предупреждение по строке: сколько дней до исчерпания запаса при текущем спросе (`daysUntilStockout`, если есть), сколько дней до прихода (`leadTimeDays`), и **разница (leadTimeDays − daysUntilStockout)** в днях, когда оба значения известны (наглядная мера «насколько поставка дольше оставшегося запаса в днях»). На сервере флаг **`willStockoutBeforeArrival`** выставляется при **`stockAtArrival &lt; 0`** в `buildSupplierOrderPlan`. Если **`willStockoutBeforeArrival === false`** — сообщение, что до прихода запаса хватает.

**Связка с таблицей:** при выборе строки основной таблицы подсвечиваются ячейки **«На WB»** (синий акцент) и **«Заказать»** в таблице закупки (фиолетовый), цвета совпадают с блоками ИТОГ в explain.

При невозможности показать supplier-explain (нет строки в текущем списке витрины) выводится подсказка **сбросить фильтр или увеличить limit**; при перезагрузке таблицы или сбросе выбора строки explain и подсветка **очищаются**, чтобы не показывать устаревшие данные.

**Ограничения:** не подменяет расчёт на сервере; возможны расхождения отображаемых промежуточных дробей с «ручным» умножением из‑за округления в полях ответа; supplier-расшифровка зависит от успешной загрузки `/supplier-replenishment` и совпадения фильтров отбора SKU.

### Режим основной таблицы WB (`viewMode`)

Параметр query **`viewMode`** задаёт read-side представление для **`GET /api/forecast/rows`**, **`GET /api/forecast/summary`** и **`GET /api/forecast/export-wb`**. **По умолчанию** (параметр **отсутствует**, пустая строка или алиасы «запасов целиком») — **`systemTotal`**. Явно **`wbTotal`**: `viewMode=wbtotal`, **`wb`**, **`wb-network`**. Неизвестное значение → **`wbTotal`** (безопасный fallback).

| Значение | UI (переключатель) | Строка таблицы | KPI сводки |
|----------|----------------------|----------------|------------|
| **`systemTotal`** (UI/default URL) | «Запасы в целом» | Одна строка на SKU **`(nm_id, tech_size)`**: те же агрегаты WB + own + system, что и в других SKU-режимах; **риск и фильтр `riskStockout`** считаются по **`daysOfStockSystem`** = `systemAvailable / Σспрос` (пул **WB∑ + own**) | Как у SKU-строк: `totalRows`, бакеты риска по **system**, суммы **`recommendedToWBTotal`** / **`recommendedFromSupplierTotal`** / **`recommendedOrderQtyTotal`** по **тем же SKU, что и строки таблицы** (в т.ч. при **`systemQuickFilter`**) |
| **`wbTotal`** | «WB в целом» | Одна строка на SKU по сети WB; **риск** по **`daysOfStockWB`** = `wbAvailableTotal / Σспрос` (только WB, без own) | `totalRows`, риски по WB-дням; **`recommendedToWBTotal`** по этим SKU |
| **`wbWarehouses`** | «По складам WB» | **warehouse × sku** | KPI — по **строкам склад×SKU** |

**Чем «Запасы в целом» отличается от «WB в целом»:** оба — одна строка на SKU и одни и те же числа **WB∑**, **own**, **recommendedToWB**, **recommendedFromSupplier** / план заказа. Отличаются **метрика «дней запаса» для бакета риска и `riskStockout`**: в **`systemTotal`** используется покрытие по **всему пулу system** (WB + наш склад), в **`wbTotal`** — только по **запасу на WB**. Так проще сравнить «риск по сети маркетплейса» и «риск по всей доступной массе товара».

**Колонка OOS (system) / поле `systemStockoutDateEstimate` в `systemTotal`:** read-side **оценка** под пул **system** (WB∑+own), согласованная с **Дн. system** и **`daysOfStockSystem`**: при **`forecastDailyDemandTotal > 0`** это календарная дата **`snapshotDate + floor(daysOfStockSystem)`** дней (UTC, без сдвига часовых поясов у строки даты среза). Это **не** `MIN(stockout_date)` по складам WB из `wb_forecast_snapshots` (такой срез остаётся у режима **«WB в целом»** и в симуляции pipeline по складам) и **не** отдельная посуточная модель перетоков между складами и own. При **нулевом или отрицательном** Σ-спросе оценка **`null`**.

**Отличие от WB:** в **`wbTotal`** колонка OOS опирается на **`MIN(stockout_date)`** по WB для SKU — ранняя дата по сети складов из снимка. В **`systemTotal`** используется только агрегат **systemAvailable / Σ спрос** → **дни** → **дата оценки**; при большом **own** и «раннем» WB-`stockout_date` раньше колонки OOS могли расходиться с днями system — теперь одна логика.

**Ограничения оценки OOS (system):** предполагается **постоянный** дневной спрос **`forecastDailyDemandTotal`** (как у **Дн. system**); нет покоординатной симуляции по складам и own, нет MOQ/перераспределений. Дробные дни запаса схлопываются через **`floor`** перед сдвигом календаря. Отдельная **`stockout_date`** в БД по строкам склада по смыслу ближе к режиму **WB по складам / wbTotal**, а не к этой формуле.

Алиасы: **`wbWarehouses`** — `wbwarehouses`, `warehouses`, `by-warehouse`; **`systemTotal`** — `systemtotal`, `system`, `system-stock`, `stocks`.

В UI для **`wbTotal`** / **`systemTotal`** первая колонка с заметным бакетом, вторая — **vendor**. Сортировка по умолчанию: **`wbTotal`** — **`daysOfStockWB` ASC**; **`systemTotal`** — **`daysOfStockSystem` ASC**; далее **`forecastDailyDemandTotal` DESC**.

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
| `lt45` | `days_of_stock < 45` |
| `lt60` | `days_of_stock < 60` |

В режиме **`wbTotal`** фильтр применяется к **агрегированным** дням запаса по сети (`daysOfStockWB` = `wbAvailableTotal / forecastDailyDemandTotal`, см. домен), а не к построчному `days_of_stock` склада.

В режиме **`systemTotal`** фильтр применяется к **`daysOfStockSystem`** = `systemAvailable / forecastDailyDemandTotal` (пул WB∑ + own, см. `daysOfStockSystemFromNetworkTotals`).

KPI по `risk.critical` / `warning` / `attention` / `ok` и `totalRows` считаются **по тем же отфильтрованным строкам**, что и таблица: в **`wbWarehouses`** — склад×SKU; в **`wbTotal`** — SKU по сети WB; в **`systemTotal`** — SKU с риском по **system**.

### Быстрый фильтр `systemTotal` (`systemQuickFilter`)

Только при **`viewMode=systemTotal`**: query **`systemQuickFilter`** сужает **строки SKU** и **согласованные KPI** (`totalRows`, бакеты, **`recommendedToWBTotal`**, **`recommendedFromSupplierTotal`**, **`recommendedOrderQtyTotal`**) после полного расчёта read-side строк (не отдельный SQL-режим).

| Значение | Алиасы (фрагмент) | Смысл строки попадает в выборку, если… |
|----------|-------------------|----------------------------------------|
| **`all`** (default) | _(пусто)_ | без дополнительного условия |
| **`systemRisk`** | `systemrisk`, `system_risk` | **`inventoryLevels.systemRisk`** (пул system пуст / ≤ 0 в read-model) |
| **`supplierOrder`** | `supplierorder`, `supplier`, `from_supplier` | **`recommendedFromSupplier` > 0** (при заданном `targetCoverageDays`) |
| **`wbReplenish`** | `wbreplenish`, `wb`, `towb`, `on_wb` | **`replenishment.recommendedToWB` > 0** |

В **`wbTotal`** / **`wbWarehouses`** параметр игнорируется.

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
| `leadTimeDays` | `45` | Дни до прихода партии; за это время списывается `systemDailyDemand × leadTimeDays`. Допустимый диапазон: **целое 1…1000** (`max` на поле в UI; перед каждым запросом и на blur значение приводится к диапазону; вне его — fallback `45` на сервере). |
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
- **`recommendedFromSupplierTotal`** — **Σ** `recommendedFromSupplier` только по **уникальным SKU** из supplier-агрегата (`riskStockout` **не** применяется к списку SKU; учитываются `warehouseKey` и `q` для отбора SKU). В режиме **`systemTotal`** суммы **`recommendedFromSupplierTotal`** и **`recommendedOrderQtyTotal`** дополнительно ограничиваются **SKU, присутствующими в строках таблицы** после **`riskStockout`** и **`systemQuickFilter`**, чтобы совпадать со сводкой по видимым строкам.
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

### `GET /api/forecast/rows?...&viewMode=&systemQuickFilter=&q=&techSize=&riskStockout=&...`

Строки прогноза для **одного** выбранного горизонта (`horizonDays`). Форма **`rows[]`** зависит от **`viewMode`**.

- **`viewMode`** — `systemTotal` (по умолчанию при отсутствии параметра в API/UI) | `wbTotal` | `wbWarehouses` (см. раздел «Режим основной таблицы WB»).
- **`systemQuickFilter`** — только для **`systemTotal`**: `all` | `systemRisk` | `supplierOrder` | `wbReplenish` (см. раздел «Быстрый фильтр systemTotal»).
- `warehouseKey` — опционально: в **`wbWarehouses`** — точное совпадение с `warehouse_key`; в **`wbTotal`** — отбор SKU, у которых есть строка на этом складе (scope по ключу SKU).
- `q` — опциональный поиск: если строка целиком число → фильтр по `nm_id`; иначе подстрока по `vendor_code` / тексту `nm_id`.
- **`techSize`** — опционально: учитывается **только вместе с числовым `q` (nm_id)`**; добавляет условие `tech_size = ?` в SQL и сужает supplier / wb-total scope до одного `(nm_id, tech_size)` (удобно после drilldown из UI).
- **`riskStockout`** — см. раздел «Риск окончания» (`all` | `lt7` | `lt14` | `lt30` | `lt45` | `lt60`).
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
  "viewMode": "systemTotal",
  "systemTotalQuickFilter": "all",
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
- при **`viewMode: "wbTotal"`** — объект **`WbTotalBySkuReportRow`**: `viewKind: "wbTotal"`, `nmId`, `techSize`, **`wbStartStockTotal`**, **`wbIncomingUnitsTotal`**, `wbAvailableTotal` (= сумма стока и incoming по сети), `forecastDailyDemandTotal`, `daysOfStockWB`, `stockoutDateWB`, `stockSnapshotAtWB`, `ownStock`, **`recommendedFromSupplier`**, `risk`, **`inventoryLevels`**, **`replenishment`** (рекомендация «На WB» для сети при заданном `targetCoverageDays`);
- при **`viewMode: "systemTotal"`** — объект **`SystemTotalBySkuReportRow`**: `viewKind: "systemTotal"`, те же поля WB в т. ч. **`wbStartStockTotal`** / **`wbIncomingUnitsTotal`**, плюс **`daysOfStockSystem`**, **`systemStockoutDateEstimate`**, **`stockSnapshotAtSystem`**, **`recommendedOrderQty`**, **`willStockoutBeforeArrival`** (значения supplier-плана совпадают с **`GET /api/forecast/supplier-replenishment`** для того же SKU).

### `GET /api/forecast/supplier-replenishment?snapshotDate=&horizonDays=&targetCoverageDays=&warehouseKey=&q=&ownWarehouseCode=&replenishmentMode=&leadTimeDays=&coverageDays=&safetyDays=`

Отдельное read-side представление **по SKU** (не по складу).

- Обязательны `snapshotDate`, `horizonDays`, валидный **`targetCoverageDays`** (`30` | `45` | `60`).
- **`riskStockout`** не передаётся и **не** используется — отбор SKU только по **`warehouseKey`** (наличие артикула на складе) и **`q`**.
- **`leadTimeDays`** (default `45`), **`coverageDays`** (default `90`), **`safetyDays`** (default `0`) — план заказа см. раздел «План заказа у поставщика».
- **Ответ:** `{ snapshotDate, horizonDays, targetCoverageDays, leadTimeDays, coverageDays, safetyDays, ownWarehouseCode, rows[] }` — строки отсортированы по `recommendedFromSupplier` по убыванию; в каждой строке также поля плана (`recommendedOrderQty`, `stockAtArrival`, `daysUntilStockout`, …), плюс **`wbStartStockTotal`** и **`wbIncomingUnitsTotal`** (Σ по сети WB для SKU — раскладка `wbAvailableTotal`).

### `GET /api/forecast/summary?...` (те же query-параметры, что и у `/rows`, включая `viewMode`, `riskStockout`, `targetCoverageDays`, `leadTimeDays`, `coverageDays`, `safetyDays`)

KPI по тем же фильтрам и **`viewMode`**, что и `/rows`. В ответе echo поля **`viewMode`** (как у `/rows`).

Дополнительно:

- **`staleStockRowCount`**: строки, у которых дата в `stock_snapshot_at` (первые 10 символов `YYYY-MM-DD`) **строго меньше** `snapshotDate`.
- **`leadTimeDays`**, **`coverageDays`**, **`safetyDays`** — echo параметров плана (для клиента).
- **`replenishment`**:  
  `{ targetCoverageDays, replenishmentMode, ownWarehouseCode, recommendedToWBTotal, recommendedFromSupplierTotal, recommendedOrderQtyTotal, leadTimeDays, orderCoverageDays, safetyDays }` — `recommendedFromSupplierTotal` и `recommendedOrderQtyTotal` только из SKU-агрегата.

### `GET /api/forecast/export-wb` и `GET /api/forecast/export-supplier`

CSV **на сервере**, `Content-Type: text/csv; charset=utf-8`, имя файла `wb-replenishment-<date>-h<horizon>.csv` / `supplier-replenishment-<date>-h<horizon>.csv`.

- **export-wb** — те же query, что у `/rows`, без `limit`: все строки по фильтру. Колонки зависят от **`viewMode`**: при **`wbWarehouses`** — построчный экспорт складов (колонки `warehouse_key`, …); при **`wbTotal`** — агрегат по SKU (`wb_start_stock_total`, `wb_incoming_units_total`, `days_of_stock_wb`, …); при **`systemTotal`** — агрегат по SKU с **`days_of_stock_system`**, **`recommended_order_qty`**, **`wb_risk`**, **`system_risk`** и др.
- **export-supplier** — обязателен **`targetCoverageDays`** в query; остальное как у `/supplier-replenishment` (включая `leadTimeDays`, `coverageDays`, `safetyDays`, опционально `viewMode` для единообразия URL — на состав SKU не влияет). В CSV есть **`wb_start_stock_total`** и **`wb_incoming_units_total`** перед **`wb_available_total`**.

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
