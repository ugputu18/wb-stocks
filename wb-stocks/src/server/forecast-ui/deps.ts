import { WbOrdersDailyRepository } from "../../infra/wbOrdersDailyRepository.js";
import { WbOrdersDailyByRegionRepository } from "../../infra/wbOrdersDailyByRegionRepository.js";
import { WbDemandSnapshotRepository } from "../../infra/wbDemandSnapshotRepository.js";
import { WbRegionDemandSnapshotRepository } from "../../infra/wbRegionDemandSnapshotRepository.js";
import { StockSnapshotRepository } from "../../infra/stockSnapshotRepository.js";
import { WbSupplyRepository } from "../../infra/wbSupplyRepository.js";
import { WbForecastSnapshotRepository } from "../../infra/wbForecastSnapshotRepository.js";
import type { ForecastUiServerCtx } from "./forecastUiServerCtx.js";
import type { ForecastUiHandlerDeps } from "./types.js";

/** Dependencies for `runSalesForecastMvp` (recalculate). */
export function buildMvpDeps(ctx: ForecastUiServerCtx) {
  const { db, wbClient, logger } = ctx;
  return {
    db,
    wbClient,
    ordersRepository: new WbOrdersDailyRepository(db),
    ordersByRegionRepository: new WbOrdersDailyByRegionRepository(db),
    demandRepository: new WbDemandSnapshotRepository(db),
    regionDemandRepository: new WbRegionDemandSnapshotRepository(db),
    stockRepository: new StockSnapshotRepository(db),
    supplyRepository: new WbSupplyRepository(db),
    forecastRepository: new WbForecastSnapshotRepository(db),
    logger,
  };
}

/** Single place to attach `forecastRepo` for API handlers (one instance per request, as before). */
export function buildForecastUiHandlerDeps(ctx: ForecastUiServerCtx): ForecastUiHandlerDeps {
  return {
    ...ctx,
    forecastRepo: new WbForecastSnapshotRepository(ctx.db),
  };
}
