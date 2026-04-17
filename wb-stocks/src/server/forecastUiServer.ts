import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logger.js";
import type { DbHandle } from "../infra/db.js";
import { WbStatsClient } from "../infra/wbStatsClient.js";
import { WbOrdersDailyRepository } from "../infra/wbOrdersDailyRepository.js";
import { WbDemandSnapshotRepository } from "../infra/wbDemandSnapshotRepository.js";
import { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import { WbSupplyRepository } from "../infra/wbSupplyRepository.js";
import { WbForecastSnapshotRepository } from "../infra/wbForecastSnapshotRepository.js";
import {
  runSalesForecastMvp,
  type RunSalesForecastMvpResult,
} from "../application/runSalesForecastMvp.js";
import type { ReplenishmentMode } from "../domain/multiLevelInventory.js";
import type {
  ForecastReportFilter,
  ForecastViewMode,
  RiskStockoutFilter,
  WbForecastSnapshotReportRow,
  WbTotalBySkuReportRow,
} from "../infra/wbForecastSnapshotRepository.js";
import type { SupplierSkuReplenishmentReadModel } from "../domain/multiLevelInventory.js";
import { toCsv } from "./csv.js";

const STATIC_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/forecast-ui",
);

export interface ForecastUiServerCtx {
  cfg: AppConfig;
  db: DbHandle;
  logger: Logger;
  wbClient: WbStatsClient;
}

function buildMvpDeps(ctx: ForecastUiServerCtx) {
  const { db, wbClient, logger } = ctx;
  return {
    db,
    wbClient,
    ordersRepository: new WbOrdersDailyRepository(db),
    demandRepository: new WbDemandSnapshotRepository(db),
    stockRepository: new StockSnapshotRepository(db),
    supplyRepository: new WbSupplyRepository(db),
    forecastRepository: new WbForecastSnapshotRepository(db),
    logger,
  };
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** All `GET/POST /api/*` require `Authorization: Bearer <FORECAST_UI_TOKEN>` when that env is set. */
function authOk(
  cfg: AppConfig,
  req: IncomingMessage,
  pathname: string,
): boolean {
  const token = cfg.FORECAST_UI_TOKEN;
  if (!token) return true;
  if (!pathname.startsWith("/api/")) return true;
  const h = req.headers.authorization;
  return h === `Bearer ${token}`;
}

const ROWS_LIMIT_DEFAULT = 500;
const ROWS_LIMIT_MIN = 50;
const ROWS_LIMIT_MAX = 2000;

const ALLOWED_TARGET_COVERAGE = new Set([30, 45, 60]);

const DEFAULT_SUPPLIER_LEAD_DAYS = 45;
const DEFAULT_SUPPLIER_ORDER_COVERAGE_DAYS = 90;
const DEFAULT_SUPPLIER_SAFETY_DAYS = 0;

function parseSupplierLeadTimeDays(url: URL): number {
  const raw = url.searchParams.get("leadTimeDays");
  if (raw === null || raw.trim() === "") return DEFAULT_SUPPLIER_LEAD_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) return DEFAULT_SUPPLIER_LEAD_DAYS;
  return n;
}

/** Покрытие после прихода (план заказа); не путать с `targetCoverageDays`. */
function parseSupplierOrderCoverageDays(url: URL): number {
  const raw = url.searchParams.get("coverageDays");
  if (raw === null || raw.trim() === "") return DEFAULT_SUPPLIER_ORDER_COVERAGE_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 730) return DEFAULT_SUPPLIER_ORDER_COVERAGE_DAYS;
  return n;
}

function parseSupplierSafetyDays(url: URL): number {
  const raw = url.searchParams.get("safetyDays");
  if (raw === null || raw.trim() === "") return DEFAULT_SUPPLIER_SAFETY_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 365) return DEFAULT_SUPPLIER_SAFETY_DAYS;
  return n;
}

function parseRiskStockout(raw: string | null): RiskStockoutFilter {
  const t = raw?.trim().toLowerCase() ?? "";
  if (t === "" || t === "all") return "all";
  if (t === "lt7" || t === "<7" || t === "under7") return "lt7";
  if (t === "lt14" || t === "<14" || t === "under14") return "lt14";
  if (t === "lt30" || t === "<30" || t === "under30") return "lt30";
  return "all";
}

function parseTargetCoverageDays(url: URL): number | undefined {
  const raw = url.searchParams.get("targetCoverageDays");
  if (raw === null || raw.trim() === "") return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || !ALLOWED_TARGET_COVERAGE.has(n)) return 30;
  return n;
}

function parseReplenishmentMode(url: URL): ReplenishmentMode {
  const raw = url.searchParams.get("replenishmentMode")?.trim().toLowerCase() ?? "";
  if (raw === "supplier") return "supplier";
  return "wb";
}

