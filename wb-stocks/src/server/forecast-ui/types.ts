import type { DbHandle } from "../../infra/db.js";
import type { WbDemandSnapshotRepository } from "../../infra/wbDemandSnapshotRepository.js";
import type { WbOrdersDailyRepository } from "../../infra/wbOrdersDailyRepository.js";
import type { WbOrdersDailyByRegionRepository } from "../../infra/wbOrdersDailyByRegionRepository.js";
import type { WbRegionDemandSnapshotRepository } from "../../infra/wbRegionDemandSnapshotRepository.js";
import type { StockSnapshotRepository } from "../../infra/stockSnapshotRepository.js";
import type { WbSupplyRepository } from "../../infra/wbSupplyRepository.js";
import type {
  WbForecastReportQueryService,
  WbForecastSnapshotRepository,
} from "../../infra/wbForecastSnapshotRepository.js";
import type { Logger } from "../../logger.js";
import type { WbStatsClient } from "../../infra/wbStatsClient.js";
import type { ForecastUiServerCtx } from "./forecastUiServerCtx.js";

/** Dependencies for `runSalesForecastMvp` — явный тип, чтобы `.d.ts` не тянул внутренности `better-sqlite3` (TS4058). */
export interface ForecastMvpDeps {
  db: DbHandle;
  wbClient: WbStatsClient;
  logger: Logger;
  ordersRepository: WbOrdersDailyRepository;
  ordersByRegionRepository: WbOrdersDailyByRegionRepository;
  demandRepository: WbDemandSnapshotRepository;
  regionDemandRepository: WbRegionDemandSnapshotRepository;
  stockRepository: StockSnapshotRepository;
  supplyRepository: WbSupplyRepository;
  forecastRepository: WbForecastSnapshotRepository;
}

/** Per-request deps for `/api/forecast/*` after static + health (matches previous `forecastRepo` scope). */
export type ForecastUiHandlerDeps = ForecastUiServerCtx & {
  forecastRepo: WbForecastSnapshotRepository;
  forecastReportQuery: WbForecastReportQueryService;
};

export type { ForecastUiServerCtx };
