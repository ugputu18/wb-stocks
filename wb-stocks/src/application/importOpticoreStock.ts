import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import {
  DEFAULT_WAREHOUSE_CODE,
  type OwnStockSnapshotRecord,
} from "../domain/ownStockSnapshot.js";
import type {
  OpticoreReportsClient,
  OpticoreStockRow,
} from "../infra/opticoreReportsClient.js";
import type { OwnStockSnapshotRepository } from "../infra/ownStockSnapshotRepository.js";

export type OpticoreVendorCodeSource = "sku_id" | "article" | "code";

export interface ImportOpticoreStockDeps {
  client: Pick<OpticoreReportsClient, "getStockList">;
  repository: OwnStockSnapshotRepository;
  logger: Logger;
  now?: () => Date;
  readFile?: (path: string) => Promise<Buffer>;
}

export interface ImportOpticoreStockOptions {
  /** Calendar date of the own warehouse snapshot. Defaults to today (local). */
  date?: string;
  warehouseCode?: string;
  /** OptiCore Warehouse_id allowlist. Empty/undefined means all warehouses. */
  opticoreWarehouseIds?: readonly string[];
  /** OptiCore StockType_id allowlist. Defaults to stock type 0 ("Сток"). */
  stockTypeIds?: readonly string[];
  /** How to turn OptiCore rows into own_stock_snapshots.vendor_code. */
  vendorCodeSource?: OpticoreVendorCodeSource;
  /**
   * Optional JSON/CSV mapping file for OptiCore Sku_id -> vendor_code.
   * JSON shape: { "123455": "35/272" }
   * CSV shape: sku_id,vendor_code
   */
  skuVendorMapFile?: string;
}

export interface ImportOpticoreStockIssue {
  skuId: string;
  reason: string;
}

export interface ImportOpticoreStockResult {
  snapshotDate: string;
  warehouseCode: string;
  source: string;
  actualAt: string;
  fetched: number;
  filteredOut: number;
  skipped: number;
  inserted: number;
  wasUpdate: boolean;
  durationMs: number;
  issues: ImportOpticoreStockIssue[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function importOpticoreStock(
  deps: ImportOpticoreStockDeps,
  options: ImportOpticoreStockOptions = {},
): Promise<ImportOpticoreStockResult> {
  const { client, repository, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const read = deps.readFile ?? (async (p) => readFile(p));
  const startedAt = Date.now();

  const snapshotDate = options.date ?? todayLocalYmd(now());
  if (!DATE_RE.test(snapshotDate)) {
    throw new Error(`Invalid date "${snapshotDate}": expected YYYY-MM-DD`);
  }

  const warehouseCode = options.warehouseCode ?? DEFAULT_WAREHOUSE_CODE;
  const stockTypeIds = new Set(options.stockTypeIds ?? ["0"]);
  const warehouseIds = new Set(options.opticoreWarehouseIds ?? []);
  const vendorCodeSource = options.vendorCodeSource ?? "sku_id";
  const skuMap = options.skuVendorMapFile
    ? await loadSkuVendorMap(resolve(options.skuVendorMapFile), read)
    : new Map<string, string>();

  logger.info(
    {
      snapshotDate,
      warehouseCode,
      stockTypeIds: Array.from(stockTypeIds),
      opticoreWarehouseIds: Array.from(warehouseIds),
      vendorCodeSource,
      skuVendorMapFile: options.skuVendorMapFile ? basename(options.skuVendorMapFile) : null,
    },
    "OptiCore stock import: start",
  );

  const existing = repository.countForDate(snapshotDate, warehouseCode);
  const wasUpdate = existing > 0;
  const stock = await client.getStockList(snapshotDate);

  if (
    stock.rows.length === 0 &&
    stock.errorMessage &&
    stock.errorMessage.toLowerCase() !== "string"
  ) {
    throw new Error(`OptiCore returned ErrorMessage: ${stock.errorMessage}`);
  }

  const quantities = new Map<string, number>();
  const issues: ImportOpticoreStockIssue[] = [];
  let filteredOut = 0;

  for (const row of stock.rows) {
    if (warehouseIds.size > 0 && !warehouseIds.has(row.warehouseId)) {
      filteredOut += 1;
      continue;
    }
    if (stockTypeIds.size > 0 && !stockTypeIds.has(row.stockTypeId)) {
      filteredOut += 1;
      continue;
    }

    const vendorCode = resolveVendorCode(row, vendorCodeSource, skuMap);
    if (!vendorCode) {
      issues.push({
        skuId: row.skuId,
        reason: `missing vendor code for source "${vendorCodeSource}"`,
      });
      continue;
    }

    quantities.set(vendorCode, (quantities.get(vendorCode) ?? 0) + row.qty);
  }

  const importedAt = now().toISOString();
  const source = `opticore:${stock.actualAt || snapshotDate}`;
  const records: OwnStockSnapshotRecord[] = Array.from(quantities, ([vendorCode, qty]) => ({
    snapshotDate,
    warehouseCode,
    vendorCode,
    quantity: Math.round(qty),
    sourceFile: source,
    importedAt,
  }));

  if (stock.rows.length > 0 && records.length === 0) {
    throw new Error(
      "OptiCore returned stock rows, but none were importable. Check warehouse/type filters and sku_id -> vendor_code mapping.",
    );
  }

  const { inserted } = repository.replaceForDate(snapshotDate, warehouseCode, records);
  const result: ImportOpticoreStockResult = {
    snapshotDate,
    warehouseCode,
    source,
    actualAt: stock.actualAt,
    fetched: stock.rows.length,
    filteredOut,
    skipped: issues.length,
    inserted,
    wasUpdate,
    durationMs: Date.now() - startedAt,
    issues,
  };

  for (const issue of issues.slice(0, 20)) {
    logger.warn(issue, "OptiCore stock import: row skipped");
  }
  if (issues.length > 20) {
    logger.warn(
      { skipped: issues.length, logged: 20 },
      "OptiCore stock import: additional skipped rows omitted from logs",
    );
  }
  logger.info(result, "OptiCore stock import: done");
  return result;
}

async function loadSkuVendorMap(
  path: string,
  read: (path: string) => Promise<Buffer>,
): Promise<Map<string, string>> {
  const text = (await read(path)).toString("utf8").replace(/^\uFEFF/, "");
  const trimmed = text.trim();
  const map = new Map<string, string>();
  if (!trimmed) return map;

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const [skuId, vendorCode] of Object.entries(parsed)) {
      if (typeof vendorCode === "string" && vendorCode.trim()) {
        map.set(skuId.trim(), vendorCode.trim());
      }
    }
    return map;
  }

  const lines = trimmed.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const [skuIdRaw, vendorCodeRaw] = line.split(/[;,]/, 2);
    const skuId = skuIdRaw?.trim();
    const vendorCode = vendorCodeRaw?.trim();
    if (!skuId || !vendorCode) continue;
    if (index === 0 && /sku/i.test(skuId) && /vendor|article|артик/i.test(vendorCode)) continue;
    map.set(skuId, vendorCode);
  }
  return map;
}

function resolveVendorCode(
  row: OpticoreStockRow,
  source: OpticoreVendorCodeSource,
  skuMap: ReadonlyMap<string, string>,
): string | null {
  const mapped = skuMap.get(row.skuId);
  if (mapped?.trim()) return mapped.trim();

  if (source === "article") return row.article?.trim() || null;
  if (source === "code") return row.code?.trim() || null;
  return row.skuId.trim() || null;
}

function todayLocalYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
