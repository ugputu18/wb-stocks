# Regional stocks: поиск по товарным полям и прогноз выручки

## Задача

Доработать страницу **«Запасы»** (`/forecast-ui/regional-stocks`): поле
поиска должно фильтровать не только по `nm_id` и `vendor_code`, но и по
вхождению строки в бренд и товарное название/предмет. Пример рабочего
сценария: оператор вводит `lovi` и видит только ситуацию по этому бренду.

Фильтр должен применяться на сервере к общему `RegionalStocksReport`, чтобы
одинаково пересчитывались:

- строки таблицы;
- агрегаты в плашках;
- XLSX-экспорт региональных запасов.

Дополнительно добавить в сводку цену продажи и прогнозную выручку рядом с
плашками вроде **«Расход WB»**, чтобы быстро оценивать прогноз продаж в
контексте бренда или категории товаров.

## Зафиксированные решения

- **Название товара** для этой задачи: WB `subject`, fallback на `category`.
  Полноценное название карточки из WB Content API пока не подключаем.
- **Бренд**: WB `brand`.
- **Цена продажи**: текущая цена из payload WB stocks: `Price` с учетом
  `Discount`.
- Если `Price` отсутствует, цена для SKU считается неизвестной, а вклад в
  прогнозную выручку равен `0`.
- Существующий query-параметр `q` расширяет семантику; новый параметр поиска
  не нужен.

## Implementation Plan

### Product catalog read-model

- Добавить таблицу `wb_product_catalog` в миграции SQLite:
  - `nm_id INTEGER NOT NULL`
  - `tech_size TEXT NOT NULL`
  - `vendor_code TEXT`
  - `category TEXT`
  - `subject TEXT`
  - `brand TEXT`
  - `price REAL`
  - `discount REAL`
  - `sale_price REAL`
  - `updated_at TEXT NOT NULL`
  - primary/unique key: `(nm_id, tech_size)`.
- Расширить `wbStocksApiRowSchema` полями `category`, `subject`, `brand`,
  `Price`, `Discount`.
- В `mapWbStockRow` или соседнем mapper helper нормализовать товарные поля:
  - пустые строки -> `null`;
  - `salePrice = Price * (1 - Discount / 100)`;
  - если `Discount` отсутствует, считать его `0`;
  - если `Price` отсутствует или не число, `salePrice = null`.
- Добавить repository для `wb_product_catalog` с batch upsert.
- В `importWbStocks` после сохранения `wb_stock_snapshots` обновлять каталог
  из валидных stock rows. Для дублей по складам выбирать непустые текстовые
  поля и последнюю доступную цену.

### Regional stocks report

- В `loadRegionalStocksReport` загрузить каталог по всем `(nm_id, tech_size)`,
  которые участвуют в stock/demand rows, и передать metadata в
  `buildRegionalStocksReport`.
- Расширить `RegionalStocksReportRow`:
  - `category: string | null`
  - `subject: string | null`
  - `brand: string | null`
  - `productName: string | null`
  - `salePrice: number | null`
  - `projectedRevenue: number`
- `productName = subject ?? category ?? null`.
- `projectedRevenue = targetCoverageDays * regionalForecastDailyDemand *
  salePrice`, если `salePrice` известна; иначе `0`.
- Расширить `matchesSearch`: case-insensitive RU-поиск по `nmId`,
  `vendorCode`, `brand`, `subject`, `category`, `productName`.
- Сводку строить по уже отфильтрованным строкам, как сейчас:
  - `salePriceWeightedAvg: number | null`
  - `projectedRevenueTotal: number`
- `salePriceWeightedAvg` считать как средневзвешенную цену по прогнозному
  расходу: `sum(consumptionUnits * salePrice) / sum(consumptionUnits)` только
  по строкам с известной ценой и положительным расходом.

### UI and export

- Обновить placeholder поиска на странице запасов:
  `nm_id, артикул, бренд, предмет...`.
- В таблицу добавить компактные колонки `Бренд` и `Предмет`.
- В плашки сводки добавить:
  - **Цена продажи**: средневзвешенная цена, формат в рублях;
  - **Выручка**: `projectedRevenueTotal`, формат в рублях.
- Расширить `RegionalStocksResponse` в `forecast-ui-client/src/api/types.ts`.
- Расширить XLSX-экспорт региональных запасов колонками:
  - `Бренд`
  - `Предмет`
  - `Цена продажи`
  - `Прогноз выручки`

## Test Plan

- `mapWbStockRow.test.ts`:
  - парсит `category`, `subject`, `brand`, `Price`, `Discount`;
  - считает `salePrice` с учетом скидки;
  - оставляет `salePrice = null`, если цены нет.
- Новый/расширенный тест product catalog repository:
  - upsert по `(nm_id, tech_size)`;
  - fallback непустых строк;
  - обновление цены.
- `importWbStocks.test.ts`:
  - импорт stocks сохраняет snapshot и обновляет `wb_product_catalog`.
- `buildRegionalStocksReport.test.ts`:
  - поиск находит строку по `brand = lovi`;
  - поиск находит строку по `subject/category`;
  - summary пересчитывается только по найденным строкам;
  - `projectedRevenueTotal` и `salePriceWeightedAvg` считаются по фильтру.
- Проверки:
  - `pnpm --dir wb-stocks test`
  - `pnpm --dir wb-stocks typecheck`
  - `pnpm --dir wb-stocks typecheck:forecast-ui-client`

## Notes

- Старые строки без каталога продолжают находиться по `nm_id` и
  `vendor_code`; по бренду/предмету они не найдутся до следующего импорта
  stocks.
- Просмотр страницы и фильтрация не должны ходить во внешние API: все данные
  берутся из локальной SQLite.
- Реализацию Content API для настоящих названий карточек не включать в эту
  задачу.
