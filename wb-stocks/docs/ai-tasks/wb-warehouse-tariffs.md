# Тарифы складов WB: импорт и хранение

## Что было

Модуль `wb-stocks` хранил только остатки (`wb_stock_snapshots`), поставки
(`wb_supplies`/`wb_supply_items`) и заказы (`wb_orders_daily*`). При
этом для задачи «оценить, выгодно ли везти товар на конкретный склад»
нужен ещё один независимый слой данных — **тарифы по складам**:

- сколько стоит логистика «склад WB → покупатель» за литр,
- сколько стоит хранение литра в день,
- какие коэффициенты приёмки и доступна ли разгрузка в ближайшие 14 дней.

Эти данные публикует WB Common API на отдельном хосте
`https://common-api.wildberries.ru`. Готового сводного ответа «доставка
из Сибири в ДФО» там нет, только сырые тарифы на склад — а локализация
(склад → ФО → регион заказа) уже наша задача (`wbWarehouseMacroRegion`
+ `wbRegionMacroRegion`). Чтобы аналитика могла оперировать
«себестоимостью отгрузки со склада X», нужно регулярно класть тарифы в
ту же БД и держать их рядом с остатками/заказами/привязками к ФО.

## Что сделано

### Новый клиент

`wb-stocks/src/infra/wbCommonClient.ts` — тонкая обёртка над тремя
эндпойнтами WB Common API:

| Метод клиента | WB endpoint | Возвращает |
|---|---|---|
| `getBoxTariffs({ date })` | `GET /api/v1/tariffs/box?date=YYYY-MM-DD` | envelope `{ response: { data: { dtNextBox, dtTillMax, warehouseList[] } } }` |
| `getPalletTariffs({ date })` | `GET /api/v1/tariffs/pallet?date=YYYY-MM-DD` | envelope (поля `dtNextPallet`, `warehouseList[]`) |
| `getAcceptanceCoefficients({ warehouseIds? })` | `GET /api/tariffs/v1/acceptance/coefficients[?warehouseIDs=...]` | плоский массив `AcceptanceCoefficient[]` на 14 дней вперёд |

Особенности:

- Авторизация — bare `Authorization: <token>` (без `Bearer`), как и в
  остальных клиентах WB.
- Ретраи и backoff построены по той же схеме, что в `WbStatsClient` /
  `WbSuppliesClient` (общий `WbApiError`). На 429 для этого API даём
  2 сек × попытка backoff: у `acceptance/coefficients` лимит 6 req/min
  (10 сек интервал), у tariffs box/pallet — 60 req/min, но мы дёргаем
  раз в сутки, в лимит упереться нереально.
- Парсинг — на уровне ответа: возвращаем «как пришло», нормализация
  живёт в `mapWbWarehouseTariff.ts`.

### Парсер и доменная модель

`wb-stocks/src/domain/wbWarehouseTariff.ts`:

- `parseTariffDecimal(raw): number | null` — публичная утилита, потому
  что числа у WB приходят **строками с запятой**
  (`"0,14"`, `"11,2"`, `"35.65"`) и иногда с пробелом-разделителем тысяч
  (`"1 039"`, `"1\u00A0039"`). Пустые строки/`"-"`/нераспарсимый ввод →
  `null`. Принимает также готовые `number` (acceptance изредка отдаёт
  такие).
- `toEffectiveDate(rfc3339): string` — режет дату приёмки до `YYYY-MM-DD`
  (WB всегда отдаёт полночь, время не несёт смысла).
- Zod-схемы трёх форматов ответа + три record-типа
  (`WbBoxTariffRecord`, `WbPalletTariffRecord`,
  `WbAcceptanceCoefficientRecord`).

### Маппер

`wb-stocks/src/application/mapWbWarehouseTariff.ts`:

- `mapBoxTariffEnvelope(body, ctx)` / `mapPalletTariffEnvelope(body, ctx)`
  — валидируют конверт, проходят по `warehouseList`, парсят значения,
  возвращают `{ records, skipped, dtNext*, dtTillMax }`. Кривой
  envelope — бросаем (это баг WB или сети, не «грязная строка»). Кривая
  строка внутри `warehouseList` (например, без `warehouseName`) —
  пропускаем с записью в `skipped`, остальное сохраняем.
