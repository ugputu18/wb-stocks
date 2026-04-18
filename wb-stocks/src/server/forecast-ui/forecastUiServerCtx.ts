import type { AppConfig } from "../../config/env.js";
import type { Logger } from "../../logger.js";
import type { DbHandle } from "../../infra/db.js";
import type { WbStatsClient } from "../../infra/wbStatsClient.js";

export interface ForecastUiServerCtx {
  cfg: AppConfig;
  db: DbHandle;
  logger: Logger;
  wbClient: WbStatsClient;
}
