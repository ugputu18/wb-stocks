import type { Logger } from "pino";
import type { WbStatsClient } from "../infra/wbStatsClient.js";
import type { WbOrderUnit } from "../domain/wbOrder.js";
import { mapWbOrderRow } from "./mapWbOrderRow.js";
import { wbSupplierOrderRowSchema } from "../domain/wbOrder.js";

/** Согласовано с `importWbOrders`: крупные ответы → пагинация по `lastChangeDate`. */
const PAGINATE_THRESHOLD = 79_000;

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

export interface FetchWbOrderUnitsWindowResult {
  units: WbOrderUnit[];
  /** Пара «сырая строка WB + нормализованная единица» (только если `includeRaw: true`). */
  paired?: Array<{ raw: unknown; unit: WbOrderUnit }>;
  fetchedRows: number;
  validRows: number;
  skippedRows: number;
  pages: number;
  stoppedReason: "complete" | "max_pages" | "max_raw_rows";
}

/**
 * Загружает заказы WB за окно по `orderDate` (как импорт), без записи в БД.
 * Использует тот же контракт API и пагинацию, что `importWbOrders`.
 */
export async function fetchWbOrderUnitsForWindow(
  wbClient: WbStatsClient,
  logger: Logger,
  options: {
    /** YYYY-MM-DD — нижняя граница `orderDate` (включительно). */
    dateFromYmd: string;
    /** YYYY-MM-DD — верхняя граница `orderDate` (включительно). */
    dateToYmd: string;
    /** Стартовый `dateFrom` для WB API (обычно тот же день, что `dateFromYmd`). */
    apiDateFrom: string;
    maxPages?: number;
    /** Остановка при слишком большом ответе (защита от OOM). */
    maxRawRows?: number;
    /** Сохранить сырые JSON-строки рядом с `WbOrderUnit` (для raw-диагностики). */
    includeRaw?: boolean;
  },
): Promise<FetchWbOrderUnitsWindowResult> {
  const maxPages = options.maxPages ?? 25;
  const maxRawRows = options.maxRawRows ?? 500_000;
  const includeRaw = options.includeRaw === true;

  const rawRows: unknown[] = [];
  let cursor = options.apiDateFrom;
  let pages = 0;
  let stoppedReason: FetchWbOrderUnitsWindowResult["stoppedReason"] = "complete";

  while (pages < maxPages) {
    const batch = await wbClient.getSupplierOrders({
      dateFrom: cursor,
      flag: 0,
    });
    pages += 1;
    rawRows.push(...batch);
    logger.info(
      {
        diagnostic: "wb_orders_window",
        page: pages,
        cursor,
        returned: batch.length,
        totalSoFar: rawRows.length,
      },
      "WB supplier orders: diagnostic page",
    );

    if (rawRows.length >= maxRawRows) {
      stoppedReason = "max_raw_rows";
      break;
    }

    if (batch.length < PAGINATE_THRESHOLD) break;

    const next = pickNextCursor(batch);
    if (next === null || next === cursor) {
      logger.warn(
        { cursor, returned: batch.length },
        "WB supplier orders: cannot advance cursor",
      );
      break;
    }
    cursor = next;
  }

  if (pages >= maxPages && stoppedReason === "complete") {
    stoppedReason = "max_pages";
  }

  const units: WbOrderUnit[] = [];
  const paired: Array<{ raw: unknown; unit: WbOrderUnit }> = [];
  let skipped = 0;
  for (const raw of rawRows) {
    const r = mapWbOrderRow(raw);
    if (r.ok) {
      units.push(r.value);
      if (includeRaw) paired.push({ raw, unit: r.value });
    } else {
      skipped += 1;
    }
  }

  const fromY = options.dateFromYmd;
  const toY = options.dateToYmd;
  const filtered = units.filter((u) => {
    if (u.orderDate < fromY) return false;
    if (u.orderDate > toY) return false;
    return true;
  });

  const pairedFiltered = includeRaw
    ? paired.filter((p) => p.unit.orderDate >= fromY && p.unit.orderDate <= toY)
    : [];

  return {
    units: filtered,
    paired: includeRaw ? pairedFiltered : undefined,
    fetchedRows: rawRows.length,
    validRows: units.length,
    skippedRows: skipped,
    pages,
    stoppedReason,
  };
}

/** Поля из сырой строки WB для диагностики (дополнение к {@link WbOrderUnit}). */
export interface WbOrderRawDiagnosticsFields {
  date: string | null;
  oblastOkrugName: string | null;
  countryName: string | null;
  cancelDate: string | null;
  orderType: string | null;
}

export function extractRawOrderDiagnosticsFields(raw: unknown): WbOrderRawDiagnosticsFields {
  const parsed = wbSupplierOrderRowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      date: null,
      oblastOkrugName: null,
      countryName: null,
      cancelDate: null,
      orderType: null,
    };
  }
  const d = parsed.data;
  return {
    date: d.date ?? null,
    oblastOkrugName: d.oblastOkrugName ?? null,
    countryName: d.countryName ?? null,
    cancelDate: d.cancelDate ?? null,
    orderType: d.orderType ?? null,
  };
}
