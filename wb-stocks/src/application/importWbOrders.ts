import type { Logger } from "pino";
import type { WbStatsClient } from "../infra/wbStatsClient.js";
import type { WbOrdersDailyRepository } from "../infra/wbOrdersDailyRepository.js";
import type {
  WbOrderUnit,
  WbOrdersDailyRecord,
} from "../domain/wbOrder.js";
import { mapWbOrderRow } from "./mapWbOrderRow.js";

export interface ImportWbOrdersDeps {
  wbClient: WbStatsClient;
  repository: WbOrdersDailyRepository;
  logger: Logger;
  /** Override for tests; defaults to () => new Date(). */
  now?: () => Date;
}

export interface ImportWbOrdersOptions {
  /** YYYY-MM-DD or RFC3339 (Moscow tz). Default: today − 31 days. */
  dateFrom?: string;
  /**
   * Optional inclusive upper bound on `orderDate` to persist. Useful when
   * we want to ignore "today" because it is still being filled in. Default:
   * no upper bound — we trust whatever WB returned.
   */
  dateTo?: string;
  /** Aggregate but never write to DB. Default: false. */
  dryRun?: boolean;
  /**
   * If a single response is suspiciously large (close to WB's ~80k cap),
   * the importer pages forward by `lastChangeDate`. This bounds how many
   * such follow-up calls we are willing to make. Default: 10.
   */
  maxPages?: number;
}

export interface ImportWbOrdersResult {
  dateFrom: string;
  dateTo: string | null;
  fetchedRows: number;
  validRows: number;
  skippedRows: number;
  pages: number;
  /** Days that we actually overwrote in `wb_orders_daily`. */
  daysReplaced: number;
  /** Per-day "deleted" counts summed (rows removed across all replaced days). */
  rowsDeleted: number;
  /** Per-day "inserted" counts summed. */
  rowsInserted: number;
  durationMs: number;
  dryRun: boolean;
}

const DEFAULT_LOOKBACK_DAYS = 31;
/**
 * WB caps `/supplier/orders` at ~80k rows per response. If we get exactly
 * this many, assume there are more and page forward by `lastChangeDate`.
 * The threshold is intentionally a bit lower so we don't miss the case
 * where WB rounds slightly under the cap.
 */
const PAGINATE_THRESHOLD = 79_000;

/**
 * Use case: pull WB supplier orders since `dateFrom`, aggregate to days,
 * and replace whole days in `wb_orders_daily`.
 *
 * Why "replace by day", not "upsert per row":
 *   WB orders are mutable (cancellations come in days later, occasionally
 *   new rows appear retroactively). The cleanest convergent model is
 *   "the dataset for date D is whatever WB now reports for date D".
 *   We only replace days that the current fetch actually observed; older
 *   days outside the window stay untouched.
 */
