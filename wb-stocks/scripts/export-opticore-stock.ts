import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  buildOpticoreReportsUrl,
  OpticoreReportsClient,
  type OpticoreStockRow,
} from "../src/infra/opticoreReportsClient.js";

type OutputFormat = "csv" | "json";

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  tsx scripts/export-opticore-stock.ts [--endpoint=url|--base-url=url] [--out=path] [--format=csv|json]",
      "",
      "Environment:",
      "  OPTICORE_USER              integration User tag",
      "  OPTICORE_PASSWORD          raw integration password used for md5(password|YYYY-MM-DD)",
      "  OPTICORE_HTTP_USER         optional HTTP Basic user; defaults to OPTICORE_USER",
      "  OPTICORE_HTTP_PASSWORD     optional HTTP Basic password; defaults to OPTICORE_PASSWORD",
      "  OPTICORE_REPORTS_URL       optional full reports.asmx URL",
      "  OPTICORE_BASE_URL          optional base URL; reports.asmx is appended",
      "",
      "Examples:",
      "  tsx scripts/export-opticore-stock.ts --base-url=http://api.cdek.opticore.biz:33333 --out=../store/opticore-stock.csv",
      "  tsx scripts/export-opticore-stock.ts --endpoint=http://host:33333/reports.asmx --format=json",
    ].join("\n"),
  );
  process.exit(2);
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function toCsv(actualAt: string, rows: readonly OpticoreStockRow[]): string {
  const header = ["actual_at", "warehouse_id", "sku_id", "unit_id", "stock_type_id", "qty"];
  const lines = rows.map((row) =>
    [
      actualAt,
      row.warehouseId,
      row.skuId,
      row.unitId,
      row.stockTypeId,
      String(row.qty),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        endpoint: { type: "string" },
        "base-url": { type: "string" },
        out: { type: "string" },
        format: { type: "string" },
        date: { type: "string" },
        "timeout-ms": { type: "string" },
        "no-basic": { type: "boolean" },
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

  const format = (parsed.values.format ?? "csv") as OutputFormat;
  if (format !== "csv" && format !== "json") throw new Error("--format must be csv or json");

  const timeoutMs = Number(parsed.values["timeout-ms"] ?? 30_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be positive");

  const user = requiredEnv("OPTICORE_USER");
  const rawPassword = requiredEnv("OPTICORE_PASSWORD");
  const reportsUrl = buildOpticoreReportsUrl({
    endpoint: parsed.values.endpoint ?? optionalEnv("OPTICORE_REPORTS_URL"),
    baseUrl: parsed.values["base-url"] ?? optionalEnv("OPTICORE_BASE_URL"),
  });
  const client = new OpticoreReportsClient({
    reportsUrl,
    user,
    password: rawPassword,
    httpUser: parsed.values["no-basic"] ? undefined : (optionalEnv("OPTICORE_HTTP_USER") ?? user),
    httpPassword: parsed.values["no-basic"]
      ? undefined
      : (optionalEnv("OPTICORE_HTTP_PASSWORD") ?? rawPassword),
    timeoutMs,
  });

  const stock = await client.getStockList(parsed.values.date);
  if (stock.rows.length === 0 && stock.errorMessage && stock.errorMessage.toLowerCase() !== "string") {
    throw new Error(`OptiCore returned ErrorMessage: ${stock.errorMessage}`);
  }

  const payload = format === "json" ? JSON.stringify(stock, null, 2) + "\n" : toCsv(stock.actualAt, stock.rows);

  if (parsed.values.out) {
    await writeFile(parsed.values.out, payload, "utf8");
    console.log(
      JSON.stringify(
        {
          reportsUrl,
          actualAt: stock.actualAt,
          rows: stock.rows.length,
          out: parsed.values.out,
        },
        null,
        2,
      ),
    );
  } else {
    process.stdout.write(payload);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
