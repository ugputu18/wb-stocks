import {
  wbStocksApiRowSchema,
  type StockSnapshotRecord,
} from "../domain/stockSnapshot.js";

export type MapResult =
  | { ok: true; record: StockSnapshotRecord }
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
  return {
    ok: true,
    record: {
      snapshotAt,
      nmId: row.nmId,
      vendorCode: nullable(row.supplierArticle),
      barcode: nullable(row.barcode),
      techSize: nullable(row.techSize),
      warehouseName: row.warehouseName,
      quantity: row.quantity,
      inWayToClient: row.inWayToClient ?? null,
      inWayFromClient: row.inWayFromClient ?? null,
      quantityFull: row.quantityFull ?? null,
      lastChangeDate: nullable(row.lastChangeDate),
    },
  };
}

function nullable(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}
