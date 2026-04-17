import { parseArgs } from "node:util";
import { loadConfig } from "../src/config/env.js";
import { logger } from "../src/logger.js";
import { openDatabase } from "../src/infra/db.js";
import { WbSuppliesClient } from "../src/infra/wbSuppliesClient.js";
import { WbSupplyRepository } from "../src/infra/wbSupplyRepository.js";
import { importWbSupplies } from "../src/application/importWbSupplies.js";

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  tsx scripts/update-wb-supplies.ts [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]",
      "                                    [--status=1,2,5] [--no-details]",
      "                                    [--no-items] [--dry-run]",
      "",
      "Examples:",
      "  # default lookback (last 30 days), full enrichment:",
      "  tsx scripts/update-wb-supplies.ts",
      "",
      "  # explicit start date:",
      "  tsx scripts/update-wb-supplies.ts --from=2026-04-01",
      "",
      "  # only currently-arriving / accepted supplies:",
      "  tsx scripts/update-wb-supplies.ts --status=4,5,6",
      "",
      "  # fetch fast (no per-supply enrichment):",
      "  tsx scripts/update-wb-supplies.ts --no-details --no-items",
      "",
      "  # dry-run (no DB writes):",
      "  tsx scripts/update-wb-supplies.ts --from=2026-04-01 --dry-run",
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

function parseStatusList(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 1 || n > 6) {
        throw new Error(`Invalid status id: "${s}" (expected 1..6)`);
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
        from: { type: "string" },
        to: { type: "string" },
        status: { type: "string" },
        "no-details": { type: "boolean" },
        "no-items": { type: "boolean" },
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
    throw new Error("WB_TOKEN is required for WB supplies update");
  }

  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let statusIds: number[] | undefined;
  try {
    dateFrom = normalizeYmd(parsed.values.from);
    dateTo = normalizeYmd(parsed.values.to);
    statusIds = parseStatusList(parsed.values.status);
  } catch (err) {
    console.error((err as Error).message);
    printUsageAndExit();
  }

  const dryRun = parsed.values["dry-run"] === true;
  const withDetails = parsed.values["no-details"] !== true;
  const withItems = parsed.values["no-items"] !== true;

  logger.info(
    {
      args: {
        from: parsed.values.from ?? null,
        to: parsed.values.to ?? null,
        status: parsed.values.status ?? null,
        withDetails,
        withItems,
        dryRun,
      },
    },
    "WB supplies update: CLI invoked",
  );

  const wbClient = new WbSuppliesClient({
    baseUrl: cfg.WB_SUPPLIES_BASE_URL,
    token: cfg.WB_TOKEN,
    logger,
  });

  const db = openDatabase(cfg.DATABASE_PATH);
  const repository = new WbSupplyRepository(db);

  try {
    const result = await importWbSupplies(
      { wbClient, repository, logger },
      {
        dateFrom,
        dateTo,
        statusIds,
        withDetails,
        withItems,
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
    "WB supplies update failed",
  );
  process.exitCode = 1;
});
