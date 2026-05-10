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

- **Основной UI (Preact):** кастомные пути SPA (тот же `public/forecast-ui-next/index.html`): константы и `isKnownForecastRoute` — **`forecast-ui-client/src/routes.ts`** (реэкспорт из **`src/forecastUiRoutes.ts`**, общий с сервером). Пути: **`/`**, **`/redistribution`**, **`/warehouse-region-audit`**, **`/regional-demand-diagnostics`** (с завершающим `/` или без); JS/CSS сборки — **`/next/assets/*`** (Vite `base: /next/`).
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

Интерфейс по умолчанию на Preact (корень **`/`**; исходники `forecast-ui-client/`, сборка в `public/forecast-ui-next/`) использует слой подсказок в `forecast-ui-client/src/components/hints/`: **`LabelWithInlineHelp`** (Panda recipe **`fieldLabelRow`**) + **`HelpToggle`** (Radix Popover, компактные recipes **`helpTrigger`** / **`helpPopover`**) для ключевых полей фильтров и параметров расчёта; **`ActionHint`** под кнопками загрузки/экспорта, **`TableHeadHintCell`** / **`ColHintText`** для второй строки заголовка таблиц (классы `.action-hint`, `.thead-hint-row` / `.col-hint`, стили в `hints.css`).

#### Panda CSS и Radix UI (внедрение поэтапно, только `forecast-ui-client`)

Подключены **Panda CSS** и **Radix UI** (`@radix-ui/react-popover`, через `preact/compat` в Vite). **Preflight Panda отключён** (`panda.config.ts`), чтобы не дублировать сброс с `forecast-ui-theme.css`. Новые и переведённые блоки оформляются через recipes/tokens Panda и примитивы в **`forecast-ui-client/src/components/ui/`** (`Panel`, `SectionHeading`, `Badge`, `FieldHint`, `InlineAction`, `PopoverInfo` / `Disclosure`). Уже на Panda + Radix: **`HelpToggle`** / **`LabelWithInlineHelp`** (recipes **`fieldLabelRow`**, **`helpTrigger`**, **`helpPopover`**), **`RegionWarehousesDisclosure`**, блок параметров **`RedistributionControls`** через **`Panel`**, секция **результатов перераспределения** (**`RedistributionResultsSection`**: оболочка, lede, pill активного ranking, плотная таблица, интерактивные строки и ячейка региона / preferred warehouse — recipes и подкомпоненты без изменения расчётов и порядка колонок), **`MainTable`** / **`SupplierTable`** (пустое состояние — **`tableEmptyState`**, тулбар над supplier-таблицей — **`toolbarRow`**).

**Стили главной forecast-страницы** (верхняя форма, сводка KPI, блоки диагностики в деталях и т.д.), ранее бывшие большим inline-блоком в **`App.tsx`**, вынесены в **`forecast-ui-client/src/pages/forecast-page.css`** и импортируются из **`main.tsx`** сразу после **`hints.css`**, чтобы селектор **`.forecast-next-root`** и остальные общие классы применялись ко всем маршрутам SPA, а **`App.tsx`** оставался слоем композиции (hooks + разметка). Форма фильтров на главной странице (**`FiltersForm`**) оформлена через Panda: **`filterFormRow`** / **`filterField`** / **`quickFiltersBar`** / **`quickFilterChip`** / **`calcParams*`**; подписи полей — **`LabelWithInlineHelp`** (**`fieldLabelRow`**) + при необходимости **`HelpToggle`**. Дальнейшие шаги по **`forecast-page.css`**: по готовности перенос сетки **`summary-grid`**, блоков **`detail-diagnosis-*`** и т.д. Слой входа Panda: `src/panda.css` (`@layer …`). После `pnpm install` скрипт **`prepare`** генерирует **`styled-system/`** (см. также `pnpm run panda:forecast-ui`).

