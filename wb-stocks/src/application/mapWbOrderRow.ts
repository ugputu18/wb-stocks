import {
  wbSupplierOrderRowSchema,
  type WbOrderUnit,
} from "../domain/wbOrder.js";
import { warehouseKey } from "../domain/warehouseName.js";

export type MapOrderResult =
  | { ok: true; value: WbOrderUnit }
  | { ok: false; reason: string; raw: unknown };

/**
 * Validate + normalize a single raw row from `/api/v1/supplier/orders`.
 * Bad rows are returned as `{ ok: false, ... }` so the importer can log
 * them and keep aggregating the rest of the batch.
 */
export function mapWbOrderRow(raw: unknown): MapOrderResult {
  const parsed = wbSupplierOrderRowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; "),
      raw,
    };
  }

  const r = parsed.data;
  const orderDate = extractMoscowDate(r.date);
  if (orderDate === null) {
    return {
      ok: false,
      reason: `date: cannot extract YYYY-MM-DD from ${JSON.stringify(r.date)}`,
      raw,
    };
  }

  return {
    ok: true,
    value: {
      orderDate,
      lastChangeDate: nullableString(r.lastChangeDate),
      warehouseNameRaw: nullableString(r.warehouseName),
      warehouseKey: warehouseKey(r.warehouseName),
      nmId: r.nmId,
      techSize: normalizeTechSize(r.techSize),
      vendorCode: nullableString(r.supplierArticle),
      barcode: nullableString(r.barcode),
      isCancel: r.isCancel === true,
      srid: nullableString(r.srid),
    },
  };
}

/**
 * WB sends `date` as a naive RFC3339-ish string in Moscow time, e.g.
 * `"2026-04-15T18:08:31"`. The first 10 chars are the date in MSK and
 * that's exactly what we want as the aggregation bucket. We do not call
 * `new Date()` here — that would re-interpret the string as UTC and shift
 * cross-midnight orders into the wrong day.
 */
function extractMoscowDate(s: string): string | null {
  if (typeof s !== "string" || s.length < 10) return null;
  const head = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

function nullableString(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * `tech_size` is part of the PK in `wb_orders_daily`, so missing/empty
 * must collapse to a deterministic value rather than NULL (SQLite would
 * otherwise treat each NULL as distinct under most uniqueness models).
 */
function normalizeTechSize(v: string | null | undefined): string {
  if (v === undefined || v === null) return "";
  return v.trim();
}
