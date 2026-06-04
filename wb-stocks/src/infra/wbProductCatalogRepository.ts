import type { WbProductCatalogRecord } from "../domain/stockSnapshot.js";
import type { DbHandle } from "./db.js";

export interface ProductCatalogSkuKey {
  nmId: number;
  techSize: string;
}

const CHUNK_SIZE = 400;

export class WbProductCatalogRepository {
  constructor(private readonly db: DbHandle) {}

  upsertBatch(rows: readonly WbProductCatalogRecord[]): { upserted: number } {
    if (rows.length === 0) return { upserted: 0 };

    const stmt = this.db.prepare(
      `INSERT INTO wb_product_catalog (
         nm_id, tech_size, vendor_code, category, subject, brand,
         price, discount, sale_price, updated_at
       ) VALUES (
         @nmId, @techSize, @vendorCode, @category, @subject, @brand,
         @price, @discount, @salePrice, @updatedAt
       )
       ON CONFLICT(nm_id, tech_size) DO UPDATE SET
         vendor_code = COALESCE(excluded.vendor_code, wb_product_catalog.vendor_code),
         category = COALESCE(excluded.category, wb_product_catalog.category),
         subject = COALESCE(excluded.subject, wb_product_catalog.subject),
         brand = COALESCE(excluded.brand, wb_product_catalog.brand),
         price = COALESCE(excluded.price, wb_product_catalog.price),
         discount = COALESCE(excluded.discount, wb_product_catalog.discount),
         sale_price = COALESCE(excluded.sale_price, wb_product_catalog.sale_price),
         updated_at = excluded.updated_at`,
    );

    let upserted = 0;
    const tx = this.db.transaction((batch: readonly WbProductCatalogRecord[]) => {
      for (const row of batch) {
        stmt.run(row);
        upserted += 1;
      }
    });
    tx(rows);
    return { upserted };
  }

  getBySkuKeys(
    keys: readonly ProductCatalogSkuKey[],
  ): Map<string, WbProductCatalogRecord> {
    const uniq = dedupeKeys(keys);
    const out = new Map<string, WbProductCatalogRecord>();
    if (uniq.length === 0) return out;

    for (let i = 0; i < uniq.length; i += CHUNK_SIZE) {
      const chunk = uniq.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "(?, ?)").join(", ");
      const params = chunk.flatMap((k) => [k.nmId, k.techSize]);
      const rows = this.db
        .prepare(
          `SELECT nm_id       AS nmId,
                  tech_size   AS techSize,
                  vendor_code AS vendorCode,
                  category    AS category,
                  subject     AS subject,
                  brand       AS brand,
                  price       AS price,
                  discount    AS discount,
                  sale_price  AS salePrice,
                  updated_at  AS updatedAt
             FROM wb_product_catalog
            WHERE (nm_id, tech_size) IN (${placeholders})`,
        )
        .all(...params) as WbProductCatalogRecord[];
      for (const row of rows) {
        out.set(catalogKey(row.nmId, row.techSize), row);
      }
    }

    return out;
  }

  countAll(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM wb_product_catalog`)
      .get() as { c: number };
    return row.c;
  }
}

export function catalogKey(nmId: number, techSize: string): string {
  return `${nmId}\u0000${techSize}`;
}

function dedupeKeys(keys: readonly ProductCatalogSkuKey[]): ProductCatalogSkuKey[] {
  const seen = new Set<string>();
  const out: ProductCatalogSkuKey[] = [];
  for (const key of keys) {
    const normalized = {
      nmId: key.nmId,
      techSize: key.techSize ?? "",
    };
    const k = catalogKey(normalized.nmId, normalized.techSize);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(normalized);
  }
  return out;
}
