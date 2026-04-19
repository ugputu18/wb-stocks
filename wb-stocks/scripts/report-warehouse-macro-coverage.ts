/**
 * Сверка покрытия `WB_WAREHOUSE_MACRO_REGION`: уникальные `warehouse_key` из снимка
 * `wb_forecast_snapshots` → canonical {@link normalizeWarehouseName} → {@link getWarehouseMacroRegion}.
 *
 * Запуск (из корня wb-stocks, с `.env` и БД):
 *   pnpm exec tsx --env-file=.env scripts/report-warehouse-macro-coverage.ts
 *
 * Вывод: список ключей без макрорегиона (добавлять в справочник только подтверждённые реальные ключи).
 */

import { loadConfig } from "../src/config/env.js";
import { openDatabase } from "../src/infra/db.js";
import {
  getWarehouseMacroRegion,
  WB_WAREHOUSE_MACRO_REGION,
} from "../src/domain/wbWarehouseMacroRegion.js";
import { normalizeWarehouseName } from "../src/domain/warehouseName.js";

function main(): void {
  const cfg = loadConfig();
  const db = openDatabase(cfg.DATABASE_PATH);
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT warehouse_key AS k
           FROM wb_forecast_snapshots
          WHERE warehouse_key IS NOT NULL AND TRIM(warehouse_key) != ''
          ORDER BY warehouse_key`,
      )
      .all() as { k: string }[];

    const unmapped: string[] = [];
    for (const { k } of rows) {
      if (getWarehouseMacroRegion(k) == null) {
        unmapped.push(`${k} → normalized: "${normalizeWarehouseName(k)}"`);
      }
    }

    const dictSize = Object.keys(WB_WAREHOUSE_MACRO_REGION).length;
    console.log(
      `Distinct warehouse_key in wb_forecast_snapshots: ${rows.length}; dictionary keys: ${dictSize}; unmapped: ${unmapped.length}`,
    );
    if (unmapped.length) {
      console.log("--- unmapped (add only after verifying real usage) ---");
      for (const line of unmapped) console.log(line);
    }
  } finally {
    db.close();
  }
}

main();
