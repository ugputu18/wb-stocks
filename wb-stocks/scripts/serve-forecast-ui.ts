import { loadConfig } from "../src/config/env.js";
import { logger } from "../src/logger.js";
import { openDatabase } from "../src/infra/db.js";
import { WbStatsClient } from "../src/infra/wbStatsClient.js";
import { startForecastUiServer } from "../src/server/forecastUiServer.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDatabase(cfg.DATABASE_PATH);
  const wbClient = new WbStatsClient({
    baseUrl: cfg.WB_STATS_BASE_URL,
    token: cfg.WB_TOKEN ?? "",
    logger,
  });

  const server = startForecastUiServer({
    cfg,
    db,
    logger,
    wbClient,
  });

  const shutdown = (): void => {
    server.close(() => {
      db.close();
      logger.info("Forecast UI server shut down");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error(
    {
      err:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : err,
    },
    "Forecast UI server failed",
  );
  process.exitCode = 1;
});
