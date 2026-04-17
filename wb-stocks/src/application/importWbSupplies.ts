import type { Logger } from "pino";
import type {
  ListSuppliesParams,
  WbSuppliesClient,
} from "../infra/wbSuppliesClient.js";
import type { WbSupplyRepository } from "../infra/wbSupplyRepository.js";
import type {
  WbSupplyItemRecord,
  WbSupplyListRow,
} from "../domain/wbSupply.js";
import {
  buildItemRecord,
  buildSupplyRecord,
  parseDetails,
  parseGoodsRow,
  parseListRow,
} from "./mapWbSupply.js";

export interface ImportWbSuppliesDeps {
  wbClient: WbSuppliesClient;
  repository: WbSupplyRepository;
  logger: Logger;
  now?: () => Date;
}

export interface ImportWbSuppliesOptions {
  /**
   * Inclusive lower bound for `createDate` filter (YYYY-MM-DD or RFC3339).
   * Default: today − 30 days.
   */
  dateFrom?: string;
  /** Inclusive upper bound. Default: today. */
  dateTo?: string;
  /** Optional WB status IDs to keep (1..6). Default: all. */
  statusIds?: readonly number[];
  /** Page size for List supplies. WB max = 1000. */
  pageSize?: number;
  /** Fetch `GET /api/v1/supplies/{ID}` to enrich warehouse + qty. Default: true. */
  withDetails?: boolean;
  /** Fetch `GET /api/v1/supplies/{ID}/goods` for line items. Default: true. */
  withItems?: boolean;
  /** Fetch + aggregate but never write to DB. Default: false. */
  dryRun?: boolean;
}

export interface ImportWbSuppliesResult {
  dateFrom: string;
  dateTo: string;
  fetchedRows: number;
  validRows: number;
  skippedRows: number;
  /** Rows skipped because supplyID was null/0 (drafts/preorders). */
  preorderOnly: number;
  supplies: number;
  created: number;
  updated: number;
  unchanged: number;
  statusChanged: number;
  detailsFetched: number;
  detailsFailed: number;
  itemsFetched: number;
  itemsFailed: number;
  itemsTotal: number;
  durationMs: number;
  dryRun: boolean;
}

const DEFAULT_LOOKBACK_DAYS = 30;