**Регионы складов WB (read-side):** **явный** справочник `warehouse_key` → регион-кластер WB (логистический; не ОКАТО). Источник истины: **`wb-stocks/src/domain/wbWarehouseMacroRegion.ts`** (клиент реэкспортирует из `forecast-ui-client/src/utils/wbWarehouseRegion.ts`). Ключи совпадают с нормализацией имён в БД (`normalizeWarehouseName`). **Нет** угадывания по подстроке — только таблица. **`getWarehouseMacroRegion`** → `string | null`; без записи в таблице подписи показывают **`Не сопоставлен`** (не «—»): **`formatWarehouseWithRegion`**, **`formatWarehouseRegionFirst`**. Служебная страница **`GET /warehouse-region-audit`** — агрегаты по `wb_forecast_snapshots` и список складов без маппинга по убыванию Σ `forecast_daily_demand`; API **`GET /api/forecast/warehouse-region-audit?snapshotDate=&horizonDays=`**. Где ещё: **«По складам WB»**, фильтр **«Склад»**, **«Детали строки»**, панель сети по SKU, **`/redistribution`**. Ключи добавляем вручную по данным аудита.

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

### Перемещение между складами WB (read-side MVP)

Отдельная страница Preact: **`GET /redistribution`** или **`/redistribution/`** — тот же `index.html`, что и **`/`**; роутер в клиенте показывает сценарий перераспределения. С главной страницы прогноза есть ссылка «Перемещение между складами WB».

Продуктовая модель (макро vs исполнение, СНГ, сибирский кластер, skip) — [`redistribution-product.md`](./redistribution-product.md). Read-model клиента (пулы складов, флаги `hasCandidateWarehouses` / `hasExecutionTargets`, ranking preferred) — [`redistribution-read-model.md`](./redistribution-read-model.md).

**Fulfillment vs региональный спрос:** прогноз по складам (`forecastDailyDemand` в строках WB) считается из **`wb_demand_snapshots`** — это **спрос по складу исполнения** (агрегат заказов по `warehouseName`). Отдельный read-side слой **`wb_orders_daily_by_region`** → **`wb_region_demand_snapshots`** даёт **спрос по региону покупателя** (`regionName` в заказах WB); окна 7/30/90 и формулы сглаживания/trend — те же, что у `computeDemandSnapshot`, итоговое поле в БД — **`regional_forecast_daily_demand`**. На странице **`/redistribution`** по умолчанию **Regional**: **цель — регион**; **донор** — склад. Объём перевода в регион опирается на **дефицит до целевого покрытия**, а не на «сырой» спрос: учитывается **Σ localAvailable** по складам целевого региона в уже загруженной сети SKU; **большой спрос без дефицита** не поднимает регион в топ. Режим **Fulfillment** — цель = **склад исполнения**, как раньше. Строки, где **регион донора** совпадает с **регионом цели** (межрегиональная логика), не показываются. Маппинг: склад → регион — **`wbWarehouseMacroRegion.ts`**; регион заказа → регион — **`wb_region_macro_region`** + bootstrap **`wbRegionMacroRegion.ts`**. Query **`rankingMode=fulfillment`** переключает на fulfillment. Верификация по SKU: **`GET /api/forecast/regional-demand-verify?…`**. Пакетный снимок: **`POST /api/forecast/regional-demand`**. Пересчёт регионального снимка входит в **`runSalesForecastMvp`** (без изменения **`wb_forecast_snapshots`**).

#### Диагностика: региональный спрос vs fulfillment (вся сеть, без SKU)

