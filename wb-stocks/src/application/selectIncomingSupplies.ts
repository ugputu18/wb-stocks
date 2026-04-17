import type { Logger } from "pino";
import type {
  WbSupplyItemRecord,
  WbSupplyRecord,
} from "../domain/wbSupply.js";
import {
  describeSupplyStatus,
  isIncomingForForecast,
} from "../domain/wbSupplyStatus.js";
import { warehouseKey } from "../domain/warehouseName.js";

/**
 * One arrival into a single warehouse for a single SKU on a single day.
 * Multiple arrivals on the same day for the same key are kept as
 * separate entries (the simulation sums them at consumption time so
 * that traceability survives — see `runForecastSimulation`).
 */
export interface IncomingArrival {
  /** Day the supply becomes consumable (start-of-day, see options). */
  date: string; // YYYY-MM-DD
  /**
   * Units that will *land* on that day, i.e. NOT-yet-in-stock pieces.
   * For status "Accepting" (4) we deduct `acceptedQuantity` so we never
   * double-count items that already moved into `wb_stock_snapshots`.
   */
  quantity: number;
  supplyId: number;
  statusId: number;
  warehouseSource: "actual" | "planned";
}

/** Map key: `${warehouseKey}\u0000${nmId}\u0000${techSize}`. */
export type IncomingByKey = Map<string, IncomingArrival[]>;

export interface SelectIncomingSuppliesInput {
  supplies: readonly WbSupplyRecord[];
  itemsBySupplyId: ReadonlyMap<number, readonly WbSupplyItemRecord[]>;
  /** Inclusive lower bound on arrival day (YYYY-MM-DD). */
  fromDate: string;
  /** Inclusive upper bound on arrival day (YYYY-MM-DD). */
  toDate: string;
  logger?: Logger;
}

export interface SelectIncomingSuppliesResult {
  incoming: IncomingByKey;
  consideredSupplies: number;
  acceptedSupplies: number;
  totalArrivals: number;
  totalUnits: number;
  /** Per-supply skip log (reason + identifying fields), for diagnostics. */
  skipped: Array<{ supplyId: number; reason: string }>;
}

/**
 * Build an `(warehouseKey, nm_id, tech_size) → arrivals[]` index from
 * `wb_supplies` + `wb_supply_items`.
 *
 * Decisions, by responsibility (see `wb-stocks/ReadmeAI.md` for the
 * forecast section that documents these in prose):
 *
 * 1. **Status filter** — only `isIncomingForForecast(statusId)` qualifies.
 *    Status semantics live in `domain/wbSupplyStatus.ts`; this function
 *    never reads the raw numeric ID.
 * 2. **Warehouse choice** — `actual_warehouse_name` if WB has redirected
 *    the supply, else `warehouse_name` (planned). Result is normalized
 *    via `warehouseKey()` so it joins cleanly with stocks/orders.
 * 3. **Arrival date** — `supply_date` (planned arrival). MVP rule:
 *    "supply with date D is consumable at the start of day D". A supply
 *    with a null/unparseable `supply_date` is skipped with reason
 *    `no-supply-date`.
 * 4. **Quantity per item** — `item.quantity − (item.acceptedQuantity ?? 0)`,
 *    clamped to ≥ 0. Justification: in status 4 ("Accepting") WB already
 *    moves accepted pieces into `wb_stock_snapshots.quantity`. Adding
 *    the full `quantity` would double-count. For statuses 2/3/6
 *    `acceptedQuantity` is 0 in practice, so subtracting is a no-op.
 * 5. **Window** — only arrivals with `fromDate <= date <= toDate` are
 *    emitted. Arrivals outside the forecast horizon are silently
 *    dropped (they are valid supplies, just not relevant to this run).
 *
 * Pure function: takes data in, returns data out, logs intermediate
 * decisions when a logger is provided.
 */
