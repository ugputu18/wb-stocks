import type { DbHandle } from "./db.js";

export interface WbRegionMacroRegionRow {
  regionKey: string;
  macroRegion: string;
}

/**
 * Явное сопоставление `region_key` (нормализованный `regionName` из заказов) → макрорегион.
 * Строки должны использовать те же значения `macro_region`, что и складской справочник в UI.
 */
export class WbRegionMacroRegionRepository {
  constructor(private readonly db: DbHandle) {}

  getAll(): WbRegionMacroRegionRow[] {
    return this.db
      .prepare(
        `SELECT region_key AS regionKey, macro_region AS macroRegion
           FROM wb_region_macro_region
          ORDER BY region_key`,
      )
      .all() as WbRegionMacroRegionRow[];
  }

  upsertMany(rows: readonly WbRegionMacroRegionRow[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO wb_region_macro_region (region_key, macro_region)
       VALUES (@regionKey, @macroRegion)`,
    );
    const tx = this.db.transaction((batch: readonly WbRegionMacroRegionRow[]) => {
      for (const r of batch) stmt.run(r);
    });
    tx(rows);
  }
}
