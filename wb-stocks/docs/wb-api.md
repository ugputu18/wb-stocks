# WB API — справка по тому, что использует `wb-stocks`

Документ описывает **ровно те эндпойнты Wildberries, которые модуль реально
дёргает**, а также все известные нам подводные камни их применения. Это не
полный референс WB (он живёт на [dev.wildberries.ru](https://dev.wildberries.ru)),
а боевые заметки: в каком хосте искать, какие поля бывают `null`/отсутствуют,
какие лимиты, какие коды ошибок что значат, что делать при поломке.

> Когда что-то меняется в WB API — обновляем этот файл, а не дублируем
> описание в коде или в `ReadmeAI.md`. `ReadmeAI.md` ссылается сюда.

## 1. Хосты, авторизация и общие правила

WB не один сервис, а семейство. Мы используем четыре хоста:

| Хост | Назначение | Что мы тут дёргаем |
|---|---|---|
| `https://statistics-api.wildberries.ru` | WB Statistics API (продажи, заказы, остатки) | `GET /api/v1/supplier/stocks` |
| `https://supplies-api.wildberries.ru` | WB FBW Supplies API (поставки на склады WB) | `POST /api/v1/supplies`, `GET /api/v1/supplies/{ID}`, `GET /api/v1/supplies/{ID}/goods` |
| `https://common-api.wildberries.ru` | WB Common API (тарифы складов, общая инфо) | `GET /api/v1/tariffs/box`, `GET /api/v1/tariffs/pallet`, `GET /api/tariffs/v1/acceptance/coefficients` |
| `https://seller-analytics-api.wildberries.ru` | Seller Analytics API (отчёты, аналитика) | пока не используется; сюда уйдёт замена deprecated `supplier/stocks` |

### 1.1 Авторизация

Один и тот же seller-токен с разными scope-битами. Заголовок:

```
Authorization: <token>
```

> Без префикса `Bearer ` — WB его **не ожидает** и вернёт 401, если добавить.

Scopes, которые требуются именно нам:

| API | Требуемый scope в токене |
|---|---|
| Statistics (`/api/v1/supplier/stocks`) | **Statistics** (Статистика) |
| FBW Supplies (`/api/v1/supplies/...`) | **Marketplace** (Маркетплейс / FBW) |
| Common: тарифы коробов/паллет (`/api/v1/tariffs/...`) | **Marketplace** или **Поставки** — достаточно одного |
| Common: коэффициенты приёмки (`/api/tariffs/v1/acceptance/coefficients`) | **Marketplace** или **Поставки** |
| Seller Analytics | **Analytics** (Аналитика) |

В .env лежит **один** `WB_TOKEN`. Если планируется разделять права — заведите
два, по одному на каждый клиент. Сейчас используется единый токен с двумя
scope-ми.

### 1.2 Лимиты

| API | Лимит | Поведение при превышении |
|---|---|---|
| Statistics | официально не публикуется, наблюдаемо «мягкий» | редкие 429, обычный exp-backoff |
| FBW Supplies | **30 запросов/мин на каждый метод**, на каждый аккаунт | агрессивный 429, нужен длинный backoff |
| Common: tariffs box / pallet | **60 запросов/мин** (всплеск 5/сек) + базовый лимит **1 запрос/час** для непривилегированных сервисов | мы дёргаем раз в сутки — упереться нереально |
| Common: acceptance coefficients | **6 запросов/мин** (интервал 10 сек) | при 429 backoff ≥ 2 секунды |
| Seller Analytics | свой суточный квот на отчёт | мы не используем |

Для FBW Supplies при средней поставке (deta + goods постранично) `1 + 2N`
запросов на N поставок. На рабочем аккаунте (~4 поставки за месяц)
повторный полный sync легко упирается в лимит — клиент сам спит и
повторяет, см. §1.3.

### 1.3 Ретраи и backoff (как сделано у нас)

Базовая логика общая (`requestWithRetry`):

- **3 попытки** (т.е. до 4 запросов суммарно) на каждый внешний вызов.
- Ретраются: `429`, `5xx`, `AbortError` (наш timeout). Любой другой
  4xx — **fail-loud** (не баг сети, а баг запроса).
- Таймаут одного запроса — 60 сек.

Backoff отличается:

```
Statistics (wbStatsClient):
  delay = 500 * 2^attempt + jitter[0..250]   ms     # 500, 1000, 2000, 4000

FBW Supplies (wbSuppliesClient):
  if 429:  delay = 2000 * (attempt + 1) + jitter[0..500]   # 2s, 4s, 6s, 8s
  else:    delay = 500 * 2^attempt + jitter[0..250]
```

Длинный backoff на 429 у Supplies API — намеренно: WB не отдаёт
`Retry-After` для этого эндпойнта, а лимит «30 в минуту» означает в худшем
случае 2 секунды на запрос. Меньше — гарантированно ловим повторный 429.

### 1.4 Ошибки

Внутренний класс — один на оба клиента:

```ts
class WbApiError extends Error {
  status?: number;   // HTTP status, undefined для не-HTTP ошибок
  body?: string;     // первые 500 байт тела (для логов)
}
```

Что мы интерпретируем по статусам:

| Код | Что значит на практике | Что делает клиент |
|---|---|---|
| `400` | Кривой query/body (наш баг) | бросает, **не ретраит** |
| `401` | Нет/протух токен / токен без нужного scope | бросает |
| `403` | Токен валиден, но scope не подходит | бросает |
| `404` | Эндпойнт удалён или ID не существует | бросает |
| `429` | Превышен лимит | ретрай с длинным backoff |
| `5xx` | Внутренняя проблема WB | ретрай с обычным backoff |
| non-JSON 200 | WB вернул HTML/текст вместо JSON (бывает в момент апдейта) | бросает с body в `WbApiError.body` |

В логах ошибки пишутся структурно: `{ name, message, status }` — никаких
огромных stack trace-ов в продовых логах.

### 1.5 Конвенции ответа WB

WB API в целом не очень строгий — те же поля приходят то с одной
капитализацией, то с другой; то отсутствуют, то приходят `null`. Поэтому
во всех `zod`-схемах:

- строковые поля — `.nullish()` (ловит и `null`, и `undefined`),
  затем нормализуем пустые строки в `null` в маппере;
- числовые поля — `.nullish()` для всего, что не идентификатор;
- идентификаторы (`nmID`, `supplyID`) — `.int()` без nullable, кроме
  специально оговорённых случаев (см. ниже);
- лишние поля **не валидим** (zod object игнорирует их по умолчанию).

Важная деталь именования: одни эндпойнты возвращают `nmId`, другие —
`nmID`; `supplierArticle` vs `vendorCode`. Это поверх WB, не наша
ошибка — каждый клиент маппит «их буквы → наши буквы» в своём слое.

## 2. Statistics API

### 2.1 `GET /api/v1/supplier/stocks` — текущие остатки на складах WB

**Используется в:** `WbStatsClient.getSupplierStocks` →
`importWbStocks` → таблица `wb_stock_snapshots`.

```
GET https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2019-06-20
Authorization: <token со scope Statistics>
Accept: application/json
```

| Параметр | Тип | Обязателен | Что значит |
|---|---|---|---|
| `dateFrom` | string (date или RFC3339) | да | граница «остатки изменялись после». Чтобы получить **полное текущее состояние**, документация WB рекомендует подавать «далёкое прошлое» (`2019-01-01` — наш дефолт). |

Ответ — плоский JSON-массив. Каждая строка — кортеж
`(nmId × techSize × warehouse)`. Пример (поля сокращены):

```json
[
  {
    "lastChangeDate": "2026-04-17T05:21:34",
    "warehouseName": "Коледино",
    "supplierArticle": "35/368_gre",
    "nmId": 507833572,
    "barcode": "5903407173818",
    "quantity": 12,
    "inWayToClient": 3,
    "inWayFromClient": 0,
    "quantityFull": 15,
    "techSize": "0",
    "category": "...", "subject": "...", "brand": "...",
    "Price": 999, "Discount": 50,
    "isSupply": true, "isRealization": true, "SCCode": "..."
  }
]
```

Реально используем (zod-схема в `src/domain/stockSnapshot.ts`):

| Поле WB | В нашей модели | Замечание |
|---|---|---|
| `nmId` | `nmId` | int, **обязательно** |
| `supplierArticle` | `vendorCode` | строка, может быть пустой → `null` |
| `barcode` | `barcode` | может отсутствовать |
| `techSize` | `techSize` | пустая строка → `null` |
| `warehouseName` | `warehouseName` | строка, **обязательно** (PK включает его) |
| `quantity` | `quantity` | int, **обязательно** (= доступно к продаже) |
| `inWayToClient` | `inWayToClient` | в пути к клиенту |
| `inWayFromClient` | `inWayFromClient` | возвраты в пути |
| `quantityFull` | `quantityFull` | полный остаток (= `quantity + inWay*`) |
| `lastChangeDate` | `lastChangeDate` | время последнего изменения по WB |

Поля `category`, `subject`, `brand`, `Price`, `Discount`, `isSupply`,
`isRealization`, `SCCode` — **сознательно не сохраняем** (это другая
задача — каталог и цены).

### 2.2 ⚠️ DEPRECATION — этот эндпойнт удаляется 2026-06-23

WB анонсировали отключение `GET /api/v1/supplier/stocks`. Замена —
`POST /api/analytics/v1/stocks-report/wb-warehouses` (Seller Analytics).
Новый метод **не отдаёт** часть полей:

| Старое поле | Есть в новом? |
|---|---|
| `barcode` | **нет** |
| `supplierArticle` | **нет** |
| `inWayToClient` | **нет** |
| `inWayFromClient` | **нет** |
| `quantityFull` | **нет** |
| `warehouseId` | **появляется** (новое) |
| `regionName` | **появляется** (новое) |

План миграции, когда дойдёт:
1. Создать `WbAnalyticsClient` рядом с `WbStatsClient` (хост другой,
   ретраи такие же).
2. Не трогать `StockSnapshotRecord` — в нём перечисленные выше колонки уже
   nullable именно под этот сценарий.
3. Переключение по env-флагу или фиче-флагу, чтобы можно было откатиться.

### 2.3 ⚰️ DEPRECATED — `GET /api/v1/supplier/incomes` (приёмки)

Был отключён **2026-03-11**. Сейчас отвечает `404` с релиз-нотами в теле.
**Не использовать.** Это причина, по которой импорт поставок переехал на
FBW Supplies API (см. §3).

## 3. FBW Supplies API

База: `https://supplies-api.wildberries.ru`. Все три метода ниже имеют
**свой собственный лимит 30 req/min** — то есть `POST /supplies` и
`GET /supplies/{ID}` считаются отдельно. На практике лимит выбивается
второй фазой (детали + товары для каждой поставки).

### 3.1 `POST /api/v1/supplies` — список поставок

**Используется в:** `WbSuppliesClient.listSupplies` →
`importWbSupplies` (фаза 1).

```
POST https://supplies-api.wildberries.ru/api/v1/supplies?limit=1000&offset=0
Authorization: <token со scope Marketplace>
Content-Type: application/json

{
  "dates": [
    { "from": "2026-04-01", "till": "2026-04-17", "type": "createDate" }
  ],
  "statusIDs": [4, 5, 6]
}
```

| Параметр | Где | Тип | Замечание |
|---|---|---|---|
| `limit` | query | int (≤ 1000) | размер страницы; мы используем 1000 |
| `offset` | query | int | для пагинации |
| `dates` | body | массив диапазонов | даты в YYYY-MM-DD; `type` — какое поле фильтровать (`createDate`, `supplyDate`, `factDate`, `updatedDate`) |
| `statusIDs` | body | массив int | список статусов 1..6, см. §3.4 |

Пагинация: дёргаем страницами, **пока ответ короче `limit`** — это маркер
последней страницы. WB не отдаёт `total`.

Ответ — массив объектов-заголовков:

```json
[
  {
    "supplyID": 38450430,
    "preorderID": 5001234,
    "phone": "+7 *** ** **",
    "createDate": "2026-04-09T14:55:52+03:00",
    "supplyDate": "2026-04-17T00:00:00+03:00",
    "factDate": "2026-04-17T14:57:54+03:00",
    "updatedDate": "2026-04-17T15:00:00+03:00",
    "statusID": 4,
    "boxTypeID": 2,
    "virtualTypeID": null,
    "isBoxOnPallet": false
  }
]
```

⚠️ **Критическая деталь:** `supplyID` может быть `null` или `0` — это
поставки в статусе «Not planned» (предзаказ, ещё не получивший номер).
**Мы такие пропускаем**: они не имеют стабильного ключа (preorderID
отдельная сущность), для нашей задачи бесполезны. В логе они
учитываются как `preorderOnly`.

### 3.2 `GET /api/v1/supplies/{ID}` — детали поставки

**Используется в:** `WbSuppliesClient.getSupplyDetails` →
`importWbSupplies` (фаза 2, опциональна — `--no-details` отключает).

```
GET https://supplies-api.wildberries.ru/api/v1/supplies/38450430?isPreorderID=false
Authorization: <token>
```

| Параметр | Где | Зачем |
|---|---|---|
| `{ID}` | path | значение `supplyID` из списка |
| `isPreorderID` | query | `false` — мы передаём supplyID, а не preorderID. WB различает на этом флаге. |

Ответ — один объект (НЕ массив). Поля, которых в списке не было:

| Поле | Тип | Что это |
|---|---|---|
| `warehouseID` / `warehouseName` | int / string | склад **назначения** (план) |
| `actualWarehouseID` / `actualWarehouseName` | int / string | склад, куда WB фактически принял (если перенаправили) |
| `transitWarehouseID` / `transitWarehouseName` | int / string | транзитный склад (если перевозка через хаб) |
| `quantity` | int | план — суммарное количество товаров |
| `acceptedQuantity` | int | факт принято |
| `unloadingQuantity` | int | в процессе выгрузки |
| `readyForSaleQuantity` | int | прошло обработку, готово к продаже |
| `depersonalizedQuantity` | int | обезличено (потеряна привязка к товару) |

Все «количества» могут приходить нулями до приёмки — это нормально, не
ошибка.

### 3.3 `GET /api/v1/supplies/{ID}/goods` — товары поставки

**Используется в:** `WbSuppliesClient.getSupplyGoods` →
`importWbSupplies` (фаза 3, опциональна — `--no-items` отключает).

```
GET https://supplies-api.wildberries.ru/api/v1/supplies/38450430/goods?limit=1000&offset=0&isPreorderID=false
Authorization: <token>
```

Параметры: `limit / offset / isPreorderID` — как в `getSupplyDetails`,
плюс пагинация (наш клиент берёт первую страницу, потому что в реальных
поставках максимум сотни строк; если понадобится больше — добавить цикл,
TODO в коде нет, добавляйте по факту).

Ответ — массив:

```json
[
  {
    "barcode": "5903407173818",
    "vendorCode": "35/368_gre",
    "nmID": 507833572,
    "techSize": "0",
    "color": "зеленый",
    "quantity": 1,
    "acceptedQuantity": 1,
    "readyForSaleQuantity": 1,
    "unloadingQuantity": 0
  }
]
```

`nmID` тут — `nmID`, а не `nmId` (в Statistics API было наоборот). **Не
путать.** В нашей схеме оба маппятся в `nmId` (camelCase у нас).

### 3.4 Справочник `statusID` (поставки FBW)

| ID | Значение | Что в жизни |
|---|---|---|
| 1 | Not planned | черновик / preorder без supplyID |
| 2 | Planned | заявка создана, ждёт заезда |
| 3 | Unloading allowed | разрешена разгрузка на складе WB |
| 4 | Accepting | приёмка идёт |
| 5 | Accepted | принято целиком |
| 6 | Unloaded at the gate | выгружено на воротах (для палет) |

Таблица зашита в код константой `SUPPLY_STATUS_LABELS` в
`src/domain/wbSupply.ts`. Если WB добавит новые статусы — расширить там
и в этой таблице.

### 3.5 Поведение в реальной жизни (что наблюдали)

- При первом запросе `getSupplyDetails` для поставки в статусе 6
  (выгружено) `actualWarehouseName` отличается от `warehouseName` —
  на нашем аккаунте поставка ехала в «Склад Шушары», но фактически
  выгрузили в «Обухово». Это **нормально** и значимо для аналитики
  («WB перенаправил»).
- `factDate` появляется только после приёмки (в статусах 4..6). До этого
  он `null` или `"0001-01-01..."` (мы такое нормализуем в `null` через
  trim+empty в маппере).
- `phone` приходит замаскированным (`"+7 *** ** **"`). Сохраняем
  как есть — это аудитный след, не для дозвона.
- `boxTypeID = 0` означает «Не задано» (например, для палет
  `virtualTypeID` важнее).

## 4. Common API — тарифы складов

База: `https://common-api.wildberries.ru`. Эти эндпойнты — единственное на
сегодня публичное место, где WB отдаёт тарифы доставки/хранения и
ближайшую доступность приёмки **в разрезе складов**. Готового ответа
«сколько будет стоить доставка из Сибири в ДФО» здесь нет — только сырые
тарифы на склад. Для локализации эти данные нужно сочетать с привязкой
склад → федеральный округ (`wbWarehouseMacroRegion.ts`) и регионом
заказа.

### 4.1 `GET /api/v1/tariffs/box?date=YYYY-MM-DD` — тарифы для коробов

**Используется в:** `WbCommonClient.getBoxTariffs` →
`importWbWarehouseTariffs` → `mapBoxTariffEnvelope` →
`WbWarehouseTariffRepository.saveBoxBatch` → `wb_warehouse_box_tariffs`.

```
GET https://common-api.wildberries.ru/api/v1/tariffs/box?date=2026-05-11
Authorization: <token со scope Marketplace или Поставки>
```

Ответ — envelope:

```json
{
  "response": {
    "data": {
      "dtNextBox": "2026-06-01",
      "dtTillMax": "2026-06-30",
      "warehouseList": [
        {
          "warehouseName": "Коледино",
          "geoName": "Центральный федеральный округ",
          "boxDeliveryBase": "48",
          "boxDeliveryLiter": "11,2",
          "boxDeliveryCoefExpr": "160",
          "boxDeliveryMarketplaceBase": "40",
          "boxDeliveryMarketplaceLiter": "11",
          "boxDeliveryMarketplaceCoefExpr": "125",
          "boxStorageBase": "0,14",
          "boxStorageLiter": "0,07",
          "boxStorageCoefExpr": "115"
        }
      ]
    }
  }
}
```

| Поле WB | В нашей модели | Замечание |
|---|---|---|
| `warehouseName` | `warehouse_name` | строка, **обязательно** (часть PK) |
| `geoName` | `geo_name` | страна или ФО — например `«Центральный федеральный округ»`, `«Сибирский и Дальневосточный»`, `«Казахстан»`. Используется при фильтрации регионов. |
| `boxDeliveryBase` / `boxDeliveryLiter` | `box_delivery_base` / `box_delivery_liter` | ₽ за первый/доп. литр логистики |
| `boxDeliveryCoefExpr` | `box_delivery_coef_expr` | % коэффициента; **уже учтён** в `boxDeliveryBase`/`boxDeliveryLiter`. Хранится для аудита. |
| `boxDeliveryMarketplace*` | `box_delivery_marketplace_*` | то же, но для схемы FBS |
| `boxStorageBase` / `boxStorageLiter` | `box_storage_base` / `box_storage_liter` | ₽ за хранение литра в день |
| `boxStorageCoefExpr` | `box_storage_coef_expr` | % коэффициента хранения; уже учтён |
| `dtNextBox` / `dtTillMax` | дублируются в каждую строку | даты смены тарифа |

⚠️ **Формат чисел.** Все числовые поля приходят строками с запятой как
десятичным разделителем (`"0,14"`, `"11,2"`) и иногда c пробелом/NBSP
как разделителем тысяч (`"1 039"`). Парсятся в `parseTariffDecimal` →
`number | null`; пустая строка превращается в `null`.

### 4.2 `GET /api/v1/tariffs/pallet?date=YYYY-MM-DD` — тарифы для паллет

**Используется в:** `WbCommonClient.getPalletTariffs` →
`importWbWarehouseTariffs` → `mapPalletTariffEnvelope` →
`WbWarehouseTariffRepository.savePalletBatch` →
`wb_warehouse_pallet_tariffs`.

Схема ответа — аналогичный envelope, поля другие:

| Поле WB | В нашей модели | Замечание |
|---|---|---|
| `warehouseName` | `warehouse_name` | **обязательно** |
| `palletDeliveryValueBase` | `pallet_delivery_value_base` | ₽ за 1 литр логистики |
| `palletDeliveryValueLiter` | `pallet_delivery_value_liter` | ₽ за каждый доп. литр |
| `palletDeliveryExpr` | `pallet_delivery_expr` | % коэффициента; уже учтён |
| `palletStorageValueExpr` | `pallet_storage_value_expr` | ₽ за хранение одной монопаллеты (за единицу, не за литр!) |
| `palletStorageExpr` | `pallet_storage_expr` | % коэффициента хранения; уже учтён |
| `dtNextPallet` / `dtTillMax` | дублируются в каждую строку | даты смены тарифа |

⚠️ Поле `geoName` в pallet endpoint **не приходит** — наш столбец
`geo_name` в `wb_warehouse_pallet_tariffs` оставлен как опциональный
для совместимости (если WB решит добавить — мы его подхватим без
миграции).

### 4.3 `GET /api/tariffs/v1/acceptance/coefficients` — приёмка на 14 дней

**Используется в:** `WbCommonClient.getAcceptanceCoefficients` →
`importWbWarehouseTariffs` → `mapAcceptanceCoefficient` →
`WbWarehouseTariffRepository.saveAcceptanceBatch` →
`wb_warehouse_acceptance_coefficients`.

```
GET https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients
GET https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients?warehouseIDs=507,117501
Authorization: <token>
```

Один параметр — опциональный `warehouseIDs` (запятая, без пробелов).
Ответ — **плоский массив** объектов на 14 дней вперёд, по одной строке на
`(date × warehouseID × boxTypeID)`:

```json
[
  {
    "date": "2026-05-12T00:00:00Z",
    "coefficient": 0,
    "warehouseID": 507,
    "warehouseName": "Коледино",
    "allowUnload": true,
    "boxTypeID": 2,
    "boxTypeName": "Короба",
    "storageCoef": "1",
    "deliveryCoef": "1",
    "deliveryBaseLiter": "48",
    "deliveryAdditionalLiter": "11,2",
    "storageBaseLiter": "0,14",
    "storageAdditionalLiter": "0,07",
    "isSortingCenter": false
  }
]
```

Значения `coefficient`:

- `-1` — приёмка недоступна, **независимо от `allowUnload`**;
- `0` — бесплатная приёмка;
- `1` или больше — множитель стоимости приёмки.

«Приёмка доступна» = `coefficient ∈ {0, 1}` **и** `allowUnload === true`.

| Поле WB | В нашей модели | Замечание |
|---|---|---|
| `date` | `effective_date` | RFC3339 → обрезается до `YYYY-MM-DD` |
| `coefficient` | `coefficient` | REAL, обязателен |
| `warehouseID` | `warehouse_id` | int, обязателен |
| `boxTypeID` | `box_type_id` | 2=Короба, 5=Монопаллеты, 6=Суперсейф. Для QR-поставок поле не приходит → `null` |
| `allowUnload` | `allow_unload` | boolean → INTEGER 0/1 в БД |
| `storageCoef` / `deliveryCoef` | `storage_coef` / `delivery_coef` | пустая строка → `null` |
| `storageBaseLiter` | `storage_base_liter` | для паллет — стоимость за паллету; для коробов — стоимость литра |
| `storageAdditionalLiter` | `storage_additional_liter` | для паллет всегда `null` |
| `isSortingCenter` | `is_sorting_center` | true = СЦ, false = обычный склад |

⚠️ Здесь и `coefficient`, и поля стоимости WB иногда отдаёт **числом**
(не строкой) — наш zod-схема принимает оба варианта, парсер
нормализует.

### 4.4 Идемпотентность импорта

| Таблица | Ключ уникальности | Поведение re-run |
|---|---|---|
| `wb_warehouse_box_tariffs` | `(tariff_date, warehouse_name)` | UPSERT — последний прогон за дату перезаписывает |
| `wb_warehouse_pallet_tariffs` | `(tariff_date, warehouse_name)` | UPSERT |
| `wb_warehouse_acceptance_coefficients` | `(fetched_at, effective_date, warehouse_id, box_type_id)` | INSERT OR IGNORE; **история сохраняется** (каждый прогон — свой `fetched_at`) |

Box/pallet — это «расписание тарифов» (меняется редко), нам важна
последняя версия. Acceptance — это «прогноз на 14 дней» (WB пересчитывает
в течение суток), история нужна, чтобы можно было сравнить «что WB
обещал утром vs. что вечером».

### 4.5 Что мы сознательно НЕ дёргаем из Common API

| Эндпойнт | Почему |
|---|---|
| `GET /api/v1/tariffs/return` | возвраты — отдельная задача, не входит в скоуп локализации остатков |
| `GET /api/v1/tariffs/commission` | комиссия по категориям — для P&L, не для нашего модуля |

## 5. Соответствие WB API ↔ наши таблицы

| WB endpoint | Наш слой | Целевая таблица |
|---|---|---|
| `GET /api/v1/supplier/stocks` | `WbStatsClient.getSupplierStocks` → `importWbStocks` → `mapWbStockRow` → `StockSnapshotRepository.saveBatch` | `wb_stock_snapshots` |
| `POST /api/v1/supplies` | `WbSuppliesClient.listSupplies` → `importWbSupplies` → `parseListRow` → `WbSupplyRepository.upsertSupply` | `wb_supplies` |
| `GET /api/v1/supplies/{ID}` | `WbSuppliesClient.getSupplyDetails` → `importWbSupplies` → `parseDetails` → `buildSupplyRecord` (мерж в заголовок) | `wb_supplies` (обогащение) + `wb_supply_status_history` |
| `GET /api/v1/supplies/{ID}/goods` | `WbSuppliesClient.getSupplyGoods` → `importWbSupplies` → `parseGoodsRow` → `WbSupplyRepository.replaceItemsForSupply` | `wb_supply_items` |
| `GET /api/v1/tariffs/box` | `WbCommonClient.getBoxTariffs` → `importWbWarehouseTariffs` → `mapBoxTariffEnvelope` → `WbWarehouseTariffRepository.saveBoxBatch` | `wb_warehouse_box_tariffs` |
| `GET /api/v1/tariffs/pallet` | `WbCommonClient.getPalletTariffs` → `importWbWarehouseTariffs` → `mapPalletTariffEnvelope` → `WbWarehouseTariffRepository.savePalletBatch` | `wb_warehouse_pallet_tariffs` |
| `GET /api/tariffs/v1/acceptance/coefficients` | `WbCommonClient.getAcceptanceCoefficients` → `importWbWarehouseTariffs` → `mapAcceptanceCoefficient` → `WbWarehouseTariffRepository.saveAcceptanceBatch` | `wb_warehouse_acceptance_coefficients` |

## 6. Что мы сознательно НЕ дёргаем

| Эндпойнт | Почему не нужен |
|---|---|
| `GET /content/v2/get/cards/list` (карточки) | каталог — другая задача, цены/категории не сохраняем |
| `POST /api/v3/orders` (заказы FBS) | у нас FBW, не FBS |
| `GET /api/v1/supplier/sales` (продажи) | продажи в этот модуль не входят, отдельный pipeline |
| `POST /api/v1/supplies/{ID}/orders` (товары на закрытие) | управление поставками не в скоупе модуля |
| `GET /api/v1/warehouses` (справочник складов) | имени склада из ответа достаточно, отдельная справочная таблица сейчас избыточна |

## 7. Источники и release notes

- Главный портал: <https://dev.wildberries.ru>
- Список изменений API: <https://dev.wildberries.ru/news>
- Раздел FBW: <https://dev.wildberries.ru/openapi/orders-fbw>
- Раздел Statistics: <https://dev.wildberries.ru/openapi/statistics>
- Объявление об отключении `supplier/stocks` (23.06.2026): на странице
  Statistics в разделе deprecation; фиксируется здесь, чтобы не
  потерять.
- Объявление об отключении `supplier/incomes` (11.03.2026): отдаёт 404
  с ссылкой на релиз-ноты в теле ответа.
