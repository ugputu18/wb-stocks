import { parseArgs } from "node:util";
import { loadConfig } from "../src/config/env.js";
import { logger } from "../src/logger.js";
import { openDatabase } from "../src/infra/db.js";
import { OwnStockSnapshotRepository } from "../src/infra/ownStockSnapshotRepository.js";
import { importOwnWarehouseState } from "../src/application/importOwnWarehouseState.js";

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  tsx scripts/import-own-warehouse-state.ts [--date=YYYY-MM-DD] [--warehouse=code] [--file=path]",
      "",
      "Examples:",
      "  # today, default warehouse, auto-resolved CSV (../store/our<MMDD>.csv):",
      "  tsx scripts/import-own-warehouse-state.ts",
      "",
      "  # explicit date:",
      "  tsx scripts/import-own-warehouse-state.ts --date=2026-04-18",
      "",
      "  # explicit file and warehouse:",
      "  tsx scripts/import-own-warehouse-state.ts --date=2026-04-18 --warehouse=main --file=../store/our0418.csv",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        date: { type: "string" },
        warehouse: { type: "string" },
        file: { type: "string" },
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

  // Env is loaded via `node --env-file=.env` in the pnpm script; not needed here.
  // Still call loadConfig so DATABASE_PATH and LOG_LEVEL are validated.
  const cfg = loadConfig();

  const db = openDatabase(cfg.DATABASE_PATH);
  const repository = new OwnStockSnapshotRepository(db);

  logger.info(
    {
      args: {
        date: parsed.values.date ?? null,
        warehouse: parsed.values.warehouse ?? null,
        file: parsed.values.file ?? null,
      },
    },
    "Own warehouse import: CLI invoked",
  );

  try {
    const result = await importOwnWarehouseState(
      { repository, logger },
      {
        date: parsed.values.date,
        warehouseCode: parsed.values.warehouse,
        file: parsed.values.file,
        conventionBaseDir: "../store",
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
    "Own warehouse import failed",
  );
  process.exitCode = 1;
});
