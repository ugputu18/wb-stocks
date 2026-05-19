import { WbOrdersDailyRepository } from "../../infra/wbOrdersDailyRepository.js";
import { WbOrdersDailyByRegionRepository } from "../../infra/wbOrdersDailyByRegionRepository.js";
import { WbDemandSnapshotRepository } from "../../infra/wbDemandSnapshotRepository.js";
import { WbRegionDemandSnapshotRepository } from "../../infra/wbRegionDemandSnapshotRepository.js";
import { StockSnapshotRepository } from "../../infra/stockSnapshotRepository.js";
import { OwnStockSnapshotRepository } from "../../infra/ownStockSnapshotRepository.js";
import { WbSupplyRepository } from "../../infra/wbSupplyRepository.js";
import {
  WbForecastReportQueryService,
  WbForecastSnapshotRepository,
} from "../../infra/wbForecastSnapshotRepository.js";
import {
  buildOpticoreReportsUrl,
  OpticoreReportsClient,
} from "../../infra/opticoreReportsClient.js";
import type { ForecastUiServerCtx } from "./forecastUiServerCtx.js";
import type { ForecastMvpDeps, ForecastUiHandlerDeps } from "./types.js";

function splitCsvList(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

/** Dependencies for `runSalesForecastMvp` (recalculate). */
export function buildMvpDeps(ctx: ForecastUiServerCtx): ForecastMvpDeps {
  const { db, wbClient, logger } = ctx;
  const opticoreReportsUrl =
    ctx.cfg.OPTICORE_REPORTS_URL || ctx.cfg.OPTICORE_BASE_URL
      ? buildOpticoreReportsUrl({
          endpoint: ctx.cfg.OPTICORE_REPORTS_URL,
          baseUrl: ctx.cfg.OPTICORE_BASE_URL,
        })
      : undefined;
  return {
    db,
    wbClient,
    ordersRepository: new WbOrdersDailyRepository(db),
    ordersByRegionRepository: new WbOrdersDailyByRegionRepository(db),
    demandRepository: new WbDemandSnapshotRepository(db),
    regionDemandRepository: new WbRegionDemandSnapshotRepository(db),
    stockRepository: new StockSnapshotRepository(db),
    ownStockRepository: new OwnStockSnapshotRepository(db),
    supplyRepository: new WbSupplyRepository(db),
    forecastRepository: new WbForecastSnapshotRepository(db),
    opticoreClient:
      ctx.cfg.OPTICORE_STOCK_REFRESH_ENABLED &&
      ctx.cfg.OPTICORE_USER &&
      ctx.cfg.OPTICORE_PASSWORD &&
      opticoreReportsUrl
        ? new OpticoreReportsClient({
            reportsUrl: opticoreReportsUrl,
            user: ctx.cfg.OPTICORE_USER,
            password: ctx.cfg.OPTICORE_PASSWORD,
            httpUser: ctx.cfg.OPTICORE_HTTP_USER ?? ctx.cfg.OPTICORE_USER,
            httpPassword: ctx.cfg.OPTICORE_HTTP_PASSWORD ?? ctx.cfg.OPTICORE_PASSWORD,
            timeoutMs: ctx.cfg.OPTICORE_TIMEOUT_MS,
            logger,
          })
        : undefined,
    opticoreStockOptions: {
      warehouseCode: ctx.cfg.OPTICORE_OWN_WAREHOUSE_CODE,
      opticoreWarehouseIds: splitCsvList(ctx.cfg.OPTICORE_WAREHOUSE_IDS),
      stockTypeIds: splitCsvList(ctx.cfg.OPTICORE_STOCK_TYPE_IDS),
      vendorCodeSource: ctx.cfg.OPTICORE_VENDOR_CODE_SOURCE,
      skuVendorMapFile: ctx.cfg.OPTICORE_SKU_VENDOR_MAP_FILE,
    },
    opticoreStockFailureMode: ctx.cfg.OPTICORE_STOCK_FAILURE_MODE,
    logger,
  };
}

/** Single place to attach `forecastRepo` for API handlers (one instance per request, as before). */
export function buildForecastUiHandlerDeps(ctx: ForecastUiServerCtx): ForecastUiHandlerDeps {
  const forecastRepo = new WbForecastSnapshotRepository(ctx.db);
  return {
    ...ctx,
    forecastRepo,
    forecastReportQuery: new WbForecastReportQueryService(ctx.db, forecastRepo),
  };
}
