import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Logger } from "pino";
import type { OwnStockSnapshotRepository } from "../infra/ownStockSnapshotRepository.js";
import {
  DEFAULT_WAREHOUSE_CODE,
  type OwnStockSnapshotRecord,
} from "../domain/ownStockSnapshot.js";
import { parseOwnStockCsv } from "./parseOwnStockCsv.js";

export interface ImportOwnWarehouseStateDeps {
  repository: OwnStockSnapshotRepository;
  logger: Logger;
  /** Override for tests. */
  now?: () => Date;
  /** Override for tests. */
  readFile?: (path: string) => Promise<Buffer>;
}

export interface ImportOwnWarehouseStateOptions {
  /** Calendar date of the snapshot (YYYY-MM-DD). Defaults to today (local). */
  date?: string;
  /** Warehouse identifier; defaults to {@link DEFAULT_WAREHOUSE_CODE}. */
  warehouseCode?: string;
  /**
   * Explicit CSV path. If omitted, resolved by convention from `date`:
   *   <conventionBaseDir>/our<MMDD>.csv
   * matching the existing `store/our0418.csv` layout.
   */
  file?: string;
  /** Base directory for the filename convention. Defaults to `./store`. */
  conventionBaseDir?: string;
}

export interface ImportOwnWarehouseStateResult {
  snapshotDate: string;
  warehouseCode: string;
  sourceFile: string;
  fetched: number;
  skipped: number;
  inserted: number;
  wasUpdate: boolean;
  durationMs: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Use case: "snapshot the state of our warehouse on a given calendar date".
 *
 * Meaning of "state on date" in this project: the balance of each SKU in the
 * warehouse as recorded in the CSV file produced for that date (see
 * `store/our<MMDD>.csv`). There is no movement/transaction history inside
 * the project to compute state from — the CSV is authoritative.
 *
 * Idempotency model: replace-for-date (see {@link OwnStockSnapshotRepository.replaceForDate}).
 */
export async function importOwnWarehouseState(
  deps: ImportOwnWarehouseStateDeps,
  options: ImportOwnWarehouseStateOptions = {},
): Promise<ImportOwnWarehouseStateResult> {
  const { repository, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const read = deps.readFile ?? (async (p) => readFile(p));

  const snapshotDate = options.date ?? todayLocalYmd(now());
  if (!DATE_RE.test(snapshotDate)) {
    throw new Error(
      `Invalid date "${snapshotDate}": expected YYYY-MM-DD`,
    );
  }
  const warehouseCode = options.warehouseCode ?? DEFAULT_WAREHOUSE_CODE;
  const sourceFile = resolve(
    options.file ??
      defaultSourcePath(snapshotDate, options.conventionBaseDir ?? "./store"),
  );
  const startedAt = Date.now();

  logger.info(
    { snapshotDate, warehouseCode, sourceFile },
    "Own warehouse import: start",
  );

  const existing = repository.countForDate(snapshotDate, warehouseCode);
  const wasUpdate = existing > 0;

  const buf = await read(sourceFile);
  const { rows, issues } = parseOwnStockCsv(buf);

  for (const issue of issues) {
    logger.warn(
      { lineNumber: issue.lineNumber, reason: issue.reason, raw: issue.raw },
      "Own warehouse import: row skipped",
    );
  }

  const importedAt = now().toISOString();
  const records: OwnStockSnapshotRecord[] = rows.map((row) => ({
    snapshotDate,
    warehouseCode,
    vendorCode: row.vendorCode,
    quantity: row.quantity,
    sourceFile: basename(sourceFile),
    importedAt,
  }));

  const { inserted } = repository.replaceForDate(
    snapshotDate,
    warehouseCode,
    records,
  );
  const durationMs = Date.now() - startedAt;

  logger.info(
    {
      snapshotDate,
      warehouseCode,
      sourceFile,
      fetched: rows.length + issues.length,
      skipped: issues.length,
      inserted,
      wasUpdate,
      durationMs,
    },
    wasUpdate
      ? "Own warehouse import: snapshot updated"
      : "Own warehouse import: snapshot created",
  );

  return {
    snapshotDate,
    warehouseCode,
    sourceFile,
    fetched: rows.length + issues.length,
    skipped: issues.length,
    inserted,
    wasUpdate,
    durationMs,
  };
}

function todayLocalYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function defaultSourcePath(snapshotDate: string, baseDir: string): string {
  const [, mm, dd] = snapshotDate.split("-") as [string, string, string];
  return `${baseDir}/our${mm}${dd}.csv`;
}
