import { parseArgs } from "node:util";
import { loadConfig } from "../src/config/env.js";
import { openDatabase } from "../src/infra/db.js";
import { ProductQuantRepository } from "../src/infra/productQuantRepository.js";
import { importProductQuants } from "../src/application/importProductQuants.js";
import { logger } from "../src/logger.js";

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  tsx scripts/import-product-quants.ts [--file=path]",
      "",
      "Examples:",
      "  tsx scripts/import-product-quants.ts",
      "  tsx scripts/import-product-quants.ts --file=../store/kvants.csv",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
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

  const cfg = loadConfig();
  const db = openDatabase(cfg.DATABASE_PATH);
  try {
    const result = await importProductQuants(
      {
        repository: new ProductQuantRepository(db),
        logger,
      },
      {
        file: parsed.values.file,
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
    "Product quant import failed",
  );
  process.exitCode = 1;
});
