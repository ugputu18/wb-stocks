# ReadmeAI — `wb-stocks`

> Документ описывает **архитектуру и осмысленные решения** модуля. Сюда
> заходят, чтобы понять «как тут что устроено и почему именно так», а не
> чтобы прочитать API-референс. WB API подробно расписан отдельно —
> [`docs/wb-api.md`](./docs/wb-api.md).

## Оглавление

1. [Назначение и контекст](#1-назначение-и-контекст)
2. [Архитектура](#2-архитектура)
3. [Модель данных](#3-модель-данных)
4. [Кросс-каттинг конвенции](#4-кросс-каттинг-конвенции)
5. [Pipeline 1 — WB stocks](#5-pipeline-1--wb-stocks-остатки-на-складах-wb)
6. [Pipeline 2 — Own warehouse state](#6-pipeline-2--own-warehouse-state-собственный-склад)
7. [Pipeline 3 — WB FBW supplies](#7-pipeline-3--wb-fbw-supplies-поставки-fbw)
8. [Окружение и запуск](#8-окружение-и-запуск)
9. [Тесты](#9-тесты)
10. [Что модуль НЕ делает (и почему)](#10-что-модуль-не-делает-и-почему)
11. [Карта будущих изменений](#11-карта-будущих-изменений)
12. [Pipeline 4 — Sales forecast MVP](#12-pipeline-4--sales-forecast-mvp)

---

## 1. Назначение и контекст

`wb-stocks` хранит **исторические снапшоты остатков** в локальной SQLite-базе.
Сейчас три независимых источника данных:

| Источник | Откуда берётся | Use case | CLI |
|---|---|---|---|
| WB stocks | WB Statistics API | `importWbStocks` | `pnpm import:stocks` |
| Собственный склад | CSV `store/our<MMDD>.csv` | `importOwnWarehouseState` | `pnpm import:own-stocks` |
| WB поставки FBW | WB FBW Supplies API (3 эндпойнта) | `importWbSupplies` | `pnpm update:wb-supplies` |
| WB sales forecast MVP | orders + demand snapshot + stocks + supplies | `runSalesForecastMvp` | `pnpm forecast:sales-mvp` |
| Локальный forecast UI (MVP) | Preact UI на **`/`**, legacy на **`/legacy`**, JSON API без изменений | `startForecastUiServer` | `pnpm serve:forecast-ui` |

Имя `wb-stocks` оставлено историческим — WB был первым источником. Сейчас
модуль умышленно объединяет **несколько источников остатков в одной базе**,
чтобы не плодить параллельные инфраструктуры (одна миграция, один
логгер, один env, одна CLI-конвенция, общие конвенции тестирования).

**Контекст до этого модуля.** Ранее работа с остатками была построена на
вручную скачанных/заполненных CSV (`store/recommendations.csv`,
`store/our<MMDD>.csv` и др.) и Python-скриптах (`store/calculate_*.py`,
`store/analyze_*.py`, `store/update_*.py`). Этот модуль даёт программный
путь: фиксировать реальные значения в БД и копить историю, не ломая
существующие CSV-пайплайны.

## 2. Архитектура

Слойная DDD-light. Явно три слоя + CLI:

```
┌─────────────────────────────────────────────────────────────────┐
│ CLI                                                             │
│   src/cli/importStocks.ts            (WB stocks)                │
│   scripts/import-own-warehouse-state.ts (own warehouse)         │
│   scripts/update-wb-supplies.ts      (WB supplies)              │
│   scripts/run-sales-forecast-mvp.ts  (forecast happy path)      │
│   scripts/serve-forecast-ui.ts       (local thin UI + JSON API) │
└────────────┬────────────────────────────────────────────────────┘
             │  loadConfig + openDatabase + new Client + Repository
             │  → use case
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Application (use cases — чистые функции)                        │
│   importWbStocks         — WB stocks → DB                       │
│   importOwnWarehouseState — CSV → DB                            │
│   importWbSupplies       — WB FBW supplies → DB                 │
│   mapWbStockRow / mapWbSupply / parseOwnStockCsv (pure mappers) │
└────────────┬────────────────────────────────────────────────────┘
             │  WbXxxClient (network) + XxxRepository (DB)
             ▼
┌──────────────────────────────────┬──────────────────────────────┐
│ Infra — adapters                 │ Domain — types и schemas     │
│   wbStatsClient                  │   stockSnapshot              │
│   wbSuppliesClient               │   ownStockSnapshot           │
│   stockSnapshotRepository        │   wbSupply                   │
│   ownStockSnapshotRepository     │   (zod-схемы + record-types) │
│   wbSupplyRepository             │                              │
│   db (SQLite open + migrations)  │                              │
└──────────────────────────────────┴──────────────────────────────┘
```

Жёсткие правила слоёв:

- **Domain** ничего не импортирует кроме `zod`. Только типы данных и
  схемы валидации входа от внешних систем.
- **Application** не знает про `fetch`, `better-sqlite3`, файлы. Принимает
  зависимости через DI (`{ wbClient, repository, logger, now? }`). Из-за
  этого все use case-ы тривиально мокаются в тестах.
- **Infra** реализует те самые зависимости. Здесь живут `fetch`, SQL,
  `fs`. Никакой бизнес-логики.
- **CLI** — тонкая обвязка: парсит флаги (`node:util.parseArgs`), грузит
  env, конструирует клиенты/репозитории, дёргает use case, печатает
  результат. Никакой бизнес-логики.

Use case-ы — **чистые функции** (`async function importXxx(deps, opts)`).
Их можно дёргать из шедулера/джобы напрямую, не разворачивая CLI.

## 3. Модель данных

Один SQLite-файл, дефолт `./data/wb-stocks.sqlite`. Миграции
идемпотентные (`CREATE … IF NOT EXISTS`), накатываются на
каждом `openDatabase()` в одной транзакции. Менеджера миграций нет
осознанно — пять таблиц, без изменений схемы по версиям.

### 3.1 Карта таблиц

```
wb_stock_snapshots          одна строка = (snapshot_at, nm_id, barcode,
                            tech_size, warehouse_name); INSERT-only,
                            история — серии строк по разным snapshot_at

own_stock_snapshots         одна строка = (snapshot_date, warehouse_code,
                            vendor_code); replace-for-date

wb_supplies                 одна строка = supply_id (PK)
   ├─ wb_supply_items       N строк, FK ON DELETE CASCADE
   └─ wb_supply_status_history  N строк, FK ON DELETE CASCADE
```

### 3.2 `wb_stock_snapshots`

Снапшот остатков WB на момент вызова `importWbStocks`. **INSERT-only**,
`INSERT OR IGNORE` на DB-уникальном ключе.

```sql
CREATE TABLE wb_stock_snapshots (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_at        TEXT    NOT NULL,    -- одинаковое для всего батча
  nm_id              INTEGER NOT NULL,
  vendor_code        TEXT,
  barcode            TEXT,
  tech_size          TEXT,
  warehouse_name     TEXT    NOT NULL,
  quantity           INTEGER NOT NULL,
  in_way_to_client   INTEGER,
  in_way_from_client INTEGER,
  quantity_full      INTEGER,
  last_change_date   TEXT
);
CREATE UNIQUE INDEX ux_wb_stock_snapshots_key
  ON wb_stock_snapshots (
    snapshot_at, nm_id,
    COALESCE(barcode, ''), COALESCE(tech_size, ''),
    warehouse_name
  );
```

`COALESCE` в индексе нужен потому, что SQLite считает каждый `NULL`
уникальным — без него повторный батч с null-полем не отфильтровался бы.

### 3.3 `own_stock_snapshots`

Снапшот собственного склада на календарную дату (CSV → БД). **Replace-
for-date**: один пирёр `(snapshot_date, warehouse_code)` хранит ровно
один батч.

```sql
CREATE TABLE own_stock_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date  TEXT    NOT NULL,    -- 'YYYY-MM-DD' (календарная дата)
  warehouse_code TEXT    NOT NULL,    -- 'main' по дефолту
  vendor_code    TEXT    NOT NULL,    -- "Артикул" из CSV
  quantity       INTEGER NOT NULL,    -- "Остаток" из CSV
  source_file    TEXT,                -- basename исходного CSV (аудит)
  imported_at    TEXT    NOT NULL     -- ISO timestamp импорта
);
CREATE UNIQUE INDEX ux_own_stock_snapshots_key
  ON own_stock_snapshots (snapshot_date, warehouse_code, vendor_code);
```

### 3.4 `wb_supplies` + items + status history

Поставки FBW. Заголовок (`wb_supplies`) — **upsert by `supply_id`**.
Товары и история статуса — отдельные таблицы с FK + ON DELETE CASCADE.

```sql
CREATE TABLE wb_supplies (
  supply_id               INTEGER PRIMARY KEY,
  preorder_id             INTEGER,
  phone                   TEXT,           -- маскированный
  create_date             TEXT,
  supply_date             TEXT,
  fact_date               TEXT,
  updated_date            TEXT,
  status_id               INTEGER NOT NULL,
  box_type_id             INTEGER,
  virtual_type_id         INTEGER,
  is_box_on_pallet        INTEGER,        -- 0/1
  warehouse_id            INTEGER,        -- из getSupplyDetails
  warehouse_name          TEXT,
  actual_warehouse_id     INTEGER,        -- если WB перенаправил поставку
  actual_warehouse_name   TEXT,
  quantity                INTEGER,        -- план (из details)
  accepted_quantity       INTEGER,
  unloading_quantity      INTEGER,
  ready_for_sale_quantity INTEGER,
  depersonalized_quantity INTEGER,
  first_seen_at           TEXT NOT NULL,  -- когда мы её впервые увидели
  last_seen_at            TEXT NOT NULL   -- последний sync, когда видели
);

CREATE TABLE wb_supply_items (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  supply_id                INTEGER NOT NULL,
  barcode                  TEXT,
  vendor_code              TEXT,
  nm_id                    INTEGER NOT NULL,
  tech_size                TEXT,
  color                    TEXT,
  quantity                 INTEGER,
  accepted_quantity        INTEGER,
  ready_for_sale_quantity  INTEGER,
  unloading_quantity       INTEGER,
  FOREIGN KEY (supply_id) REFERENCES wb_supplies(supply_id) ON DELETE CASCADE
);

CREATE TABLE wb_supply_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supply_id   INTEGER NOT NULL,
  status_id   INTEGER NOT NULL,
  fact_date   TEXT,
  changed_at  TEXT NOT NULL,
  FOREIGN KEY (supply_id) REFERENCES wb_supplies(supply_id) ON DELETE CASCADE
);
```

`PRAGMA foreign_keys = ON` включается при каждом `openDatabase` — без
него SQLite по умолчанию игнорирует FK.

## 4. Кросс-каттинг конвенции

Эти решения общие для всех трёх pipeline-ов. Они и есть «то, что нужно
помнить про модуль в целом».

### 4.1 Три модели идемпотентности (выбор по природе данных)

В коде существуют **три разных подхода**, по одному на каждый
pipeline. Их выбор не случайный — он отражает то, как соответствующие
данные меняются во времени:

| Pipeline | Модель | Где реализована | Почему именно так |
|---|---|---|---|
| WB stocks | INSERT-only с DB-unique key, `INSERT OR IGNORE` | `StockSnapshotRepository.saveBatch` | каждый запуск = новый `snapshotAt` = новая серия строк, нужна полная история во времени |
| Own warehouse | Replace-for-date (DELETE + INSERT в одной tx) | `OwnStockSnapshotRepository.replaceForDate` | per-day снапшоты, оператор переимпортирует тот же день — должна получиться **ровно та картина, что в CSV**, без merge-сюрпризов |
| WB supplies | Upsert by `supply_id` + replace items + append-on-change history | `WbSupplyRepository.{upsertSupply, replaceItemsForSupply, appendStatusHistoryIfChanged}` | поставка — долгоживущая сущность с переходами статуса; нужна и текущая картина, и переходы |

Никогда не путать эти модели. Если добавится новый pipeline — выбирать
тот же шаблон, не изобретать новый.

### 4.2 «Snapshot timestamp» vs «calendar date»

В модуле два разных понятия времени:

- **`snapshot_at: TEXT`** — ISO-8601 timestamp в UTC (`new Date().toISOString()`),
  используется для WB stocks. Один батч = один timestamp на все строки.
- **`snapshot_date: TEXT`** — календарная дата `YYYY-MM-DD` без часового
  пояса, используется для собственного склада. Один день = один
  снапшот, дёрганье CLI два раза в день — это всё равно один снапшот.

Для дат в WB API (фильтры по `dateFrom/till`) используем `YYYY-MM-DD`
(локальное представление). Внутри SQLite храним ровно то, что приходит
из WB (как правило это RFC3339 с TZ-смещением, например
`2026-04-17T14:57:54+03:00`) — не нормализуем, чтобы не терять
информацию о таймзоне источника.

### 4.3 Парсинг входящих данных (zod + result-объект)

Для всех внешних входов (WB API, CSV) используем единый шаблон:

1. zod-схема в `src/domain/...` — описывает **только используемые поля**;
   лишние игнорируются (zod object по умолчанию не strict).
2. Маппер в `src/application/...` — `safeParse` → возвращает
   discriminated union:
   ```ts
   type MapResult<T> = { ok: true; record: T }
                     | { ok: false; reason: string; raw: unknown };
   ```
3. Use case логирует `{ reason, raw }` на `warn` и пропускает строку,
   остальные строки продолжают обрабатываться. Битая строка **не валит**
   весь батч.

Строковые поля во всех схемах WB — `.nullish()` (а не `.optional()`),
потому что WB иногда возвращает `null` вместо отсутствия поля. Эту
разницу мы наступали — см. историю переезда с deprecated
`supplier/incomes`. После `safeParse` пустые строки `""` нормализуем в
`null` — единая семантика «нет значения».

### 4.4 Обработка ошибок (fail-loud vs per-row)

Правило: **fail-loud на главной ручке, per-row на всём остальном.**

Конкретно:

| Ошибка | Что делаем |
|---|---|
| Не валидный env (zod) | бросаем, процесс падает с ненулевым exit |
| Сеть/HTTP на главной ручке pipeline (`getSupplierStocks`, `listSupplies`, `readFile` для CSV) | бросаем — без главного запроса делать нечего |
| Сеть на per-row обогащении (`getSupplyDetails`, `getSupplyGoods`) | `error`-лог + счётчик `*Failed`, заголовок всё равно сохраняется (с null-полями), остальные поставки продолжают обрабатываться |
| Битая строка ответа (zod fail) | `warn`-лог + счётчик `skipped*` |
| Ошибка при upsert одной строки в DB | `error`-лог, остальные строки продолжают |
| HTTP 4xx, кроме 429 | бросаем, **не ретраим** — это баг запроса, не сети |
| HTTP 429/5xx/timeout | автоматический ретрай с backoff (см. [`docs/wb-api.md`](./docs/wb-api.md) §1.3) |

CLI ловит финальный throw и выставляет `process.exitCode = 1`, чтобы
шедулер мог это увидеть.

### 4.5 Логи (pino) и финальный JSON

- Логгер один на модуль (`src/logger.ts`), `service: "wb-stocks"`,
  ISO-time, JSON в stdout. Уровень — `LOG_LEVEL` из env, дефолт `info`.
- Каждый use case в финале **возвращает** результат-объект
  (`ImportXxxResult`) и одновременно логирует его на `info` с message
  `"... done"`. CLI ещё и печатает этот объект в stdout как pretty-JSON
  — для удобства ручного запуска.
- Структура результата всегда плоская и с консистентными именами
  `fetched / mapped / skipped / inserted / created / updated /
  unchanged / durationMs / dryRun`. Это критично — оперативная аналитика
  упирается в эти числа.

### 4.6 Конвенция CLI

Все три скрипта подчиняются одному шаблону:

1. `node:util.parseArgs` со `strict: true, allowPositionals: false` —
   опечатанный флаг сразу даёт ошибку и usage.
2. `--help` / `-h` печатают usage с примерами и выходят с кодом 2.
3. Грузят env через `loadConfig` (zod), даже если конкретно эта команда
   `WB_TOKEN` не использует — для валидации `DATABASE_PATH`/`LOG_LEVEL`.
4. `--dry-run` (где применимо) — проходит весь pipeline до `repository.*`
   и возвращает итоговый отчёт, **не делая записи**.

> **Грабля pnpm:** `pnpm <script> -- --foo=bar` ненадёжно пробрасывает
> аргументы (зависит от версии). Если флаги не доходят, запускайте
> скрипт прямо: `node --env-file=.env --import tsx
> scripts/update-wb-supplies.ts --from=2026-04-01 --dry-run`.

### 4.7 Тестирование

- `vitest run`. 10 тест-файлов, все проходят на in-memory SQLite
  (`openDatabase(":memory:")`).
- Use case-тесты подменяют сетевой клиент и часы:
  `now: () => new Date("2026-04-17T10:00:00.000Z")` — тогда все
  timestamp-ы детерминированы и тесты не флапают.
- Клиент-тесты используют `vi.spyOn(globalThis, "fetch")` — реальный
  HTTP не дёргается.
- Конкретный список тестов — в каждой соответствующей секции pipeline-а
  ниже.

### 4.8 Зависимости и почему именно они

| Пакет | Зачем |
|---|---|
| `better-sqlite3` | синхронный SQLite — простая транзакционная семантика, не нужен async-хайлайт |
| `csv-parse` | проверенный CSV-парсер с `bom: true`, `relax_column_count: true` под кривые операторские CSV |
| `pino` | структурный JSON-логгер, дешёвый |
| `zod` | валидация env + входящих API/CSV строк |
| `tsx` (dev) | запуск .ts напрямую без сборки — каждый CLI стартует одной командой |
| `vitest` (dev) | тесты, без babel-овой обвязки |

Намеренно **нет** `dotenv` — `node --env-file=.env` встроен в Node 20.6+.
Намеренно **нет** `axios` — нативный `fetch` в Node 22 покрывает всё, что
нужно (timeout через `AbortController`, заголовки, JSON).

## 5. Pipeline 1 — WB stocks (остатки на складах WB)

**Что делает.** Снимает текущее состояние остатков по всем складам WB
и пишет каждый запуск как новую серию строк (история по timestamp).

**Что использует.** `GET /api/v1/supplier/stocks` (Statistics API) —
полный референс в [`docs/wb-api.md`](./docs/wb-api.md) §2.1.

**Поток.**

```
CLI: src/cli/importStocks.ts
  loadConfig() → openDatabase() → new WbStatsClient() → new StockSnapshotRepository()
  → importWbStocks(deps)
       1. snapshotAt = now().toISOString()           — общий timestamp для всего батча
       2. wbClient.getSupplierStocks({ dateFrom })   — один HTTP запрос, ретраи внутри клиента
       3. mapWbStockRow(raw, snapshotAt)             — построчно через zod
       4. repository.saveBatch(records)              — INSERT OR IGNORE в одной tx
       5. return { snapshotAt, fetched, mapped, skipped, inserted, durationMs }
```

**Идемпотентность.** §4.1, INSERT-only с DB-unique key. Случайный
двойной запуск в ту же миллисекунду молча игнорируется; нормальный
повторный запуск даёт новую серию строк.

**Полезные граничные случаи (зашиты в тесты).**

- `dateFrom` по умолчанию = `"2019-01-01"` (рекомендация WB для «получи
  всё текущее»).
- `last_change_date` приходит без TZ — храним как есть, не нормализуем.
- Битая строка в ответе → `warn` + `skipped++`, остальные обрабатываются.

**Тесты.**

- `mapWbStockRow.test.ts` — полный ряд, отсутствующие опциональные поля,
  пустые строки → `null`, отбраковка невалидных.
- `stockSnapshotRepository.test.ts` — upsert/idempotency, сохранение
  истории по разным `snapshot_at`, различение `NULL` vs не-`NULL`
  в составном ключе.
- `importWbStocks.test.ts` — счётчики, идемпотентность с фиксированным
  `now()`, пропуск битых строк, прокидывание `dateFrom`, прозрачное
  падение на ошибке клиента.
- `wbStatsClient.test.ts` — корректный URL и `Authorization`, 4xx →
  `WbApiError`, ретрай на 429, ошибка на не-массиве в ответе.

## 6. Pipeline 2 — Own warehouse state (собственный склад)

**Что делает.** Импортирует «состояние нашего склада на дату» из CSV в
формате `store/our<MMDD>.csv`. Один день = один снапшот.

**Семантика «состояние на дату».** В проекте **нет таблицы движений
товара** (приходов/расходов/перемещений), поэтому состояние на дату не
рассчитывается из движений. Текущая семантика — **ровно то, что в
CSV-файле, подготовленном оператором для этой даты**. Если когда-нибудь
появятся движения, snapshot-таблица не изменится — в ней всегда
итоговое состояние.

**Источник данных.**

- Дефолт: `<conventionBaseDir>/our<MMDD>.csv`, где `conventionBaseDir`
  жёстко задан в CLI как `../store` (т.е. файл рядом с папкой модуля).
- Override: флаг `--file=<путь>`.
- Формат CSV согласован с Python-скриптами `store/`: колонки
  `Артикул, Остаток, Потребность, Потребность WB 56`. Используем только
  `Артикул → vendor_code` и `Остаток → quantity`. Колонки
  `Потребность*` — плановые наложения, **не** часть состояния склада, в
  снапшот не попадают.

**Правила парсинга** (`parseOwnStockCsv`, согласованы с
`store/update_our0418_wb56.py :: parse_int`):

- пустой `Остаток` → `0`;
- `"1 234"` и `"1,5"` нормализуются (`1234`, `1`);
- строка без `Артикул` → пропуск с `warn` (в операторских CSV в конце
  обычно пустые строки и строка-итог типа `43,157 pcs` — их тут и
  ловим).

**Поток.**

```
CLI: scripts/import-own-warehouse-state.ts
  loadConfig() → openDatabase() → new OwnStockSnapshotRepository()
  → importOwnWarehouseState(deps, { date, warehouseCode, file, conventionBaseDir })
       1. snapshotDate = options.date ?? today (LOCAL, не UTC — это календарная дата оператора)
       2. resolve sourceFile (по конвенции из date, либо явный --file)
       3. existing = repository.countForDate(...)   — для флага wasUpdate
       4. parseOwnStockCsv(buffer)                   — { rows, issues }
       5. records = rows.map(...)
       6. repository.replaceForDate(...)             — DELETE + INSERT в одной tx
       7. return { ..., wasUpdate, fetched, skipped, inserted, durationMs }
```

**Идемпотентность.** §4.1, replace-for-date. Перезапуск за тот же
`(snapshotDate, warehouseCode)` полностью перетирает снапшот этой пары.
Снимки за другие даты/склады не затрагиваются. В логе финального
сообщения — флаг `wasUpdate: true|false`.

**Несколько складов в будущем.**

- Ключ снапшота уже содержит `warehouse_code`.
- В CLI есть `--warehouse=<code>`, дефолт — `main`.
- Справочник складов отдельной таблицей не выделен (избыточно для
  единственного склада); появится потребность — добавится без миграции
  снапшотов.

**Два независимых входа.** `--date` и `--file` **не обязаны
совпадать**: `--date` — это **ключ снапшота в БД**, `--file` — это
**источник данных**. Кейс «оператор положил CSV с именем завтрашнего
числа, а зафиксировать надо сегодняшним снапшотом» решается явной парой
`--date=2026-04-17 --file=../store/our0418.csv`.

**Тесты.**

- `parseOwnStockCsv.test.ts` — пустые значения, нормализация чисел,
  BOM/пробелы, пропуск строк без артикула, игнор лишних колонок.
- `ownStockSnapshotRepository.test.ts` — `replaceForDate`: вставка,
  повторный вызов как идемпотент, разделение по датам и по складам,
  пустой батч = очистка снапшота даты.
- `importOwnWarehouseState.test.ts` — дефолт даты = local today,
  конвенция имени файла из даты, `--file` override, флаг `wasUpdate`,
  прокидывание `warehouseCode`, пропуск битых строк, валидация формата
  даты, проброс IO-ошибок.

## 7. Pipeline 3 — WB FBW supplies (поставки FBW)

**Что делает.** Тащит текущее состояние поставок на склады WB
(заголовок + товары + история смены статуса), три отдельные таблицы.

**Что использует.** Три эндпойнта FBW Supplies API — полный референс в
[`docs/wb-api.md`](./docs/wb-api.md) §3.

**Почему не WB Statistics?** Использовавшийся раньше
`GET /api/v1/supplier/incomes` **отключён 11 марта 2026**
([`docs/wb-api.md`](./docs/wb-api.md) §2.3). Замены 1-в-1 нет: WB
разделили данные о поставках по нескольким эндпойнтам нового API.

**Поток.**

```
CLI: scripts/update-wb-supplies.ts
  loadConfig() → openDatabase() → new WbSuppliesClient() → new WbSupplyRepository()
  → importWbSupplies(deps, { dateFrom, dateTo, statusIds, withDetails, withItems, dryRun })

  Phase 1 — list (главная ручка, fail-loud):
    while (true) {
      page = listSupplies({ limit:1000, offset, dates:[{from,till,type:createDate}], statusIDs })
      rawRows.push(...page)
      if (page.length < 1000) break
      offset += 1000
    }

  Phase 2 — validate + filter:
    for raw in rawRows:
      r = parseListRow(raw)
      if (!r.ok)                              skipped++
      else if (r.value.supplyID is null/0)    preorderOnly++   // не сохраняем
      else                                    valid.push(r.value)

  Phase 3 — per-supply enrich + persist (per-row error tolerant):
    for list in valid:
      details = withDetails ? getSupplyDetails(supplyId) : null
      items   = withItems   ? getSupplyGoods(supplyId).map(parseGoodsRow → buildItemRecord) : []
      if dryRun: continue

      record = buildSupplyRecord(list, details)
      result = repository.upsertSupply(record, seenAt)   // 'created' | 'updated' | 'unchanged'
      if items.length > 0: repository.replaceItemsForSupply(supplyId, items)
      wrote = repository.appendStatusHistoryIfChanged(supplyId, statusId, factDate, seenAt)

  return { dateFrom, dateTo, fetchedRows, validRows, preorderOnly,
           created, updated, unchanged, statusChanged,
           detailsFetched, detailsFailed, itemsFetched, itemsFailed, itemsTotal,
           durationMs, dryRun }
```

**Опциональные фазы.** `--no-details` и `--no-items` отключают вторую
и третью фазу соответственно. Один `--no-details --no-items` =
быстрый list-only sync (1 запрос на 1000 поставок). Полезно, чтобы
просто увидеть, какие supplyID существуют.

**Идемпотентность — три разных модели в одной use case.**

1. **`wb_supplies`** — `UPSERT BY supply_id`. `upsertSupply` сравнивает
   все «бизнес-поля» (`status / factDate / quantities / warehouse / ...`),
   если ничего не поменялось — возвращает `unchanged` и не трогает
   `first_seen_at`. Логика сравнения — функция `supplyFieldsDiffer` в
   `wbSupplyRepository.ts`; туда нужно добавлять любое новое поле, по
   которому считается «изменилось».
2. **`wb_supply_items`** — на каждый sync **полная замена**
   (`DELETE WHERE supply_id=? + INSERT ...` в одной tx). Дубликаты
   невозможны, изменение состава товаров поставки даёт актуальную
   картину без diff-логики на уровне строк.
3. **`wb_supply_status_history`** — append, **только если** пара
   `(status_id, fact_date)` отличается от последней зафиксированной.
   Первое наблюдение поставки **всегда** пишет одну строку.

Что это даёт практически:

- повторный запуск без изменений → `created/updated/statusChanged = 0`,
  `unchanged = N` (наблюдается на проде);
- настоящий переход статуса (например, `2 → 5`) → `updated = 1` +
  одна новая строка в истории;
- появление `factDate` без смены статуса → также пишет историю
  (важная информация: «тогда-то фактически приехало»).

**Поставки без `supplyID` (preorder-only, статус 1).** Не пишутся в
эти таблицы — у них нет стабильного ключа на стороне WB. В логе
учитываются как `preorderOnly` для прозрачности.

**Поведение при ошибках.**

- Ошибка `listSupplies` → fail-loud, exit 1.
- Ошибка `getSupplyDetails` / `getSupplyGoods` per-supply → error-лог,
  счётчик `*Failed`, **заголовок всё равно upsert-ится** (с
  null-полями склада/количеств), остальные поставки продолжают.
- Ошибка `repository.*` per-supply → error-лог, остальные поставки
  продолжают.
- 429 — клиент сам ждёт и повторяет (см. [`docs/wb-api.md`](./docs/wb-api.md) §1.3).

**Пример выхода (реальный прод-прогон, 4 поставки за 17 дней).**

Первый запуск:
```json
{
  "dateFrom": "2026-04-01", "dateTo": "2026-04-17",
  "fetchedRows": 4, "validRows": 4, "skippedRows": 0, "preorderOnly": 0,
  "created": 4, "updated": 0, "unchanged": 0, "statusChanged": 4,
  "detailsFetched": 4, "detailsFailed": 0,
  "itemsFetched": 4, "itemsFailed": 0, "itemsTotal": 120,
  "durationMs": 5068, "dryRun": false
}
```

Повторный запуск без изменений:
```json
{
  "created": 0, "updated": 0, "unchanged": 4, "statusChanged": 0,
  "detailsFetched": 4, "itemsFetched": 4, "itemsTotal": 120,
  "durationMs": 13804
}
```

`durationMs` ≈ 14 сек — упёрлись в лимит 30 req/min, клиент сам подождал
и повторил. Без потерь.

**Тесты.**

- `mapWbSupply.test.ts` — `parseListRow / parseDetails / parseGoodsRow`
  (валидные и битые входы), `buildSupplyRecord` (склейка списка +
  деталей, нормализация пустых строк в `null`, обязательность
  `supplyID`), `buildItemRecord`.
- `wbSupplyRepository.test.ts` — три отдельных пути:
  upsert (`created → unchanged → updated`), `replaceItemsForSupply` (нет
  дубликатов и старые строки исчезают), `appendStatusHistoryIfChanged`
  (пишет первый раз, не пишет повторно, пишет на смену статуса/
  fact_date), round-trip булева `isBoxOnPallet`.
- `importWbSupplies.test.ts` — end-to-end use case на in-memory SQLite
  с фейковым клиентом: end-to-end сценарий с 2 поставками,
  идемпотентность повторного прогона, переход статуса с появлением
  `factDate`, пагинация (1001 запись = 2 страницы), `dryRun` ничего не
  пишет, per-supply ошибки `details/goods` не валят весь импорт,
  ошибка `listSupplies` всё-таки роняет весь run, дефолт `dateFrom =
  today − 30d`.

## 8. Окружение и запуск

### 8.1 Требования

- **Node.js 20.6+** (проверено и зафиксировано в `.nvmrc` на 22).
  `--env-file=.env` встроен в Node 20.6+, отдельного `dotenv` нет.
- `pnpm`.
- Внутри `wb-stocks/` сделать `nvm use`, чтобы переключиться на Node 22.

### 8.2 Подготовка

```bash
cd wb-stocks
nvm use
pnpm install
cp .env.example .env
# вписать WB_TOKEN: scope Statistics нужен для import:stocks,
# scope Marketplace нужен для update:wb-supplies.
# Для import:own-stocks токен не нужен (CSV).
```

### 8.3 Env

| Переменная | Описание | По умолчанию |
|---|---|---|
| `WB_TOKEN` | Seller-токен. Scope Statistics для stocks, Marketplace для supplies. | — (опционально, нужен только для WB-flow) |
| `WB_STATS_BASE_URL` | База WB Statistics API | `https://statistics-api.wildberries.ru` |
| `WB_SUPPLIES_BASE_URL` | База WB FBW Supplies API | `https://supplies-api.wildberries.ru` |
| `DATABASE_PATH` | Путь к SQLite-файлу | `./data/wb-stocks.sqlite` |
| `LOG_LEVEL` | Уровень pino-логов | `info` |

### 8.4 Команды

```bash
# WB stocks (текущее состояние, история по timestamp):
pnpm import:stocks

# Собственный склад (CSV → snapshot на дату):
pnpm import:own-stocks                       # сегодня, склад main, ../store/our<MMDD>.csv
pnpm import:own-stocks --date=2026-04-18
pnpm import:own-stocks --date=2026-04-17 --file=../store/our0418.csv
pnpm import:own-stocks --warehouse=spb --file=../store/spb_2026-04-18.csv

# WB FBW supplies:
pnpm update:wb-supplies                              # default lookback = 30d
pnpm update:wb-supplies --from=2026-04-01            # явная дата
pnpm update:wb-supplies --from=2026-04-01 --to=2026-04-15
pnpm update:wb-supplies --status=4,5,6               # только идущие/принятые/выгруженные
pnpm update:wb-supplies --no-details --no-items      # быстрый list-only sync
pnpm update:wb-supplies --from=2026-04-01 --dry-run  # ничего не пишет в БД

# Если pnpm плохо пробрасывает флаги — запускайте напрямую:
node --env-file=.env --import tsx scripts/update-wb-supplies.ts --from=2026-04-01 --dry-run
```

### 8.5 Из кода (use case как чистая функция)

```ts
import { importWbStocks } from "wb-stocks/src/application/importWbStocks.js";
import { importOwnWarehouseState } from "wb-stocks/src/application/importOwnWarehouseState.js";
import { importWbSupplies } from "wb-stocks/src/application/importWbSupplies.js";

const r1 = await importWbStocks({ wbClient, repository, logger });
const r2 = await importOwnWarehouseState(
  { repository, logger },
  { date: "2026-04-18", warehouseCode: "main" },
);
const r3 = await importWbSupplies(
  { wbClient, repository, logger },
  { dateFrom: "2026-04-01", withItems: true },
);
```

Шедулера в модуле нет — это сознательно. Когда понадобится cron / BullMQ
/ systemd timer, его задача ограничивается «вызвать use case в нужный
момент» и распорядиться результатом. Никакой логики «сколько раз в день
импортировать» в use case-ах нет.

### 8.6 Грабли окружения

- `node: bad option: --env-file=.env` → оболочка на Node < 20.6, сделать
  `nvm use` внутри `wb-stocks/`.
- `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` → `pnpm` запущен не из
  `wb-stocks/`.
- `Invalid environment configuration: WB_TOKEN: ...` → не вписан токен в
  `.env` (для нужного pipeline).
- `SqliteError: no such column: status_id` при первом
  `update:wb-supplies` после старого билда → в БД остались устаревшие
  таблицы поставок с предыдущей итерации схемы. Удалить:
  `sqlite3 data/wb-stocks.sqlite 'DROP TABLE wb_supply_status_history;
  DROP TABLE wb_supply_items; DROP TABLE wb_supplies;'` — миграции
  пересоздадут их.

## 9. Тесты

```bash
pnpm test            # vitest run, single pass
pnpm test:watch      # вотчер
pnpm typecheck       # tsc --noEmit
```

Сейчас 10 тест-файлов / 62 теста. Список и покрытие — по pipeline-ам в
секциях §5.5, §6 «Тесты», §7 «Тесты». Общие принципы — §4.7.

## 10. Что модуль НЕ делает (и почему)

**Не входит в скоуп модуля:**

| Что | Почему |
|---|---|
| Каталог / цены (`category, subject, brand, Price, Discount`) | другая задача — каталог-pipeline; zod-схемы намеренно эти поля игнорируют |
| Аналитика поверх снапшотов | задача Python-скриптов в `store/` (`calculate_*`, `analyze_*`) и/или будущего отчётного модуля |
| Расчёт ETA / out-of-stock-риска | аналитика поверх таблиц `wb_supplies + wb_stock_snapshots + own_stock_snapshots` — отдельный пайплайн |
| Шедулер / cron | задача оркестратора (cron, systemd, BullMQ); use case — чистая функция |
| Запись в `recommendations.csv`-pipeline | независимый источник данных, не мешает существующим расчётам |
| Управление поставками (создание, изменение состава) | задача оператора в кабинете WB |
| Preorder-only заявки (statusID=1, без supplyID) | нет стабильного ключа для upsert |

**Архитектурные «не делаем»:**

- Нет ORM. better-sqlite3 + сырой SQL — простая и предсказуемая
  семантика транзакций, отсутствие магии.
- Нет менеджера миграций. 5 таблиц, `CREATE IF NOT EXISTS`. Появится
  необходимость менять схему по версиям — добавим простой
  schema-version-counter, не раньше.
- Нет автоматического кэша HTTP. Плохо ложится на наши паттерны (snapshot
  на момент времени), да и WB-эндпойнты не cacheable.

## 11. Карта будущих изменений

Места, в которых **уже сейчас известно**, что нужно будет поменять:

| Когда | Что | Где менять |
|---|---|---|
| **2026-06-23** | WB отключит `GET /api/v1/supplier/stocks`. Переезжаем на `POST /api/analytics/v1/stocks-report/wb-warehouses` | новый `WbAnalyticsClient` рядом с `WbStatsClient`; `StockSnapshotRecord` менять не надо (поля `barcode`, `supplierArticle`, `inWayTo*`, `quantity_full` уже nullable). См. [`docs/wb-api.md`](./docs/wb-api.md) §2.2 |
| при появлении 2-го склада | вынести справочник складов в таблицу | `own_stock_snapshots.warehouse_code` уже есть; добавится таблица `warehouses` без миграции снапшотов |
| при появлении движений товара | альтернативный путь «состояние из движений» | новая таблица движений + use case, **не** меняя `own_stock_snapshots` |
| если WB добавит новые statusID для поставок | расширить `SUPPLY_STATUS_LABELS` и [`docs/wb-api.md`](./docs/wb-api.md) §3.4 | `src/domain/wbSupply.ts` |
| если в `wb_supplies` появятся новые «бизнес-поля» | расширить `supplyFieldsDiffer` в `wbSupplyRepository.ts` — иначе они не будут триггерить `updated` | `src/infra/wbSupplyRepository.ts` |
| если поставки начнут отдавать > 1000 товаров | добавить пагинацию в `getSupplyGoods` | `src/infra/wbSuppliesClient.ts` |

## 12. Pipeline 4 — Sales forecast MVP

Прогноз deliberately собран **поверх существующих снапшотов**, без новой
отдельной интеграции WB:

1. `importWbOrders` подтягивает orders за окно `snapshotDate - 30 ... snapshotDate - 1`
   и сохраняет дневные агрегаты в `wb_orders_daily` и параллельно в **`wb_orders_daily_by_region`**
   (по `regionName`: ключ `region_key`, тот же net-of-cancel accounting).
2. `computeDemandSnapshot` считает **fulfillment** demand baseline в `wb_demand_snapshots`
   (спрос по складу исполнения).
2b. `computeRegionDemandSnapshot` считает **региональный** спрос в **`wb_region_demand_snapshots`**
   (те же 7/30-дневные формулы; ключ `(region_key, nm_id, tech_size)`). Не подменяет шаг прогноза по складам.
3. `buildForecastSnapshot` соединяет **только** fulfillment demand (`wb_demand_snapshots`) + pinned stock snapshot + incoming
   supplies и пишет `wb_forecast_snapshots`.
4. `runSalesForecastMvp` — orchestration use case для CLI happy path (включает шаги 1–2b + 3).

**Таблица `wb_region_macro_region`:** явное сопоставление `region_key` → макрорегион; строки БД перекрывают bootstrap в **`wbRegionKeyMacroRegionBootstrap.ts`**. Без маппинга buyer-регион попадает в «Не сопоставлен». На **`/redistribution`** по умолчанию **regional ranking**: **`transferScore`** использует **`targetRegionalDemand`** (buyer-region, Σ по макрорегиону цели); опционально **fulfillment** — по **`targetForecastDailyDemand`**. Донор и **`recommendedToWB`** складовые. Заполняется вручную (SQL/seed) при необходимости, без эвристики по подстроке.

**CLI `--sku` / `--warehouse`:** ограничивают только **запись** в
`wb_forecast_snapshots` (scoped `DELETE` + `INSERT` по совпадению колонок).
Импорт orders и пересчёт `wb_demand_snapshots` на `--date` остаются **полными**
за фиксированное окно — иначе спросовая таблица рассинхронизируется с
реальностью.

Основные конвенции MVP:

- Ключ спроса/прогноза: `(warehouse_key, nm_id, tech_size)`.
- `vendor_code` и `barcode` — payload-only, для explainability и сверки.
- Stock snapshot выбирается по UTC cutoff:
  последний `snapshot_at <= snapshotDateT23:59:59.999Z`.
- Incoming по поставкам готовится отдельно в `selectIncomingSupplies`.
- Incoming статусы для прогноза: `2,3,4,6`.
- Статус `5` исключается: принятая поставка уже должна быть в `wb_stock_snapshots`.
- Поставка с датой `D` считается доступной в начале дня `D`.
- `forecast_daily_demand` может быть дробным, поэтому `forecast_units` и
  `end_stock` могут быть дробными; `daysOfStock` остаётся количеством
  целых полных дней покрытия.
- `--dry-run` для CLI реализован через SQLite savepoint + rollback:
  команда честно считает весь pipeline, но не оставляет следов в БД.

**Локальный forecast UI** (`pnpm serve:forecast-ui`, см. `docs/forecast-ui.md`): по умолчанию открывать **`/`** (Preact, `pnpm build:forecast-ui-client`); старый vanilla-экран — **`/legacy`** для сравнения и fallback. Чтение `wb_forecast_snapshots` + `own_stock_snapshots`, pipeline не трогаем.

**Макрорегионы складов WB** в forecast UI: явный mapping `warehouse_key` → кластер в **`wb-stocks/src/domain/wbWarehouseMacroRegion.ts`** (клиент реэкспортирует); без эвристики по имени; неизвестный склад → подпись **«Не сопоставлен»**. Диагностика: **`GET /warehouse-region-audit`** в UI и **`GET /api/forecast/warehouse-region-audit`** (агрегаты по `wb_forecast_snapshots`, список складов без маппинга по спросу). Таблица **`wb_region_macro_region`** относится к **регионам заказов** (нормализованный `regionName`), отдельно от складского справочника; для **regional**-ranking на **`/redistribution`** склад и buyer-регион сводятся к **одному имени макрорегиона** для сигнала сортировки.

**Кастомные пути forecast UI (SPA, один `index.html`):** **`/`**, **`/redistribution`**, **`/warehouse-region-audit`**, **`/regional-demand-diagnostics`** — в клиенте импорт из **`forecast-ui-client/src/routes.ts`**; реализация общая с сервером в **`src/forecastUiRoutes.ts`**.

**Региональный спрос (read-side):** **`wb_orders_daily_by_region`** и **`wb_region_demand_snapshots`** — спрос по **`regionName`** из заказов WB (не по складу исполнения). Поле **`regional_forecast_daily_demand`** — аналог `forecast_daily_demand` в `wb_demand_snapshots`. Сверка по SKU: **`GET /api/forecast/regional-demand-verify?snapshotDate=&nmId=&techSize=`**; **`POST /api/forecast/regional-demand`** — пакетно по SKU (в JSON — полный merged **`regionMacroMap`**: bootstrap + БД). **Сводка по всей сети (без SKU):** страница **`/regional-demand-diagnostics`**, API **`GET /api/forecast/regional-vs-warehouse-summary`** — сравнение regional vs fulfillment по макрорегионам; расширенный явный маппинг субъектов РФ в bootstrap снижает долю unmapped и делает **`comparisonByMacroRegion`** содержательнее; блок unmapped остаётся для контроля. Основной прогноз и главная таблица по-прежнему на **fulfillment**; **`/redistribution`** для приоритета перевозок по умолчанию **regional** (buyer-region signal), **`rankingMode=fulfillment`** — альтернатива по складу исполнения.

**Сырые заказы WB (диагностика, read-only, без записи в БД):** построчно в SQLite не храним — только дневные агрегаты. Для проверки **`regionName` (buyer) vs `warehouseName` (исполнение)** в forecast UI добавлены **`GET /api/forecast/raw-orders-diagnostics`**, **`GET /api/forecast/order-flow-by-region`**, **`GET /api/forecast/order-flow-macro-matrix`** (параметры **`dateFrom`**, **`dateTo`**, опционально **`nmId`**, **`vendorCode`**; окно до 31 дня; нужен **`WB_TOKEN`** — live-вызов WB Statistics API). Матрица макрорегионов: buyer → **`wbRegionMacroRegion`**, fulfillment → **`wbWarehouseMacroRegion`**. Подробности — `docs/forecast-ui.md`, раздел «Диагностика: сырые заказы WB».

**Сценарий «Перемещение между складами WB»** (отдельная страница Preact **`/redistribution`**, тот же `index.html`, что и **`/`**): read-side эвристика. **Донор** — всегда склад (резерв, излишек). По умолчанию **Regional**: **цель — макрорегион**; **нехватка** до целевого покрытия = `max(0, ceil(ceil(Σ regional/день × покрытие) − Σ local в макрорегионе по сети SKU))` (эквивалентно `max(0, ceil(целевой запас − Σ local))`); **`recommendedTransferUnitsToRegion = min(donorTransferableUnits, нехватка)`**; **`transferScore = перевод × Σ regional/день`**; строки «донор и цель в одном макрорегионе» отбрасываются; склады — кандидаты, **preferred** = max **recommendedToWB** в регионе (подсказка). Режим **Fulfillment**: цель = склад исполнения, **`recommendedTransferUnits = min(donorTransferableUnits, recommendedToWB)`**, score × спрос склада. В regional-таблице у макрорегиона можно нажать **«Склады»** и раскрыть список складов WB в регионе (те же кандидаты и preferred, что в модели) — только подсказка маршрута. Пользователь выбирает **склад-донор**: **`GET /api/forecast/rows`** с **`viewMode=wbWarehouses`**, **`warehouseKey=донор`**; для топ SKU по **`donorTransferableUnits`** догружается сеть по **`q=nm_id`** + **`techSize`**. Query **`rankingMode=fulfillment`** для явного переключения. Подробности — `docs/forecast-ui.md`, раздел «Перемещение между складами WB». **UX верификации:** карточка «сводка по донору» (Σ локальных остатков, Σ спроса, оценка дней покрытия по складу, число SKU с излишком при текущем резерве); таблица **«Товары донора»** — все SKU×размер склада с локальным остатком, в пути, резервом и «можно снять» (тот же расчёт, что и для перераспределения); клик по строке рекомендации или товара донора открывает **inline-панель** сети по SKU (`q` + `techSize`), таблица по складам с пометками донор/получатель и подсветкой потребности «На WB», совпадающие строки в рекомендациях подсвечиваются. **Основная таблица** переключается query **`viewMode`** (по умолчанию **`systemTotal`**): **`systemTotal`** («Запасы в целом») — одна строка на SKU, риск и дни запаса по пулу **system** (WB∑+own), колонка **OOS (system)** — read-side оценка **`snapshot_date + floor(daysOfStockSystem)`** календарных дней при положительном Σ-спросе (согласована с «Дн. system»; не `MIN(stockout_date)` по WB); **`wbTotal`** («WB в целом») — та же строка SKU, бакет риска по **WB**, OOS — **`MIN(stockout_date)`** по сети; либо **`wbWarehouses`** (строка = `warehouse_key × sku`). В JSON для агрегатов и supplier-витрины read-side отдаёт **`wbStartStockTotal`** / **`wbIncomingUnitsTotal`**: раскладка **`wbAvailableTotal`** (= сток + в пути по сети WB для SKU). Рекомендации «На WB» и supplier-план те же read-side формулы, не дублируя business logic. Из режимов **`wbTotal`** / **`systemTotal`** можно одним действием перейти к строкам по складам: UI выставляет **`viewMode=wbWarehouses`**, **`q=<nm_id>`** и опционально **`techSize`** (узкий фильтр, только при числовом `q`). Фильтры и режим **дублируются в адресной строке** (`history.replaceState` после загрузки; drilldown через `pushState`; восстановление при refresh и **Назад**); токен UI в URL **не** пишется. **Supplier replenishment** остаётся **sku-level** (`nm_id` + `tech_size`): `GET /api/forecast/supplier-replenishment` — **одна строка на SKU**; «Заказать» от пула (`recommendedFromSupplier`), плюс read-side **план заказа с lead time** — `leadTimeDays` / `coverageDays` / `safetyDays`, поля `recommendedOrderQty`, `daysUntilStockout`. В **`GET /api/forecast/summary`** KPI по рискам и **`recommendedToWBTotal`** следуют выбранному **`viewMode`**; **`recommendedFromSupplierTotal`** и **`recommendedOrderQtyTotal`** — всегда по SKU-витрине. Экспорт: `GET /api/forecast/export-wb` (ветвление колонок по `viewMode`), `GET /api/forecast/export-supplier`. В панели **«Детали строки»** основной UI показывает **расшифровку формул** рекомендации «На WB» и заказа у поставщика (см. `docs/forecast-ui.md`, раздел «Расшифровка рекомендаций»). **Основной UI** (`forecast-ui-client`): общие примитивы подсказок в `components/hints/` и явное отображение **сток / в пути** в таблицах и explain (см. `docs/forecast-ui.md`, «Основной UI»).