- **Страница:** **`GET /regional-demand-diagnostics`** — таблицы и KPI: суммы по `region_key` из **`wb_region_demand_snapshots`** (дата = `snapshotDate`), суммы fulfillment по региону склада из **`wb_forecast_snapshots`** для того же `snapshotDate` и **`horizonDays`** (30/60/90), сравнение по региону после явного mapping: регион покупателя → bootstrap + **`wb_region_macro_region`**; склад → **`wbWarehouseMacroRegion.ts`**. В сводке — **`regionalMappedShareOfRegional`** / **`regionalUnmappedShareOfRegional`**; несопоставленные `region_key` — отдельный блок (контроль качества).
- **API:** **`GET /api/forecast/regional-vs-warehouse-summary?snapshotDate=YYYY-MM-DD&horizonDays=30|60|90`** — JSON: `regionalTotals`, `warehouseMacroRegionTotals`, `comparisonByMacroRegion` (сортировка по `|gapShare|` DESC), `totals` (в т.ч. mapped/unmapped доли), `unmappedRegionalTotals`. Pipeline не меняется.
- **Соседние страны:** buyer-регионы в bootstrap маппятся на **те же названия**, что кластеры складов в **`wbWarehouseMacroRegion`** (Беларусь, Казахстан, Армения, Киргизия, Узбекистан, Таджикистан), чтобы `comparisonByMacroRegion` сопоставлял regional и fulfillment **по стране**; для Таджикистана складов в справочнике может не быть — тогда только regional в сравнении.

#### Диагностика: сырые заказы WB (drill-down, без записи в БД)

В SQLite **нет** построчного хранения ответа WB: только агрегаты **`wb_orders_daily`** (по складу исполнения) и **`wb_orders_daily_by_region`** (по региону заказа), без связки region×warehouse на уровне единицы. Чтобы проверить гипотезу «**buyer `regionName` vs склад исполнения**», сервер forecast UI может **на лету** вызвать WB Statistics API (**`GET /api/v1/supplier/orders`**, тот же контракт, что **`importWbOrders`**) и вернуть JSON **read-only**. Требуется **`WB_TOKEN`** в окружении. Окно по полю **`date`** заказа (Moscow, как в импорте): **до 31 календарного дня** за один запрос; ответ WB может быть очень большим — в метаданных указываются **`pages`**, **`stoppedReason`**.

- **`GET /api/forecast/raw-orders-diagnostics?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`** — список нормализованных полей по строкам (в т.ч. `lastChangeDate`, `regionName` / `regionKey`, `oblastOkrugName`, `warehouseName` / `warehouseKey`, `isCancel`, `cancelDate`, `orderType`, `srid`). Опционально: **`nmId`**, **`vendorCode`**, фильтр подстроки **`regionName`** (по нормализованному имени или ключу), **`limit`** (по умолчанию 200, макс. 2000) — после фильтров, с начала списка.
- **`GET /api/forecast/order-flow-by-region?dateFrom=&dateTo=`** — агрегат **`regionKey` × `warehouseKey`**: число net-единиц, доля **`shareWithinRegion`** внутри buyer-региона. Опционально **`nmId`**, **`vendorCode`**.
- **`GET /api/forecast/order-flow-macro-matrix?dateFrom=&dateTo=`** — матрица **регион покупателя** (из **`wbRegionMacroRegion`**: bootstrap + **`wb_region_macro_region`**) × **регион склада** (**`wbWarehouseMacroRegion.ts`**) и net units; показывает, куда по кластерам «утекает» исполнение относительно региона заказа.

**Интерпретация:** если для buyer-регионов Сибири/DV в матрице доминируют склады с **другим** регионом исполнения — это ожидаемый сигнал перекоса между «спросом по региону заказа» и «спросом по складу исполнения» в `wb_demand_snapshots`. Сравнение с агрегатами по снимкам (`regional-vs-warehouse-summary`) дополняет, но не заменяет, raw-проверку.

#### Страница «один донорский склад WB» (текущий MVP)

Пользователь выбирает **только склад-донор** и параметры расчёта (дата среза, горизонт, `targetCoverageDays`, лимит строк, резерв донора в днях, минимум передаваемых шт., максимум SKU для догрузки сети). **Не нужно** выбирать SKU заранее.

**Данные:**

1. **Строки донора:** `GET /api/forecast/rows` с **`viewMode=wbWarehouses`**, **`warehouseKey=<warehouse_key донора>`**, **`limit`** из формы (до 2000) — все SKU, у которых есть строка на этом складе.

