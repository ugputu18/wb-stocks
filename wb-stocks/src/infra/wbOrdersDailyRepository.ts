import type { DbHandle } from "./db.js";
import type { WbOrdersDailyRecord } from "../domain/wbOrder.js";

/**
 * Repository for the daily orders pre-aggregate (`wb_orders_daily`).
 *
 * Idempotency model:
 * - PK is `(order_date, warehouse_key, nm_id, tech_size)`. The aggregator
 *   (`importWbOrders`) emits exactly one row per such tuple per import.
 * - `replaceDay(orderDate, rows)` is a "delete-then-insert by day": every
 *   re-import for the same date fully overwrites that day's slice. This
 *   matters because WB occasionally adds/cancels orders retroactively;
 *   a re-run of the same date must converge to whatever WB now reports,
 *   not accumulate stale rows.
 * - `vendor_code` / `barcode` are stored alongside the key for debugging
 *   and joining with our own warehouse data, but they are never part of
 *   the key itself (they are not always stable per (nm_id, techSize)).
 */
export class WbOrdersDailyRepository {
  constructor(private readonly db: DbHandle) {}

  /**
   * Atomically replace all rows for a given `orderDate` with `rows`.
   * Returns counts to help the caller log the diff.
   */
  replaceDay(
    orderDate: string,
    rows: readonly WbOrdersDailyRecord[],
  ): { deleted: number; inserted: number } {
    const del = this.db.prepare(
      `DELETE FROM wb_orders_daily WHERE order_date = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO wb_orders_daily (
         order_date, warehouse_name_raw, warehouse_key, nm_id, tech_size,
         vendor_code, barcode, units, cancelled_units, gross_units,
         first_seen_at, last_seen_at
       ) VALUES (
         @orderDate, @warehouseNameRaw, @warehouseKey, @nmId, @techSize,
         @vendorCode, @barcode, @units, @cancelledUnits, @grossUnits,
         @firstSeenAt, @lastSeenAt
       )`,
    );

    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly WbOrdersDailyRecord[]) => {
        deleted = del.run(orderDate).changes;
        for (const r of batch) {
          ins.run(r);
          inserted += 1;
        }
      },
    );
    tx(rows);
    return { deleted, inserted };
  }

  /**
   * Fetch all rows in `[dateFrom, dateTo]` (inclusive). Used by the
   * demand snapshot use case. Result is ordered by date for predictable
   * grouping in tests and downstream code.
   */
  getRange(dateFrom: string, dateTo: string): WbOrdersDailyRecord[] {
    return this.db
      .prepare(
        `SELECT order_date         AS orderDate,
                warehouse_name_raw AS warehouseNameRaw,
                warehouse_key      AS warehouseKey,
                nm_id              AS nmId,
                tech_size          AS techSize,
                vendor_code        AS vendorCode,
                barcode            AS barcode,
                units              AS units,
                cancelled_units    AS cancelledUnits,
                gross_units        AS grossUnits,
                first_seen_at      AS firstSeenAt,
                last_seen_at       AS lastSeenAt
           FROM wb_orders_daily
          WHERE order_date BETWEEN ? AND ?
          ORDER BY order_date, warehouse_key, nm_id, tech_size`,
      )
      .all(dateFrom, dateTo) as WbOrdersDailyRecord[];
  }

  countDay(orderDate: string): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM wb_orders_daily WHERE order_date = ?`,
      )
      .get(orderDate) as { c: number };
    return r.c;
  }

  countAll(): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS c FROM wb_orders_daily`)
      .get() as { c: number };
    return r.c;
  }
}
