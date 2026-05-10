import { WbRegionDemandSnapshotRepository } from "../../../infra/wbRegionDemandSnapshotRepository.js";
import { WbRegionMacroRegionRepository } from "../../../infra/wbRegionMacroRegionRepository.js";
import { WbSupplyRepository } from "../../../infra/wbSupplyRepository.js";
import { buildRegionMacroLookup } from "../../../domain/wbRegionMacroRegion.js";
import { SUPPLY_STATUS_INCOMING_FOR_FORECAST } from "../../../domain/wbSupplyStatus.js";
import { buildRegionalStocksReport } from "../../../application/buildRegionalStocksReport.js";
import { selectIncomingSupplies } from "../../../application/selectIncomingSupplies.js";
import type { ForecastReportFilter } from "../../../infra/wbForecastSnapshotRepository.js";
import { json } from "../http/json.js";
import { readBody } from "../http/readBody.js";
import {
  parseQuery,
  parseRegionalStocksQuery,
  parseRowsLimit,
} from "../parse/forecastQuery.js";
import type { ForecastUiHandlerDeps } from "../types.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

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

function findBaseForecastHorizon(
  deps: ForecastUiHandlerDeps,
  snapshotDate: string,
): number | null {
  const row = deps.db
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

export function createForecastReadRoutes(deps: ForecastUiHandlerDeps): ForecastRouteMatch[] {
  const { forecastRepo, forecastReportQuery } = deps;

  return [
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/warehouse-keys",
      handle: (req, res, url) => {
        void req;
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const warehouseKeys = forecastRepo.distinctWarehouseKeys(
          q.snapshotDate,
          q.horizonDays,
        );
        json(res, 200, { warehouseKeys });
      },
    },
    {
      match: (req, url) => req.method === "GET" && url.pathname === "/api/forecast/rows",
      handle: (req, res, url) => {
        void req;
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const limit = parseRowsLimit(url);
        const filter: ForecastReportFilter = {
          warehouseKey: q.warehouseKey,
          q: q.q,
          techSize: q.techSize,
          riskStockout: q.riskStockout,
          replenishmentTargetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          supplierLeadTimeDays: q.supplierLeadTimeDays,
          supplierOrderCoverageDays: q.supplierOrderCoverageDays,
          supplierSafetyDays: q.supplierSafetyDays,
          viewMode: q.viewMode,
          systemTotalQuickFilter: q.systemTotalQuickFilter,
        };
        const rows =
          q.viewMode === "wbWarehouses"
            ? forecastReportQuery.listReportRows(
                q.snapshotDate,
                q.horizonDays,
                filter,
                limit,
              )
            : q.viewMode === "systemTotal"
              ? forecastReportQuery.listSystemTotalBySkuReportRows(
                  q.snapshotDate,
                  q.horizonDays,
                  filter,
                  limit,
                )
              : forecastReportQuery.listWbTotalBySkuReportRows(
                  q.snapshotDate,
                  q.horizonDays,
                  filter,
                  limit,
                );
        json(res, 200, {
          snapshotDate: q.snapshotDate,
          horizonDays: q.horizonDays,
          viewMode: q.viewMode,
          systemTotalQuickFilter: q.systemTotalQuickFilter,
          riskStockout: q.riskStockout,
          targetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          limit,
          rows,
        });
      },
    },
    {
      match: (req, url) => req.method === "GET" && url.pathname === "/api/forecast/summary",
      handle: (req, res, url) => {
        void req;
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const filter: ForecastReportFilter = {
          warehouseKey: q.warehouseKey,
          q: q.q,
          techSize: q.techSize,
          riskStockout: q.riskStockout,
          replenishmentTargetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          supplierLeadTimeDays: q.supplierLeadTimeDays,
          supplierOrderCoverageDays: q.supplierOrderCoverageDays,
          supplierSafetyDays: q.supplierSafetyDays,
          viewMode: q.viewMode,
          systemTotalQuickFilter: q.systemTotalQuickFilter,
        };
        const agg = forecastReportQuery.aggregateReportMetrics(
          q.snapshotDate,
          q.horizonDays,
          filter,
        );
        json(res, 200, {
          snapshotDate: q.snapshotDate,
          horizonDays: q.horizonDays,
          viewMode: q.viewMode,
          systemTotalQuickFilter: q.systemTotalQuickFilter,
          riskStockout: q.riskStockout,
          targetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          totalRows: agg.totalRows,
          risk: agg.risk,
          staleStockRowCount: agg.staleStockRowCount,
          oldestStockSnapshotAt: agg.oldestStockSnapshotAt,
          newestStockSnapshotAt: agg.newestStockSnapshotAt,
          replenishment: agg.replenishment,
          leadTimeDays: q.supplierLeadTimeDays,
          coverageDays: q.supplierOrderCoverageDays,
          safetyDays: q.supplierSafetyDays,
        });
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/supplier-replenishment",
      handle: (req, res, url) => {
        void req;
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const tc = q.replenishmentTargetCoverageDays;
        if (tc === undefined || !Number.isFinite(tc) || tc <= 0) {
          json(res, 400, {
            ok: false,
            error: "targetCoverageDays required (30 | 45 | 60)",
          });
          return;
        }
        const supplierFilter: ForecastReportFilter = {
          warehouseKey: q.warehouseKey,
          q: q.q,
          techSize: q.techSize,
          ownWarehouseCode: q.ownWarehouseCode,
          replenishmentMode: q.replenishmentMode,
          replenishmentTargetCoverageDays: tc,
          supplierLeadTimeDays: q.supplierLeadTimeDays,
          supplierOrderCoverageDays: q.supplierOrderCoverageDays,
          supplierSafetyDays: q.supplierSafetyDays,
          viewMode: q.viewMode,
        };
        const supplierRows = forecastReportQuery.listSupplierReplenishmentBySku(
          q.snapshotDate,
          q.horizonDays,
          supplierFilter,
          tc,
        );
        json(res, 200, {
          snapshotDate: q.snapshotDate,
          horizonDays: q.horizonDays,
          targetCoverageDays: tc,
          leadTimeDays: q.supplierLeadTimeDays,
          coverageDays: q.supplierOrderCoverageDays,
          safetyDays: q.supplierSafetyDays,
          ownWarehouseCode: q.ownWarehouseCode ?? "main",
          viewMode: q.viewMode,
          rows: supplierRows,
        });
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/regional-stocks",
      handle: (req, res, url) => {
        void req;
        const q = parseRegionalStocksQuery(url);
        if (!q.ok) {
          json(res, 400, { ok: false, error: q.error });
          return;
        }
        const baseForecastHorizon = findBaseForecastHorizon(deps, q.snapshotDate);
        if (baseForecastHorizon === null) {
          json(res, 404, {
            ok: false,
            error:
              "No base forecast snapshot found for snapshotDate (need one of horizonDays 30|60|90)",
          });
          return;
        }

        const supplyRepo = new WbSupplyRepository(deps.db);
        const supplies = supplyRepo.getSuppliesByStatuses(
          SUPPLY_STATUS_INCOMING_FOR_FORECAST,
        );
        const items = supplyRepo.getItemsForSupplyIds(
          supplies.map((s) => s.supplyId),
        );
        const incoming = selectIncomingSupplies({
          supplies,
          itemsBySupplyId: groupSupplyItemsBySupplyId(items),
          fromDate: q.snapshotDate,
          toDate: addDaysYmd(q.snapshotDate, q.horizonDays - 1),
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
          .all(q.snapshotDate, baseForecastHorizon) as Array<{
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
          .all(q.snapshotDate) as Array<{
          regionKey: string;
          nmId: number;
          techSize: string;
          vendorCode: string | null;
          regionalForecastDailyDemand: number;
        }>;

        const macroRepo = new WbRegionMacroRegionRepository(deps.db);
        const report = buildRegionalStocksReport({
          snapshotDate: q.snapshotDate,
          horizonDays: q.horizonDays,
          macroRegion: q.macroRegion,
          targetCoverageDays: q.targetCoverageDays,
          riskStockout: q.riskStockout,
          q: q.q,
          limit: q.limit,
          stockRows: stockRowsWithIncoming,
          demandRows,
          regionMacroLookup: buildRegionMacroLookup(macroRepo.getAll()),
        });
        json(res, 200, report);
      },
    },
    {
      match: (req, url) =>
        req.method === "POST" && url.pathname === "/api/forecast/regional-demand",
      handle: async (req, res, url) => {
        void url;
        const regionDemandRepo = new WbRegionDemandSnapshotRepository(deps.db);
        const macroRepo = new WbRegionMacroRegionRepository(deps.db);
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { ok: false, error: "Invalid JSON body" });
          return;
        }
        const b = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
        const snapshotDate = typeof b?.snapshotDate === "string" ? b.snapshotDate.trim() : "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
          json(res, 400, { ok: false, error: "snapshotDate (YYYY-MM-DD) required" });
          return;
        }
        const skusRaw = b?.skus;
        if (!Array.isArray(skusRaw) || skusRaw.length === 0) {
          json(res, 400, { ok: false, error: "skus: non-empty array required" });
          return;
        }
        const MAX_SKUS = 500;
        if (skusRaw.length > MAX_SKUS) {
          json(res, 400, {
            ok: false,
            error: `skus: at most ${MAX_SKUS} entries`,
          });
          return;
        }
        const skus: { nmId: number; techSize: string }[] = [];
        for (const item of skusRaw) {
          if (!item || typeof item !== "object") {
            json(res, 400, { ok: false, error: "skus: invalid entry" });
            return;
          }
          const o = item as Record<string, unknown>;
          const nmId = o.nmId;
          const techSize = o.techSize;
          if (typeof nmId !== "number" || !Number.isInteger(nmId)) {
            json(res, 400, { ok: false, error: "skus: nmId must be integer" });
            return;
          }
          if (techSize !== undefined && techSize !== null && typeof techSize !== "string") {
            json(res, 400, { ok: false, error: "skus: techSize must be string" });
            return;
          }
          skus.push({ nmId, techSize: typeof techSize === "string" ? techSize : "" });
        }
        const rows = regionDemandRepo.getForDateAndSkus(snapshotDate, skus);
        const regionMacroLookup = buildRegionMacroLookup(macroRepo.getAll());
        const regionMacroMap = Object.fromEntries(regionMacroLookup);
        json(res, 200, {
          snapshotDate,
          rows: rows.map((r) => ({
            regionKey: r.regionKey,
            regionNameRaw: r.regionNameRaw,
            nmId: r.nmId,
            techSize: r.techSize,
            regionalForecastDailyDemand: r.regionalForecastDailyDemand,
            units7: r.units7,
            units30: r.units30,
            units90: r.units90,
            avgDaily7: r.avgDaily7,
            avgDaily30: r.avgDaily30,
            avgDaily90: r.avgDaily90,
          })),
          regionMacroMap,
        });
      },
    },
  ];
}
