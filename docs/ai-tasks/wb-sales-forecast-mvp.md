# WB SALES FORECAST MVP (WAREHOUSE-LEVEL)

Нужно реализовать MVP-прогноз продаж по товарам и складам WB.

Цель:
Для каждой пары товар × склад рассчитывать прогноз продаж на 30, 60 и 90 дней с учетом:
- текущей уходимости
- краткосрочной динамики
- текущих остатков
- ожидаемых поставок

Важно:
- сначала исследовать текущую реализацию
- не выдумывать структуру проекта
- максимально переиспользовать существующие данные и сервисы
- двигаться по этапам
- после каждого этапа кратко описывать результат

---

# ЭТАП 1. ИССЛЕДОВАНИЕ

Найди в проекте:

1. Источники данных:
   - остатки по складам
   - поставки WB
   - продажи / заказы WB
   - справочник товаров (nmId, vendorCode, barcode, internal SKU)

2. Где это хранится:
   - таблицы
   - модели
   - сервисы
   - snapshot-структуры

3. Что уже есть:
   - агрегаты продаж
   - CLI-скрипты
   - джобы
   - GraphQL / internal endpoints

4. Выбери источник спроса для MVP:
   - предпочтительно фактические продажи (выкупы)
   - если они ненадежны — заказы
   - явно обоснуй выбор

Верни:
- список найденных мест в коде
- какой источник спроса выбран
- краткий план реализации

---

# ЭТАП 2. DEMAND SNAPSHOT

Реализовать расчет demand-метрик на дату snapshotDate.

Для каждой пары товар × склад:

units7 = сумма за 7 дней  
units30 = сумма за 30 дней  

avgDaily7 = units7 / 7  
avgDaily30 = units30 / 30  

baseDailyDemand = 0.6 * avgDaily7 + 0.4 * avgDaily30  

trendRatio = avgDaily7 / max(avgDaily30, epsilon)  
trendRatioClamped = clamp(trendRatio, 0.75, 1.25)  

forecastDailyDemand = baseDailyDemand * trendRatioClamped  

Сохранить snapshot в БД.

Требования:
- idempotent (upsert по snapshotDate + warehouse + sku)
- не дублировать данные
- использовать существующие модели, если возможно

---

# ЭТАП 3. ПРОГНОЗ (SIMULATION)

Реализовать прогноз на горизонты:
- 30 дней
- 60 дней
- 90 дней

Для каждой пары товар × склад:

Вход:
- forecastDailyDemand
- текущий остаток
- поставки по дням

Логика по дням:

available = stock + incoming  
sales = min(available, forecastDailyDemand)  
stock_next = available - sales  

Посчитать:
- forecastUnits
- endStock
- daysOfStock
- stockoutDate (если есть)

Сохранить snapshot:
(snapshotDate, horizon, warehouse, sku)

---

# ЭТАП 4. CLI

Сделать CLI-скрипт:

tsx scripts/run-sales-forecast-mvp.ts

Параметры:
--date=YYYY-MM-DD
--horizons=30,60,90
--dry-run
--sku (optional)
--warehouse (optional)

Скрипт:
1. считает demand snapshot
2. считает forecast
3. сохраняет результат (если не dry-run)

---

# ЭТАП 5. ОБЪЯСНИМОСТЬ

Обеспечить возможность понять прогноз:

Для каждой записи должны быть доступны:
- units7
- units30
- avgDaily7
- avgDaily30
- baseDailyDemand
- trendRatio
- forecastDailyDemand
- startStock
- incoming

Можно:
- либо хранить в forecast snapshot
- либо связать с demand snapshot

---

# ВАЖНЫЕ ПРАВИЛА

1. Не дублировать существующие интеграции WB
2. Не создавать лишнюю архитектуру
3. Не выдумывать поля API
4. Не ломать текущие модели
5. Делать минимально достаточное решение (MVP)
6. Если видишь, что данных недостаточно для точного прогноза — не усложняй модель, а сделай максимально устойчивый baseline.

---

# ТЕСТЫ

Добавить:
- агрегация 7/30 дней
- расчет trendRatio и clamp
- сценарий stockout
- сценарий с поставкой
- отсутствие дублей при повторном запуске

---

# ФИНАЛЬНЫЙ ОТЧЕТ

После выполнения показать:

1. Какие файлы добавлены / изменены  
2. Как запускать CLI  
3. Какие допущения сделаны  
4. Ограничения MVP  
5. Где в коде лежит основная логика  

Если есть ReadmeAI.md в модуле — обновить его.

---

# СТАТУС РЕАЛИЗАЦИИ

## Этап 2. Demand snapshot

Реализовано:
- `GET /api/v1/supplier/orders` через `WbStatsClient.getSupplierOrders()`
- импорт и агрегация заказов в `wb_orders_daily`
- расчёт `wb_demand_snapshots`
- единая нормализация `warehouseName`

Ключ:
- `(warehouse_key, nm_id, tech_size)`
- `vendor_code` и `barcode` сохраняются как payload

Идемпотентность:
- `wb_orders_daily` — replace-by-day
- `wb_demand_snapshots` — replace-by-date

## Этап 3. Forecast simulation

Реализовано:
- `wb_forecast_snapshots`
- отдельный selector `selectIncomingSupplies()`
- отдельная pure-function симуляции `runForecastSimulation()`
- orchestration use case `buildForecastSnapshot()`

Принятые правила MVP:
- stock snapshot выбирается по UTC cutoff: последний `snapshot_at <= snapshotDateT23:59:59.999Z`
- поставка с датой `D` считается доступной в начале дня `D`
- incoming статусы: `2,3,4,6`
- статус `5` исключается, потому что уже должен быть в `wb_stock_snapshots`
- дробный `forecast_daily_demand` допустим; поэтому `forecast_units` и `end_stock` могут быть дробными, а `daysOfStock` остаётся целым числом полных дней

## Этап 4. CLI

Реализовано:
- `scripts/run-sales-forecast-mvp.ts`
- happy path:
  1. подтягивает `orders` ровно за окно demand snapshot (`snapshotDate - 30 ... snapshotDate - 1`)
  2. считает demand snapshot
  3. считает forecast для горизонтов `30,60,90` по умолчанию

Поддерживается:
- `--date=YYYY-MM-DD`
- `--horizons=30,60,90`
- `--dry-run`
- `--sku`
- `--warehouse`

Особенность dry-run:
- dry-run реализован через SQLite savepoint + rollback
- команда показывает реальные `created/replaced/skipped`, но не оставляет изменений в БД

---

# ПОРЯДОК РАБОТЫ

Сначала выполнить ЭТАП 1 и остановиться.  
Не писать код до подтверждения плана.  
После подтверждения двигаться по этапам.