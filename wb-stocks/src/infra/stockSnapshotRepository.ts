import type { DbHandle } from "./db.js";
import type { StockSnapshotRecord } from "../domain/stockSnapshot.js";

/**
 * Idempotency: uniqueness is enforced at DB level on
 * (snapshot_at, nm_id, barcode, tech_size, warehouse_name).
 * Using `INSERT OR IGNORE` so a re-run with the same snapshot timestamp
 * cannot produce duplicates. Each new import uses a fresh snapshot timestamp,
 * so history is preserved across runs.
 */
export class StockSnapshotRepository {
  constructor(private readonly db: DbHandle) {}

  saveBatch(rows: readonly StockSnapshotRecord[]): { inserted: number } {
    if (rows.length === 0) return { inserted: 0 };

    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO wb_stock_snapshots (
         snapshot_at, nm_id, vendor_code, barcode, tech_size,
         warehouse_name, quantity, in_way_to_client, in_way_from_client,
         quantity_full, last_change_date
       ) VALUES (
         @snapshotAt, @nmId, @vendorCode, @barcode, @techSize,
         @warehouseName, @quantity, @inWayToClient, @inWayFromClient,
         @quantityFull, @lastChangeDate
       )`,
    );

    let inserted = 0;
    const tx = this.db.transaction((batch: readonly StockSnapshotRecord[]) => {
      for (const row of batch) {
        const info = stmt.run(row);
        inserted += info.changes;
      }
    });
    tx(rows);
    return { inserted };
  }

  countForSnapshot(snapshotAt: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM wb_stock_snapshots WHERE snapshot_at = ?`,
      )
      .get(snapshotAt) as { c: number };
    return row.c;
  }

  /**
   * Latest `snapshot_at` value not later than the end of `asOfDate`
   * (UTC). Used by the forecast pipeline to pin which snapshot fed
   * `startStock`. Returns `null` when we have never imported stocks
   * up to that date.
   *
   * The cutoff is `asOfDate + "T23:59:59.999Z"` so a snapshot taken any
   * time during `asOfDate` (UTC) qualifies. This is an explicit MVP
   * convention: `snapshotDate` across demand/forecast is a UTC business
   * date, and stock imports are timestamped in UTC, so using a UTC cutoff
   * keeps the pipeline reproducible and host-timezone-independent.
   *
   * We deliberately do not look ahead: running a forecast for a historical
   * date must not consume a stock snapshot taken AFTER that date. If we
   * later need "Moscow business day" semantics, that conversion should
   * happen at the CLI/orchestrator boundary before calling this method.
   */
  getLatestSnapshotAtAsOf(asOfDate: string): string | null {
    const cutoff = `${asOfDate}T23:59:59.999Z`;
    const r = this.db
      .prepare(
        `SELECT MAX(snapshot_at) AS m FROM wb_stock_snapshots WHERE snapshot_at <= ?`,
      )
      .get(cutoff) as { m: string | null };
    return r.m ?? null;
  }

  /** All rows belonging to a specific snapshot, in insertion order. */
  getBySnapshotAt(snapshotAt: string): StockSnapshotRecord[] {
    return this.db
      .prepare(
        `SELECT snapshot_at        AS snapshotAt,
                nm_id              AS nmId,
                vendor_code        AS vendorCode,
                barcode            AS barcode,
                tech_size          AS techSize,
                warehouse_name     AS warehouseName,
                quantity           AS quantity,
                in_way_to_client   AS inWayToClient,
                in_way_from_client AS inWayFromClient,
                quantity_full      AS quantityFull,
                last_change_date   AS lastChangeDate
           FROM wb_stock_snapshots
          WHERE snapshot_at = ?
          ORDER BY id`,
      )
      .all(snapshotAt) as StockSnapshotRecord[];
  }
}
