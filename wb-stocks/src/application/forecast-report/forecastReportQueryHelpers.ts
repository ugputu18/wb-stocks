import type { DbHandle } from "../../infra/db.js";
import type {
  InventoryLevelsReadModel,
  WbRowReplenishmentReadModel,
} from "../../domain/multiLevelInventory.js";
import type {
  ForecastReportFilter,
  ForecastSnapshotScope,
  RiskStockoutFilter,
} from "./forecastReportTypes.js";

export function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function skuKey(nmId: number, techSize: string): string {
  return `${nmId}\t${techSize ?? ""}`;
}

export function aggregatedRiskStockoutMatches(
  daysWb: number,
  rs: RiskStockoutFilter,
): boolean {
  if (rs === "all") return true;
  if (rs === "lt7") return daysWb < 7;
  if (rs === "lt14") return daysWb < 14;
  if (rs === "lt30") return daysWb < 30;
  if (rs === "lt45") return daysWb < 45;
  if (rs === "lt60") return daysWb < 60;
  return true;
}

export function systemTotalQuickFilterMatches(
  qf: ForecastReportFilter["systemTotalQuickFilter"],
  row: {
    inventoryLevels: InventoryLevelsReadModel;
    recommendedFromSupplier: number;
    replenishment?: WbRowReplenishmentReadModel;
  },
): boolean {
  const mode = qf ?? "all";
  if (mode === "all") return true;
  if (mode === "systemRisk") return row.inventoryLevels.systemRisk;
  if (mode === "supplierOrder") return row.recommendedFromSupplier > 0;
  if (mode === "wbReplenish") {
    return (row.replenishment?.recommendedToWB ?? 0) > 0;
  }
  return true;
}

export function buildReportWhere(
  snapshotDate: string,
  horizonDays: number,
  filter: ForecastReportFilter,
): { sql: string; params: unknown[] } {
  const clauses = ["snapshot_date = ?", "horizon_days = ?"];
  const params: unknown[] = [snapshotDate, horizonDays];

  const wh = filter.warehouseKey?.trim();
  if (wh) {
    clauses.push("warehouse_key = ?");
    params.push(wh);
  }

  const q = filter.q?.trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      clauses.push("nm_id = ?");
      params.push(Number(q));
      const ts = filter.techSize?.trim();
      if (ts) {
        clauses.push("tech_size = ?");
        params.push(ts);
      }
    } else {
      const like = `%${escapeLike(q)}%`;
      clauses.push("(vendor_code LIKE ? OR CAST(nm_id AS TEXT) LIKE ?)");
      params.push(like, like);
    }
  }

  const rs = filter.riskStockout ?? "all";
  if (rs === "lt7") {
    clauses.push("days_of_stock < 7");
  } else if (rs === "lt14") {
    clauses.push("days_of_stock < 14");
  } else if (rs === "lt30") {
    clauses.push("days_of_stock < 30");
  } else if (rs === "lt45") {
    clauses.push("days_of_stock < 45");
  } else if (rs === "lt60") {
    clauses.push("days_of_stock < 60");
  }

  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

export function buildScopeWhere(
  snapshotDate: string,
  horizonDays: number,
  scope: ForecastSnapshotScope,
): { sql: string; params: Array<string | number> } {
  const clauses = ["snapshot_date = ?", "horizon_days = ?"];
  const params: Array<string | number> = [snapshotDate, horizonDays];
  if (scope.warehouseKey !== undefined) {
    clauses.push("warehouse_key = ?");
    params.push(scope.warehouseKey);
  }
  if (scope.nmId !== undefined) {
    clauses.push("nm_id = ?");
    params.push(scope.nmId);
  }
  if (scope.vendorCode !== undefined) {
    clauses.push("vendor_code = ?");
    params.push(scope.vendorCode);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

/**
 * Какие `(nm_id, tech_size)` попадают в supplier-витрину при фильтрах warehouse / q.
 * Без фильтров — `null` (все SKU среза). `riskStockout` сюда не входит.
 */
export function skuKeysMatchingScope(
  db: DbHandle,
  snapshotDate: string,
  horizonDays: number,
  filter: ForecastReportFilter,
): Set<string> | null {
  const wh = filter.warehouseKey?.trim();
  const q = filter.q?.trim();

  if (!wh && !q) return null;

  let set: Set<string> | null = null;

  const intersect = (a: Set<string>, b: Set<string>) =>
    new Set([...a].filter((x) => b.has(x)));

  if (wh) {
    const rows = db
      .prepare(
        `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
           FROM wb_forecast_snapshots
          WHERE snapshot_date = ? AND horizon_days = ? AND warehouse_key = ?`,
      )
      .all(snapshotDate, horizonDays, wh) as {
      nmId: number;
      techSize: string;
    }[];
    set = new Set(rows.map((r) => skuKey(r.nmId, r.techSize)));
  }

  if (q) {
    let qSet: Set<string>;
    if (/^\d+$/.test(q)) {
      const nm = Number(q);
      const ts = filter.techSize?.trim();
      const rows = ts
        ? (db
            .prepare(
              `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
                 FROM wb_forecast_snapshots
                WHERE snapshot_date = ? AND horizon_days = ? AND nm_id = ? AND tech_size = ?`,
            )
            .all(snapshotDate, horizonDays, nm, ts) as {
            nmId: number;
            techSize: string;
          }[])
        : (db
            .prepare(
              `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
                 FROM wb_forecast_snapshots
                WHERE snapshot_date = ? AND horizon_days = ? AND nm_id = ?`,
            )
            .all(snapshotDate, horizonDays, nm) as {
            nmId: number;
            techSize: string;
          }[]);
      qSet = new Set(rows.map((r) => skuKey(r.nmId, r.techSize)));
    } else {
      const like = `%${escapeLike(q)}%`;
      const rows = db
        .prepare(
          `SELECT DISTINCT nm_id AS nmId, tech_size AS techSize
             FROM wb_forecast_snapshots
            WHERE snapshot_date = ? AND horizon_days = ?
              AND (vendor_code LIKE ? OR CAST(nm_id AS TEXT) LIKE ?)`,
        )
        .all(snapshotDate, horizonDays, like, like) as {
        nmId: number;
        techSize: string;
      }[];
      qSet = new Set(rows.map((r) => skuKey(r.nmId, r.techSize)));
    }
    set = set ? intersect(set, qSet) : qSet;
  }

  return set;
}