/** Default `wbTotal` — одна строка на SKU по сети WB. */
function parseViewMode(url: URL): ForecastViewMode {
  const raw = url.searchParams.get("viewMode")?.trim().toLowerCase() ?? "";
  if (raw === "wbwarehouses" || raw === "warehouses" || raw === "by-warehouse") {
    return "wbWarehouses";
  }
  return "wbTotal";
}

function parseOwnWarehouseCode(url: URL): string {
  const raw = url.searchParams.get("ownWarehouseCode")?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_OWN_WAREHOUSE_CODE;
}

const DEFAULT_OWN_WAREHOUSE_CODE = "main";

const CSV_UTF8_BOM = "\uFEFF";

/** Supplier export: `targetCoverageDays` must be present and valid (30 | 45 | 60). */
function parseRequiredTargetCoverageDays(url: URL): number | null {
  const raw = url.searchParams.get("targetCoverageDays");
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || !ALLOWED_TARGET_COVERAGE.has(n)) return null;
  return n;
}

const WB_EXPORT_COLUMNS = [
  "warehouse_key",
  "vendor_code",
  "nm_id",
  "tech_size",
  "local_available",
  "wb_available",
  "system_available",
  "forecast_daily_demand",
  "days_of_stock",
  "stockout_date",
  "recommended_to_wb",
  "risk_bucket",
] as const;

const WB_TOTAL_EXPORT_COLUMNS = [
  "risk_bucket",
  "vendor_code",
  "nm_id",
  "tech_size",
  "wb_available_total",
  "own_stock",
  "system_available",
  "days_of_stock_wb",
  "forecast_daily_demand_total",
  "recommended_to_wb",
  "recommended_from_supplier",
  "stockout_date_wb",
  "stock_snapshot_at_wb",
] as const;

const SUPPLIER_EXPORT_COLUMNS = [
  "vendor_code",
  "nm_id",
  "tech_size",
  "wb_available_total",
  "own_stock",
  "system_available",
  "target_coverage_days",
  "target_demand_system",
  "recommended_from_supplier",
  "lead_time_days",
  "order_coverage_days",
  "safety_days",
  "stock_at_arrival",
  "recommended_order_qty",
  "will_stockout_before_arrival",
  "days_until_stockout",
] as const;

function forecastWbCsvFilename(snapshotDate: string, horizonDays: number): string {
  return `wb-replenishment-${snapshotDate}-h${horizonDays}.csv`;
}

function forecastSupplierCsvFilename(snapshotDate: string, horizonDays: number): string {
  return `supplier-replenishment-${snapshotDate}-h${horizonDays}.csv`;
}

function wbTotalRowsToCsvObjects(
  rows: WbTotalBySkuReportRow[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    risk_bucket: row.risk,
    vendor_code: row.vendorCode ?? "",
    nm_id: row.nmId,
    tech_size: row.techSize,
    wb_available_total: row.wbAvailableTotal,
    own_stock: row.ownStock,
    system_available: row.inventoryLevels.systemAvailable,
    days_of_stock_wb: row.daysOfStockWB,
    forecast_daily_demand_total: row.forecastDailyDemandTotal,
    recommended_to_wb: row.replenishment?.recommendedToWB ?? "",
    recommended_from_supplier: row.recommendedFromSupplier,
    stockout_date_wb: row.stockoutDateWB ?? "",
    stock_snapshot_at_wb: row.stockSnapshotAtWB,
  }));
}

function wbReportRowsToCsvObjects(
  rows: WbForecastSnapshotReportRow[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    warehouse_key: row.warehouseKey,
    vendor_code: row.vendorCode ?? "",
    nm_id: row.nmId,
    tech_size: row.techSize,
    local_available: row.inventoryLevels.localAvailable,
    wb_available: row.inventoryLevels.wbAvailable,
    system_available: row.inventoryLevels.systemAvailable,
    forecast_daily_demand: row.forecastDailyDemand,
    days_of_stock: row.daysOfStock,
    stockout_date: row.stockoutDate ?? "",
    recommended_to_wb: row.replenishment?.recommendedToWB ?? "",
    risk_bucket: row.risk,
  }));
}