- `mapAcceptanceCoefficient(raw, ctx)` — построчно, возвращает discriminated
  union `{ ok: true, record } | { ok: false, reason, raw }` (та же
  конвенция, что у `mapWbStockRow`).

### Схема БД

Три новые таблицы (миграции в `wb-stocks/src/infra/db.ts`):

```sql
-- Тарифы коробов: одна строка на (дата, склад)
CREATE TABLE wb_warehouse_box_tariffs (
  id                                INTEGER PRIMARY KEY AUTOINCREMENT,
  tariff_date                       TEXT NOT NULL,
  fetched_at                        TEXT NOT NULL,
  warehouse_name                    TEXT NOT NULL,
  geo_name                          TEXT,
  box_delivery_base                 REAL,
  box_delivery_liter                REAL,
  box_delivery_coef_expr            REAL,
  box_delivery_marketplace_base     REAL,
  box_delivery_marketplace_liter    REAL,
  box_delivery_marketplace_coef_expr REAL,
  box_storage_base                  REAL,
  box_storage_liter                 REAL,
  box_storage_coef_expr             REAL,
  dt_next_box                       TEXT,
  dt_till_max                       TEXT
);
CREATE UNIQUE INDEX ux_wb_warehouse_box_tariffs_key
  ON wb_warehouse_box_tariffs (tariff_date, warehouse_name);

-- Тарифы паллет: аналогично
CREATE TABLE wb_warehouse_pallet_tariffs (...);
CREATE UNIQUE INDEX ux_wb_warehouse_pallet_tariffs_key
  ON wb_warehouse_pallet_tariffs (tariff_date, warehouse_name);

-- Коэффициенты приёмки: история прогонов
CREATE TABLE wb_warehouse_acceptance_coefficients (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at               TEXT NOT NULL,
  effective_date           TEXT NOT NULL,
  warehouse_id             INTEGER NOT NULL,
  warehouse_name           TEXT,
  box_type_id              INTEGER,
  box_type_name            TEXT,
  coefficient              REAL NOT NULL,
  allow_unload             INTEGER, -- 0/1
  storage_coef             REAL,
  delivery_coef            REAL,
  delivery_base_liter      REAL,
  delivery_additional_liter REAL,
  storage_base_liter       REAL,
  storage_additional_liter REAL,
  is_sorting_center        INTEGER  -- 0/1
);
CREATE UNIQUE INDEX ux_wb_warehouse_acceptance_key
  ON wb_warehouse_acceptance_coefficients (
    fetched_at, effective_date, warehouse_id, COALESCE(box_type_id, -1)
  );
```

Идемпотентность:

- **Box/pallet** — `INSERT … ON CONFLICT DO UPDATE`. WB меняет тарифы
  редко (раз в недели-месяцы), нам нужна «последняя версия за день».
  Повторный прогон в течение того же дня перезаписывает строку,
  обновляя `fetched_at`.
- **Acceptance** — `INSERT OR IGNORE` + ключ включает `fetched_at`.
  Это «прогноз на 14 дней», WB пересчитывает в течение суток (например,
  утром склад X доступен с коэф. 0, к вечеру стал × 5). Каждый прогон
  — отдельная запись истории. Метод `getLatestAcceptance()` отдаёт
  только последнюю партию (по `MAX(fetched_at)`); если нужна полная
  история — есть индекс `ix_wb_warehouse_acceptance_eff_date`.

### Use case

`wb-stocks/src/application/importWbWarehouseTariffs.ts` —
`importWbWarehouseTariffs(deps, options)`:

- три независимых шага (box / pallet / acceptance), каждый можно
  отключить флагом `skip*`. Ошибка в одном шаге не корраптит другие
  (т.к. фетч и запись — две разные фазы, и запись каждой секции
  происходит до начала следующей секции, в отдельной транзакции).
- `dryRun=true` — короткое замыкание перед `repository.save*`. Сырые
  запросы к WB всё равно идут (валидация формата и фактическая проверка
  доступа токена) — это полезно для smoke-теста.
- `tariffDate` — `YYYY-MM-DD` для box/pallet (по умолчанию = сегодня в
  UTC). Acceptance параметра даты не принимает (WB отдаёт сам).
