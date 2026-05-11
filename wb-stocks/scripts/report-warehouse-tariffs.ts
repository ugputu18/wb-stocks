import { parseArgs } from "node:util";
import { loadConfig } from "../src/config/env.js";
import { logger } from "../src/logger.js";
import { openDatabase } from "../src/infra/db.js";
import { StockSnapshotRepository } from "../src/infra/stockSnapshotRepository.js";
import { WbWarehouseTariffRepository } from "../src/infra/wbWarehouseTariffRepository.js";
import {
  buildWarehouseTariffReport,
  type AcceptanceInputRow,
  type BoxTariffInputRow,
  type PalletTariffInputRow,
  type WarehouseStockTotalsInputRow,
  type WarehouseTariffReportRow,
  type WarehouseTariffSortKey,
} from "../src/application/buildWarehouseTariffReport.js";

const SORT_KEYS: readonly WarehouseTariffSortKey[] = [
  "score",
  "delivery",
  "storage",
  "stock",
  "acceptance",
  "name",
];

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  tsx scripts/report-warehouse-tariffs.ts [--format=table|csv|json]",
      "                                          [--sort=score|delivery|storage|stock|acceptance|name]",
      "                                          [--box-type=2|5|6]",
      "                                          [--macro='Сибирский и Дальневосточный']",
      "                                          [--geo='Сибирский']",
      "                                          [--available-only] [--limit=N]",
      "",
      "Examples:",
      "  # default: TTY table, score-sorted, box_type=2 (Короба):",
      "  tsx scripts/report-warehouse-tariffs.ts",
      "",
      "  # top-10 cheapest by shipping, where acceptance is available:",
      "  tsx scripts/report-warehouse-tariffs.ts --sort=delivery --available-only --limit=10",
      "",
      "  # Сибирь+ДВ, CSV для Excel:",
      "  tsx scripts/report-warehouse-tariffs.ts --macro='Сибирский и Дальневосточный' --format=csv",
      "",
      "  # only WB's «Сибирский ФО»:",
      "  tsx scripts/report-warehouse-tariffs.ts --geo='Сибирский' --format=table",
    ].join("\n"),
  );
  process.exit(2);
}

type OutputFormat = "table" | "csv" | "json";

function parseFormat(raw: string | undefined): OutputFormat {
  if (raw === undefined) return "table";
  if (raw === "table" || raw === "csv" || raw === "json") return raw;
  throw new Error(`Invalid --format=${raw} (expected table|csv|json)`);
}

function parseSort(raw: string | undefined): WarehouseTariffSortKey {
  if (raw === undefined) return "score";
  if ((SORT_KEYS as readonly string[]).includes(raw)) {
    return raw as WarehouseTariffSortKey;
  }
  throw new Error(
    `Invalid --sort=${raw} (expected one of: ${SORT_KEYS.join("|")})`,
  );
}

