import { WbRegionDemandSnapshotRepository } from "../../../infra/wbRegionDemandSnapshotRepository.js";
import { WbRegionMacroRegionRepository } from "../../../infra/wbRegionMacroRegionRepository.js";
import { WbWarehouseTariffRepository } from "../../../infra/wbWarehouseTariffRepository.js";
import { buildRegionMacroLookup } from "../../../domain/wbRegionMacroRegion.js";
import { warehouseKey as toWarehouseKey } from "../../../domain/warehouseName.js";
import type { ForecastReportFilter } from "../../../infra/wbForecastSnapshotRepository.js";
import { json } from "../http/json.js";
import { readBody } from "../http/readBody.js";
import {
  parseQuery,
  parseRegionalStocksQuery,
  parseRowsLimit,
} from "../parse/forecastQuery.js";
import {
  loadRegionalStocksReport,
  resolveLatestForecastSnapshotDate,
} from "../queries/loadRegionalStocksReport.js";
import type { ForecastUiHandlerDeps } from "../types.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

function resolveForecastSnapshotDate(
  deps: ForecastUiHandlerDeps,
  snapshotDateRaw: string,
  horizonDays: number,
): { ok: true; snapshotDate: string } | { ok: false; status: number; error: string } {
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) {
    return { ok: false, status: 400, error: "horizonDays required" };
  }
  if (snapshotDateRaw !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDateRaw)) {
      return { ok: false, status: 400, error: "snapshotDate must be YYYY-MM-DD" };
    }
    return { ok: true, snapshotDate: snapshotDateRaw };
  }
  const latest = resolveLatestForecastSnapshotDate(deps.db, horizonDays);
  if (latest === null) {
    return {
      ok: false,
      status: 404,
      error:
        "No forecast snapshots found in DB for requested horizon (run sales forecast MVP first)",
    };
  }
  return { ok: true, snapshotDate: latest };
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
        const resolved = resolveForecastSnapshotDate(deps, q.snapshotDate, q.horizonDays);
        if (!resolved.ok) {
          json(res, resolved.status, { ok: false, error: resolved.error });
          return;
        }
        const warehouseKeys = forecastRepo.distinctWarehouseKeys(
          resolved.snapshotDate,
          q.horizonDays,
        );
        json(res, 200, {
          snapshotDate: resolved.snapshotDate,
          horizonDays: q.horizonDays,
          warehouseKeys,
        });
      },
    },
    {
      match: (req, url) => req.method === "GET" && url.pathname === "/api/forecast/rows",
      handle: (req, res, url) => {
        void req;
        const q = parseQuery(url);
        const resolved = resolveForecastSnapshotDate(deps, q.snapshotDate, q.horizonDays);
        if (!resolved.ok) {
          json(res, resolved.status, { ok: false, error: resolved.error });
          return;
        }
        const snapshotDate = resolved.snapshotDate;
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
                snapshotDate,
                q.horizonDays,
                filter,
                limit,
              )
            : q.viewMode === "systemTotal"
              ? forecastReportQuery.listSystemTotalBySkuReportRows(
                  snapshotDate,
                  q.horizonDays,
                  filter,
                  limit,
                )
              : forecastReportQuery.listWbTotalBySkuReportRows(
                  snapshotDate,
                  q.horizonDays,
                  filter,
                  limit,
                );
        json(res, 200, {
          snapshotDate,
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
        const resolved = resolveForecastSnapshotDate(deps, q.snapshotDate, q.horizonDays);
        if (!resolved.ok) {
          json(res, resolved.status, { ok: false, error: resolved.error });
          return;
        }
        const snapshotDate = resolved.snapshotDate;
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
          snapshotDate,
          q.horizonDays,
          filter,
        );
        json(res, 200, {
          snapshotDate,
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
        if (!Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "horizonDays required" });
          return;
        }
        const resolved = resolveForecastSnapshotDate(deps, q.snapshotDate, q.horizonDays);
        if (!resolved.ok) {
          json(res, resolved.status, { ok: false, error: resolved.error });
          return;
        }
        const snapshotDate = resolved.snapshotDate;
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
          snapshotDate,
          q.horizonDays,
          supplierFilter,
          tc,
        );
        json(res, 200, {
          snapshotDate,
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
        req.method === "GET" && url.pathname === "/api/forecast/warehouse-tariffs",
      handle: (req, res, url) => {
        void req;
        void url;
        // Справочные данные: для UI «Запасы WB по региону» нужна только
        // базовая стоимость доставки за коробку минимального объёма
        // (`boxDeliveryBase` ≈ ₽ за 1 литр FBO). Дата тарифов резолвится
        // сервером как MAX(tariff_date) — оператор не выбирает её руками.
        const tariffRepo = new WbWarehouseTariffRepository(deps.db);
        const tariffDate = tariffRepo.getLatestBoxTariffDate();
        if (tariffDate === null) {
          json(res, 200, { tariffDate: null, tariffs: [] });
          return;
        }
        const rows = tariffRepo.getBoxForDate(tariffDate);
        json(res, 200, {
          tariffDate,
          tariffs: rows.map((r) => ({
            warehouseKey: toWarehouseKey(r.warehouseName),
            warehouseName: r.warehouseName,
            geoName: r.geoName,
            boxDeliveryBase: r.boxDeliveryBase,
            boxDeliveryLiter: r.boxDeliveryLiter,
          })),
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
        const outcome = loadRegionalStocksReport(
          { db: deps.db, logger: deps.logger },
          q,
        );
        if (!outcome.ok) {
          json(res, outcome.status, { ok: false, error: outcome.error });
          return;
        }
        json(res, 200, outcome.report);
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
        const snapshotDateRaw =
          typeof b?.snapshotDate === "string" ? b.snapshotDate.trim() : "";
        const snapshotDate =
          snapshotDateRaw !== ""
            ? snapshotDateRaw
            : resolveLatestForecastSnapshotDate(deps.db);
        if (snapshotDate === null) {
          json(res, 404, {
            ok: false,
            error: "No forecast snapshots found in DB (run sales forecast MVP first)",
          });
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
          json(res, 400, { ok: false, error: "snapshotDate must be YYYY-MM-DD" });
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