- `warehouseIds` — пробрасывается в `acceptance/coefficients` (для CLI
  это `--warehouses=507,117501`).
- Результат: `{ fetchedAt, tariffDate, box, pallet, acceptance, durationMs }`.

### CLI

`wb-stocks/scripts/update-wb-tariffs.ts` + новый pnpm script
`update:wb-tariffs`. Запускается в той же конвенции, что
`update:wb-supplies`:

```bash
nvm use
cp .env.example .env       # WB_TOKEN, при необходимости WB_COMMON_BASE_URL
pnpm install

# Дефолт — сегодня (UTC), все три эндпойнта, запись в БД:
pnpm update:wb-tariffs

# Конкретная дата (имеет смысл, если WB опубликовал тариф на следующий период):
pnpm update:wb-tariffs --date=2026-05-12

# Только приёмка, для конкретных складов:
pnpm update:wb-tariffs --skip-box --skip-pallet --warehouses=507,117501

# Без записи в БД (sanity check):
pnpm update:wb-tariffs --dry-run
```

JSON-результат печатается в stdout, структурированные логи — в stderr
(pino).

### Конфигурация

Добавлен `WB_COMMON_BASE_URL` в `src/config/env.ts` и
`.env.example` (дефолт — `https://common-api.wildberries.ru`,
переопределять обычно не нужно — оставлено для интеграционных тестов).
Никаких новых токенов не нужно: тот же `WB_TOKEN` со scope
**Marketplace** или **Поставки**.

## Как пользоваться (примеры)

### Получить «свежие» тарифы коробов на сегодня

```bash
cd wb-stocks
nvm use
pnpm update:wb-tariffs
```

После прогона:

```sql
SELECT warehouse_name, geo_name,
       box_delivery_base, box_delivery_liter,
       box_storage_base
  FROM wb_warehouse_box_tariffs
 WHERE tariff_date = DATE('now')
 ORDER BY box_delivery_liter;
```

### Найти «выгодные» склады в Сибири/ДФО (как в описании задачи)

```sql
SELECT warehouse_name,
       box_delivery_base, box_delivery_liter,
       box_storage_base,  box_storage_liter
  FROM wb_warehouse_box_tariffs
 WHERE tariff_date = (SELECT MAX(tariff_date) FROM wb_warehouse_box_tariffs)
   AND geo_name LIKE 'Сибирский%'   -- или 'Сибирский и Дальневосточный'
 ORDER BY box_delivery_liter ASC;
```

### Доступность приёмки на 14 дней

```sql
SELECT effective_date, warehouse_name, box_type_name,
       coefficient, allow_unload
  FROM wb_warehouse_acceptance_coefficients
 WHERE fetched_at = (SELECT MAX(fetched_at)
                       FROM wb_warehouse_acceptance_coefficients)
   AND coefficient IN (0, 1)
   AND allow_unload = 1
 ORDER BY effective_date, warehouse_name;
```

## Совместимость

- Все добавления — append-only (новые таблицы, новые поля env, новый
  CLI). Существующие пайплайны (`import:stocks`, `update:wb-supplies`,
  `forecast:sales-mvp`, серверный `recalculateRoute`) **не затронуты**.
- `openDatabase` идемпотентно создаёт новые таблицы — старые БД
  получат их при первом открытии после обновления, миграция не нужна.
- Парсер чисел не используется нигде кроме mapper'а тарифов; не
  меняет поведение существующих сущностей.

## Как проверить

```bash
cd wb-stocks
nvm use
pnpm vitest run test/wbWarehouseTariff.test.ts \
                test/wbWarehouseTariffRepository.test.ts \
                test/wbCommonClient.test.ts \
                test/importWbWarehouseTariffs.test.ts
# → 38/38 ✅

pnpm test          # полный прогон: 331/331 ✅
pnpm typecheck     # tsc --noEmit, без ошибок
```

Ручная проверка:

```bash
WB_TOKEN=<реальный токен> pnpm update:wb-tariffs --dry-run
# В логах должно быть три блока:
#   "box done"        : fetched=N, inserted=0, skipped=0
#   "pallet done"     : fetched=M, inserted=0, skipped=0
#   "acceptance done" : fetched=K, inserted=0, skipped=0
```

После прогона без `--dry-run`:

