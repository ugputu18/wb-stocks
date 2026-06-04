import {
  wbStocksApiRowSchema,
  type WbProductCatalogRecord,
  type StockSnapshotRecord,
} from "../domain/stockSnapshot.js";

export type MapResult =
  | { ok: true; record: StockSnapshotRecord; catalogRecord: WbProductCatalogRecord }
  | { ok: false; reason: string; raw: unknown };

/**
 * Map a single raw WB supplier-stocks row into our internal snapshot record.
 * Invalid rows are returned as `{ ok: false, ... }` so the caller can log
 * them and keep processing the rest of the batch.
 */
export function mapWbStockRow(
  raw: unknown,
  snapshotAt: string,
): MapResult {
  const parsed = wbStocksApiRowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; "),
      raw,
    };
  }

  const row = parsed.data;
  const vendorCode = nullable(row.supplierArticle);
  const techSize = nullable(row.techSize);
  const price = finiteOrNull(row.Price);
  const discount = finiteOrNull(row.Discount) ?? 0;
  const salePrice = price === null ? null : price * (1 - clamp(discount, 0, 100) / 100);
  return {
    ok: true,
    record: {
      snapshotAt,
      nmId: row.nmId,
      vendorCode,
      barcode: nullable(row.barcode),
      techSize,
      warehouseName: row.warehouseName,
      quantity: row.quantity,
      inWayToClient: row.inWayToClient ?? null,
      inWayFromClient: row.inWayFromClient ?? null,
      quantityFull: row.quantityFull ?? null,
      lastChangeDate: nullable(row.lastChangeDate),
    },
    catalogRecord: {
      nmId: row.nmId,
      techSize: techSize ?? "",
      vendorCode,
      category: nullable(row.category),
      subject: nullable(row.subject),
      brand: nullable(row.brand),
      price,
      discount: price === null ? null : discount,
      salePrice,
      updatedAt: snapshotAt,
    },
  };
}

function nullable(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function finiteOrNull(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}
