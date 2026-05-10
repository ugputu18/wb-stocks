import { toCsv } from "../../csv.js";
import type { ForecastReportFilter } from "../../../infra/wbForecastSnapshotRepository.js";
import { json } from "../http/json.js";
import { sendCsvAttachment } from "../http/sendCsvAttachment.js";
import { parseQuery, parseRegionalStocksQuery } from "../parse/forecastQuery.js";
import { parseRequiredTargetCoverageDays } from "../parse/exportQuery.js";
import { loadRegionalStocksReport } from "../queries/loadRegionalStocksReport.js";
import {
  forecastSupplierCsvFilename,
  forecastWbCsvFilename,
  REGIONAL_STOCKS_EXPORT_COLUMNS,
  regionalStocksCsvFilename,
  regionalStocksRowsToCsvObjects,
  supplierRowsToCsvObjects,
  SUPPLIER_EXPORT_COLUMNS,
  SYSTEM_TOTAL_EXPORT_COLUMNS,
  wbReportRowsToCsvObjects,
  WB_EXPORT_COLUMNS,
  wbTotalRowsToCsvObjects,
  WB_TOTAL_EXPORT_COLUMNS,
  systemTotalRowsToCsvObjects,
} from "../csv/forecastExportMappers.js";
import type { ForecastUiHandlerDeps } from "../types.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

export function createExportRoutes(deps: ForecastUiHandlerDeps): ForecastRouteMatch[] {
  const { forecastReportQuery } = deps;

  return [
    {
      match: (req, url) => req.method === "GET" && url.pathname === "/api/forecast/export-wb",
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
        const csv =
          q.viewMode === "wbWarehouses"
            ? toCsv(
                wbReportRowsToCsvObjects(
                  forecastReportQuery.listReportRows(
                    q.snapshotDate,
                    q.horizonDays,
                    filter,
                    undefined,
                  ),
                ),
                [...WB_EXPORT_COLUMNS],
              )
            : q.viewMode === "systemTotal"
              ? toCsv(
                  systemTotalRowsToCsvObjects(
                    forecastReportQuery.listSystemTotalBySkuReportRows(
                      q.snapshotDate,
                      q.horizonDays,
                      filter,
                      undefined,
                    ),
                  ),
                  [...SYSTEM_TOTAL_EXPORT_COLUMNS],
                )
              : toCsv(
                  wbTotalRowsToCsvObjects(
                    forecastReportQuery.listWbTotalBySkuReportRows(
                      q.snapshotDate,
                      q.horizonDays,
                      filter,
                      undefined,
                    ),
                  ),
                  [...WB_TOTAL_EXPORT_COLUMNS],
                );
        sendCsvAttachment(
          res,
          forecastWbCsvFilename(q.snapshotDate, q.horizonDays),
          csv,
        );
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && url.pathname === "/api/forecast/export-supplier",
      handle: (req, res, url) => {
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
        const csv = toCsv(
          supplierRowsToCsvObjects(supplierRows, tc),
          [...SUPPLIER_EXPORT_COLUMNS],
        );
        sendCsvAttachment(
          res,
          forecastSupplierCsvFilename(q.snapshotDate, q.horizonDays),
          csv,
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
        const filteredRows = outcome.report.rows.filter(
          (r) => r.recommendedOrderQty > 0,
        );
        const csv = toCsv(
          regionalStocksRowsToCsvObjects(filteredRows),
          [...REGIONAL_STOCKS_EXPORT_COLUMNS],
        );
        sendCsvAttachment(
          res,
          regionalStocksCsvFilename(
            outcome.report.snapshotDate,
            outcome.report.horizonDays,
            outcome.report.macroRegion,
          ),
          csv,
        );
      },
    },
  ];
}