export async function importWbOrders(
  deps: ImportWbOrdersDeps,
  options: ImportWbOrdersOptions = {},
): Promise<ImportWbOrdersResult> {
  const { wbClient, repository, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const seenAt = startedAt.toISOString();
  const dateFrom = options.dateFrom ?? defaultDateFrom(startedAt);
  const dateTo = options.dateTo ?? null;
  const dryRun = options.dryRun === true;
  const maxPages = options.maxPages ?? 10;
  const t0 = Date.now();

  logger.info(
    { dateFrom, dateTo, dryRun, maxPages },
    "WB orders import: start",
  );

  // 1) Pull rows, paging forward by `lastChangeDate` if needed.
  const rawRows: unknown[] = [];
  let cursor = dateFrom;
  let pages = 0;
  while (pages < maxPages) {
    const batch = await wbClient.getSupplierOrders({
      dateFrom: cursor,
      flag: 0,
    });
    pages += 1;
    rawRows.push(...batch);
    logger.info(
      {
        page: pages,
        cursor,
        returned: batch.length,
        totalSoFar: rawRows.length,
      },
      "WB orders import: page fetched",
    );
    if (batch.length < PAGINATE_THRESHOLD) break;

    const next = pickNextCursor(batch);
    if (next === null || next === cursor) {
      logger.warn(
        { cursor, returned: batch.length },
        "WB orders import: cannot advance cursor; stopping pagination",
      );
      break;
    }
    cursor = next;
  }

  // 2) Validate + project to internal units.
  const units: WbOrderUnit[] = [];
  let skipped = 0;
  for (const raw of rawRows) {
    const r = mapWbOrderRow(raw);
    if (r.ok) {
      units.push(r.value);
    } else {
      skipped += 1;
      logger.warn(
        { reason: r.reason, raw: r.raw },
        "WB orders import: row skipped",
      );
    }
  }

  // 3) Filter by [dateFrom, dateTo] window so we never accidentally
  //    overwrite a day we did not really cover.
  const dateFromYmd = toYmd(dateFrom);
  const filtered = units.filter((u) => {
    if (u.orderDate < dateFromYmd) return false;
    if (dateTo && u.orderDate > toYmd(dateTo)) return false;
    return true;
  });

  // 4) Aggregate by (orderDate, warehouseKey, nmId, techSize).
  const byDay = aggregateByDay(filtered, seenAt);

  let daysReplaced = 0;
  let rowsDeleted = 0;
  let rowsInserted = 0;
  if (!dryRun) {
    for (const [orderDate, rows] of byDay) {
      const { deleted, inserted } = repository.replaceDay(orderDate, rows);
      daysReplaced += 1;
      rowsDeleted += deleted;
      rowsInserted += inserted;
      logger.info(
        { orderDate, deleted, inserted, distinctRows: rows.length },
        "WB orders import: day replaced",
      );
    }
  }

  const durationMs = Date.now() - t0;
  const result: ImportWbOrdersResult = {
    dateFrom,
    dateTo,
    fetchedRows: rawRows.length,
    validRows: units.length,
    skippedRows: skipped,
    pages,
    daysReplaced,
    rowsDeleted,
    rowsInserted,
    durationMs,
    dryRun,
  };
  logger.info(result, "WB orders import: done");
  return result;
}

/**
 * Walk units once, building per-day → per-key aggregates. Exposed for
 * unit tests; `importWbOrders` is the only production caller.
 */
export function aggregateByDay(
  units: readonly WbOrderUnit[],
  seenAt: string,
): Map<string, WbOrdersDailyRecord[]> {
  const byDay = new Map<string, Map<string, WbOrdersDailyRecord>>();
  for (const u of units) {
    let dayMap = byDay.get(u.orderDate);
    if (!dayMap) {
      dayMap = new Map();
      byDay.set(u.orderDate, dayMap);
    }
    const key = `${u.warehouseKey}\u0000${u.nmId}\u0000${u.techSize}`;
    const existing = dayMap.get(key);
    if (!existing) {
      dayMap.set(key, {
        orderDate: u.orderDate,
        warehouseNameRaw: u.warehouseNameRaw,
        warehouseKey: u.warehouseKey,
        nmId: u.nmId,
        techSize: u.techSize,
        vendorCode: u.vendorCode,
        barcode: u.barcode,
        units: u.isCancel ? 0 : 1,
        cancelledUnits: u.isCancel ? 1 : 0,
        grossUnits: 1,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
    } else {
      existing.grossUnits += 1;
      if (u.isCancel) existing.cancelledUnits += 1;
      else existing.units += 1;
      // Prefer a non-null payload value over a previously-seen null.
      if (existing.vendorCode === null && u.vendorCode !== null) {
        existing.vendorCode = u.vendorCode;
      }
      if (existing.barcode === null && u.barcode !== null) {
        existing.barcode = u.barcode;
      }
      if (existing.warehouseNameRaw === null && u.warehouseNameRaw !== null) {
        existing.warehouseNameRaw = u.warehouseNameRaw;
      }
    }
  }

  const out = new Map<string, WbOrdersDailyRecord[]>();
  for (const [day, m] of byDay) {
    out.set(day, Array.from(m.values()));
  }
  return out;
}

function defaultDateFrom(now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  return toYmd(d.toISOString());
}

function toYmd(s: string | Date): string {
  const str = typeof s === "string" ? s : s.toISOString();
  if (str.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return str;
}

function pickNextCursor(batch: readonly unknown[]): string | null {
  for (let i = batch.length - 1; i >= 0; i -= 1) {
    const r = batch[i];
    if (r && typeof r === "object" && "lastChangeDate" in r) {
      const v = (r as { lastChangeDate?: unknown }).lastChangeDate;
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return null;
}
