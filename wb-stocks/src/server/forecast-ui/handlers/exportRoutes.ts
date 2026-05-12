import { toXlsxBuffer } from "../../xlsx.js";
import type { ForecastReportFilter } from "../../../infra/wbForecastSnapshotRepository.js";
import { json } from "../http/json.js";
import { sendXlsxAttachment } from "../http/sendXlsxAttachment.js";
import { parseQuery, parseRegionalStocksQuery } from "../parse/forecastQuery.js";
import { parseRequiredTargetCoverageDays } from "../parse/exportQuery.js";
import { loadRegionalStocksReport } from "../queries/loadRegionalStocksReport.js";
import {
  forecastSupplierXlsxFilename,
  forecastWbXlsxFilename,
  REGIONAL_STOCKS_EXPORT_COLUMNS,
  regionalStocksXlsxFilename,
  regionalStocksRowsToExportObjects,
  supplierRowsToExportObjects,
  SUPPLIER_EXPORT_COLUMNS,
  SYSTEM_TOTAL_EXPORT_COLUMNS,
  wbReportRowsToExportObjects,
  WB_EXPORT_COLUMNS,
  wbTotalRowsToExportObjects,
  WB_TOTAL_EXPORT_COLUMNS,
  systemTotalRowsToExportObjects,
} from "../export/forecastExportMappers.js";
import type { ForecastUiHandlerDeps } from "../types.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

/**
 * Экспорт прогнозных отчётов в XLSX.
 *
 * Ранее тут отдавали CSV, но из-за локалезависимого парсинга чисел и
 * длинных `nm_id` оператор каждый раз чинил формат руками в Excel.
 * `toXlsxBuffer` сохраняет JS-`number` как настоящие числовые ячейки,
 * поэтому открытие в любой локали выглядит одинаково.
 */
export function createExportRoutes(deps: ForecastUiHandlerDeps): ForecastRouteMatch[] {
  const { forecastReportQuery } = deps;

  return [
    {
      match: (req, url) => req.method === "GET" && url.pathname === "/api/forecast/export-wb",
      handle: async (req, res, url) => {
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
        const buffer =
          q.viewMode === "wbWarehouses"
            ? await toXlsxBuffer(
                wbReportRowsToExportObjects(
                  forecastReportQuery.listReportRows(
                    q.snapshotDate,
                    q.horizonDays,
                    filter,
                    undefined,
                  ),
                ),
                [...WB_EXPORT_COLUMNS],
                { sheetName: "WB replenishment" },
              )
            : q.viewMode === "systemTotal"
              ? await toXlsxBuffer(
                  systemTotalRowsToExportObjects(
                    forecastReportQuery.listSystemTotalBySkuReportRows(
                      q.snapshotDate,
                      q.horizonDays,
                      filter,
                      undefined,
                    ),
                  ),
                  [...SYSTEM_TOTAL_EXPORT_COLUMNS],
                  { sheetName: "System total" },
                )
              : await toXlsxBuffer(
                  wbTotalRowsToExportObjects(
                    forecastReportQuery.listWbTotalBySkuReportRows(
                      q.snapshotDate,
                      q.horizonDays,
                      filter,
                      undefined,
                    ),
                  ),
                  [...WB_TOTAL_EXPORT_COLUMNS],
                  { sheetName: "WB total" },
                );
        sendXlsxAttachment(
          res,
          forecastWbXlsxFilename(q.snapshotDate, q.horizonDays),
          buffer,
        );
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/export-supplier",
      handle: async (req, res, url) => {
        void req;
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const tc = parseRequiredTargetCoverageDays(url);
        if (tc === null) {
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
        const buffer = await toXlsxBuffer(
          supplierRowsToExportObjects(supplierRows, tc),
          [...SUPPLIER_EXPORT_COLUMNS],
          { sheetName: "Supplier" },
        );
        sendXlsxAttachment(
          res,
          forecastSupplierXlsxFilename(q.snapshotDate, q.horizonDays),
          buffer,
        );
      },
    },
    {
      // Только позиции с ненулевым «Заказ» (recommendedOrderQty > 0):
      // экспорт оптимизирован под кейс "что заказать с производства / у поставщика
      // под выбранный регион".
      match: (req, url) =>
        req.method === "GET" &&
        url.pathname === "/api/forecast/export-regional-stocks",
      handle: async (req, res, url) => {
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
        const filteredRows = outcome.report.rows.filter(
          (r) => r.recommendedOrderQty > 0,
        );
        const buffer = await toXlsxBuffer(
          regionalStocksRowsToExportObjects(filteredRows),
          [...REGIONAL_STOCKS_EXPORT_COLUMNS],
          { sheetName: "Regional stocks" },
        );
        sendXlsxAttachment(
          res,
          regionalStocksXlsxFilename(
            outcome.report.snapshotDate,
            outcome.report.horizonDays,
            outcome.report.macroRegion,
          ),
          buffer,
        );
      },
    },
  ];
}
