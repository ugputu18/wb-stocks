import type { Logger } from "pino";
import type { WbStatsClient } from "../infra/wbStatsClient.js";
import type { StockSnapshotRepository } from "../infra/stockSnapshotRepository.js";
import { mapWbStockRow } from "./mapWbStockRow.js";

export interface ImportWbStocksDeps {
  wbClient: WbStatsClient;
  repository: StockSnapshotRepository;
  logger: Logger;
  /** Override for tests; defaults to () => new Date(). */
  now?: () => Date;
}

export interface ImportWbStocksOptions {
  /**
   * WB requires a `dateFrom` query param. Pass a far-past date to get the
   * current full state of stocks (per WB docs).
   */
  dateFrom?: string;
}

export interface ImportWbStocksResult {
  snapshotAt: string;
  fetched: number;
  mapped: number;
  skipped: number;
  inserted: number;
  durationMs: number;
}

const DEFAULT_DATE_FROM = "2019-01-01";

/**
 * Use case: "load current WB warehouse stocks as a snapshot at now()".
 *
 * One invocation = one snapshot timestamp = one batch.
 * Re-running this within the same wall-clock millisecond is effectively a
 * no-op thanks to the DB-level uniqueness key; any later re-run produces a
 * new snapshot so history is preserved.
 */
export async function importWbStocks(
  deps: ImportWbStocksDeps,
  options: ImportWbStocksOptions = {},
): Promise<ImportWbStocksResult> {
  const { wbClient, repository, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const snapshotAt = now().toISOString();
  const dateFrom = options.dateFrom ?? DEFAULT_DATE_FROM;
  const startedAt = Date.now();

  logger.info({ snapshotAt, dateFrom }, "WB stocks import: start");

  const rawRows = await wbClient.getSupplierStocks({ dateFrom });
  logger.info({ count: rawRows.length }, "WB stocks import: fetched rows");

  const mapped: ReturnType<typeof mapWbStockRow>[] = rawRows.map((raw) =>
    mapWbStockRow(raw, snapshotAt),
  );

  const records = [];
  let skipped = 0;
  for (const result of mapped) {
    if (result.ok) {
      records.push(result.record);
    } else {
      skipped += 1;
      logger.warn(
        { reason: result.reason, raw: result.raw },
        "WB stocks import: row skipped",
      );
    }
  }

  const { inserted } = repository.saveBatch(records);
  const durationMs = Date.now() - startedAt;

  logger.info(
    {
      snapshotAt,
      fetched: rawRows.length,
      mapped: records.length,
      skipped,
      inserted,
      durationMs,
    },
    "WB stocks import: done",
  );

  return {
    snapshotAt,
    fetched: rawRows.length,
    mapped: records.length,
    skipped,
    inserted,
    durationMs,
  };
}
