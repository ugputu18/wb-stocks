import { z } from "zod";

/**
 * Raw row shape returned by WB Statistics API:
 *   GET https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=...
 *
 * We only declare the fields we actually use. WB may return additional
 * properties, they are ignored on parse (`.passthrough()` not set on purpose
 * to enforce that we don't accidentally rely on undeclared fields).
 *
 * WB Dev Portal note: this endpoint is scheduled for removal on 2026-06-23.
 * When migrating to POST /api/analytics/v1/stocks-report/wb-warehouses, the
 * fields in_way_to_client / in_way_from_client / quantity_full / barcode
 * will not be available from that endpoint; those columns must stay nullable.
 */
export const wbStocksApiRowSchema = z.object({
  lastChangeDate: z.string().optional(),
  warehouseName: z.string(),
  supplierArticle: z.string().optional(),
  nmId: z.number().int(),
  barcode: z.string().optional(),
  quantity: z.number().int(),
  inWayToClient: z.number().int().optional(),
  inWayFromClient: z.number().int().optional(),
  quantityFull: z.number().int().optional(),
  techSize: z.string().optional(),
});

export type WbStocksApiRow = z.infer<typeof wbStocksApiRowSchema>;

/**
 * Internal representation of a single warehouse-stock snapshot row.
 * One row per (snapshot, nmId, barcode, techSize, warehouse).
 */
export interface StockSnapshotRecord {
  snapshotAt: string; // ISO-8601 UTC, identical for every row of the same import
  nmId: number;
  vendorCode: string | null; // from WB supplierArticle
  barcode: string | null;
  techSize: string | null;
  warehouseName: string;
  quantity: number;
  inWayToClient: number | null;
  inWayFromClient: number | null;
  quantityFull: number | null;
  lastChangeDate: string | null;
}