function supplierRowsToCsvObjects(
  rows: SupplierSkuReplenishmentReadModel[],
  targetCoverageDays: number,
): Record<string, unknown>[] {
  return rows.map((r) => ({
    vendor_code: r.vendorCode ?? "",
    nm_id: r.nmId,
    tech_size: r.techSize,
    wb_available_total: r.wbAvailableTotal,
    own_stock: r.ownStock,
    system_available: r.systemAvailable,
    target_coverage_days: targetCoverageDays,
    target_demand_system: r.targetDemandSystem,
    recommended_from_supplier: r.recommendedFromSupplier,
    lead_time_days: r.leadTimeDays,
    order_coverage_days: r.orderCoverageDays,
    safety_days: r.safetyDays,
    stock_at_arrival: r.stockAtArrival,
    recommended_order_qty: r.recommendedOrderQty,
    will_stockout_before_arrival: r.willStockoutBeforeArrival ? "true" : "false",
    days_until_stockout:
      r.daysUntilStockout === null || r.daysUntilStockout === undefined
        ? ""
        : r.daysUntilStockout,
  }));
}

function sendCsvAttachment(
  res: ServerResponse,
  filename: string,
  csvBody: string,
): void {
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(CSV_UTF8_BOM + csvBody, "utf8");
}

function parseQuery(url: URL): ForecastReportFilter & {
  snapshotDate: string;
  horizonDays: number;
} {
  const snapshotDate = url.searchParams.get("snapshotDate")?.trim() ?? "";
  const horizonRaw = url.searchParams.get("horizonDays");
  const horizonDays = horizonRaw ? Number(horizonRaw) : NaN;
  const warehouseKey = url.searchParams.get("warehouseKey");
  const q = url.searchParams.get("q");
  const riskStockout = parseRiskStockout(url.searchParams.get("riskStockout"));
  const replenishmentTargetCoverageDays = parseTargetCoverageDays(url);
  const replenishmentMode = parseReplenishmentMode(url);
  const ownWarehouseCode = parseOwnWarehouseCode(url);
  const supplierLeadTimeDays = parseSupplierLeadTimeDays(url);
  const supplierOrderCoverageDays = parseSupplierOrderCoverageDays(url);
  const supplierSafetyDays = parseSupplierSafetyDays(url);
  const viewMode = parseViewMode(url);
  return {
    snapshotDate,
    horizonDays,
    warehouseKey: warehouseKey?.trim() || null,
    q: q?.trim() || null,
    riskStockout,
    replenishmentTargetCoverageDays,
    replenishmentMode,
    ownWarehouseCode,
    supplierLeadTimeDays,
    supplierOrderCoverageDays,
    supplierSafetyDays,
    viewMode,
  };
}

function parseRowsLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return ROWS_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < ROWS_LIMIT_MIN) return ROWS_LIMIT_DEFAULT;
  return Math.min(n, ROWS_LIMIT_MAX);
}

function aggregateSkipped(
  result: RunSalesForecastMvpResult,
): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const f of result.forecasts) {
    for (const s of f.skipped) {
      m.set(s.reason, (m.get(s.reason) ?? 0) + s.count);
    }
  }
  return Array.from(m, ([reason, count]) => ({ reason, count }));
}

/**
 * Minimal static + JSON server for the internal forecast UI.
 * Bind `FORECAST_UI_HOST` (default 127.0.0.1) only unless you know what you're doing.
 */
export function startForecastUiServer(ctx: ForecastUiServerCtx): ReturnType<
  typeof createServer
