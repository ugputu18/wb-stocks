import { SUPPLY_STATUS_LABELS } from "./wbSupply.js";

/**
 * Forecast-only view of WB FBW supply statuses.
 *
 * The simulation MUST NOT branch on raw `status_id` numbers; instead it
 * asks one of the helpers below. That keeps the meaning of each status
 * in one place and makes future status-table changes (or vendor
 * additions) a one-file edit.
 *
 * Semantics, derived from `SUPPLY_STATUS_LABELS`:
 *
 * | id | label                    | counts as     | reasoning                                  |
 * |----|--------------------------|---------------|--------------------------------------------|
 * | 1  | Not planned              | DRAFT         | preorder draft, no `supplyID` → unusable   |
 * | 2  | Planned                  | INCOMING      | заявка ещё не приехала, qty не в стоке     |
 * | 3  | Unloading allowed        | INCOMING      | приехала, разрешена разгрузка, не в стоке  |
 * | 4  | Accepting                | INCOMING      | приёмка идёт; принятая часть исключается   |
 * | 5  | Accepted                 | ALREADY_STOCK | целиком в `wb_stock_snapshots.quantity`    |
 * | 6  | Unloaded at the gate     | INCOMING      | для палет выгружено на воротах, но не принято |
 *
 * Why 2/3/4/6 are incoming:
 * - 2 `Planned`            — поставка только запланирована, товара в WB stock ещё нет
 * - 3 `Unloading allowed`  — WB разрешил разгрузку, но товар ещё не принят в остатки
 * - 4 `Accepting`          — приёмка идёт; принятая часть уже может попасть в stock,
 *                            поэтому её надо вычитать из incoming
 * - 6 `Unloaded at the gate` — по наблюдению в наших данных это "товар уже у WB физически,
 *                              но ещё не принят на складской остаток"; `actualWarehouseName`
 *                              уже может быть известен и отличаться от планового склада
 *
 * Why 5 is excluded:
 * - 5 `Accepted` means the supply is fully accepted and should already be
 *   reflected in `wb_stock_snapshots.quantity`. Counting it as incoming
 *   would double-count stock.
 *
 * Status 4 is the tricky case: WB increments warehouse stock as items get
 * accepted, so the supply's own `acceptedQuantity` would otherwise double-
 * count. `selectIncomingSupplies` deducts `acceptedQuantity` per item to
 * avoid that.
 */

export const SUPPLY_STATUS_INCOMING_FOR_FORECAST: readonly number[] = [
  2, 3, 4, 6,
];

export const SUPPLY_STATUS_ALREADY_IN_STOCK: readonly number[] = [5];

export const SUPPLY_STATUS_DRAFT: readonly number[] = [1];

export function isIncomingForForecast(statusId: number): boolean {
  return SUPPLY_STATUS_INCOMING_FOR_FORECAST.includes(statusId);
}

export function isAlreadyInStock(statusId: number): boolean {
  return SUPPLY_STATUS_ALREADY_IN_STOCK.includes(statusId);
}

export function isDraftSupply(statusId: number): boolean {
  return SUPPLY_STATUS_DRAFT.includes(statusId);
}

/**
 * Human-readable label of a status, falls back to `unknown(<id>)` for
 * statuses that WB might add later. Used in logs and skip reasons.
 */
export function describeSupplyStatus(statusId: number): string {
  return SUPPLY_STATUS_LABELS[statusId] ?? `unknown(${statusId})`;
}
