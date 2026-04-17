/**
 * A single row of the "own warehouse state on a given calendar date" snapshot.
 *
 * The project currently has exactly one physical warehouse, so `warehouseCode`
 * defaults to `"main"`. The field is kept explicitly so that additional
 * warehouses can be introduced without schema changes.
 *
 * "Snapshot date" is a pure calendar date (`YYYY-MM-DD`) — NOT a timestamp.
 * One (snapshotDate, warehouseCode) pair == one authoritative state of that
 * warehouse on that day. Re-importing the same pair is treated as a replace,
 * not as an append (see `OwnStockSnapshotRepository.replaceForDate`).
 */
export interface OwnStockSnapshotRecord {
  snapshotDate: string; // YYYY-MM-DD
  warehouseCode: string;
  vendorCode: string;
  quantity: number;
  sourceFile: string | null;
  importedAt: string; // ISO timestamp when the row was written
}

export const DEFAULT_WAREHOUSE_CODE = "main";