> {
  const { cfg, logger } = ctx;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const pathname = url.pathname;
      if (!authOk(cfg, req, pathname)) {
        json(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      if (req.method === "GET" && pathname === "/") {
        const p = join(STATIC_DIR, "index.html");
        if (!existsSync(p)) {
          json(res, 500, { ok: false, error: "Missing public/forecast-ui/index.html" });
          return;
        }
        const html = readFileSync(p, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/static/")) {
        const name = pathname.slice("/static/".length);
        if (!name || name.includes("..")) {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        const p = resolve(STATIC_DIR, name);
        const rel = relative(STATIC_DIR, p);
        if (rel.startsWith("..") || rel === "") {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        if (!existsSync(p)) {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        const ext = name.split(".").pop();
        const ct =
          ext === "js"
            ? "text/javascript; charset=utf-8"
            : ext === "css"
              ? "text/css; charset=utf-8"
              : "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct });
        res.end(readFileSync(p));
        return;
      }

      if (req.method === "GET" && pathname === "/api/forecast/health") {
        json(res, 200, { ok: true, service: "wb-stocks-forecast-ui" });
        return;
      }

      const forecastRepo = new WbForecastSnapshotRepository(ctx.db);

      if (req.method === "GET" && pathname === "/api/forecast/warehouse-keys") {
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
        return;
      }

      if (req.method === "GET" && pathname === "/api/forecast/rows") {
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const limit = parseRowsLimit(url);
        const filter: ForecastReportFilter = {
          warehouseKey: q.warehouseKey,
          q: q.q,
          riskStockout: q.riskStockout,
          replenishmentTargetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          supplierLeadTimeDays: q.supplierLeadTimeDays,
          supplierOrderCoverageDays: q.supplierOrderCoverageDays,
          supplierSafetyDays: q.supplierSafetyDays,
          viewMode: q.viewMode,
        };
        const rows =
          q.viewMode === "wbWarehouses"
            ? forecastRepo.listReportRows(
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
          riskStockout: q.riskStockout,
          targetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          limit,
          rows,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/forecast/summary") {
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const filter: ForecastReportFilter = {
          warehouseKey: q.warehouseKey,
          q: q.q,
          riskStockout: q.riskStockout,
          replenishmentTargetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          supplierLeadTimeDays: q.supplierLeadTimeDays,
          supplierOrderCoverageDays: q.supplierOrderCoverageDays,
          supplierSafetyDays: q.supplierSafetyDays,
          viewMode: q.viewMode,
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
        return;
      }

      if (req.method === "GET" && pathname === "/api/forecast/supplier-replenishment") {
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
        return;
      }

      if (req.method === "GET" && pathname === "/api/forecast/export-wb") {
        const q = parseQuery(url);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.snapshotDate) || !Number.isInteger(q.horizonDays) || q.horizonDays <= 0) {
          json(res, 400, { ok: false, error: "snapshotDate and horizonDays required" });
          return;
        }
        const filter: ForecastReportFilter = {
          warehouseKey: q.warehouseKey,
          q: q.q,
          riskStockout: q.riskStockout,
          replenishmentTargetCoverageDays: q.replenishmentTargetCoverageDays,
          replenishmentMode: q.replenishmentMode,
          ownWarehouseCode: q.ownWarehouseCode,
          supplierLeadTimeDays: q.supplierLeadTimeDays,
          supplierOrderCoverageDays: q.supplierOrderCoverageDays,
          supplierSafetyDays: q.supplierSafetyDays,
          viewMode: q.viewMode,
        };
        const csv =
          q.viewMode === "wbWarehouses"
            ? toCsv(
                wbReportRowsToCsvObjects(
                  forecastRepo.listReportRows(
                    q.snapshotDate,
                    q.horizonDays,
                    filter,
                    undefined,
                  ),
                ),
                [...WB_EXPORT_COLUMNS],
              )
            : toCsv(
                wbTotalRowsToCsvObjects(
                  forecastRepo.listWbTotalBySkuReportRows(
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
        return;
      }

      if (req.method === "GET" && pathname === "/api/forecast/export-supplier") {
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
        const csv = toCsv(
          supplierRowsToCsvObjects(supplierRows, tc),
          [...SUPPLIER_EXPORT_COLUMNS],
        );
        sendCsvAttachment(
          res,
          forecastSupplierCsvFilename(q.snapshotDate, q.horizonDays),
          csv,
        );
        return;
      }

      if (req.method === "POST" && pathname === "/api/forecast/recalculate") {
        if (!cfg.WB_TOKEN) {
          json(res, 503, {
            ok: false,
            code: "WB_TOKEN_MISSING",
            error:
              "Не задан WB_TOKEN в окружении: без него нельзя вызвать WB Statistics API для импорта заказов и пересчёта.",
          });
          return;
        }
        const raw = await readBody(req);
        let body: Record<string, unknown> = {};
        if (raw.trim()) {
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            json(res, 400, { ok: false, error: "Invalid JSON body" });
            return;
          }
        }
        const snapshotDate =
          typeof body.snapshotDate === "string" ? body.snapshotDate : undefined;
        const horizons = Array.isArray(body.horizons)
          ? (body.horizons as unknown[]).filter(
              (x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0,
            )
          : undefined;
        const dryRun = body.dryRun === true;
        const sku =
          typeof body.sku === "string" && body.sku.trim() !== ""
            ? body.sku.trim()
            : undefined;
        const warehouse =
          typeof body.warehouse === "string" && body.warehouse.trim() !== ""
            ? body.warehouse.trim()
            : undefined;

        const result = await runSalesForecastMvp(buildMvpDeps(ctx), {
          snapshotDate,
          horizons,
          dryRun,
          sku,
          warehouse,
        });

        json(res, 200, {
          ok: true,
          result,
          skippedAggregate: aggregateSkipped(result),
        });
        return;
      }

      json(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      /* Do not log req.headers / body — may contain bearer tokens. */
      logger.error({ err }, "forecast UI server error");
      json(res, 500, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Внутренняя ошибка сервера прогноза",
      });
    }
  });

  server.listen(cfg.FORECAST_UI_PORT, cfg.FORECAST_UI_HOST, () => {
    logger.info(
      {
        host: cfg.FORECAST_UI_HOST,
        port: cfg.FORECAST_UI_PORT,
        static: STATIC_DIR,
      },
      "Forecast UI server listening",
    );
  });

  return server;
}
