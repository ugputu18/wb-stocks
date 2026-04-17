import type { DbHandle } from "./db.js";
import type { OwnStockSnapshotRecord } from "../domain/ownStockSnapshot.js";
import { DEFAULT_WAREHOUSE_CODE } from "../domain/ownStockSnapshot.js";

/**
 * Idempotency model: **replace-for-date**.
 *
 * One (snapshotDate, warehouseCode) pair represents the authoritative state
 * of the warehouse on that day. Re-importing the same pair first deletes any
 * existing rows for that pair, then inserts fresh ones in the same
 * transaction. This matches the "snapshot on a date" semantics and avoids
 * the ambiguity of merging partial re-imports.
 *
 * History across *different* dates is preserved: only the row set of the
 * date being imported is touched.
 */
export class OwnStockSnapshotRepository {
  constructor(private readonly db: DbHandle) {}

  /**
   * Vendor → quantity for one calendar snapshot and physical warehouse
   * (`own_stock_snapshots` key). Used by forecast UI (read-side system level).
   */
  quantitiesByVendor(
    snapshotDate: string,
    warehouseCode: string = DEFAULT_WAREHOUSE_CODE,
  ): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT vendor_code AS v, quantity AS q
           FROM own_stock_snapshots
          WHERE snapshot_date = ? AND warehouse_code = ?`,
      )
      .all(snapshotDate, warehouseCode) as { v: string; q: number }[];
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(String(r.v).trim(), Number(r.q));
    }
    return m;
  }

  countForDate(snapshotDate: string, warehouseCode: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM own_stock_snapshots
          WHERE snapshot_date = ? AND warehouse_code = ?`,
      )
      .get(snapshotDate, warehouseCode) as { c: number };
    return row.c;
  }

  /**
   * Replace the whole snapshot of `warehouseCode` for `snapshotDate`.
   *
   * The `snapshotDate` / `warehouseCode` on each input record are *forced*
   * to match the method arguments, so the caller cannot accidentally mix
   * rows from different days or warehouses into one batch.
   */
  replaceForDate(
    snapshotDate: string,
    warehouseCode: string,
    rows: readonly OwnStockSnapshotRecord[],
  ): { deleted: number; inserted: number } {
    const del = this.db.prepare(
      `DELETE FROM own_stock_snapshots
        WHERE snapshot_date = ? AND warehouse_code = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO own_stock_snapshots (
         snapshot_date, warehouse_code, vendor_code, quantity,
         source_file, imported_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );

    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly OwnStockSnapshotRecord[]) => {
        deleted = del.run(snapshotDate, warehouseCode).changes;
        for (const row of batch) {
          ins.run(
            snapshotDate,
            warehouseCode,
            row.vendorCode,
            row.quantity,
            row.sourceFile,
            row.importedAt,
          );
          inserted += 1;
        }
      },
    );
    tx(rows);
    return { deleted, inserted };
  }
}