function parseInt2(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --${name}=${raw} (expected positive integer)`);
  }
  return n;
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.trunc(n).toString();
}

function fmtAvailability(av: WarehouseTariffReportRow["availability"]): string {
  switch (av) {
    case "available_free":
      return "free";
    case "available_paid":
      return "paid";
    case "blocked":
      return "blocked";
    case "unknown":
      return "—";
  }
}

const COLUMNS: ReadonlyArray<{
  header: string;
  width: number;
  align: "l" | "r";
  pick: (r: WarehouseTariffReportRow) => string;
}> = [
  { header: "warehouse", width: 38, align: "l", pick: (r) => r.warehouseName },
  { header: "geo", width: 20, align: "l", pick: (r) => (r.geoName ?? "—").slice(0, 20) },
  { header: "macro", width: 26, align: "l", pick: (r) => (r.macroRegion ?? "—").slice(0, 26) },
  { header: "ship/10L", width: 9, align: "r", pick: (r) => fmt(r.shipCostPer10L, 1) },
  { header: "store/10L·mo", width: 12, align: "r", pick: (r) => fmt(r.storeCostPer10LPerMonth, 1) },
  { header: "score", width: 9, align: "r", pick: (r) => fmt(r.score, 1) },
  { header: "stock", width: 8, align: "r", pick: (r) => fmtInt(r.currentStockUnits) },
  { header: "avail", width: 8, align: "l", pick: (r) => fmtAvailability(r.availability) },
  { header: "next free", width: 10, align: "l", pick: (r) => r.nearestFreeDate ?? "—" },
  { header: "next any", width: 10, align: "l", pick: (r) => r.nearestAvailableDate ?? "—" },
  { header: "min coef", width: 8, align: "r", pick: (r) => fmt(r.minCoefficient14d, 0) },
  { header: "days/14", width: 7, align: "r", pick: (r) => String(r.availableDays14d) },
];

function padCol(s: string, width: number, align: "l" | "r"): string {
  if (s.length >= width) return s.slice(0, width);
  const pad = " ".repeat(width - s.length);
  return align === "l" ? s + pad : pad + s;
}

function printTable(
  rows: readonly WarehouseTariffReportRow[],
  meta: {
    tariffDate: string;
    acceptanceFetchedAt: string | null;
    boxTypeId: number;
  },
): void {
  console.log(
    `# warehouse tariffs — tariff_date=${meta.tariffDate}, ` +
      `box_type=${meta.boxTypeId}, ` +
      `acceptance_fetched_at=${meta.acceptanceFetchedAt ?? "(none)"}`,
  );
  const header = COLUMNS.map((c) => padCol(c.header, c.width, c.align)).join(
    "  ",
  );
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    console.log(
      COLUMNS.map((c) => padCol(c.pick(r), c.width, c.align)).join("  "),
    );
  }
  console.log(`# ${rows.length} row(s)`);
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function printCsv(rows: readonly WarehouseTariffReportRow[]): void {
  const fields: Array<{
    name: string;
    pick: (r: WarehouseTariffReportRow) => string;
  }> = [
    { name: "warehouseName", pick: (r) => r.warehouseName },
    { name: "warehouseId", pick: (r) => (r.warehouseId === null ? "" : String(r.warehouseId)) },
    { name: "geoName", pick: (r) => r.geoName ?? "" },
    { name: "macroRegion", pick: (r) => r.macroRegion ?? "" },
    { name: "boxDeliveryBase", pick: (r) => r.boxDeliveryBase === null ? "" : String(r.boxDeliveryBase) },
    { name: "boxDeliveryLiter", pick: (r) => r.boxDeliveryLiter === null ? "" : String(r.boxDeliveryLiter) },
    { name: "boxStorageBase", pick: (r) => r.boxStorageBase === null ? "" : String(r.boxStorageBase) },
    { name: "boxStorageLiter", pick: (r) => r.boxStorageLiter === null ? "" : String(r.boxStorageLiter) },
    { name: "shipCostPer10L", pick: (r) => r.shipCostPer10L === null ? "" : r.shipCostPer10L.toFixed(2) },
    { name: "storeCostPer10LPerMonth", pick: (r) => r.storeCostPer10LPerMonth === null ? "" : r.storeCostPer10LPerMonth.toFixed(2) },
    { name: "score", pick: (r) => r.score === null ? "" : r.score.toFixed(2) },
    { name: "palletDeliveryBase", pick: (r) => r.palletDeliveryBase === null ? "" : String(r.palletDeliveryBase) },
    { name: "palletStorageDaily", pick: (r) => r.palletStorageDaily === null ? "" : String(r.palletStorageDaily) },
    { name: "availability", pick: (r) => r.availability },
    { name: "nearestFreeDate", pick: (r) => r.nearestFreeDate ?? "" },
    { name: "nearestAvailableDate", pick: (r) => r.nearestAvailableDate ?? "" },
    { name: "minCoefficient14d", pick: (r) => r.minCoefficient14d === null ? "" : String(r.minCoefficient14d) },
    { name: "availableDays14d", pick: (r) => String(r.availableDays14d) },
    { name: "isSortingCenter", pick: (r) => r.isSortingCenter === null ? "" : r.isSortingCenter ? "1" : "0" },
    { name: "currentStockUnits", pick: (r) => r.currentStockUnits === null ? "" : String(r.currentStockUnits) },
    { name: "dtTillMax", pick: (r) => r.dtTillMax ?? "" },
  ];
  console.log(fields.map((f) => f.name).join(","));
  for (const r of rows) {
    console.log(fields.map((f) => csvEscape(f.pick(r))).join(","));
  }
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        format: { type: "string" },
        sort: { type: "string" },
        "box-type": { type: "string" },
        macro: { type: "string" },
        geo: { type: "string" },
        "available-only": { type: "boolean" },
        limit: { type: "string" },
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

  let format: OutputFormat;
  let sortBy: WarehouseTariffSortKey;
  let boxTypeId: number;
  let limit: number | undefined;
  try {
    format = parseFormat(parsed.values.format);
    sortBy = parseSort(parsed.values.sort);
    boxTypeId = parseInt2(parsed.values["box-type"], "box-type") ?? 2;
    limit = parseInt2(parsed.values.limit, "limit");
  } catch (err) {
    console.error((err as Error).message);
    printUsageAndExit();
  }

  const macroFilter = parsed.values.macro?.trim() || null;
  const geoFilter = parsed.values.geo?.trim() || null;
  const availableOnly = parsed.values["available-only"] === true;

  const cfg = loadConfig();
  const db = openDatabase(cfg.DATABASE_PATH);
  const tariffRepo = new WbWarehouseTariffRepository(db);
  const stockRepo = new StockSnapshotRepository(db);

  try {
    const tariffDate = tariffRepo.getLatestBoxTariffDate();
    if (tariffDate === null) {
      console.error(
        "No box tariffs in DB. Run `pnpm update:wb-tariffs` first.",
      );
      process.exitCode = 1;
      return;
    }
    const palletDate = tariffRepo.getLatestPalletTariffDate();
    const acceptanceFetchedAt = tariffRepo.getLatestAcceptanceFetchedAt();

    const boxRows: BoxTariffInputRow[] = tariffRepo
      .getBoxForDate(tariffDate)
      .map((r) => ({
        warehouseName: r.warehouseName,
        geoName: r.geoName,
        boxDeliveryBase: r.boxDeliveryBase,
        boxDeliveryLiter: r.boxDeliveryLiter,
        boxStorageBase: r.boxStorageBase,
        boxStorageLiter: r.boxStorageLiter,
        dtTillMax: r.dtTillMax,
      }));
    const palletRows: PalletTariffInputRow[] =
      palletDate === null
        ? []
        : tariffRepo.getPalletForDate(palletDate).map((r) => ({
            warehouseName: r.warehouseName,
            palletDeliveryValueBase: r.palletDeliveryValueBase,
            palletDeliveryValueLiter: r.palletDeliveryValueLiter,
            palletStorageValueExpr: r.palletStorageValueExpr,
          }));
    const acceptanceRows: AcceptanceInputRow[] = tariffRepo
      .getLatestAcceptance()
      .filter((r) => r.boxTypeId === boxTypeId)
      .map((r) => ({
        warehouseName: r.warehouseName,
        warehouseId: r.warehouseId,
        boxTypeId: r.boxTypeId,
        effectiveDate: r.effectiveDate,
        coefficient: r.coefficient,
        allowUnload: r.allowUnload,
        isSortingCenter: r.isSortingCenter,
      }));
    const stockTotals: WarehouseStockTotalsInputRow[] = stockRepo
      .getLatestStockUnitsByWarehouse()
      .map((r) => ({
        warehouseName: r.warehouseName,
        currentStockUnits: r.units,
      }));

    const report = buildWarehouseTariffReport({
      tariffDate,
      acceptanceFetchedAt,
      boxTypeId,
      boxRows,
      palletRows,
      acceptanceRows,
      stockTotals,
      macroFilter,
      geoFilter,
      availableOnly,
      sortBy,
      limit,
    });

    logger.info(
      {
        tariffDate,
        acceptanceFetchedAt,
        boxTypeId,
        sortBy,
        macroFilter,
        geoFilter,
        availableOnly,
        limit: limit ?? null,
        rows: report.rows.length,
        summary: report.summary,
      },
      "Warehouse tariffs report: built",
    );

    if (format === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else if (format === "csv") {
      printCsv(report.rows);
    } else {
      printTable(report.rows, {
        tariffDate,
        acceptanceFetchedAt,
        boxTypeId,
      });
      const s = report.summary.byAvailability;
      console.log(
        `# availability: free=${s.available_free} paid=${s.available_paid} ` +
          `blocked=${s.blocked} unknown=${s.unknown}`,
      );
    }
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
    "Warehouse tariffs report failed",
  );
  process.exitCode = 1;
});
