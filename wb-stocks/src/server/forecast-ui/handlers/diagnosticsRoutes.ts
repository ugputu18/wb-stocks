import { WbRegionDemandSnapshotRepository } from "../../../infra/wbRegionDemandSnapshotRepository.js";
import { WbRegionMacroRegionRepository } from "../../../infra/wbRegionMacroRegionRepository.js";
import { WbApiError } from "../../../infra/wbStatsClient.js";
import { buildRegionalVsWarehouseSummary } from "../../../application/buildRegionalVsWarehouseSummary.js";
import { buildWarehouseRegionAudit } from "../../../application/warehouseRegionAudit.js";
import { buildRegionMacroLookup } from "../../../domain/wbRegionMacroRegion.js";
import { normalizeWbRegionName } from "../../../domain/wbRegionKey.js";
import {
  fetchWbOrderUnitsForWindow,
  extractRawOrderDiagnosticsFields,
} from "../../../application/fetchWbSupplierOrdersWindow.js";
import {
  aggregateOrderFlowByRegion,
  aggregateOrderFlowMacroMatrix,
} from "../../../application/orderFlowDiagnostics.js";
import { json } from "../http/json.js";
import { parseQuery } from "../parse/forecastQuery.js";
import {
  parseOptionalVendorCode,
  parseOrdersDiagnosticsDateRange,
  parseRawOrdersDiagnosticsLimit,
} from "../parse/diagnosticsQuery.js";
import type { ForecastUiHandlerDeps } from "../types.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

