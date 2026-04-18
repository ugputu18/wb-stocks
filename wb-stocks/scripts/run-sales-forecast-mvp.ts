import { parseArgs } from "node:util";
import { loadConfig } from "../src/config/env.js";
import { logger } from "../src/logger.js";
import { openDatabase } from "../src/infra/db.js";
import { WbStatsClient } from "../src/infra/wbStatsClient.js";
import { WbOrdersDailyRepository } from "../src/infra/wbOrdersDailyRepository.js";
import { WbOrdersDailyByRegionRepository } from "../src/infra/wbOrdersDailyByRegionRepository.js";
import { WbDemandSnapshotRepository } from "../src/infra/wbDemandSnapshotRepository.js";
import { WbRegionDemandSnapshotRepository } from "../src/infra/wbRegionDemandSnapshotRepository.js";
import { StockSnapshotRepository } from "../src/infra/stockSnapshotRepository.js";
import { WbSupplyRepository } from "../src/infra/wbSupplyRepository.js";
import { WbForecastSnapshotRepository } from "../src/infra/wbForecastSnapshotRepository.js";
import { runSalesForecastMvp } from "../src/application/runSalesForecastMvp.js";

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  tsx scripts/run-sales-forecast-mvp.ts [--date=YYYY-MM-DD]",
      "                                        [--horizons=30,60,90]",
      "                                        [--dry-run]",
      "                                        [--sku=12345|VENDOR-CODE]",
      "                                        [--warehouse=Коледино]",
      "",
      "Notes:",
      "  - Always re-imports orders for [date-30, date-1] and recomputes the full demand snapshot for --date.",
      "  - --sku and --warehouse only narrow which wb_forecast_snapshots rows are deleted+re-inserted per horizon;",
      "    they do NOT limit orders import or demand snapshot (see ReadmeAI §12).",
      "",
      "Examples:",
      "  # default happy path: pull orders window, recompute demand, recompute 30/60/90 forecast:",
      "  tsx scripts/run-sales-forecast-mvp.ts",
      "",
      "  # specific date and horizons:",
      "  tsx scripts/run-sales-forecast-mvp.ts --date=2026-04-17 --horizons=30,60",
      "",
      "  # preview a single SKU/warehouse slice without persisting changes:",
      "  tsx scripts/run-sales-forecast-mvp.ts --dry-run --sku=SKU-1 --warehouse=Коледино",
    ].join("\n"),
  );
  process.exit(2);
}

function normalizeYmd(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new Error(`Expected YYYY-MM-DD, got "${t}"`);
  }
  return t;
}

function parseHorizons(raw: string | undefined): number[] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid horizon: "${s}" (expected positive integer)`);
      }
      return n;
    });
  if (parts.length === 0) {
    throw new Error("Expected at least one horizon");
  }
  return parts;
}

function normalizeOptional(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  return t === "" ? undefined : t;
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        date: { type: "string" },
        horizons: { type: "string" },
        "dry-run": { type: "boolean" },
        sku: { type: "string" },
        warehouse: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    console.error((err as Error).message);
    printUsageAndExit();
  }

  if (parsed.values.help) printUsageAndExit();

  const cfg = loadConfig();
  if (!cfg.WB_TOKEN) {
    throw new Error("WB_TOKEN is required for sales forecast CLI");
  }

  let snapshotDate: string | undefined;
  let horizons: number[] | undefined;
  let sku: string | undefined;
  let warehouse: string | undefined;
  try {
    snapshotDate = normalizeYmd(parsed.values.date);
    horizons = parseHorizons(parsed.values.horizons);
    sku = normalizeOptional(parsed.values.sku);
    warehouse = normalizeOptional(parsed.values.warehouse);
  } catch (err) {
    console.error((err as Error).message);
    printUsageAndExit();
  }

  const dryRun = parsed.values["dry-run"] === true;
  logger.info(
    {
      args: {
        date: snapshotDate ?? null,
        horizons: horizons ?? null,
        dryRun,
        sku: sku ?? null,
        warehouse: warehouse ?? null,
      },
    },
    "WB sales forecast CLI: invoked",
  );

  const db = openDatabase(cfg.DATABASE_PATH);
  try {
    const wbClient = new WbStatsClient({
      baseUrl: cfg.WB_STATS_BASE_URL,
      token: cfg.WB_TOKEN,
      logger,
    });
    const result = await runSalesForecastMvp(
      {
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
      },
      {
        snapshotDate,
        horizons,
        dryRun,
        sku,
        warehouse,
      },
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  logger.error(
    {
      err:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : err,
    },
    "WB sales forecast CLI failed",
  );
  process.exitCode = 1;
});
