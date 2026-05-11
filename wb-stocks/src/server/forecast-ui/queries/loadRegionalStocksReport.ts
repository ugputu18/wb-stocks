/**
 * Shared loader for the "Запасы WB по региону" report.
 *
 * Both the JSON read endpoint (`GET /api/forecast/regional-stocks`) and the
 * CSV export (`GET /api/forecast/export-regional-stocks`) need the *same*
 * computed report. This module keeps the SQLite + supplies + own-warehouse
 * wiring in one place so the two routes cannot accidentally drift apart.
 */
import {
  buildRegionalStocksReport,
  type RegionalStocksReport,
} from "../../../application/buildRegionalStocksReport.js";
import { selectIncomingSupplies } from "../../../application/selectIncomingSupplies.js";
import { buildRegionMacroLookup } from "../../../domain/wbRegionMacroRegion.js";
import { SUPPLY_STATUS_INCOMING_FOR_FORECAST } from "../../../domain/wbSupplyStatus.js";
import type { DbHandle } from "../../../infra/db.js";
import type { Logger } from "../../../logger.js";
import { OwnStockSnapshotRepository } from "../../../infra/ownStockSnapshotRepository.js";
import { WbRegionMacroRegionRepository } from "../../../infra/wbRegionMacroRegionRepository.js";
import { WbSupplyRepository } from "../../../infra/wbSupplyRepository.js";
import type { RegionalStocksQuery } from "../parse/forecastQuery.js";

function addDaysYmd(ymd: string, days: number): string {
  const utcMs = Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(5, 7)) - 1,
    Number(ymd.slice(8, 10)),
  );
  const d = new Date(utcMs + days * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function groupSupplyItemsBySupplyId<T extends { supplyId: number }>(
  items: readonly T[],
): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const item of items) {
    const arr = m.get(item.supplyId) ?? [];
    arr.push(item);
    m.set(item.supplyId, arr);
  }
  return m;
}

export function findBaseForecastHorizon(
  db: DbHandle,
  snapshotDate: string,
): number | null {
  const row = db
    .prepare(
      `SELECT horizon_days AS horizonDays
         FROM wb_forecast_snapshots
        WHERE snapshot_date = ?
          AND horizon_days IN (30, 60, 90)
        GROUP BY horizon_days
        ORDER BY CASE horizon_days WHEN 30 THEN 1 WHEN 60 THEN 2 WHEN 90 THEN 3 ELSE 4 END
        LIMIT 1`,
    )
    .get(snapshotDate) as { horizonDays: number } | undefined;
  return row?.horizonDays ?? null;
}

/**
 * Самый свежий snapshot_date среди базовых горизонтов прогноза. Использует
 * тот же пул горизонтов (30/60/90), что и `findBaseForecastHorizon`, чтобы
 * "последний срез" гарантированно прошёл следующий шаг и не привёл к 404 из-за
 * того, что для самой свежей даты есть только нестандартный горизонт.
 */
export function resolveLatestForecastSnapshotDate(db: DbHandle): string | null {
  const row = db
    .prepare(
      `SELECT MAX(snapshot_date) AS d
         FROM wb_forecast_snapshots
        WHERE horizon_days IN (30, 60, 90)`,
    )
    .get() as { d: string | null } | undefined;
  const d = row?.d?.trim();
  return d && d.length > 0 ? d : null;
}

export interface RegionalStocksLoadDeps {
  db: DbHandle;
  logger: Logger;
}

export type LoadRegionalStocksOutcome =
  | { ok: true; report: RegionalStocksReport }
  | { ok: false; status: 404; error: string };

/**
 * Build the regional-stocks report end-to-end (DB → application) for a parsed
 * query. Returns a 404-ish envelope when the snapshot is missing so callers
 * can decide whether to render JSON or a CSV error response.
 *
 * `q.snapshotDate === null` означает "оператор не задал дату" — берём самый
 * свежий срез автоматически (см. `resolveLatestForecastSnapshotDate`).
 */
