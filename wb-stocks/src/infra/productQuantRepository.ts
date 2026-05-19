import type { ProductQuantRecord } from "../domain/productQuant.js";
import { normalizeUnitsPerBox } from "../domain/productQuant.js";
import type { DbHandle } from "./db.js";

export class ProductQuantRepository {
  constructor(private readonly db: DbHandle) {}

  allByVendor(): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT vendor_code AS vendorCode, units_per_box AS unitsPerBox
           FROM product_quants`,
      )
      .all() as { vendorCode: string; unitsPerBox: number }[];
    const m = new Map<string, number>();
    for (const row of rows) {
      const vendorCode = String(row.vendorCode).trim();
      if (!vendorCode) continue;
      m.set(vendorCode, normalizeUnitsPerBox(row.unitsPerBox));
    }
    return m;
  }

  countAll(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM product_quants`)
      .get() as { c: number };
    return row.c;
  }

  replaceAll(rows: readonly ProductQuantRecord[]): {
    deleted: number;
    inserted: number;
  } {
    const del = this.db.prepare(`DELETE FROM product_quants`);
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO product_quants (
         vendor_code, units_per_box, source_file, imported_at
       ) VALUES (?, ?, ?, ?)`,
    );

    let deleted = 0;
    let inserted = 0;
    const tx = this.db.transaction((batch: readonly ProductQuantRecord[]) => {
      deleted = del.run().changes;
      for (const row of batch) {
        const vendorCode = row.vendorCode.trim();
        if (!vendorCode) continue;
        ins.run(
          vendorCode,
          normalizeUnitsPerBox(row.unitsPerBox),
          row.sourceFile,
          row.importedAt,
        );
        inserted += 1;
      }
    });
    tx(rows);
    return { deleted, inserted };
  }
}