```bash
sqlite3 data/wb-stocks.sqlite \
  "SELECT COUNT(DISTINCT warehouse_name), COUNT(DISTINCT geo_name)
     FROM wb_warehouse_box_tariffs;"
```

## Отчёт «выбор оптимального склада»

После загрузки тарифов появляется отдельная задача — **рангированный
выбор склада для отгрузки**. Голые таблицы `wb_warehouse_box_tariffs` +
`wb_warehouse_acceptance_coefficients` ответ на вопрос «куда сейчас
выгоднее везти» не дают: нужно одновременно учитывать тариф логистики,
тариф хранения, доступность приёмки на ближайшие 14 дней и сколько уже
лежит на складе. Под это сделан отдельный отчёт.

### Что добавлено

`wb-stocks/src/application/buildWarehouseTariffReport.ts` — чистая
функция-сборщик. Принимает массивы box/pallet/acceptance/stock-totals
и возвращает `WarehouseTariffReport`:

- `rows: WarehouseTariffReportRow[]` — по одной строке на склад из
  последнего среза `wb_warehouse_box_tariffs`. Поля:
  - тариф: `boxDeliveryBase/Liter`, `boxStorageBase/Liter` (как в БД)
  - синтетические метрики на «коробку 10 л» (один сортируемый
    показатель вместо двух колонок):
    - `shipCostPer10L = boxDeliveryBase + 9 * boxDeliveryLiter`
    - `storeCostPer10LPerMonth = 30 * (boxStorageBase + 9 * boxStorageLiter)`
    - `score = shipCostPer10L + storeCostPer10LPerMonth`
  - макрорегион из `wbWarehouseMacroRegion` (`null` если склад не
    сопоставлен — частая ситуация для СГТ-/ВРЦ-/FBS-складов);
  - сводка по acceptance (для выбранного `box_type_id`, по умолчанию
    `2 = Короба`):
    - `nearestAvailableDate` — ближайшая дата, когда приёмка возможна
      (`coef ∈ {0,1}` и `allowUnload=true`);
    - `nearestFreeDate` — ближайшая дата с **бесплатной** приёмкой
      (`coef=0`);
    - `minCoefficient14d`, `availableDays14d`, `isSortingCenter`;
  - `availability` — единственный поясняющий лейбл:
    - `available_free` — бесплатная приёмка хотя бы в одну дату;
    - `available_paid` — приёмка только за коэффициент;
    - `blocked` — на 14 дней `coef=-1` или `allowUnload=false`;
    - `unknown` — склад есть в box-тарифах, но acceptance/coefficients
      его не вернул. Это **не равно blocked**: обычно это FBS-точки
      «Маркетплейс: …», которые в acceptance API не входят;
  - `currentStockUnits` — Σ units из последнего `wb_stock_snapshots`
    по этому складу (для визуальной оценки «склад уже забит / пустой»).
- `summary` — счётчики по availability и разбивка по макрорегионам.

**Дефолтная сортировка** (`--sort=score`) — двухуровневая:
сначала ранг по `availability` (`available_free → available_paid →
unknown → blocked`), потом по cost-score. Это сделано осознанно: иначе
самые дешёвые СГТ-склады, куда отгрузить **физически нельзя**, вылезают
в топ и сбивают принятие решения. Явные сортировки (`--sort=delivery`,
`--sort=storage`, `--sort=stock`, `--sort=acceptance`, `--sort=name`)
сортируют по «сырой» колонке без availability-приоритета — пользователь,
который явно их выбрал, хочет именно колонку.

### CLI

`wb-stocks/scripts/report-warehouse-tariffs.ts` + новый pnpm-скрипт
`report:warehouse-tariffs`. Три формата вывода:

```bash
# Дефолт — TTY table, score-sorted, box_type=2:
pnpm report:warehouse-tariffs

# Топ-15 куда реально можно отгрузить (free и paid):
pnpm report:warehouse-tariffs --available-only --limit=15

# Только Сибирь+ДВ:
pnpm report:warehouse-tariffs --macro='Сибирский и Дальневосточный'

# Слайс по WB-округу (substring, RU-case-insensitive):
pnpm report:warehouse-tariffs --geo='Сибирский'

# CSV для Excel:
pnpm report:warehouse-tariffs --available-only --format=csv > picker.csv

# JSON для интеграции:
pnpm report:warehouse-tariffs --format=json | jq '.summary'

# Альтернативные сортировки:
pnpm report:warehouse-tariffs --sort=delivery     # дешевле логистика → ↑
pnpm report:warehouse-tariffs --sort=storage      # дешевле хранение → ↑
pnpm report:warehouse-tariffs --sort=stock        # больше остаток → ↑
pnpm report:warehouse-tariffs --sort=acceptance   # раньше приёмка → ↑
```