export async function importWbSupplies(
  deps: ImportWbSuppliesDeps,
  options: ImportWbSuppliesOptions = {},
): Promise<ImportWbSuppliesResult> {
  const { wbClient, repository, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const startedAtDate = now();
  const seenAt = startedAtDate.toISOString();
  const dateFrom = options.dateFrom ?? defaultDateFrom(startedAtDate);
  const dateTo = options.dateTo ?? toYmd(startedAtDate);
  const withDetails = options.withDetails !== false;
  const withItems = options.withItems !== false;
  const dryRun = options.dryRun === true;
  const pageSize = options.pageSize ?? 1000;
  const t0 = Date.now();

  logger.info(
    {
      dateFrom,
      dateTo,
      statusIds: options.statusIds ?? null,
      withDetails,
      withItems,
      dryRun,
      pageSize,
    },
    "WB supplies update: start",
  );

  // 1) Pull supplies list with pagination.
  const rawRows: unknown[] = [];
  let offset = 0;
  while (true) {
    const params: ListSuppliesParams = {
      limit: pageSize,
      offset,
      dates: [{ from: dateFrom, till: dateTo, type: "createDate" }],
    };
    if (options.statusIds && options.statusIds.length > 0) {
      params.statusIDs = options.statusIds;
    }
    const page = await wbClient.listSupplies(params);
    rawRows.push(...page);
    logger.info(
      { offset, pageSize, returned: page.length, totalSoFar: rawRows.length },
      "WB supplies update: list page fetched",
    );
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  // 2) Validate + filter to those with a real supplyID.
  const valid: WbSupplyListRow[] = [];
  let skipped = 0;
  let preorderOnly = 0;
  for (const raw of rawRows) {
    const r = parseListRow(raw);
    if (!r.ok) {
      skipped += 1;
      logger.warn(
        { reason: r.reason, raw: r.raw },
        "WB supplies update: list row skipped (invalid)",
      );
      continue;
    }
    if (r.value.supplyID === null || r.value.supplyID === 0) {
      preorderOnly += 1;
      logger.debug(
        { preorderID: r.value.preorderID, statusID: r.value.statusID },
        "WB supplies update: list row skipped (no supplyID, preorder only)",
      );
      continue;
    }
    valid.push(r.value);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let statusChanged = 0;
  let detailsFetched = 0;
  let detailsFailed = 0;
  let itemsFetched = 0;
  let itemsFailed = 0;
  let itemsTotal = 0;

  // 3) For each supply: fetch details + goods (optional), then upsert.
  for (const list of valid) {
    const supplyId = list.supplyID as number;
    let detailsParsed = null as Awaited<
      ReturnType<typeof parseDetails>
    > | null;

    try {
      if (withDetails) {
        const rawDetails = await wbClient.getSupplyDetails(supplyId);
        const dr = parseDetails(rawDetails);
        if (dr.ok) {
          detailsParsed = dr;
          detailsFetched += 1;
        } else {
          detailsFailed += 1;
          logger.warn(
            { supplyId, reason: dr.reason, raw: dr.raw },
            "WB supplies update: details parse failed",
          );
        }
      }
    } catch (err) {
      detailsFailed += 1;
      logger.error(
        { supplyId, err: serializeErr(err) },
        "WB supplies update: details fetch failed",
      );
    }

    let items: WbSupplyItemRecord[] = [];
    if (withItems) {
      try {
        const rawGoods = await wbClient.getSupplyGoods(supplyId);
        for (const g of rawGoods) {
          const r = parseGoodsRow(g);
          if (r.ok) {
            items.push(buildItemRecord(supplyId, r.value));
          } else {
            logger.warn(
              { supplyId, reason: r.reason, raw: r.raw },
              "WB supplies update: goods row skipped (invalid)",
            );
          }
        }
        itemsFetched += 1;
        itemsTotal += items.length;
      } catch (err) {
        itemsFailed += 1;
        logger.error(
          { supplyId, err: serializeErr(err) },
          "WB supplies update: goods fetch failed",
        );
      }
    }

    if (dryRun) continue;

    try {
      const supplyRecord = buildSupplyRecord(
        list,
        detailsParsed?.ok ? detailsParsed.value : null,
      );
      const { result } = repository.upsertSupply(supplyRecord, seenAt);
      if (result === "created") created += 1;
      else if (result === "updated") updated += 1;
      else unchanged += 1;

      if (withItems && items.length > 0) {
        repository.replaceItemsForSupply(supplyId, items);
      }

      const wrote = repository.appendStatusHistoryIfChanged(
        supplyId,
        supplyRecord.statusId,
        supplyRecord.factDate,
        seenAt,
      );
      if (wrote) statusChanged += 1;
    } catch (err) {
      logger.error(
        { supplyId, err: serializeErr(err) },
        "WB supplies update: persist failed",
      );
    }
  }

  const durationMs = Date.now() - t0;

  const result: ImportWbSuppliesResult = {
    dateFrom,
    dateTo,
    fetchedRows: rawRows.length,
    validRows: valid.length,
    skippedRows: skipped,
    preorderOnly,
    supplies: valid.length,
    created,
    updated,
    unchanged,
    statusChanged,
    detailsFetched,
    detailsFailed,
    itemsFetched,
    itemsFailed,
    itemsTotal,
    durationMs,
    dryRun,
  };

  logger.info(result, "WB supplies update: done");
  return result;
}

function defaultDateFrom(now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  return toYmd(d);
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { value: String(err) };
}
