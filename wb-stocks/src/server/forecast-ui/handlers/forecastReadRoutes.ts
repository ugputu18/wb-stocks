import { WbRegionDemandSnapshotRepository } from "../../../infra/wbRegionDemandSnapshotRepository.js";
import { WbRegionMacroRegionRepository } from "../../../infra/wbRegionMacroRegionRepository.js";
import { buildRegionMacroLookup } from "../../../domain/wbRegionMacroRegion.js";
import type { ForecastReportFilter } from "../../../infra/wbForecastSnapshotRepository.js";
import { json } from "../http/json.js";
import { readBody } from "../http/readBody.js";
import { parseQuery, parseRowsLimit } from "../parse/forecastQuery.js";
import type { ForecastUiHandlerDeps } from "../types.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

export function createForecastReadRoutes(deps: ForecastUiHandlerDeps): ForecastRouteMatch[] {
  const { forecastRepo } = deps;

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
            ? forecastRepo.listReportRows(
                q.snapshotDate,
                q.horizonDays,
                filter,
                limit,
              )
            : q.viewMode === "systemTotal"
              ? forecastRepo.listSystemTotalBySkuReportRows(
                  q.snapshotDate,
                  q.horizonDays,
                  filter,
                  limit,
                )
              : forecastRepo.listWbTotalBySkuReportRows(
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
        const agg = forecastRepo.aggregateReportMetrics(
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
        const supplierRows = forecastRepo.listSupplierReplenishmentBySku(
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
          })),
          regionMacroMap,
        });
      },
    },
  ];
}
