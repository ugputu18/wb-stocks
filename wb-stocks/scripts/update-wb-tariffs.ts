import { parseArgs } from "node:util";
import { loadConfig } from "../src/config/env.js";
import { logger } from "../src/logger.js";
import { openDatabase } from "../src/infra/db.js";
import { WbCommonClient } from "../src/infra/wbCommonClient.js";
import { WbWarehouseTariffRepository } from "../src/infra/wbWarehouseTariffRepository.js";
import { importWbWarehouseTariffs } from "../src/application/importWbWarehouseTariffs.js";

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  tsx scripts/update-wb-tariffs.ts [--date=YYYY-MM-DD]",
      "                                   [--warehouses=507,117501]",
      "                                   [--skip-box] [--skip-pallet]",
      "                                   [--skip-acceptance] [--dry-run]",
      "",
      "Examples:",
      "  # default: today (UTC), all three endpoints, write to DB:",
      "  tsx scripts/update-wb-tariffs.ts",
      "",
      "  # explicit date (e.g. tomorrow, after WB published next-week tariffs):",
      "  tsx scripts/update-wb-tariffs.ts --date=2026-05-12",
      "",
      "  # only acceptance, restricted to specific warehouses:",
      "  tsx scripts/update-wb-tariffs.ts --skip-box --skip-pallet \\",
      "      --warehouses=507,117501",
      "",
      "  # dry-run (no DB writes):",
      "  tsx scripts/update-wb-tariffs.ts --dry-run",
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

function parseWarehouseIds(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid warehouse id: "${s}" (expected positive int)`);
      }
      return n;
    });
  return parts.length > 0 ? parts : undefined;
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        date: { type: "string" },
        warehouses: { type: "string" },
        "skip-box": { type: "boolean" },
        "skip-pallet": { type: "boolean" },
        "skip-acceptance": { type: "boolean" },
        "dry-run": { type: "boolean" },
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
    throw new Error("WB_TOKEN is required for WB warehouse tariffs update");
  }

  let tariffDate: string | undefined;
  let warehouseIds: number[] | undefined;
  try {
    tariffDate = normalizeYmd(parsed.values.date);
    warehouseIds = parseWarehouseIds(parsed.values.warehouses);
  } catch (err) {
    console.error((err as Error).message);
    printUsageAndExit();
  }

  const dryRun = parsed.values["dry-run"] === true;
  const skipBox = parsed.values["skip-box"] === true;
  const skipPallet = parsed.values["skip-pallet"] === true;
  const skipAcceptance = parsed.values["skip-acceptance"] === true;

  logger.info(
    {
      args: {
        date: parsed.values.date ?? null,
        warehouses: parsed.values.warehouses ?? null,
        skipBox,
        skipPallet,
        skipAcceptance,
        dryRun,
      },
    },
    "WB warehouse tariffs update: CLI invoked",
  );

  const wbClient = new WbCommonClient({
    baseUrl: cfg.WB_COMMON_BASE_URL,
    token: cfg.WB_TOKEN,
    logger,
  });

  const db = openDatabase(cfg.DATABASE_PATH);
  const repository = new WbWarehouseTariffRepository(db);

  try {
    const result = await importWbWarehouseTariffs(
      { wbClient, repository, logger },
      {
        tariffDate,
        warehouseIds,
        skipBox,
        skipPallet,
        skipAcceptance,
        dryRun,
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
    "WB warehouse tariffs update failed",
  );
  process.exitCode = 1;
});
