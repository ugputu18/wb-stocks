# Перераспределение `/redistribution`: цель — макрорегион (Regional)

## Что сделано

- **Read model:** региональный режим строит строки **SKU × донор × targetMacroRegion** (`computeDonorMacroRegionRecommendations` в `forecast-ui-client/src/utils/wbRedistributionDonorModel.ts`). Режим **Fulfillment** — отдельно **SKU × целевой склад** (`computeDonorWarehouseRecommendations`, `kind: "warehouse"`).
- **Дефицит в регион:** `regionalNeedUnits = max(0, ceil(ceil(demand × coverage) − Σ local в макрорегионе))`; перевод = `min(donorTransferableUnits, regionalNeedUnits)`. Исключаются строки с тем же макрорегионом, что и донор. `recommendedToWB` — только подсказка preferred warehouse.
- **Score:** `transferScore = recommendedTransferUnitsToRegion × targetRegionalDemand`.
- **Склады:** кандидаты в макрорегионе из сети по SKU; `preferredWarehouseKey` = max `recommendedToWB` среди кандидатов; сумма `recommendedToWB` по региону — справочно.
- **UI:** `forecast-ui-client/src/pages/RedistributionPage.tsx` — отдельные колонки для Regional vs Fulfillment; панель сети подсвечивает макрорегион назначения и «Прим. склад».

## UX «Склады»

В regional-таблице у макрорегиона кнопка **«Склады»** раскрывает тот же список кандидатов/preferred, что в модели (`RegionWarehousesDisclosure.tsx`).

## Как проверить

- `cd wb-stocks && npm test -- --run forecast-ui-client/test/wbRedistributionDonorModel.test.ts`
- `npm run typecheck:forecast-ui-client`
- Локально: `pnpm dev:forecast-ui-client`, открыть `/redistribution`, режим Regional — колонка макрорегиона, кнопка **«Склады»**.

## Ограничения (без изменений по смыслу MVP)

- Нет глобального распределения одного остатка донора между несколькими целями.
- Не solver; логистика и стоимость не учитываются.
