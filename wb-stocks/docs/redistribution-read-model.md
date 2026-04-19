# Перераспределение WB — read-model (клиент)

Как на стороне **`forecast-ui-client`** собираются macro- и fulfillment-рекомендации поверх уже посчитанных строк `GET /api/forecast/rows` и регионального снимка. Продуктовые правила — [`redistribution-product.md`](./redistribution-product.md).

## Ключевые модули

| Файл | Роль |
|------|------|
| `forecast-ui-client/src/utils/wbRedistributionDonorModel.ts` | `computeDonorMacroRegionRecommendations`, `computeDonorWarehouseRecommendations`, сбор пулов складов, ranking |
| `forecast-ui-client/src/utils/wbRedistributionModel.ts` | Парсинг строк склада из API (`parseWbWarehouseRow`), нормализация ключа |
| `forecast-ui-client/src/utils/wbRedistributionUnknownWarehouses.ts` | Счётчик обращений к ключу без записи в реестре + `reset` для тестов |
| `forecast-ui-client/src/utils/wbWarehouseRegion.ts` | Реэкспорт доменных хелперов в браузер |
| `src/domain/wbWarehouseRegistry.ts` | Реестр, алиасы, hard filters исполнения |
| `src/domain/wbWarehouseMacroRegion.ts` | Совместимость макрорегионов, skip донор/цель, `getWarehouseMacroRegion` |

## Три пула при разборе сети SKU (macro collect)

Функция `collectWarehousesInMacroRegion` для целевого макрорегиона наполняет:

1. **`macroRegionNetworkRowCount`** — число строк сети (не донор), чей склад **macro-compatible** с целевым макрорегионом. Используется для **`hasCandidateWarehouses`**: «в регионе вообще есть жизнь по маппингу», даже если исполнить некуда.
2. **`availabilityContributors`** — склады, которые **входят в региональную доступность** для сумм и минимумов: виртуальные отфильтрованы (`warehouseContributesToRegionalAvailabilityStock`). От них считаются **`regionalAvailableUnits`**, **`sumRecommendedToWBInRegion`**, **`regionMinDaysOfStockHint`** — одна согласованная база.
3. **`executionTargets`** — склады, прошедшие **`isWarehouseRedistributionExecutionTarget`** (запись в реестре + hard filters). Их порядок задаёт preferred и `candidateWarehouseKeys`. Число — **`executionTargetCount`**; **`hasExecutionTargets`** = `executionTargetCount > 0`.

**Hard filters исполнения** (отдельно от ranking): не виртуальный, не сортировочный центр, `canBeRedistributionTarget`, `wbAcceptsInboundForRedistribution`. Склад **без записи в реестре** после нормализации **не** считается execution target (ни macro, ни fulfillment режим в `isWarehouseRedistributionExecutionTarget`).

## Ranking execution targets

`compareRedistributionExecutionTargets` (только среди уже отфильтрованных):

1. Выше `recommendedToWB`
2. Ниже `daysOfStock`
3. Ниже `localAvailable`
4. Выше `priorityWithinMacro` (если в реестре нет —0)
5. Стабильно: `warehouseKey.localeCompare(..., "ru")`

Тот же порядок для **`preferredWarehouseKey`** и списка **`candidateWarehouseKeys`** / подписей. Опционально **`redistributionExecutionTargetDebugSortKey`** — только отладка, не бизнес-логика.

Fulfillment-таблица (`computeDonorWarehouseRecommendations`): при сортировке рекомендаций финальный tie-breaker — **`targetWarehouseKey.localeCompare(..., "ru")`**; lookup `getWarehouseRegistryEntry` при необходимости кэшируется в `Map` на прогон.

## Неизвестные склады

`logRedistributionUnknownWarehouse`: если ключа нет в реестре — **`bumpUnknownWarehouseUsage(normalizedKey)`** на каждое срабатывание; **`console.warn`** остаётся **один раз** на нормализованный ключ. Для анализа: **`getUnknownWarehouseUsageStats()`**, **`resetUnknownWarehouseUsageStats()`**.

## Отладочный trace macro-collect

`traceRedistributionMacroRow`: включается, если в `localStorage` задано **`wbRedistTraceSubstring`** (подстрока без учёта регистра в `warehouseKey` или сыром имени). Пишет в `console.debug` причину отфильтровки/попадания строки.

## Нормализация ключей

Имя склада из API приводится к каноническому виду через **`normalizeWarehouseName`** (единый helper, не разрозненный `trim().toLowerCase()`). Реестр разрешает **статические и per-entry алиасы** (`getWarehouseRegistryEntry`).