2. **По каждому SKU с излишком:** отдельный запрос с **`viewMode=wbWarehouses`**, **`q=<nm_id>`**, **`techSize=<размер>`**, **`limit=2000`** — полная сеть складов для этого SKU (как в одно-SKU сценарии). Чтобы не делать запрос на каждый артикул в базе, UI берёт только **топ N SKU** по **`donorTransferableUnits`** (параметр «макс. SKU»), по умолчанию **100**.

3. **Региональный снимок** (при ranking **Regional**, режим по умолчанию): **`POST /api/forecast/regional-demand`** — строки **`wb_region_demand_snapshots`** по тем же SKU, что и топ по излишку, плюс **`regionMacroMap`** (bootstrap + **`wb_region_macro_region`**); клиент агрегирует в **`targetRegionalDemand` = Σ по региону** для **`(nm_id, tech_size)`**. URL без параметра или **`rankingMode=regional`** — regional; **`rankingMode=fulfillment`** — только fulfillment-сигнал.

**Формулы на строке донора:**

- **`donorReserveUnits`** = `forecastDailyDemand × donorReserveDays` по строке склада-донора.
- **`donorTransferableUnits`** = `max(0, localAvailable − donorReserveUnits)`.
- Учитываются только SKU, где **`donorTransferableUnits ≥ minTransferableUnits`** (параметр UI).

**Региональный режим (по умолчанию):** строка рекомендации — **SKU × донор × регион назначения** (read model: **`computeDonorMacroRegionRecommendations`**). Для каждого региона с **`targetRegionalDemand`** > 0 (Σ по buyer-регионам), если регион донора **≠** региона цели:

- **`regionalAvailableUnits`** = Σ **`localAvailable`** по строкам сети SKU по складам, отнесённым к этому региону (**`wbWarehouseMacroRegion`**), **без** склада-донора.
- **`regionalDaysOfStock`** = `regionalAvailableUnits / targetRegionalDemand` (при спросе > 0).
- **`targetCoverageStockUnits`** = `ceil(targetRegionalDemand × targetCoverageDays)` (дни покрытия — из формы).
- **`regionalNeedUnits`** = `max(0, ceil(targetCoverageStockUnits − regionalAvailableUnits))`. Строки с **`regionalNeedUnits`** = 0 не показываются («сытый» регион).
- **`recommendedTransferUnitsToRegion`** = `min(donorTransferableUnits, regionalNeedUnits)`.
- **`transferScore`** = `recommendedTransferUnitsToRegion × targetRegionalDemand`.

Склады WB в целевом регионе — **кандидаты** (только прошедшие hard filters исполнения в реестре); **`preferredWarehouseKey`** — первый после детерминированного ranking среди кандидатов (tie-breakers: `recommendedToWB` → `daysOfStock` → `localAvailable` → `priorityWithinMacro` → `warehouseKey` по `localeCompare("ru")`; подсказка, **не** лимит перевода). Подробнее — [`redistribution-read-model.md`](./redistribution-read-model.md). В таблице regional-рекомендаций у названия региона есть компактная кнопка **«?»** (тот же паттерн, что help у фильтров): по клику (без hover-only) открывается блок со списком тех же складов-кандидатов, рекомендуемым складом и коротким пояснением; по повторному клику или клику вне блока блок закрывается. Это **операционная подсказка** для логистики; источник спроса остаётся buyer-region / регион.

**Режим Fulfillment:** для каждого **склада-получателя** с тем же **`(nm_id, tech_size)`**, где **`warehouse_key ≠ донор`** и **`recommendedToWB > 0`**:

- **`recommendedTransferUnits`** = `min(donorTransferableUnits, recommendedToWB)` — **независимо** по каждой паре; нет глобального распределения одного остатка донора между получателями.
- **`transferScore`** = `recommendedTransferUnits × targetForecastDailyDemand`.