`--box-type=5` или `--box-type=6` переключает acceptance-фильтр на
монопаллеты / суперсейф (по умолчанию `2 = Короба`).

### Что использует «под капотом»

Никаких новых HTTP-запросов: отчёт строится **поверх уже загруженных
таблиц**. Если тарифы или коэффициенты приёмки не свежие — отчёт
честно покажет `tariffDate` / `acceptanceFetchedAt` в шапке и в JSON.
Когда в БД нет `wb_warehouse_box_tariffs`, CLI выходит с ошибкой и
просит сначала запустить `pnpm update:wb-tariffs`.

Источники данных:

- `WbWarehouseTariffRepository.getBoxForDate(latestDate)` — тариф коробов
- `WbWarehouseTariffRepository.getPalletForDate(latestDate)` — паллет (опционально)
- `WbWarehouseTariffRepository.getLatestAcceptance()` → фильтр по
  `boxTypeId` — приёмка на 14 дней
- `StockSnapshotRepository.getLatestStockUnitsByWarehouse()` — сумма
  units по складу из последнего стоков-снэпшота

Если стоков нет (например, чистая БД на новой машине) — колонка
`currentStockUnits` будет `null` повсюду, остальное работает.

### Как проверить

```bash
cd wb-stocks
nvm use
pnpm vitest run test/buildWarehouseTariffReport.test.ts   # 17/17 ✅
pnpm test          # полный прогон: 348/348 ✅
pnpm typecheck     # tsc --noEmit, чисто

# реальные данные:
pnpm update:wb-tariffs     # если ещё не делали
pnpm report:warehouse-tariffs --available-only --limit=15
```

## Известные ограничения

- **Локализации в выгодные склады/округа** в этой задаче нет —
  только сырые тарифы. Сводка «доставка склад X → регион Y» строится
  поверх (через `wbWarehouseMacroRegion` и `wbRegionMacroRegion`),
  это будет следующим инкрементом.
- **`return` тарифы** (`/api/v1/tariffs/return`) и **commission**
  (`/api/v1/tariffs/commission`) сознательно не импортируем — не
  нужны для текущей задачи. Каркас (клиент + парсер decimal) легко
  расширяется ещё одним методом и таблицей, если понадобятся.
- Acceptance endpoint накапливает историю — на маленьком аккаунте
  ~14 дат × ~50 складов × 3 типа поставки ≈ 2100 строк за прогон.
  При ежедневном cron это ~770к строк/год. Если станет тяжело —
  добавить retention job (`DELETE WHERE fetched_at < date('now','-N day')`).
- Отчёт **не сводит** тарифы с региональным спросом
  (`wb_region_demand_snapshots`) или нашим forecast-pipeline. Это можно
  сделать следующим инкрементом: к каждой строке прицепить
  `regionalDailyDemandInThisMacro` (через `wbWarehouseMacroRegion` →
  `wb_region_demand_snapshots.regional_forecast_daily_demand` по тому же
  макрорегиону) и считать «days_of_cover_if_we_ship_here» как
  `currentStockUnits / regionalDailyDemand`. Сейчас отчёт намеренно
  узкоспециализирован — «тариф + приёмка + текущий остаток», без
  forecast-зависимости.
- `score` — наивный `ship + 30-day store` для контейнера 10 л; реальная
  «оптимальность» зависит от типичной геометрии товара и срока
  оборачиваемости. Менять score → менять CLI default sort, поэтому
  пока оставлено самое очевидное и легко-интерпретируемое.
- Acceptance-сводка считается **только для одного `box_type_id`** за
  запуск (`--box-type=2` дефолт). Если хочется одновременно сравнить
  короба и паллеты — запустить отчёт дважды или собрать JSON каждой
  стороны и сджойнить вне CLI.
