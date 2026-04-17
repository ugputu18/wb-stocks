import { loadConfig } from "../config/env.js";
import { logger } from "../logger.js";
import { WbStatsClient } from "../infra/wbStatsClient.js";
import { openDatabase } from "../infra/db.js";
import { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import { importWbStocks } from "../application/importWbStocks.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.WB_TOKEN) {
    throw new Error("WB_TOKEN is required for WB stocks import");
  }

  const wbClient = new WbStatsClient({
    baseUrl: cfg.WB_STATS_BASE_URL,
    token: cfg.WB_TOKEN,
    logger,
  });

  const db = openDatabase(cfg.DATABASE_PATH);
  const repository = new StockSnapshotRepository(db);

  try {
    const result = await importWbStocks({ wbClient, repository, logger });
    logger.info(result, "WB stocks import finished");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  logger.error(
    { err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err },
    "WB stocks import failed",
  );
  process.exitCode = 1;
});