**Сортировка:** **regional** — в коде клиента: **`regionalDaysOfStock` ASC** (меньше дней — выше), затем **`targetRegionalDemand` DESC**, затем **`transferScore` DESC**, затем объём перевода. **Fulfillment** — `transferScore` **DESC**, **`targetRankingDemand`**, **`targetForecastDailyDemand`**, `targetDaysOfStock` **ASC**, `targetRecommendedToWB` **DESC**. Колонка **«Ранг»** — порядковый номер.

**Сводка по складу-донору (верификация, не для расчёта):** после выбора донора UI показывает отдельную карточку под параметрами. Данные — те же `GET /api/forecast/rows` с фильтром донора, что и для расчёта: **Σ `localAvailable`**, **Σ `forecastDailyDemand`**, оценка **«дней покрытия» по складу в целом** = `totalLocalStock / totalForecastDailyDemand` при `totalForecastDailyDemand > 0`, иначе «—». Это **не** min/max `daysOfStock` по SKU; нужно только для быстрой проверки масштаба. **Число SKU с передаваемым излишком** — счётчик строк, где `donorTransferableUnits ≥ min` при текущих «резерв донора» и «мин. передаваемых шт.» (те же правила, что и расчёт рекомендаций). Сводка обновляется при смене донора, даты среза, горизонта, `targetCoverageDays`, лимита строк и параметров резерва/минимума.

**Таблица «Товары донора»:** под сводкой — полный список SKU×размер по строкам ответа для выбранного склада. Колонки: `vendorCode`, `nm_id`, размер, `localAvailable`, `incomingUnits`, **всего на складе** = `localAvailable + incomingUnits`, `forecastDailyDemand`, `daysOfStock`, **`donorReserveUnits`** = `forecastDailyDemand × donorReserveDays`, **`donorTransferableUnits`** = `max(0, localAvailable − donorReserveUnits)` (как в расчёте перераспределения; резерв по **локальному** остатку, без вычитания incoming). Сортировка по умолчанию: **`donorTransferableUnits` DESC**, затем **`forecastDailyDemand` DESC**. Клик по строке открывает ту же **inline-панель сети по SKU**, что и клик по рекомендации; в **Fulfillment** подсвечивается склад-получатель из первой подходящей строки рекомендации, в **Regional** — регион назначения и предпочтительный склад (если есть). Строки рекомендаций с тем же `(nm_id, tech_size)` подсвечиваются. Если ответ API по донору пустой — текст: «На выбранном складе нет SKU с данными для перераспределения».

**Сеть по SKU (inline-панель):** строки таблицы **рекомендаций** и таблицы **«Товары донора»** **кликабельны**. По клику открывается блок под таблицей (не модалка, не новая страница): тот же запрос, что и для догрузки сети при расчёте — `GET /api/forecast/rows` с **`viewMode=wbWarehouses`**, **`q=<nm_id>`**, **`techSize=<размер>`**, **`limit`** из формы. Показываются по складам: название, `localAvailable`, `incomingUnits`, сумма «всего на складе» (local + incoming), `forecastDailyDemand`, `daysOfStock`, `recommendedToWB`, опционально **`stockout_date`** как «OOS (дата)». Помечаются **текущий донор**; в режиме **Fulfillment** — **получатель** (склад из строки). В режиме **Regional** — склады **региона назначения** (buyer-регион из рекомендации) и отдельно **предпочтительный склад** (max «На WB» среди кандидатов); строки с потребностью довоза на WB (`recommendedToWB > 0`) визуально подсвечены. Кэш ответа по `(nm_id, tech_size)` в памяти вкладки сбрасывается при смене даты среза, горизонта, `targetCoverageDays` или лимита строк.

**Список складов в селекторе:** при загрузке страницы для каждого **`warehouse_key`** из `GET /api/forecast/warehouse-keys` выполняется тот же запрос, что и для донора (с ограниченным параллелизмом), и в подписи опции показываются сумма **`localAvailable`** по строкам и число SKU — **ориентир** избытка без отдельного SQL.

**Ограничения MVP:** эвристика и ranking, не solver; логистика/стоимость/время перемещения не учитываются; решения не сохраняются в БД.

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
