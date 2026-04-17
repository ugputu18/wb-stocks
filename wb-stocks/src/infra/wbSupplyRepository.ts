import type { DbHandle } from "./db.js";
import type {
  WbSupplyItemRecord,
  WbSupplyRecord,
} from "../domain/wbSupply.js";

export type UpsertResult = "created" | "updated" | "unchanged";

/**
 * Repository for WB FBW supplies (поставки).
 *
 * Idempotency model:
 * - `wb_supplies` is upserted by `supply_id` (WB's external numeric ID).
 * - `wb_supply_items` for a given supply are fully replaced on each sync.
 * - `wb_supply_status_history` only grows on a real `(status_id, fact_date)`
 *   change.
 */
export class WbSupplyRepository {
  constructor(private readonly db: DbHandle) {}

  upsertSupply(
    record: WbSupplyRecord,
    seenAt: string,
  ): { result: UpsertResult; previous: WbSupplyRecord | null } {
    const existing = this.getBySupplyId(record.supplyId);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO wb_supplies (
             supply_id, preorder_id, phone, create_date, supply_date,
             fact_date, updated_date, status_id, box_type_id, virtual_type_id,
             is_box_on_pallet, warehouse_id, warehouse_name,
             actual_warehouse_id, actual_warehouse_name,
             quantity, accepted_quantity, unloading_quantity,
             ready_for_sale_quantity, depersonalized_quantity,
             first_seen_at, last_seen_at
           ) VALUES (
             @supplyId, @preorderId, @phone, @createDate, @supplyDate,
             @factDate, @updatedDate, @statusId, @boxTypeId, @virtualTypeId,
             @isBoxOnPallet, @warehouseId, @warehouseName,
             @actualWarehouseId, @actualWarehouseName,
             @quantity, @acceptedQuantity, @unloadingQuantity,
             @readyForSaleQuantity, @depersonalizedQuantity,
             @seenAt, @seenAt
           )`,
        )
        .run({
          ...record,
          isBoxOnPallet: boolToInt(record.isBoxOnPallet),
          seenAt,
        });
      return { result: "created", previous: null };
    }

    const changed = supplyFieldsDiffer(existing, record);

    this.db
      .prepare(
        `UPDATE wb_supplies
            SET preorder_id              = @preorderId,
                phone                    = @phone,
                create_date              = @createDate,
                supply_date              = @supplyDate,
                fact_date                = @factDate,
                updated_date             = @updatedDate,
                status_id                = @statusId,
                box_type_id              = @boxTypeId,
                virtual_type_id          = @virtualTypeId,
                is_box_on_pallet         = @isBoxOnPallet,
                warehouse_id             = @warehouseId,
                warehouse_name           = @warehouseName,
                actual_warehouse_id      = @actualWarehouseId,
                actual_warehouse_name    = @actualWarehouseName,
                quantity                 = @quantity,
                accepted_quantity        = @acceptedQuantity,
                unloading_quantity       = @unloadingQuantity,
                ready_for_sale_quantity  = @readyForSaleQuantity,
                depersonalized_quantity  = @depersonalizedQuantity,
                last_seen_at             = @seenAt
          WHERE supply_id = @supplyId`,
      )
      .run({
        ...record,
        isBoxOnPallet: boolToInt(record.isBoxOnPallet),
        seenAt,
      });

    return {
      result: changed ? "updated" : "unchanged",
      previous: existing,
    };
  }

  getBySupplyId(supplyId: number): WbSupplyRecord | null {
    const row = this.db
      .prepare(
        `SELECT supply_id               AS supplyId,
                preorder_id             AS preorderId,
                phone                   AS phone,
                create_date             AS createDate,
                supply_date             AS supplyDate,
                fact_date               AS factDate,
                updated_date            AS updatedDate,
                status_id               AS statusId,
                box_type_id             AS boxTypeId,
                virtual_type_id         AS virtualTypeId,
                is_box_on_pallet        AS isBoxOnPallet,
                warehouse_id            AS warehouseId,
                warehouse_name          AS warehouseName,
                actual_warehouse_id     AS actualWarehouseId,
                actual_warehouse_name   AS actualWarehouseName,
                quantity                AS quantity,
                accepted_quantity       AS acceptedQuantity,
                unloading_quantity      AS unloadingQuantity,
                ready_for_sale_quantity AS readyForSaleQuantity,
                depersonalized_quantity AS depersonalizedQuantity
           FROM wb_supplies
          WHERE supply_id = ?`,
      )
      .get(supplyId) as
      | (Omit<WbSupplyRecord, "isBoxOnPallet"> & {
          isBoxOnPallet: number | null;
        })
      | undefined;
    if (!row) return null;
    return {
      ...row,
      isBoxOnPallet: intToBool(row.isBoxOnPallet),
    };
  }

  replaceItemsForSupply(
    supplyId: number,
    items: readonly WbSupplyItemRecord[],
  ): { deleted: number; inserted: number } {
    const del = this.db.prepare(
      `DELETE FROM wb_supply_items WHERE supply_id = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO wb_supply_items (
         supply_id, barcode, vendor_code, nm_id, tech_size, color,
         quantity, accepted_quantity, ready_for_sale_quantity, unloading_quantity
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly WbSupplyItemRecord[]) => {
        deleted = del.run(supplyId).changes;
        for (const it of batch) {
          ins.run(
            supplyId,
            it.barcode,
            it.vendorCode,
            it.nmId,
            it.techSize,
            it.color,
            it.quantity,
            it.acceptedQuantity,
            it.readyForSaleQuantity,
            it.unloadingQuantity,
          );
          inserted += 1;
        }
      },
    );
    tx(items);
    return { deleted, inserted };
  }

  /**
   * Append a history row iff `(status_id, fact_date)` differs from the latest
   * known one for this supply. First observation always writes a row.
   */
  appendStatusHistoryIfChanged(
    supplyId: number,
    statusId: number,
    factDate: string | null,
    changedAt: string,
  ): boolean {
    const last = this.db
      .prepare(
        `SELECT status_id AS statusId, fact_date AS factDate
           FROM wb_supply_status_history
          WHERE supply_id = ?
          ORDER BY id DESC
          LIMIT 1`,
      )
      .get(supplyId) as
      | { statusId: number; factDate: string | null }
      | undefined;

    if (
      last &&
      last.statusId === statusId &&
      (last.factDate ?? null) === (factDate ?? null)
    ) {
      return false;
    }

    this.db
      .prepare(
        `INSERT INTO wb_supply_status_history (
           supply_id, status_id, fact_date, changed_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(supplyId, statusId, factDate, changedAt);
    return true;
  }

  /**
   * Read all supply headers whose `status_id` is in `statusIds`. Caller
   * is expected to use the explicit semantic constants from
   * `wbSupplyStatus.ts` rather than literal numbers, so the forecast
   * code never branches on raw IDs.
   */
  getSuppliesByStatuses(
    statusIds: readonly number[],
  ): WbSupplyRecord[] {
    if (statusIds.length === 0) return [];
    const placeholders = statusIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT supply_id               AS supplyId,
                preorder_id             AS preorderId,
                phone                   AS phone,
                create_date             AS createDate,
                supply_date             AS supplyDate,
                fact_date               AS factDate,
                updated_date            AS updatedDate,
                status_id               AS statusId,
                box_type_id             AS boxTypeId,
                virtual_type_id         AS virtualTypeId,
                is_box_on_pallet        AS isBoxOnPallet,
                warehouse_id            AS warehouseId,
                warehouse_name          AS warehouseName,
                actual_warehouse_id     AS actualWarehouseId,
                actual_warehouse_name   AS actualWarehouseName,
                quantity                AS quantity,
                accepted_quantity       AS acceptedQuantity,
                unloading_quantity      AS unloadingQuantity,
                ready_for_sale_quantity AS readyForSaleQuantity,
                depersonalized_quantity AS depersonalizedQuantity
           FROM wb_supplies
          WHERE status_id IN (${placeholders})
          ORDER BY supply_id`,
      )
      .all(...statusIds) as ((Omit<WbSupplyRecord, "isBoxOnPallet"> & {
      isBoxOnPallet: number | null;
    })[]);
    return rows.map((r) => ({
      ...r,
      isBoxOnPallet:
        r.isBoxOnPallet === null || r.isBoxOnPallet === undefined
          ? null
          : r.isBoxOnPallet !== 0,
    }));
  }

  /**
   * Read all items belonging to the given supply IDs. Returns a flat
   * array — the caller groups by `supplyId` if needed. SQLite has a
   * variable-count limit (~32k by default) so we chunk to be safe.
   */
  getItemsForSupplyIds(
    supplyIds: readonly number[],
  ): WbSupplyItemRecord[] {
    if (supplyIds.length === 0) return [];
    const CHUNK = 500;
    const out: WbSupplyItemRecord[] = [];
    for (let i = 0; i < supplyIds.length; i += CHUNK) {
      const chunk = supplyIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `SELECT supply_id               AS supplyId,
                  barcode                 AS barcode,
                  vendor_code             AS vendorCode,
                  nm_id                   AS nmId,
                  tech_size               AS techSize,
                  color                   AS color,
                  quantity                AS quantity,
                  accepted_quantity       AS acceptedQuantity,
                  ready_for_sale_quantity AS readyForSaleQuantity,
                  unloading_quantity      AS unloadingQuantity
             FROM wb_supply_items
            WHERE supply_id IN (${placeholders})
            ORDER BY supply_id, id`,
        )
        .all(...chunk) as WbSupplyItemRecord[];
      out.push(...rows);
    }
    return out;
  }

  countSupplies(): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS c FROM wb_supplies`)
      .get() as { c: number };
    return r.c;
  }

  countItemsForSupply(supplyId: number): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM wb_supply_items WHERE supply_id = ?`,
      )
      .get(supplyId) as { c: number };
    return r.c;
  }

  countStatusHistory(supplyId: number): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM wb_supply_status_history WHERE supply_id = ?`,
      )
      .get(supplyId) as { c: number };
    return r.c;
  }
}

function supplyFieldsDiffer(
  prev: WbSupplyRecord,
  next: WbSupplyRecord,
): boolean {
  return (
    prev.preorderId !== next.preorderId ||
    prev.phone !== next.phone ||
    prev.createDate !== next.createDate ||
    prev.supplyDate !== next.supplyDate ||
    prev.factDate !== next.factDate ||
    prev.updatedDate !== next.updatedDate ||
    prev.statusId !== next.statusId ||
    prev.boxTypeId !== next.boxTypeId ||
    prev.virtualTypeId !== next.virtualTypeId ||
    prev.isBoxOnPallet !== next.isBoxOnPallet ||
    prev.warehouseId !== next.warehouseId ||
    prev.warehouseName !== next.warehouseName ||
    prev.actualWarehouseId !== next.actualWarehouseId ||
    prev.actualWarehouseName !== next.actualWarehouseName ||
    prev.quantity !== next.quantity ||
    prev.acceptedQuantity !== next.acceptedQuantity ||
    prev.unloadingQuantity !== next.unloadingQuantity ||
    prev.readyForSaleQuantity !== next.readyForSaleQuantity ||
    prev.depersonalizedQuantity !== next.depersonalizedQuantity
  );
}

function boolToInt(v: boolean | null): number | null {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function intToBool(v: number | null): boolean | null {
  if (v === null || v === undefined) return null;
  return v !== 0;
}
