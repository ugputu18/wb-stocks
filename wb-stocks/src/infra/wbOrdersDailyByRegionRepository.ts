import type { DbHandle } from "./db.js";
import type { WbOrdersDailyRegionRecord } from "../domain/wbOrder.js";

/**
 * Дневной агрегат заказов по региону заказа (`wb_orders_daily_by_region`).
 * Идемпотентность: `replaceDay` полностью перезаписывает срез по дате.
 */
export class WbOrdersDailyByRegionRepository {
  constructor(private readonly db: DbHandle) {}

  replaceDay(
    orderDate: string,
    rows: readonly WbOrdersDailyRegionRecord[],
  ): { deleted: number; inserted: number } {
    const del = this.db.prepare(
      `DELETE FROM wb_orders_daily_by_region WHERE order_date = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO wb_orders_daily_by_region (
         order_date, region_name_raw, region_key, nm_id, tech_size,
         vendor_code, barcode, units, cancelled_units, gross_units,
         first_seen_at, last_seen_at
       ) VALUES (
         @orderDate, @regionNameRaw, @regionKey, @nmId, @techSize,
         @vendorCode, @barcode, @units, @cancelledUnits, @grossUnits,
         @firstSeenAt, @lastSeenAt
       )`,
    );

    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly WbOrdersDailyRegionRecord[]) => {
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

  getRange(dateFrom: string, dateTo: string): WbOrdersDailyRegionRecord[] {
    return this.db
      .prepare(
        `SELECT order_date         AS orderDate,
                region_name_raw    AS regionNameRaw,
                region_key         AS regionKey,
                nm_id              AS nmId,
                tech_size          AS techSize,
                vendor_code        AS vendorCode,
                barcode            AS barcode,
                units              AS units,
                cancelled_units    AS cancelledUnits,
                gross_units        AS grossUnits,
                first_seen_at      AS firstSeenAt,
                last_seen_at       AS lastSeenAt
           FROM wb_orders_daily_by_region
          WHERE order_date BETWEEN ? AND ?
          ORDER BY order_date, region_key, nm_id, tech_size`,
      )
      .all(dateFrom, dateTo) as WbOrdersDailyRegionRecord[];
  }
}