export function selectIncomingSupplies(
  input: SelectIncomingSuppliesInput,
): SelectIncomingSuppliesResult {
  const { supplies, itemsBySupplyId, fromDate, toDate, logger } = input;
  const incoming: IncomingByKey = new Map();
  const skipped: Array<{ supplyId: number; reason: string }> = [];
  let acceptedSupplies = 0;
  let totalArrivals = 0;
  let totalUnits = 0;

  for (const s of supplies) {
    if (!isIncomingForForecast(s.statusId)) {
      skipped.push({
        supplyId: s.supplyId,
        reason: `status-not-incoming(${s.statusId}/${describeSupplyStatus(s.statusId)})`,
      });
      continue;
    }

    const arrivalDate = pickArrivalDate(s.supplyDate);
    if (arrivalDate === null) {
      skipped.push({ supplyId: s.supplyId, reason: "no-supply-date" });
      logger?.warn(
        { supplyId: s.supplyId, supplyDate: s.supplyDate },
        "incoming-supplies: skipped (no parseable supplyDate)",
      );
      continue;
    }
    if (arrivalDate < fromDate || arrivalDate > toDate) {
      skipped.push({
        supplyId: s.supplyId,
        reason: `out-of-window(${arrivalDate})`,
      });
      continue;
    }

    const { warehouseSource, name, key } = pickWarehouse(s);
    if (key === null) {
      skipped.push({ supplyId: s.supplyId, reason: "no-warehouse" });
      logger?.warn(
        { supplyId: s.supplyId },
        "incoming-supplies: skipped (no warehouse_name nor actual_warehouse_name)",
      );
      continue;
    }

    const items = itemsBySupplyId.get(s.supplyId) ?? [];
    if (items.length === 0) {
      skipped.push({ supplyId: s.supplyId, reason: "no-items" });
      logger?.warn(
        { supplyId: s.supplyId, statusId: s.statusId },
        "incoming-supplies: skipped (no items rows for supply)",
      );
      continue;
    }

    let supplyAccepted = false;
    for (const it of items) {
      const remaining = remainingQty(it);
      if (remaining <= 0) continue;
      const techSize = it.techSize ?? "";
      const mapKey = `${key}\u0000${it.nmId}\u0000${techSize}`;
      const arr = incoming.get(mapKey) ?? [];
      arr.push({
        date: arrivalDate,
        quantity: remaining,
        supplyId: s.supplyId,
        statusId: s.statusId,
        warehouseSource,
      });
      incoming.set(mapKey, arr);
      totalArrivals += 1;
      totalUnits += remaining;
      supplyAccepted = true;
    }
    if (supplyAccepted) {
      acceptedSupplies += 1;
      logger?.debug(
        {
          supplyId: s.supplyId,
          statusId: s.statusId,
          warehouseSource,
          warehouseName: name,
          arrivalDate,
        },
        "incoming-supplies: supply accepted",
      );
    } else {
      skipped.push({
        supplyId: s.supplyId,
        reason: "all-items-already-accepted",
      });
    }
  }

  return {
    incoming,
    consideredSupplies: supplies.length,
    acceptedSupplies,
    totalArrivals,
    totalUnits,
    skipped,
  };
}

/**
 * Take WB-style timestamp ("2026-04-17T00:00:00+03:00") or a plain
 * "YYYY-MM-DD" and return the date part. Same approach as
 * `mapWbOrderRow.extractMoscowDate`: WB serves Moscow time, the first
 * 10 chars are the date in Moscow, no `new Date()` re-interpretation.
 */
function pickArrivalDate(supplyDate: string | null): string | null {
  if (supplyDate === null || supplyDate === undefined) return null;
  if (supplyDate.length < 10) return null;
  const head = supplyDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  // WB sometimes encodes "no date" as "0001-01-01..."; treat as null.
  if (head.startsWith("0001-")) return null;
  return head;
}

function pickWarehouse(s: WbSupplyRecord): {
  warehouseSource: "actual" | "planned";
  name: string | null;
  key: string | null;
} {
  if (s.actualWarehouseName && s.actualWarehouseName.trim() !== "") {
    return {
      warehouseSource: "actual",
      name: s.actualWarehouseName,
      key: warehouseKey(s.actualWarehouseName),
    };
  }
  if (s.warehouseName && s.warehouseName.trim() !== "") {
    return {
      warehouseSource: "planned",
      name: s.warehouseName,
      key: warehouseKey(s.warehouseName),
    };
  }
  return { warehouseSource: "planned", name: null, key: null };
}

function remainingQty(it: WbSupplyItemRecord): number {
  const planned = it.quantity ?? 0;
  const accepted = it.acceptedQuantity ?? 0;
  const remaining = planned - accepted;
  return remaining > 0 ? remaining : 0;
}
