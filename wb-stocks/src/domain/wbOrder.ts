import { z } from "zod";

/**
 * Raw row shape returned by WB Statistics API:
 *   GET https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=...
 *
 * One row = one ordered unit (1 piece). We only declare the fields we
 * actually use; WB returns ~25 more (category/brand/finishedPrice/...) which
 * we deliberately ignore — pricing/catalog is out of scope for this module.
 *
 * Strings are `.nullish()` to absorb both `null` and missing properties
 * (WB is loose on that distinction). Pure numerics that are not identifiers
 * use `.nullish()` too. `nmId` itself must always be present and integer:
 * a row without it is unusable.
 */
export const wbSupplierOrderRowSchema = z.object({
  date: z.string(),
  lastChangeDate: z.string().nullish(),
  warehouseName: z.string().nullish(),
  warehouseType: z.string().nullish(),
  countryName: z.string().nullish(),
  oblastOkrugName: z.string().nullish(),
  regionName: z.string().nullish(),
  supplierArticle: z.string().nullish(),
  nmId: z.number().int(),
  barcode: z.string().nullish(),
  techSize: z.string().nullish(),
  isCancel: z.boolean().nullish(),
  cancelDate: z.string().nullish(),
  orderType: z.string().nullish(),
  srid: z.string().nullish(),
});
export type WbSupplierOrderRow = z.infer<typeof wbSupplierOrderRowSchema>;

/**
 * Per-row internal projection of a single ordered unit, after
 * `mapWbOrderRow` validated and normalized it. The aggregator
 * (`importWbOrders`) groups these by `(orderDate, warehouseKey, nmId,
 * techSize)` and writes into `wb_orders_daily`.
 */
export interface WbOrderUnit {
  /** YYYY-MM-DD in Moscow time, derived from `date`. */
  orderDate: string;
  /** Original `lastChangeDate` (RFC3339, Moscow tz) — for paging. */
  lastChangeDate: string | null;
  /** Original WB warehouseName, untouched (null if WB sent null). */
  warehouseNameRaw: string | null;
  /** Normalized form used as join key. Always non-empty. */
  warehouseKey: string;
  nmId: number;
  /** Empty string when WB sent null/empty — never null in PK. */
  techSize: string;
  vendorCode: string | null;
  barcode: string | null;
  isCancel: boolean;
  /** WB's internal order id (unique per ordered unit). */
  srid: string | null;
  /** `regionName` из WB — регион заказа (buyer-side); для агрегата по регионам. */
  regionNameRaw: string | null;
  /** Нормализованный ключ региона (`<no-region>` если WB не прислал регион). */
  regionKey: string;
}

/**
 * One row of `wb_orders_daily` (the pre-aggregate that powers demand
 * snapshots).
 *
 * Idempotency key: `(orderDate, warehouseKey, nmId, techSize)`.
 * `vendorCode` and `barcode` are payload-only — kept for debugging and
 * for joining with our own warehouse data — never part of the key.
 */
export interface WbOrdersDailyRecord {
  orderDate: string; // YYYY-MM-DD (Moscow tz)
  warehouseNameRaw: string | null;
  warehouseKey: string;
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  barcode: string | null;
  /** Net of cancellations: WB orders that the seller actually has to fulfil. */
  units: number;
  /** Orders cancelled by buyer / WB. */
  cancelledUnits: number;
  /** All rows seen for the key, regardless of cancellation. */
  grossUnits: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Агрегат заказов по `(orderDate, regionKey, nmId, techSize)` → `wb_orders_daily_by_region`.
 * Ключ: `(orderDate, regionKey, nmId, techSize)`.
 */
export interface WbOrdersDailyRegionRecord {
  orderDate: string;
  regionNameRaw: string | null;
  regionKey: string;
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  barcode: string | null;
  units: number;
  cancelledUnits: number;
  grossUnits: number;
  firstSeenAt: string;
  lastSeenAt: string;
}