export function loadRegionalStocksReport(
  deps: RegionalStocksLoadDeps,
  q: RegionalStocksQuery,
): LoadRegionalStocksOutcome {
  const snapshotDate =
    q.snapshotDate ?? resolveLatestForecastSnapshotDate(deps.db);
  if (snapshotDate === null) {
    return {
      ok: false,
      status: 404,
      error:
        "No forecast snapshots found in DB (run sales forecast MVP first)",
    };
  }

  const baseForecastHorizon = findBaseForecastHorizon(deps.db, snapshotDate);
  if (baseForecastHorizon === null) {
    return {
      ok: false,
      status: 404,
      error:
        "No base forecast snapshot found for snapshotDate (need one of horizonDays 30|60|90)",
    };
  }

  const supplyRepo = new WbSupplyRepository(deps.db);
  const supplies = supplyRepo.getSuppliesByStatuses(
    SUPPLY_STATUS_INCOMING_FOR_FORECAST,
  );
  const items = supplyRepo.getItemsForSupplyIds(supplies.map((s) => s.supplyId));
  const incoming = selectIncomingSupplies({
    supplies,
    itemsBySupplyId: groupSupplyItemsBySupplyId(items),
    fromDate: snapshotDate,
    toDate: addDaysYmd(snapshotDate, q.horizonDays - 1),
    logger: deps.logger,
  }).incoming;
  const incomingUnitsByKey = new Map<string, number>();
  for (const [key, arrivals] of incoming) {
    incomingUnitsByKey.set(
      key,
      arrivals.reduce((sum, a) => sum + a.quantity, 0),
    );
  }

  const stockRows = deps.db
    .prepare(
      `SELECT warehouse_key AS warehouseKey,
              nm_id AS nmId,
              tech_size AS techSize,
              MAX(vendor_code) AS vendorCode,
              SUM(start_stock) AS startStock,
              MIN(stock_snapshot_at) AS stockSnapshotAt
         FROM wb_forecast_snapshots
        WHERE snapshot_date = ? AND horizon_days = ?
        GROUP BY warehouse_key, nm_id, tech_size`,
    )
    .all(snapshotDate, baseForecastHorizon) as Array<{
    warehouseKey: string;
    nmId: number;
    techSize: string;
    vendorCode: string | null;
    startStock: number;
    stockSnapshotAt: string | null;
  }>;
  const stockKeys = new Set<string>();
  const stockRowsWithIncoming = stockRows.map((row) => {
    const key = `${row.warehouseKey}\u0000${row.nmId}\u0000${row.techSize}`;
    stockKeys.add(key);
    return {
      ...row,
      incomingUnits: incomingUnitsByKey.get(key) ?? 0,
    };
  });
  for (const [key, incomingUnits] of incomingUnitsByKey) {
    if (stockKeys.has(key) || incomingUnits <= 0) continue;
    const [warehouseKey, nmIdRaw, techSize = ""] = key.split("\u0000");
    const nmId = Number(nmIdRaw);
    if (!warehouseKey || !Number.isInteger(nmId)) continue;
    stockRowsWithIncoming.push({
      warehouseKey,
      nmId,
      techSize,
      vendorCode: null,
      startStock: 0,
      incomingUnits,
      stockSnapshotAt: null,
    });
  }

  const demandRows = deps.db
    .prepare(
      `SELECT region_key AS regionKey,
              nm_id AS nmId,
              tech_size AS techSize,
              MAX(vendor_code) AS vendorCode,
              SUM(regional_forecast_daily_demand) AS regionalForecastDailyDemand
         FROM wb_region_demand_snapshots
        WHERE snapshot_date = ?
        GROUP BY region_key, nm_id, tech_size`,
    )
    .all(snapshotDate) as Array<{
    regionKey: string;
    nmId: number;
    techSize: string;
    vendorCode: string | null;
    regionalForecastDailyDemand: number;
  }>;

  const macroRepo = new WbRegionMacroRegionRepository(deps.db);
  const ownStockByVendor = new OwnStockSnapshotRepository(
    deps.db,
  ).quantitiesByVendorLatest(q.ownWarehouseCode);

  const report = buildRegionalStocksReport({
    snapshotDate,
    horizonDays: q.horizonDays,
    macroRegion: q.macroRegion,
    targetCoverageDays: q.targetCoverageDays,
    riskStockout: q.riskStockout,
    q: q.q,
    limit: q.limit,
    stockRows: stockRowsWithIncoming,
    demandRows,
    regionMacroLookup: buildRegionMacroLookup(macroRepo.getAll()),
    ownStockByVendor,
    ownWarehouseCode: q.ownWarehouseCode,
  });
  return { ok: true, report };
}