export function createDiagnosticsRoutes(deps: ForecastUiHandlerDeps): ForecastRouteMatch[] {
  const { cfg, logger, wbClient, forecastRepo } = deps;

  return [
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/warehouse-region-audit",
      handle: (req, res, url) => {
        void req;
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const raw = forecastRepo.aggregateWarehouseMetricsPerWarehouse(
          q.snapshotDate,
          q.horizonDays,
        );
        const audit = buildWarehouseRegionAudit(q.snapshotDate, q.horizonDays, raw);
        json(res, 200, audit);
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/regional-vs-warehouse-summary",
      handle: (req, res, url) => {
        void req;
        const q = parseQuery(url);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) ||
          ![30, 60, 90].includes(q.horizonDays)
        ) {
          json(res, 400, {
            ok: false,
            error: "snapshotDate (YYYY-MM-DD) and horizonDays (30|60|90) required",
          });
          return;
        }
        const regionDemandRepo = new WbRegionDemandSnapshotRepository(deps.db);
        const macroRepoRegional = new WbRegionMacroRegionRepository(deps.db);
        const regionalByRegion = regionDemandRepo.aggregateDemandByRegion(q.snapshotDate);
        const warehouseMetrics = forecastRepo
          .aggregateWarehouseMetricsPerWarehouse(q.snapshotDate, q.horizonDays)
          .map((w) => ({
            warehouseKey: w.warehouseKey,
            sumForecastDailyDemand: w.sumForecastDailyDemand,
          }));
        const regionMacroLookup = buildRegionMacroLookup(macroRepoRegional.getAll());
        const summary = buildRegionalVsWarehouseSummary({
          snapshotDate: q.snapshotDate,
          horizonDays: q.horizonDays,
          regionalByRegion,
          warehouseMetrics,
          regionMacroLookup,
        });
        json(res, 200, summary);
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/regional-demand-verify",
      handle: (req, res, url) => {
        void req;
        const snapshotDate = url.searchParams.get("snapshotDate")?.trim() ?? "";
        const nmIdRaw = url.searchParams.get("nmId");
        const techSizeRaw = url.searchParams.get("techSize");
        const techSize = techSizeRaw != null ? String(techSizeRaw) : "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
          json(res, 400, { ok: false, error: "snapshotDate (YYYY-MM-DD) required" });
          return;
        }
        const nmId =
          typeof nmIdRaw === "number"
            ? nmIdRaw
            : typeof nmIdRaw === "string"
              ? Number(nmIdRaw.trim())
              : NaN;
        if (!Number.isInteger(nmId)) {
          json(res, 400, { ok: false, error: "nmId (integer) required" });
          return;
        }
        const regionDemandRepo = new WbRegionDemandSnapshotRepository(deps.db);
        const rows = regionDemandRepo.getForDateNmTech(snapshotDate, nmId, techSize);
        json(res, 200, {
          snapshotDate,
          nmId,
          techSize,
          rows: rows.map((r) => ({
            regionKey: r.regionKey,
            regionNameRaw: r.regionNameRaw,
            regionalForecastDailyDemand: r.regionalForecastDailyDemand,
            units7: r.units7,
            units30: r.units30,
            avgDaily7: r.avgDaily7,
            avgDaily30: r.avgDaily30,
          })),
        });
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/raw-orders-diagnostics",
      handle: async (req, res, url) => {
        void req;
        if (!cfg.WB_TOKEN?.trim()) {
          json(res, 503, {
            ok: false,
            error:
              "WB_TOKEN not configured — cannot call WB Statistics API for raw orders",
          });
          return;
        }
        const dr = parseOrdersDiagnosticsDateRange(url);
        if (!dr.ok) {
          json(res, 400, { ok: false, error: dr.error });
          return;
        }
        const nmIdStr = url.searchParams.get("nmId")?.trim() ?? "";
        let nmId: number | undefined;
        if (nmIdStr !== "") {
          const n = Number(nmIdStr);
          if (!Number.isInteger(n)) {
            json(res, 400, { ok: false, error: "nmId must be an integer if set" });
            return;
          }
          nmId = n;
        }
        const vendorCodeFilter = url.searchParams.get("vendorCode")?.trim() ?? "";
        const regionNameFilter = url.searchParams.get("regionName")?.trim() ?? "";
        const limit = parseRawOrdersDiagnosticsLimit(url);
        try {
          const fetched = await fetchWbOrderUnitsForWindow(wbClient, logger, {
            dateFromYmd: dr.dateFrom,
            dateToYmd: dr.dateTo,
            apiDateFrom: dr.dateFrom,
            includeRaw: true,
            maxPages: 30,
            maxRawRows: 400_000,
          });
          const paired = fetched.paired ?? [];
          let rows = paired.map(({ raw, unit }) => {
            const ext = extractRawOrderDiagnosticsFields(raw);
            return {
              orderDate: unit.orderDate,
              lastChangeDate: unit.lastChangeDate,
              nmId: unit.nmId,
              vendorCode: unit.vendorCode,
              techSize: unit.techSize,
              regionNameRaw: unit.regionNameRaw,
              regionKey: unit.regionKey,
              oblastOkrugName: ext.oblastOkrugName,
              countryName: ext.countryName,
              warehouseNameRaw: unit.warehouseNameRaw,
              warehouseKey: unit.warehouseKey,
              isCancel: unit.isCancel,
              cancelDate: ext.cancelDate,
              orderType: ext.orderType,
              dateOriginal: ext.date,
              srid: unit.srid,
            };
          });
          if (nmId !== undefined) rows = rows.filter((r) => r.nmId === nmId);
          if (vendorCodeFilter !== "") {
            const v = vendorCodeFilter.toLowerCase();
            rows = rows.filter((r) => (r.vendorCode ?? "").toLowerCase() === v);
          }
          if (regionNameFilter !== "") {
            const needle = normalizeWbRegionName(regionNameFilter);
            rows = rows.filter(
              (r) =>
                r.regionKey.includes(needle) ||
                normalizeWbRegionName(r.regionNameRaw).includes(needle),
            );
          }
          const totalAfterFilter = rows.length;
          rows = rows.slice(0, limit);
          json(res, 200, {
            ok: true,
            readOnly: true,
            source: "wb_statistics_api_supplier_orders",
            dateFrom: dr.dateFrom,
            dateTo: dr.dateTo,
            meta: {
              fetchedRows: fetched.fetchedRows,
              validRowsInWindow: fetched.units.length,
              skippedRows: fetched.skippedRows,
              pages: fetched.pages,
              stoppedReason: fetched.stoppedReason,
              rowsReturned: rows.length,
              rowsMatchedAfterFilters: totalAfterFilter,
              limit,
            },
            rows,
          });
        } catch (e) {
          const msg =
            e instanceof WbApiError
              ? `${e.message}${e.body ? ` — ${e.body}` : ""}`
              : e instanceof Error
                ? e.message
                : String(e);
          json(res, 502, { ok: false, error: msg });
        }
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/order-flow-by-region",
      handle: async (req, res, url) => {
        void req;
        if (!cfg.WB_TOKEN?.trim()) {
          json(res, 503, {
            ok: false,
            error:
              "WB_TOKEN not configured — cannot call WB Statistics API for raw orders",
          });
          return;
        }
        const dr = parseOrdersDiagnosticsDateRange(url);
        if (!dr.ok) {
          json(res, 400, { ok: false, error: dr.error });
          return;
        }
        const nmIdStr = url.searchParams.get("nmId")?.trim() ?? "";
        let nmId: number | undefined;
        if (nmIdStr !== "") {
          const n = Number(nmIdStr);
          if (!Number.isInteger(n)) {
            json(res, 400, { ok: false, error: "nmId must be an integer if set" });
            return;
          }
          nmId = n;
        }
        const vendorCode = parseOptionalVendorCode(url);
        try {
          const fetched = await fetchWbOrderUnitsForWindow(wbClient, logger, {
            dateFromYmd: dr.dateFrom,
            dateToYmd: dr.dateTo,
            apiDateFrom: dr.dateFrom,
            includeRaw: false,
            maxPages: 30,
            maxRawRows: 400_000,
          });
          const rows = aggregateOrderFlowByRegion(fetched.units, {
            nmId,
            vendorCode,
          });
          json(res, 200, {
            ok: true,
            readOnly: true,
            source: "wb_statistics_api_supplier_orders",
            dateFrom: dr.dateFrom,
            dateTo: dr.dateTo,
            meta: {
              fetchedRows: fetched.fetchedRows,
              validRowsInWindow: fetched.units.length,
              skippedRows: fetched.skippedRows,
              pages: fetched.pages,
              stoppedReason: fetched.stoppedReason,
              rowCount: rows.length,
            },
            rows,
          });
        } catch (e) {
          const msg =
            e instanceof WbApiError
              ? `${e.message}${e.body ? ` — ${e.body}` : ""}`
              : e instanceof Error
                ? e.message
                : String(e);
          json(res, 502, { ok: false, error: msg });
        }
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/order-flow-macro-matrix",
      handle: async (req, res, url) => {
        void req;
        if (!cfg.WB_TOKEN?.trim()) {
          json(res, 503, {
            ok: false,
            error:
              "WB_TOKEN not configured — cannot call WB Statistics API for raw orders",
          });
          return;
        }
        const dr = parseOrdersDiagnosticsDateRange(url);
        if (!dr.ok) {
          json(res, 400, { ok: false, error: dr.error });
          return;
        }
        const nmIdStr = url.searchParams.get("nmId")?.trim() ?? "";
        let nmId: number | undefined;
        if (nmIdStr !== "") {
          const n = Number(nmIdStr);
          if (!Number.isInteger(n)) {
            json(res, 400, { ok: false, error: "nmId must be an integer if set" });
            return;
          }
          nmId = n;
        }
        const vendorCode = parseOptionalVendorCode(url);
        const macroRepo = new WbRegionMacroRegionRepository(deps.db);
        const regionMacroLookup = buildRegionMacroLookup(macroRepo.getAll());
        try {
          const fetched = await fetchWbOrderUnitsForWindow(wbClient, logger, {
            dateFromYmd: dr.dateFrom,
            dateToYmd: dr.dateTo,
            apiDateFrom: dr.dateFrom,
            includeRaw: false,
            maxPages: 30,
            maxRawRows: 400_000,
          });
          const rows = aggregateOrderFlowMacroMatrix(fetched.units, regionMacroLookup, {
            nmId,
            vendorCode,
          });
          json(res, 200, {
            ok: true,
            readOnly: true,
            source: "wb_statistics_api_supplier_orders",
            dateFrom: dr.dateFrom,
            dateTo: dr.dateTo,
            meta: {
              fetchedRows: fetched.fetchedRows,
              validRowsInWindow: fetched.units.length,
              skippedRows: fetched.skippedRows,
              pages: fetched.pages,
              stoppedReason: fetched.stoppedReason,
              rowCount: rows.length,
            },
            rows,
          });
        } catch (e) {
          const msg =
            e instanceof WbApiError
              ? `${e.message}${e.body ? ` — ${e.body}` : ""}`
              : e instanceof Error
                ? e.message
                : String(e);
          json(res, 502, { ok: false, error: msg });
        }
      },
    },
  ];
}
